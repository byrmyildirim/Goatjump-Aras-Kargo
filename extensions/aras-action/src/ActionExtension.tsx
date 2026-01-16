import { useEffect, useState } from 'react';
import {
    AdminAction,
    Button,
    BlockStack,
    Text,
    useApi,
    TextField,
    Select,
    Banner,
} from '@shopify/ui-extensions-react/admin';

export default function ActionExtension() {
    const { close, data } = useApi<'admin.order-details.action.render'>();
    const orderId = data.selected?.[0]?.id; // gid://shopify/Order/12345

    const [suppliers, setSuppliers] = useState<any[]>([]);
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [pieceCount, setPieceCount] = useState('1');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'critical', message: string } | null>(null);
    const [orderDetails, setOrderDetails] = useState<any>(null);

    // 1. Fetch Init Data
    useEffect(() => {
        async function init() {
            try {
                const appUrl = "https://goatjump-aras-kargo-production.up.railway.app";
                const res = await fetch(`${appUrl}/api/aras`);
                const json = await res.json();
                if (json.suppliers) {
                    setSuppliers(json.suppliers);
                    if (json.suppliers.length > 0) setSelectedSupplier(json.suppliers[0].id);
                }

                const query = `query getOrder($id: ID!) {
                order(id: $id) {
                    id
                    name
                    email
                    shippingAddress {
                        firstName
                        lastName
                        address1
                        address2
                        city
                        province
                        zip
                        phone
                        country
                    }
                    lineItems(first: 50) {
                        edges {
                            node {
                                id
                                title
                                sku
                                quantity
                            }
                        }
                    }
                }
            }`;

                const adminRes = await fetch("shopify:admin/api/graphql.json", {
                    method: "POST",
                    body: JSON.stringify({ query, variables: { id: orderId } }),
                });
                const adminJson = await adminRes.json();
                if (adminJson.data?.order) {
                    setOrderDetails(adminJson.data.order);
                }

            } catch (e) {
                console.error(e);
                setStatus({ type: 'critical', message: 'Veriler yüklenemedi.' });
            }
        }

        if (orderId) init();
    }, [orderId]);

    const handleSubmit = async () => {
        if (!orderDetails || !selectedSupplier) return;
        setLoading(true);
        setStatus(null);

        try {
            const appUrl = "https://goatjump-aras-kargo-production.up.railway.app";
            const payload = {
                orderId: orderDetails.id,
                orderName: orderDetails.name,
                supplierId: selectedSupplier,
                pieceCount: parseInt(pieceCount) || 1,
                shippingAddress: orderDetails.shippingAddress,
                items: orderDetails.lineItems.edges.map((e: any) => e.node)
            };

            const res = await fetch(`${appUrl}/api/aras`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const json = await res.json();

            if (json.status === 'success') {
                setStatus({ type: 'success', message: `Kargo oluşturuldu! MÖK: ${json.mok || '---'}` });
                setTimeout(() => close(), 2000);
            } else {
                setStatus({ type: 'critical', message: json.message || 'Hata oluştu' });
            }
        } catch (e) {
            setStatus({ type: 'critical', message: 'Bağlantı hatası.' });
        } finally {
            setLoading(false);
        }
    };

    if (!orderDetails) {
        return <AdminAction><Text>Yükleniyor...</Text></AdminAction>;
    }

    return (
        <AdminAction
            primaryAction={
                <Button onPress={handleSubmit} disabled={!selectedSupplier || loading}>
                    Kargola
                </Button>
            }
            secondaryAction={
                <Button onPress={() => close()}>İptal</Button>
            }
        >
            <BlockStack gap="base">
                {status && <Banner tone={status.type}>{status.message}</Banner>}

                <Text fontWeight="bold">{orderDetails.name} - Kargo Hazırla</Text>

                <Select
                    label="Tedarikçi (Çıkış Adresi)"
                    options={suppliers.map(s => ({ label: s.name, value: s.id }))}
                    value={selectedSupplier}
                    onChange={setSelectedSupplier}
                />

                <TextField
                    label="Paket Sayısı (Adet)"
                    value={pieceCount}
                    onChange={setPieceCount}
                    autoComplete="off"
                />

                <Text>Ürünler ({orderDetails.lineItems.edges.length} kalem):</Text>
                <BlockStack gap="none">
                    {orderDetails.lineItems.edges.map((edge: any) => (
                        <Text key={edge.node.id}>
                            {edge.node.quantity}x {edge.node.title}
                        </Text>
                    ))}
                </BlockStack>
            </BlockStack>
        </AdminAction>
    );
}
