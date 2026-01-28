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

export const getShipmentStatus = async (
    mok: string,
    settings: ArasKargoSettings
): Promise<{ success: boolean; trackingNumber?: string; message: string; rawResponse?: string }> => {
    // Redirect to the verified WCF service implementation
    return await getTrackingNumberByQueryService(mok, settings);
};

export const getTrackingNumberByQueryService = async (
    mok: string,
    settings: ArasKargoSettings
): Promise<{ success: boolean; trackingNumber?: string; message: string; rawResponse?: string }> => {
    if (!settings.queryUsername || !settings.queryPassword || !settings.queryCustomerCode) {
        return { success: false, message: 'Ayarlar eksik (Kullanıcı Adı, Şifre veya Müşteri Kodu eksik).' };
    }

    const url = 'https://customerservices.araskargo.com.tr/ArasCargoCustomerIntegrationService/ArasCargoIntegrationService.svc';

    // LoginInfo XML String (Inner XML)
    const loginInfoString = `<LoginInfo><UserName>${settings.queryUsername}</UserName><Password>${settings.queryPassword}</Password><CustomerCode>${settings.queryCustomerCode}</CustomerCode></LoginInfo>`;

    // ---------------------------------------------------------
    // ATTEMPT 1: GetQueryDS (XML DataSet) - QueryType 1
    // Recommended by latest user feedback/Gemini solution
    // ---------------------------------------------------------

    // Using QueryType 1 for IntegrationCode as per suggested solution
    const queryInfoStringDS = `<QueryInfo><QueryType>1</QueryType><IntegrationCode>${mok}</IntegrationCode></QueryInfo>`;

    // SOAP Envelope with CDATA and correct namespaces (tem:)
    const soapEnvelopeDS = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
       <soapenv:Header/>
       <soapenv:Body>
          <tem:GetQueryDS>
             <tem:loginInfo><![CDATA[${loginInfoString}]]></tem:loginInfo>
             <tem:queryInfo><![CDATA[${queryInfoStringDS}]]></tem:queryInfo>
          </tem:GetQueryDS>
       </soapenv:Body>
    </soapenv:Envelope>`;

    try {
        const responseDS = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://tempuri.org/IArasCargoIntegrationService/GetQueryDS'
            },
            body: soapEnvelopeDS
        });

        const responseTextDS = await responseDS.text();

        // Parse Response (Extract Inner XML from GetQueryDSResult)
        const resultMatch = responseTextDS.match(/<GetQueryDSResult>(.*?)<\/GetQueryDSResult>/s);

        if (resultMatch && resultMatch[1]) {
            const innerXML = resultMatch[1];

            // Regex for possible tracking number tags in the DataSet XML
            const trackingMatch = innerXML.match(/<(?:KARGO_TAKIP_NO|TrackingNumber|KargoTakipNo|TakipNo)[^>]*>(.*?)<\//i);

            if (trackingMatch && trackingMatch[1] && trackingMatch[1] !== mok) {
                return {
                    success: true,
                    message: "GetQueryDS başarılı",
                    trackingNumber: trackingMatch[1],
                    rawResponse: `--- GetQueryDS Result ---\n${innerXML}`
                };
            }
        }

    } catch (error) {
        console.error("GetQueryDS failed:", error);
    }

    // ---------------------------------------------------------
    // ATTEMPT 2: GetQueryJSON - QueryType 100 (Backup)
    // ---------------------------------------------------------

    const queryInfoStringJSON = `<QueryInfo><QueryType>100</QueryType><IntegrationCode>${mok}</IntegrationCode></QueryInfo>`;

    const soapEnvelopeJSON = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
       <soapenv:Header/>
       <soapenv:Body>
          <tem:GetQueryJSON>
             <tem:loginInfo><![CDATA[${loginInfoString}]]></tem:loginInfo>
             <tem:queryInfo><![CDATA[${queryInfoStringJSON}]]></tem:queryInfo>
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
            body: soapEnvelopeJSON
        });

        const responseText = await response.text();

        // Parse Response
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
            message: "Takip numarası bulunamadı (GetQueryDS ve GetQueryJSON denendi)",
            rawResponse: responseText
        };

    } catch (error) {
        return { success: false, message: "Servis hatası: " + (error as Error).message };
    }
};

// function escapeXml removed because it is already defined at line 63

/**
 * Get delivery status from Aras Kargo API
 * Returns status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'UNKNOWN'
 * 
 * Aras Kargo DURUM_KODU values (from documentation page 9):
 * 1 = Teslim Edildi (Delivered)
 * 9 = Şubede (At Branch - ready for delivery)
 * Other values = In Transit / Processing
 */
export const getDeliveryStatus = async (
    trackingNumber: string,
    settings: ArasKargoSettings
): Promise<{ success: boolean; status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'UNKNOWN'; message: string; rawResponse?: string }> => {
    if (!settings.queryUsername || !settings.queryPassword || !settings.queryCustomerCode) {
        return { success: false, status: 'UNKNOWN', message: 'Ayarlar eksik.' };
    }

    const url = 'https://customerservices.araskargo.com.tr/ArasCargoCustomerIntegrationService/ArasCargoIntegrationService.svc';

    const loginInfoString = `<LoginInfo><UserName>${settings.queryUsername}</UserName><Password>${settings.queryPassword}</Password><CustomerCode>${settings.queryCustomerCode}</CustomerCode></LoginInfo>`;

    // QueryType 2 = Query by Tracking Number (Kargo Takip Numarası ile sorgulama)
    const queryInfoString = `<QueryInfo><QueryType>2</QueryType><TrackingNumber>${trackingNumber}</TrackingNumber></QueryInfo>`;

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
        console.log('[getDeliveryStatus] Raw Response for tracking:', trackingNumber, responseText.substring(0, 500));

        // Parse Response
        const match = responseText.match(/<GetQueryJSONResult>(.*?)<\/GetQueryJSONResult>/);
        const jsonResultString = match ? match[1] : null;

        if (jsonResultString) {
            try {
                const jsonResult = JSON.parse(jsonResultString);
                console.log('[getDeliveryStatus] Parsed JSON:', JSON.stringify(jsonResult, null, 2));

                let foundItem: any = null;
                if (Array.isArray(jsonResult) && jsonResult.length > 0) {
                    // Get the latest item (usually last in array has most recent status)
                    foundItem = jsonResult[jsonResult.length - 1];
                } else if (typeof jsonResult === 'object') {
                    foundItem = jsonResult;
                }

                if (foundItem) {
                    // Check DURUM_KODU field (primary status indicator from Aras Kargo)
                    // According to documentation:
                    // DURUM_KODU = 1 -> Teslim Edildi (Delivered)
                    // DURUM_KODU = 9 -> Şubede (At Branch)
                    // Other values -> In Transit

                    const durumKodu = foundItem['DURUM_KODU'] || foundItem['DurumKodu'] || foundItem['durumKodu'] || foundItem['StatusCode'];
                    const durumKoduNum = parseInt(String(durumKodu), 10);

                    console.log('[getDeliveryStatus] DURUM_KODU:', durumKodu, 'Parsed:', durumKoduNum);

                    // Check for delivery indicators
                    // DURUM_KODU = 1 means delivered
                    if (durumKoduNum === 1) {
                        return {
                            success: true,
                            status: 'DELIVERED',
                            message: 'Kargo teslim edildi (DURUM_KODU=1)',
                            rawResponse: JSON.stringify(foundItem, null, 2)
                        };
                    }

                    // Check for text-based status in other fields
                    const allValues = Object.values(foundItem).map(v => String(v).toUpperCase());
                    const hasDeliveredText = allValues.some(v =>
                        v.includes('TESLİM EDİLDİ') ||
                        v.includes('TESLIM EDILDI') ||
                        v.includes('TESLİM') ||
                        v.includes('DELIVERED')
                    );

                    if (hasDeliveredText) {
                        return {
                            success: true,
                            status: 'DELIVERED',
                            message: 'Kargo teslim edildi (metin kontrolü)',
                            rawResponse: JSON.stringify(foundItem, null, 2)
                        };
                    }

                    // Check for delivery date fields
                    const deliveryDateFields = ['TESLIM_TARIHI', 'TeslimTarihi', 'DeliveryDate', 'TESLIM_ZAMANI'];
                    for (const field of deliveryDateFields) {
                        const val = foundItem[field];
                        if (val && val !== '' && val !== null && val !== '0' && val !== 'null') {
                            return {
                                success: true,
                                status: 'DELIVERED',
                                message: `Kargo teslim edildi (${field} mevcut)`,
                                rawResponse: JSON.stringify(foundItem, null, 2)
                            };
                        }
                    }

                    // If we have any data, it's in transit
                    if (Object.keys(foundItem).length > 0) {
                        return {
                            success: true,
                            status: 'IN_TRANSIT',
                            message: `Kargo kargoda (DURUM_KODU=${durumKodu || 'yok'})`,
                            rawResponse: JSON.stringify(foundItem, null, 2)
                        };
                    }
                }

            } catch (e) {
                console.error('[getDeliveryStatus] JSON parse error:', e);
                return {
                    success: false,
                    status: 'UNKNOWN',
                    message: 'JSON parse hatası',
                    rawResponse: jsonResultString
                };
            }
        }

        return {
            success: false,
            status: 'UNKNOWN',
            message: 'Kargo durumu alınamadı',
            rawResponse: responseText
        };

    } catch (error) {
        console.error('[getDeliveryStatus] Service error:', error);
        return {
            success: false,
            status: 'UNKNOWN',
            message: 'Servis hatası: ' + (error as Error).message
        };
    }
};

