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
                            body { font-family: Arial, sans-serif; padding: 20px; }
                            .label { border: 2px solid #000; padding: 20px; max-width: 400px; margin: auto; }
                            .header { text-align: center; border-bottom: 1px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
                            .section { margin-bottom: 15px; }
                            .section-title { font-weight: bold; font-size: 12px; color: #666; margin-bottom: 5px; }
                            .barcode { text-align: center; margin: 20px 0; }
                            .items { font-size: 12px; }
                            .item { padding: 2px 0; }
                        </style>
                    </head>
                    <body>
                        <div class="label">
                            <div class="header">
                                <h2 style="margin: 0;">ARAS KARGO</h2>
                                <p style="margin: 5px 0; font-size: 14px;">Sipariş: ${orderName}</p>
                            </div>
                            <div class="section">
                                <div class="section-title">GÖNDEREN</div>
                                <div>${supplierName}</div>
                            </div>
                            <div class="section">
                                <div class="section-title">ALICI</div>
                                <div><strong>${receiverName}</strong></div>
                                <div>${receiverAddress}</div>
                                <div>${receiverCity}</div>
                            </div>
                            <div class="barcode">
                                <svg id="barcode"></svg>
                            </div>
                            <div class="section">
                                <div class="section-title">İÇERİK</div>
                                <div class="items">
                                    ${items.map(i => `<div class="item">${i.quantity}x ${i.title}</div>`).join('')}
                                </div>
                            </div>
                        </div>
                        <script>
                            JsBarcode("#barcode", "${mok}", { format: "CODE128", height: 60, displayValue: true });
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
                <div id="shipping-label-content">
                    <BlockStack gap="400">
                        <div style={{ textAlign: 'center', borderBottom: '1px solid #ddd', paddingBottom: '12px' }}>
                            <Text as="h2" variant="headingLg">ARAS KARGO</Text>
                            <Text as="p" tone="subdued">Sipariş: {orderName}</Text>
                        </div>

                        <BlockStack gap="200">
                            <Text as="p" variant="bodySm" tone="subdued">GÖNDEREN</Text>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{supplierName}</Text>
                        </BlockStack>

                        <BlockStack gap="200">
                            <Text as="p" variant="bodySm" tone="subdued">ALICI</Text>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{receiverName}</Text>
                            <Text as="p" variant="bodySm">{receiverAddress}</Text>
                            <Text as="p" variant="bodySm">{receiverCity}</Text>
                        </BlockStack>

                        <div style={{ textAlign: 'center', padding: '20px 0', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
                            <Barcode value={mok} height={80} />
                            <Text as="p" variant="headingMd" fontWeight="bold">{mok}</Text>
                        </div>

                        <BlockStack gap="200">
                            <Text as="p" variant="bodySm" tone="subdued">İÇERİK ({items.reduce((sum, i) => sum + i.quantity, 0)} parça)</Text>
                            {items.map((item, idx) => (
                                <Text key={idx} as="p" variant="bodySm">
                                    {item.quantity}x {item.title}
                                </Text>
                            ))}
                        </BlockStack>
                    </BlockStack>
                </div>
            </Modal.Section>
        </Modal>
    );
}
