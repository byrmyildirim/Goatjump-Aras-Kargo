import { Modal, BlockStack, Text, Button, InlineStack } from '@shopify/polaris';
import Barcode from './Barcode';

interface ShippingLabelModalProps {
    open: boolean;
    onClose: () => void;
    mok: string;
    orderName: string;
    supplierName: string;
    receiverName: string;
    receiverAddress: string;
    receiverCity: string;
    receiverPhone?: string;
    pieceCount?: number;
    items: { title: string; quantity: number }[];
}

export default function ShippingLabelModal({
    open,
    onClose,
    mok,
    orderName,
    supplierName,
    receiverName,
    receiverAddress,
    receiverCity,
    receiverPhone,
    pieceCount = 1,
    items
}: ShippingLabelModalProps) {

    const handlePrint = () => {
        const printContent = document.getElementById('shipping-label-content');
        if (printContent) {
            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(`
                    <html>
                    <head>
                        <title>Kargo Fişi - ${orderName}</title>
                        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                        <style>
                            @page { margin: 0; }
                            body { font-family: Arial, sans-serif; padding: 10px; margin: 0; }
                            .label-container { max-width: 400px; margin: auto; }
                            table { width: 100%; border-collapse: collapse; border: 1px solid #000; font-size: 11px; }
                            th, td { border: 1px solid #000; padding: 4px; text-align: left; vertical-align: top; }
                            .header-row { background-color: #f2f2f2; text-align: center; font-weight: bold; font-size: 14px; }
                            .label-col { width: 25%; font-weight: bold; }
                            .value-col { width: 75%; }
                            .barcode-section { text-align: center; padding: 10px 0; border: 1px solid #000; border-top: none; }
                            #barcode { width: 100%; max-height: 100px; }
                            .barcode-text { font-size: 14px; font-weight: bold; margin-top: 5px; }
                        </style>
                    </head>
                    <body>
                        <div class="label-container">
                            <table>
                                <tr class="header-row">
                                    <td colspan="2">Gönderici Bilgileri</td>
                                </tr>
                                <tr>
                                    <td class="label-col">Firma</td>
                                    <td class="value-col">GOAT JUMP SPOR MALZEMELERİ İTHALAT İHRACAT VE TİCARET ANONİM ŞİRKETi</td>
                                </tr>
                                <tr>
                                    <td class="label-col">Telefon</td>
                                    <td class="value-col">05335765151</td>
                                </tr>
                                <tr>
                                    <td class="label-col">Adres</td>
                                    <td class="value-col">YENİKÖY MAH. KERAMİBEY SK. NO: 1 İÇ KAPI NO: 2 SARIYER/ İSTANBUL Sarıyer / İstanbul</td>
                                </tr>
                                <tr class="header-row">
                                    <td colspan="2">Alıcı Bilgileri</td>
                                </tr>
                                <tr>
                                    <td class="label-col">İsim</td>
                                    <td class="value-col"><strong>${receiverName}</strong></td>
                                </tr>
                                <tr>
                                    <td class="label-col">Telefon</td>
                                    <td class="value-col">${receiverPhone || ''}</td>
                                </tr>
                                <tr>
                                    <td class="label-col">Adres</td>
                                    <td class="value-col">${receiverAddress} ${receiverCity}</td>
                                </tr>
                                <tr class="header-row">
                                    <td colspan="2">Kargo Bilgileri</td>
                                </tr>
                                <tr>
                                    <td class="label-col">Kargo Firması</td>
                                    <td class="value-col">Aras Kargo</td>
                                </tr>
                                <tr>
                                    <td class="label-col">Ödeme Türü</td>
                                    <td class="value-col">Gönderici Ödemeli</td>
                                </tr>
                                <tr>
                                    <td class="label-col">Kargo Tipi</td>
                                    <td class="value-col">Gönderici Ödemeli Kargo</td>
                                </tr>
                                <tr>
                                    <td class="label-col">Paket Sayısı</td>
                                    <td class="value-col">${pieceCount}/${pieceCount}</td>
                                </tr>
                                <tr>
                                    <td class="label-col">Desi</td>
                                    <td class="value-col">1</td>
                                </tr>
                            </table>
                            <div class="barcode-section">
                                <svg id="barcode"></svg>
                                <div class="barcode-text">${mok}</div>
                            </div>
                        </div>
                        <script>
                            JsBarcode("#barcode", "${mok}", { 
                                format: "CODE128", 
                                height: 50, 
                                displayValue: false,
                                margin: 0,
                                width: 2
                            });
                            setTimeout(() => window.print(), 500);
                        </script>
                    </body>
                    </html>
                `);
                printWindow.document.close();
            }
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Kargo Fişi"
            primaryAction={{
                content: 'Yazdır',
                onAction: handlePrint
            }}
            secondaryActions={[
                { content: 'Kapat', onAction: onClose }
            ]}
        >
            <Modal.Section>
                <div id="shipping-label-content" style={{ padding: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', fontSize: '12px' }}>
                        <tbody>
                            <tr style={{ backgroundColor: '#f2f2f2', textAlign: 'center', fontWeight: 'bold' }}>
                                <td colSpan={2} style={{ border: '1px solid #000', padding: '8px' }}>Gönderici Bilgileri</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold', width: '30%' }}>Firma</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>GOAT JUMP SPOR MALZEMELERİ İTHALAT İHRACAT VE TİCARET ANONİM ŞİRKETi</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>Telefon</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>05335765151</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>Adres</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>YENİKÖY MAH. KERAMİBEY SK. NO: 1 İÇ KAPI NO: 2 SARIYER/ İSTANBUL Sarıyer / İstanbul</td>
                            </tr>
                            <tr style={{ backgroundColor: '#f2f2f2', textAlign: 'center', fontWeight: 'bold' }}>
                                <td colSpan={2} style={{ border: '1px solid #000', padding: '8px' }}>Alıcı Bilgileri</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>İsim</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}><strong>{receiverName}</strong></td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>Telefon</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>{receiverPhone}</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>Adres</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>{receiverAddress} {receiverCity}</td>
                            </tr>
                            <tr style={{ backgroundColor: '#f2f2f2', textAlign: 'center', fontWeight: 'bold' }}>
                                <td colSpan={2} style={{ border: '1px solid #000', padding: '8px' }}>Kargo Bilgileri</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>Kargo Firması</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>Aras Kargo</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>Ödeme Türü</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>Gönderici Ödemeli</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>Kargo Tipi</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>Gönderici Ödemeli Kargo</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>Paket Sayısı</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>{pieceCount}/{pieceCount}</td>
                            </tr>
                            <tr>
                                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 'bold' }}>Desi</td>
                                <td style={{ border: '1px solid #000', padding: '6px' }}>1</td>
                            </tr>
                        </tbody>
                    </table>
                    <div style={{ textAlign: 'center', padding: '10px 0', border: '1px solid #000', borderTop: 'none' }}>
                        <Barcode value={mok} height={60} />
                    </div>
                </div>
            </Modal.Section>
        </Modal>
    );
}
