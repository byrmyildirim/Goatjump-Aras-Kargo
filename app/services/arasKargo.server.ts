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
): Promise<{ success: boolean; trackingNumber?: string; status?: string; message?: string }> => {

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
        const cargoBarcodeNode = orderNode.getElementsByTagName("CargoBarcode")[0] || orderNode.getElementsByTagName("InvoiceNumber")[0];
        const statusNode = orderNode.getElementsByTagName("Status")[0];

        const trackingNumber = cargoBarcodeNode?.textContent;
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
