import { DOMParser } from '@xmldom/xmldom';
import type { ArasKargoSettings } from '@prisma/client';

export interface CreateShipmentInput {
    orderNumber: string;
    items: { title: string; quantity: number }[];
    shippingAddress: {
        firstName: string;
        lastName: string;
        address1: string;
        address2?: string | null;
        city: string; // İlçe
        province: string; // İl
        phone: string;
        zip?: string | null;
    };
    supplier: {
        name: string;
        supplierCode: string;
        arasAddressId: string;
    };
    pieceCount: number;
}

// --- START: Smart Address Correction Helpers ---
// A set of Turkish provinces in lowercase for case-insensitive matching.
const turkishProvinces = new Set([
    'adana', 'adiyaman', 'afyonkarahisar', 'ağri', 'amasya', 'ankara', 'antalya', 'artvin', 'aydin',
    'balikesir', 'bilecik', 'bingöl', 'bitlis', 'bolu', 'burdur', 'bursa', 'çanakkale', 'çankiri',
    'çorum', 'denizli', 'diyarbakir', 'edirne', 'elaziğ', 'erzincan', 'erzurum', 'eskişehir',
    'gaziantep', 'giresun', 'gümüşhane', 'hakkari', 'hatay', 'isparta', 'mersin', 'istanbul',
    'izmir', 'kars', 'kastamonu', 'kayseri', 'kirklareli', 'kirşehir', 'kocaeli', 'konya',
    'kütahya', 'malatya', 'manisa', 'kahramanmaraş', 'mardin', 'muğla', 'muş', 'nevşehir',
    'niğde', 'ordu', 'rize', 'sakarya', 'samsun', 'siirt', 'sinop', 'sivas', 'tekirdağ',
    'tokat', 'trabzon', 'tunceli', 'şanliurfa', 'uşak', 'van', 'yozgat', 'zonguldak', 'aksaray',
    'bayburt', 'karaman', 'kirikkale', 'batman', 'şirnak', 'bartin', 'ardahan', 'iğdir',
    'yalova', 'karabük', 'kilis', 'osmaniye', 'düzce'
]);

const getDistrictFromZip = (zip: string | null | undefined): string | null => {
    if (!zip) return null;
    const zipToDistrictMap = new Map([
        ['34197', 'Bahçelievler'],
        ['34149', 'Bakırköy'],
        ['34720', 'Kadıköy'],
        ['34696', 'Üsküdar'],
        ['34394', 'Şişli'],
        ['34433', 'Beyoğlu'],
        ['06420', 'Çankaya'],
        ['35620', 'Karşıyaka'],
        ['16110', 'Nilüfer'],
    ]);
    return zipToDistrictMap.get(zip) || null;
};
// --- END: Smart Address Correction Helpers ---

const generateMOK = (orderNumber: string, supplierCode: string, maxLength: number = 30): string => {
    const uniquePart = (Date.now() % 100000).toString().padStart(5, '0');
    const cleanedOrderNumber = orderNumber.replace(/[^a-zA-Z0-9]/g, '');
    return `${cleanedOrderNumber}${supplierCode}${uniquePart}`.substring(0, maxLength);
};

const escapeXml = (unsafe: string | null | undefined): string => {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

export const sendPackageToAras = async (
    input: CreateShipmentInput,
    settings: ArasKargoSettings
): Promise<{ success: boolean; mok?: string; message: string }> => {

    if (!settings.senderUsername || !settings.senderPassword) {
        return { success: false, message: 'Aras Kargo ayarları eksik. Lütfen Ayarlar sayfasından yapılandırın.' };
    }

    try {
        const pieceCount = input.pieceCount || 1;
        const suffixLength = pieceCount > 1 ? String(pieceCount).length + 1 : 0;
        const maxMokLength = 30 - suffixLength;

        const mok = generateMOK(input.orderNumber, input.supplier.supplierCode, maxMokLength);

        // Address Correction Logic
        let cityName = input.shippingAddress.province; // İl
        let townName = input.shippingAddress.city;     // İlçe

        if (!cityName || cityName.trim() === '') {
            const potentialProvince = townName?.toLocaleLowerCase('tr-TR').trim();
            if (potentialProvince && turkishProvinces.has(potentialProvince)) {
                cityName = townName;
                townName = getDistrictFromZip(input.shippingAddress.zip) || '';
            }
        }

        if ((!townName || townName.trim() === '') && input.shippingAddress.zip) {
            const districtFromZip = getDistrictFromZip(input.shippingAddress.zip);
            if (districtFromZip) {
                townName = districtFromZip;
            }
        }

        if (!cityName || cityName.trim() === '') {
            return { success: false, message: "Kargo gönderimi başarısız: 'İl' (Province) bilgisi eksik. Lütfen Shopify siparişinde adresi düzenleyin." };
        }

        // Escape and format data
        const receiverName = escapeXml(`${input.shippingAddress.firstName} ${input.shippingAddress.lastName}`.trim());
        const fullAddress = escapeXml([input.shippingAddress.address1, input.shippingAddress.address2].filter(Boolean).join(', '));
        const receiverPhone = escapeXml(input.shippingAddress.phone);
        const escapedCityName = escapeXml(cityName.toLocaleUpperCase('tr-TR'));
        const escapedTownName = escapeXml(townName?.toLocaleUpperCase('tr-TR'));

        // Content Description (Parça içeriği)
        // If 'parcaBilgisiGonderilsin' is true, we send detail. Otherwise maybe generic?
        // Actually Aras requires some content description.
        // We will stick to the logic: item titles joined.
        const content = escapeXml(input.items.map(i => i.title).join(', ').substring(0, 255));

        const invoiceNo = escapeXml(input.orderNumber.replace('#', ''));

        // Sender Account Address ID logic
        let senderAddressId = input.supplier.arasAddressId;
        // Check setting 'addressIdGonderimi'
        // If strict 'Pasif' means "Do not send tag", we might need to conditionally render XML tag.
        // But usually empty string is safer or just following the 'Panel' app logic (which always sent it).
        // The Panel app doc implies we respect the supplier's AddressID.
        // I'll assume if it's "Pasif", we might still send it because the supplier needs to be identified?
        // No, usually "Aktif" means "Use the specific branch ID", "Pasif" might mean "Use default account binding".

        // Implementing logic based on doc hints:
        if (settings.addressIdGonderimi === 'Pasif') {
            // senderAddressId = ""; // Uncomment if 'Pasif' means sending empty
            // For now, mirroring Panel logic: It always sent 'supplierInfo.arasAddressId'.
        }

        // Piece Details
        let generatedPiecesXML = '';
        const contentSummary = input.items.map(i => `${i.quantity}x ${i.title}`).join(', ').substring(0, 50);

        for (let i = 1; i <= pieceCount; i++) {
            let pieceBarcode = mok;
            if (pieceCount > 1) {
                pieceBarcode = `${mok}-${i}`;
            }

            generatedPiecesXML += `
              <PieceDetail>
                  <VolumetricWeight>1</VolumetricWeight>
                  <Weight>1</Weight>
                  <BarcodeNumber>${escapeXml(pieceBarcode)}</BarcodeNumber>
                  <Description>${escapeXml(contentSummary)}</Description>
              </PieceDetail>`;
        }

        const soapRequestXML = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <SetOrder xmlns="http://tempuri.org/">
      <orderInfo>
        <Order>
          <IntegrationCode>${escapeXml(mok)}</IntegrationCode>
          <ReceiverName>${receiverName}</ReceiverName>
          <ReceiverAddress>${fullAddress}</ReceiverAddress>
          <ReceiverPhone1>${receiverPhone}</ReceiverPhone1>
          <ReceiverCityName>${escapedCityName}</ReceiverCityName>
          <ReceiverTownName>${escapedTownName}</ReceiverTownName>
          <SenderAccountAddressId>${escapeXml(senderAddressId)}</SenderAccountAddressId>
          <PieceCount>${pieceCount}</PieceCount>
          <PieceDetails>
            ${generatedPiecesXML}
          </PieceDetails>
          <Content>${content}</Content>
          <WaybillNo></WaybillNo>
          <InvoiceNo>${invoiceNo}</InvoiceNo>
          <CodAmount>0</CodAmount>
          <CodCollectionType>0</CodCollectionType>
          <CodCostType>0</CodCostType>
          <IsCod>0</IsCod>
          <PayorTypeCode>1</PayorTypeCode>
          <IsWorldWide>0</IsWorldWide>
          <ServiceType>0</ServiceType>
          <PackagingType>1</PackagingType>
        </Order>
      </orderInfo>
      <userName>${escapeXml(settings.senderUsername)}</userName>
      <password>${escapeXml(settings.senderPassword)}</password>
    </SetOrder>
  </soap12:Body>
</soap12:Envelope>`;

        const response = await fetch('https://customerws.araskargo.com.tr/arascargoservice.asmx', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/soap+xml; charset=utf-8',
            },
            body: soapRequestXML
        });

        const responseText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(responseText, "text/xml");

        const resultCodeNode = xmlDoc.getElementsByTagName("ResultCode")[0];
        const resultMessageNode = xmlDoc.getElementsByTagName("ResultMessage")[0];

        const resultCode = resultCodeNode?.textContent;
        const resultMessage = resultMessageNode?.textContent || "Bilinmeyen yanıt formatı.";

        if (resultCode === "0") {
            return {
                success: true,
                message: `Aras Kargo alımı başarılı. MÖK: ${mok}`,
                mok
            };
        } else {
            return {
                success: false,
                message: `Aras Kargo Hatası (Kod: ${resultCode}): ${resultMessage}`
            };
        }

    } catch (error) {
        console.error("Aras Kargo API Error:", error);
        return { success: false, message: error instanceof Error ? error.message : "Sistem hatası" };
    }
};

export const getShipmentStatus = async (
    mok: string,
    settings: ArasKargoSettings
): Promise<{ success: boolean; trackingNumber?: string; status?: string; message?: string; rawResponse?: string }> => {

    if (!settings.queryUsername || !settings.queryPassword) {
        return { success: false, message: "Sorgu kullanıcı bilgileri eksik." };
    }

    const soapRequestXML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetOrderWithIntegrationCode xmlns="http://tempuri.org/">
      <userName>${escapeXml(settings.queryUsername)}</userName>
      <password>${escapeXml(settings.queryPassword)}</password>
      <integrationCode>${escapeXml(mok)}</integrationCode>
    </GetOrderWithIntegrationCode>
  </soap:Body>
</soap:Envelope>`;

    try {
        const response = await fetch('https://customerws.araskargo.com.tr/arascargoservice.asmx', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://tempuri.org/GetOrderWithIntegrationCode'
            },
            body: soapRequestXML
        });

        const responseText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(responseText, "text/xml");

        const orders = xmlDoc.getElementsByTagName("Order");
        if (!orders || orders.length === 0) {
            return { success: false, message: "Kargo takibi: Kayıt bulunamadı.", rawResponse: responseText };
        }

        const orderNode = orders[0];
        // Try multiple fields for tracking number
        let trackingNumber = orderNode.getElementsByTagName("CargoBarcode")[0]?.textContent;

        // If CargoBarcode is empty or missing, try PieceDetails > BarcodeNumber (ChatGPT advice)
        if (!trackingNumber) {
            const pieceDetails = orderNode.getElementsByTagName("PieceDetails")[0];
            if (pieceDetails) {
                const pieceDetail = pieceDetails.getElementsByTagName("PieceDetail")[0];
                if (pieceDetail) {
                    trackingNumber = pieceDetail.getElementsByTagName("BarcodeNumber")[0]?.textContent;
                }
            }
        }

        // Fallback to InvoiceNumber if completely desperate, but usually that is distinct
        if (!trackingNumber) {
            trackingNumber = orderNode.getElementsByTagName("InvoiceNumber")[0]?.textContent;
        }

        const statusNode = orderNode.getElementsByTagName("Status")[0];
        const status = statusNode?.textContent;

        if (trackingNumber) {
            return {
                success: true,
                trackingNumber,
                status: status || "İşlem görüyor",
                rawResponse: responseText // Added for debugging
            };
        }

        return { success: false, message: "Takip numarası henüz oluşmamış.", rawResponse: responseText };

    } catch (error) {
        return { success: false, message: "Sorgulama hatası: " + (error as Error).message };
    }
};

export const getBarcode = async (
    mok: string,
    settings: ArasKargoSettings
): Promise<{ success: boolean; barcodeBase64?: string; message: string }> => {
    if (!settings.queryUsername || !settings.queryPassword) {
        return { success: false, message: 'Ayarlar eksik.' };
    }

    const soapRequestXML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetBarcode xmlns="http://tempuri.org/">
      <userName>${escapeXml(settings.queryUsername)}</userName>
      <password>${escapeXml(settings.queryPassword)}</password>
      <integrationCode>${escapeXml(mok)}</integrationCode>
    </GetBarcode>
  </soap:Body>
</soap:Envelope>`;

    try {
        const response = await fetch('https://customerws.araskargo.com.tr/arascargoservice.asmx', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://tempuri.org/GetBarcode'
            },
            body: soapRequestXML
        });

        const responseText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(responseText, "text/xml");

        let base64 = "";
        const resultNode = xmlDoc.getElementsByTagName("GetBarcodeResult")[0];
        if (resultNode) {
            base64 = resultNode.textContent || "";
        }

        // Some fallback check
        if (!base64) {
            const manualNode = xmlDoc.getElementsByTagName("Barcode")[0];
            if (manualNode) base64 = manualNode.textContent || "";
        }

        if (base64) {
            return { success: true, message: "Barkod alındı", barcodeBase64: base64 };
        } else {
            return { success: false, message: "Barkod oluşturulamadı veya servisten boş döndü." };
        }

    } catch (error) {
        console.error("Barcode Error:", error);
        return { success: false, message: "Barkod servisi hatası" };
    }
};

export const getShipmentBarcode = async (
    mok: string,
    settings: ArasKargoSettings
): Promise<{ success: boolean; trackingNumber?: string; barcode?: string; message: string; rawResponse?: string }> => {
    if (!settings.queryUsername || !settings.queryPassword) {
        return { success: false, message: 'Ayarlar eksik.' };
    }

    // Try 1: GetLabelDummy - WSDL shows it has explicit TrackingNumber in response (line 593)
    const labelDummyXML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetLabelDummy xmlns="http://tempuri.org/">
      <Username>${escapeXml(settings.queryUsername)}</Username>
      <Password>${escapeXml(settings.queryPassword)}</Password>
      <integrationCode>${escapeXml(mok)}</integrationCode>
    </GetLabelDummy>
  </soap:Body>
</soap:Envelope>`;

    try {
        const response1 = await fetch('https://customerws.araskargo.com.tr/arascargoservice.asmx', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://tempuri.org/GetLabelDummy'
            },
            body: labelDummyXML
        });

        const responseText1 = await response1.text();
        const parser = new DOMParser();
        const xmlDoc1 = parser.parseFromString(responseText1, "text/xml");

        // GetLabelDummy returns DummyBarcodeResponse with direct TrackingNumber field
        const trackingNumberDirect = xmlDoc1.getElementsByTagName("TrackingNumber")[0]?.textContent;
        const resultCode1 = xmlDoc1.getElementsByTagName("ResultCode")[0]?.textContent;

        if (trackingNumberDirect && resultCode1 !== "999") {
            return {
                success: true,
                message: "Sorgulama başarılı (GetLabelDummy)",
                trackingNumber: trackingNumberDirect,
                rawResponse: responseText1
            };
        }

        // Check BarcodeModel as fallback within same response
        const barcodeModels1 = xmlDoc1.getElementsByTagName("BarcodeModel");
        if (barcodeModels1.length > 0) {
            const trackingFromModel = barcodeModels1[0].getElementsByTagName("TrackingNumber")[0]?.textContent;
            if (trackingFromModel) {
                return {
                    success: true,
                    message: "Sorgulama başarılı (GetLabelDummy/BarcodeModel)",
                    trackingNumber: trackingFromModel,
                    rawResponse: responseText1
                };
            }
        }

        // If GetLabelDummy didn't work (permission or no data), try GetBarcode (different from GetArasBarcode)
        const getBarcodeXML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetBarcode xmlns="http://tempuri.org/">
      <Username>${escapeXml(settings.queryUsername)}</Username>
      <Password>${escapeXml(settings.queryPassword)}</Password>
      <integrationCode>${escapeXml(mok)}</integrationCode>
    </GetBarcode>
  </soap:Body>
</soap:Envelope>`;

        const response2 = await fetch('https://customerws.araskargo.com.tr/arascargoservice.asmx', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://tempuri.org/GetBarcode'
            },
            body: getBarcodeXML
        });

        const responseText2 = await response2.text();
        const xmlDoc2 = parser.parseFromString(responseText2, "text/xml");

        const barcodeModels2 = xmlDoc2.getElementsByTagName("BarcodeModel");
        if (barcodeModels2.length > 0) {
            const trackingNumber = barcodeModels2[0].getElementsByTagName("TrackingNumber")[0]?.textContent;
            const barcode = barcodeModels2[0].getElementsByTagName("Barcode")[0]?.textContent;

            if (trackingNumber) {
                return {
                    success: true,
                    message: "Sorgulama başarılı (GetBarcode)",
                    trackingNumber,
                    barcode: barcode || undefined,
                    rawResponse: responseText2
                };
            }
        }

        // Try 3: GetCargoInfo - requires customerCode + integrationCode, returns IrsaliyeData
        const getCargoInfoXML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetCargoInfo xmlns="http://tempuri.org/">
      <username>${escapeXml(settings.queryUsername)}</username>
      <password>${escapeXml(settings.queryPassword)}</password>
      <customerCode>${escapeXml(settings.queryCustomerCode || '')}</customerCode>
      <integrationCode>${escapeXml(mok)}</integrationCode>
    </GetCargoInfo>
  </soap:Body>
</soap:Envelope>`;

        const response3 = await fetch('https://customerws.araskargo.com.tr/arascargoservice.asmx', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://tempuri.org/GetCargoInfo'
            },
            body: getCargoInfoXML
        });

        const responseText3 = await response3.text();
        const xmlDoc3 = parser.parseFromString(responseText3, "text/xml");

        // GetCargoInfo returns IrsaliyeData - look for any tracking-related fields
        // Common field names: KARGO_TAKIP_NO, BARCODE, TRACKING_NUMBER, etc.
        const allElements = responseText3.match(/<([A-Z_]+)>([^<]+)<\/\1>/gi) || [];
        const trackingCandidates: Record<string, string> = {};

        for (const elem of allElements) {
            const match = elem.match(/<([A-Z_]+)>([^<]+)<\/\1>/i);
            if (match) {
                const [, tag, value] = match;
                // Look for fields that might contain tracking number
                if (tag.includes('TAKIP') || tag.includes('BARCODE') || tag.includes('TRACKING') ||
                    tag.includes('KARGO') || tag.includes('WAYBILL') || tag.includes('SEVK')) {
                    trackingCandidates[tag] = value;
                }
            }
        }

        if (Object.keys(trackingCandidates).length > 0) {
            return {
                success: true,
                message: "GetCargoInfo - Aday alanlar bulundu",
                trackingNumber: Object.values(trackingCandidates)[0],
                rawResponse: `Bulunan alanlar: ${JSON.stringify(trackingCandidates, null, 2)}\n\n--- Ham XML ---\n${responseText3}`
            };
        }

        // Last resort: return all three responses for debugging
        return {
            success: false,
            message: "Takip numarası bulunamadı. (GetLabelDummy, GetBarcode ve GetCargoInfo denendi)",
            rawResponse: `--- GetLabelDummy ---\n${responseText1}\n\n--- GetBarcode ---\n${responseText2}\n\n--- GetCargoInfo ---\n${responseText3}`
        };

    } catch (error) {
        return { success: false, message: "Servis hatası: " + (error as Error).message };
    }
};

export const getTrackingNumberByQueryService = async (
    mok: string,
    settings: ArasKargoSettings
): Promise<{ success: boolean; trackingNumber?: string; message: string; rawResponse?: string }> => {
    if (!settings.queryUsername || !settings.queryPassword || !settings.queryCustomerCode) {
        return { success: false, message: 'Ayarlar eksik (Kullanıcı Adı, Şifre veya Müşteri Kodu eksik).' };
    }

    const url = 'https://customerservices.araskargo.com.tr/ArasCargoCustomerIntegrationService/ArasCargoIntegrationService.svc';

    // 1. Prepare Inner XML Strings
    // Note: User/password/code are NOT escaped here because they are inside CDATA in the envelope, 
    // OR they should be escaped if they contain special chars? CDATA handles most, but standard practice says 
    // inside CDATA it's just raw text. However, if they contain ']]>' it would break. 
    // I'll assume standard credentials don't have ']]>'.

    const loginInfoString = `<LoginInfo><UserName>${settings.queryUsername}</UserName><Password>${settings.queryPassword}</Password><CustomerCode>${settings.queryCustomerCode}</CustomerCode></LoginInfo>`;
    const queryInfoString = `<QueryInfo><QueryType>100</QueryType><IntegrationCode>${mok}</IntegrationCode></QueryInfo>`;

    // 2. SOAP Envelope with CDATA and correct namespaces (tem:)
    // Gemini said: "Dikkat: 'tem' prefix'i ve 'loginInfo' (küçük harf) burada çok önemli."
    const soapEnvelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
       <soapenv:Header/>
       <soapenv:Body>
          <tem:GetQueryJSON>
             <tem:loginInfo><![CDATA[${loginInfoString}]]></tem:loginInfo>
             <tem:queryInfo><![CDATA[${queryInfoString}]]></tem:queryInfo>
          </tem:GetQueryJSON>
       </soapenv:Body>
    </soapenv:Envelope>`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://tempuri.org/IArasCargoIntegrationService/GetQueryJSON'
            },
            body: soapEnvelope
        });

        const responseText = await response.text();

        // 3. Parse Response
        const match = responseText.match(/<GetQueryJSONResult>(.*?)<\/GetQueryJSONResult>/);
        const jsonResultString = match ? match[1] : null;

        if (jsonResultString) {
            try {
                const jsonResult = JSON.parse(jsonResultString);

                // Assuming jsonResult can be array or object
                let foundItem: any = null;
                if (Array.isArray(jsonResult) && jsonResult.length > 0) {
                    foundItem = jsonResult[0];
                } else if (typeof jsonResult === 'object') {
                    foundItem = jsonResult;
                }

                if (foundItem) {
                    const keys = Object.keys(foundItem);
                    const trackingKey = keys.find(k =>
                        k.toUpperCase().includes("TAKİP") ||
                        k.toUpperCase().includes("TAKIP") ||
                        k.toUpperCase().includes("TRACKING") ||
                        k.toUpperCase().includes("KARGO_TAKIP")
                    );

                    if (trackingKey && foundItem[trackingKey] && foundItem[trackingKey] !== mok) {
                        return {
                            success: true,
                            message: "GetQueryJSON başarılı",
                            trackingNumber: foundItem[trackingKey],
                            rawResponse: JSON.stringify(jsonResult, null, 2)
                        };
                    }

                    // Return data even if tracking number matching logic fails, to let user see
                    return {
                        success: true,
                        message: "Veri döndü (takip no bulunamadı)",
                        trackingNumber: undefined,
                        rawResponse: JSON.stringify(jsonResult, null, 2)
                    };
                }

                // If result code indicates failure
                if (jsonResult.ResultCode && jsonResult.ResultCode !== '0') {
                    return {
                        success: false,
                        message: jsonResult.Message || "Servis hatası",
                        rawResponse: JSON.stringify(jsonResult, null, 2)
                    };
                }

            } catch (e) {
                return { success: false, message: "JSON parse hatası", rawResponse: jsonResultString };
            }
        }

        return {
            success: false,
            message: "GetQueryJSON boş veya hatalı yanıt",
            rawResponse: responseText
        };

    } catch (error) {
        return { success: false, message: "Servis hatası: " + (error as Error).message };
    }
};

// function escapeXml removed because it is already defined at line 63
