import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSubmit } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    ResourceList,
    ResourceItem,
    Text,
    Badge,
    Button,
    Modal,
    BlockStack,
    InlineStack,
    TextField,
    Select,
    Checkbox,
    Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendPackageToAras, getShipmentStatus, getBarcode } from "../services/arasKargo.server";
import { useState, useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    let orders = [];
    let localShipments = [];
    let settings = null;
    let suppliers = [];
    let errors: string[] = [];

    try {
        const { admin } = await authenticate.admin(request);

        // 1. Get Unfulfilled Orders from Shopify
        try {
            const response = await admin.graphql(
                `#graphql
              query getUnfulfilledOrders {
                orders(first: 50, query: "fulfillment_status:unfulfilled OR fulfillment_status:partial") {
                  edges {
                    node {
                      id
                      name
                      createdAt
                      displayFulfillmentStatus
                      shippingAddress {
                        firstName
                        lastName
                        address1
                        address2
                        city
                        province
                        zip
                        phone
                      }
                      lineItems(first: 50) {
                        edges {
                          node {
                            id
                            title
                            sku
                            quantity
                            fulfillableQuantity
                          }
                        }
                      }
                    }
                  }
                }
              }`
            );

            const responseJson = await response.json();

            if (responseJson.data && responseJson.data.orders) {
                orders = responseJson.data.orders.edges.map((edge: any) => edge.node);
            } else {
                console.error("Shopify GraphQL data missing:", JSON.stringify(responseJson));
                errors.push("Siparişler çekilemedi (Shopify Hatası)");
            }
        } catch (e: any) {
            // Enhanced logging to capture graphQLErrors
            const errorDetails = e?.graphQLErrors
                ? JSON.stringify(e.graphQLErrors, null, 2)
                : (e?.message || String(e));
            console.error("Error fetching orders - Full details:", errorDetails);
            console.error("Error object keys:", Object.keys(e || {}));
            errors.push(`Siparişler çekilirken hata: ${e?.message || 'Bilinmeyen hata'}`);
        }

        // 2. Get local shipments
        try {
            localShipments = await prisma.shipment.findMany({
                orderBy: { createdAt: 'desc' },
                take: 20
            });
        } catch (e) {
            console.error("Error fetching shipments:", e);
            errors.push("Geçmiş gönderiler yüklenemedi (Veritabanı Hatası)");
        }

        // 3. Get Settings and Suppliers
        try {
            settings = await prisma.arasKargoSettings.findFirst();
            suppliers = await prisma.supplier.findMany();
        } catch (e) {
            console.error("Error fetching settings/suppliers:", e);
            errors.push("Ayarlar yüklenemedi.");
        }

        return json({ orders, localShipments, settings, suppliers, errors });
    } catch (error) {
        console.error("Critical Loader Error:", error);
        // Even if auth fails or catastrophic error, try not to crash
        return json({ orders: [], localShipments: [], settings: null, suppliers: [], errors: ["Kritik Sistem Hatası: " + (error as Error).message] });
    }
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "createShipment") {
        const orderId = formData.get("orderId") as string;
        const orderName = formData.get("orderName") as string;
        const supplierId = formData.get("supplierId") as string;
        const itemsJson = formData.get("items") as string; // JSON string of items to ship
        const shippingAddressJson = formData.get("shippingAddress") as string;

        const items = JSON.parse(itemsJson);
        const shippingAddress = JSON.parse(shippingAddressJson);
        const pieceCount = parseInt(formData.get("pieceCount") as string) || 1;

        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        const settings = await prisma.arasKargoSettings.findFirst();

        if (!supplier || !settings) {
            return json({ status: "error", message: "Tedarikçi veya Ayarlar bulunamadı." });
        }

        // 1. Call Aras Kargo API
        const result = await sendPackageToAras({
            orderNumber: orderName,
            items: items.map((i: any) => ({ title: i.title, quantity: i.quantity })),
            shippingAddress: {
                firstName: shippingAddress.firstName,
                lastName: shippingAddress.lastName,
                address1: shippingAddress.address1,
                address2: shippingAddress.address2,
                city: shippingAddress.city,
                province: shippingAddress.province,
                phone: shippingAddress.phone || "",
                zip: shippingAddress.zip
            },
            supplier: {
                name: supplier.name,
                supplierCode: supplier.supplierCode,
                arasAddressId: supplier.arasAddressId
            },
            pieceCount: pieceCount
        }, settings);

        if (!result.success) {
            return json({ status: "error", message: result.message });
        }

        // 2. Save Shipment to DB
        const shipment = await prisma.shipment.create({
            data: {
                orderId,
                orderNumber: orderName,
                mok: result.mok || "",
                supplierId: supplier.id,
                supplierName: supplier.name,
                addressId: supplier.arasAddressId,
                pieceCount: 1,
                status: "SENT_TO_ARAS",
                items: {
                    create: items.map((i: any) => ({
                        lineItemId: i.id,
                        sku: i.sku || "",
                        title: i.title,
                        quantity: i.quantity
                    }))
                }
            }
        });

        // 3. Create Fulfillment in Shopify for partial fulfillment support
        try {
            // First get the fulfillment order for this order
            const fulfillmentOrdersResponse = await admin.graphql(
                `#graphql
                query getFulfillmentOrders($orderId: ID!) {
                    order(id: $orderId) {
                        fulfillmentOrders(first: 10) {
                            edges {
                                node {
                                    id
                                    status
                                    lineItems(first: 50) {
                                        edges {
                                            node {
                                                id
                                                remainingQuantity
                                                lineItem {
                                                    id
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }`,
                { variables: { orderId } }
            );

            const foData = await fulfillmentOrdersResponse.json();
            const fulfillmentOrders = foData.data?.order?.fulfillmentOrders?.edges || [];

            // Find an "open" fulfillment order
            const openFO = fulfillmentOrders.find((fo: any) =>
                ['OPEN', 'IN_PROGRESS'].includes(fo.node.status)
            );

            if (openFO) {
                // Map our items to fulfillment order line items
                const foLineItems = openFO.node.lineItems.edges;
                const fulfillmentLineItems = items
                    .map((item: any) => {
                        const match = foLineItems.find((foli: any) =>
                            foli.node.lineItem.id === item.id
                        );
                        if (match && match.node.remainingQuantity > 0) {
                            return {
                                fulfillmentOrderLineItemId: match.node.id,
                                quantity: Math.min(item.quantity, match.node.remainingQuantity)
                            };
                        }
                        return null;
                    })
                    .filter(Boolean);

                if (fulfillmentLineItems.length > 0) {
                    // Create the fulfillment
                    await admin.graphql(
                        `#graphql
                        mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
                            fulfillmentCreateV2(fulfillment: $fulfillment) {
                                fulfillment {
                                    id
                                    status
                                }
                                userErrors {
                                    field
                                    message
                                }
                            }
                        }`,
                        {
                            variables: {
                                fulfillment: {
                                    lineItemsByFulfillmentOrder: [{
                                        fulfillmentOrderId: openFO.node.id,
                                        fulfillmentOrderLineItems: fulfillmentLineItems
                                    }],
                                    notifyCustomer: false,
                                    trackingInfo: {
                                        company: "Aras Kargo",
                                        number: result.mok || "",
                                        url: `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${result.mok}`
                                    }
                                }
                            }
                        }
                    );
                    console.log("Shopify fulfillment created for partial shipment");
                }
            }
        } catch (fulfillmentError) {
            console.error("Error creating Shopify fulfillment (non-blocking):", fulfillmentError);
            // Don't fail the whole operation if fulfillment creation fails
        }

        return json({ status: "success", message: `Kargo gönderildi! MÖK: ${result.mok}` });
    }

    if (intent === "getBarcode") {
        const shipmentId = formData.get("shipmentId") as string;
        const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });

        if (!shipment || !shipment.mok) {
            return json({ status: "error", message: "Gönderi bulunamadı." });
        }

        const settings = await prisma.arasKargoSettings.findFirst();
        if (!settings) {
            return json({ status: "error", message: "Ayarlar eksik." });
        }

        // Call getBarcode (imported from service)
        const result = await getBarcode(shipment.mok, settings);

        if (result.success && result.barcodeBase64) {
            return json({ status: "success", message: "Barkod alındı", barcodeBase64: result.barcodeBase64 });
        } else {
            return json({ status: "error", message: result.message });
        }
    }

    if (intent === "updateStatus") {
        const shipmentId = formData.get("shipmentId") as string;
        const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });

        if (!shipment || !shipment.mok) {
            return json({ status: "error", message: "Gönderi veya MÖK bulunamadı." });
        }


        const settings = await prisma.arasKargoSettings.findFirst();
        if (!settings) {
            return json({ status: "error", message: "Ayarlar bulunamadı." });
        }

        const result = await getShipmentStatus(shipment.mok, settings);

        if (result.success && result.trackingNumber) {
            await prisma.shipment.update({
                where: { id: shipmentId },
                data: {
                    trackingNumber: result.trackingNumber,
                    status: "IN_TRANSIT"
                }
            });
            return json({ status: "success", message: `Takip no güncellendi: ${result.trackingNumber}` });
        }

        return json({ status: "error", message: result.message || "Takip bilgisi alınamadı." });
    }

    return null;
};

export default function Shipments() {
    const { orders, localShipments, suppliers, errors } = useLoaderData<typeof loader>();
    const fetcher = useFetcher();

    const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
    const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
    const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
    const [pieceCount, setPieceCount] = useState<number>(1);

    const handleOrderClick = (order: any) => {
        setSelectedOrder(order);
        setPieceCount(1); // Reset piece count
        // Reset selection
        const newSelection: Record<string, boolean> = {};
        const newQuantities: Record<string, number> = {};
        order.lineItems.edges.forEach((edge: any) => {
            newSelection[edge.node.id] = true;
            newQuantities[edge.node.id] = edge.node.fulfillableQuantity;
        });
        setSelectedItems(newSelection);
        setSelectedQuantities(newQuantities);
        if (suppliers.length > 0) setSelectedSupplierId(suppliers[0].id);
    };

    const handleCreateShipment = () => {
        if (!selectedOrder || !selectedSupplierId) return;

        // Filter items
        const itemsToShip = selectedOrder.lineItems.edges
            .map((e: any) => e.node)
            .filter((node: any) => selectedItems[node.id] && selectedQuantities[node.id] > 0)
            .map((node: any) => ({
                id: node.id,
                title: node.title,
                sku: node.sku,
                quantity: selectedQuantities[node.id]
            }));

        if (itemsToShip.length === 0) {
            shopify.toast.show("Lütfen gönderilecek ürün seçin");
            return;
        }

        const formData = new FormData();
        formData.append("intent", "createShipment");
        formData.append("orderId", selectedOrder.id);
        formData.append("orderName", selectedOrder.name);
        formData.append("supplierId", selectedSupplierId);
        formData.append("items", JSON.stringify(itemsToShip));
        formData.append("shippingAddress", JSON.stringify(selectedOrder.shippingAddress));
        formData.append("pieceCount", pieceCount.toString());

        fetcher.submit(formData, { method: "POST" });
        setSelectedOrder(null); // Close modal
    };

    // Handle barcode response
    useEffect(() => {
        const data = fetcher.data as any;
        if (data?.barcodeBase64) {
            // Create a link to download or view
            const link = document.createElement('a');
            link.href = `data:application/pdf;base64,${fetcher.data.barcodeBase64}`; // Assuming PDF, might be image
            link.download = `barcode_${Date.now()}.pdf`; // Should adjust extension based on format
            // If it's ZPL it needs a viewer, but let's assume PDF from Aras.
            // Let's assume user wants to download it.

            // Actually, better UX:
            const win = window.open();
            if (win) {
                const isPdf = data.barcodeBase64.startsWith('JVBERi0');
                if (isPdf) {
                    win.document.write(`<iframe src="data:application/pdf;base64,${data.barcodeBase64}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
                } else {
                    // Assume Image or Text (ZPL)
                    win.document.write(`<pre>${atob(data.barcodeBase64)}</pre>`);
                }
            }
        }
    }, [fetcher.data]);


    return (
        <Page>
            <TitleBar title="Kargo İşlemleri" />
            <BlockStack gap="500">
                {errors && errors.length > 0 && (
                    <Banner tone="critical">
                        <p>Aşağıdaki hatalar oluştu:</p>
                        <ul>
                            {errors.map((err, i) => <li key={i}>{err}</li>)}
                        </ul>
                    </Banner>
                )}
                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">Bekleyen Siparişler</Text>
                                {orders.length === 0 ? (
                                    <p>Gönderilecek sipariş bulunamadı.</p>
                                ) : (
                                    <ResourceList
                                        resourceName={{ singular: 'order', plural: 'orders' }}
                                        items={orders}
                                        renderItem={(item: any) => {
                                            const { id, name, createdAt, displayFulfillmentStatus, shippingAddress } = item;
                                            return (
                                                <ResourceItem
                                                    id={id}
                                                    onClick={() => handleOrderClick(item)}
                                                    accessibilityLabel={`View details for ${name}`}
                                                >
                                                    <InlineStack align="space-between">
                                                        <div>
                                                            <Text variant="bodyMd" fontWeight="bold" as="span">{name}</Text>
                                                            <Text variant="bodySm" as="span" tone="subdued"> - {new Date(createdAt).toLocaleDateString()}</Text>
                                                            <div style={{ fontSize: '0.8em', color: '#666' }}>
                                                                {shippingAddress?.firstName} {shippingAddress?.lastName} - {shippingAddress?.city}
                                                            </div>
                                                        </div>
                                                        <Badge tone={displayFulfillmentStatus === 'PARTIALLY_FULFILLED' ? 'info' : 'warning'}>
                                                            {displayFulfillmentStatus || 'UNFULFILLED'}
                                                        </Badge>
                                                    </InlineStack>
                                                </ResourceItem>
                                            );
                                        }}
                                    />
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>

                    <Layout.Section variant="oneThird">
                        <Card>
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">Son Gönderiler</Text>
                                <BlockStack gap="100">
                                    {localShipments.map((shipment: any) => (
                                        <div key={shipment.id} className="border-b py-2">
                                            <Text as="p" fontWeight="bold">{shipment.orderNumber}</Text>
                                            <Text as="p" tone="subdued" variant="bodySm">MÖK: {shipment.mok}</Text>
                                            {shipment.trackingNumber && <Text as="p" tone="success">Takip: {shipment.trackingNumber}</Text>}
                                            <InlineStack gap="200" align="start">
                                                <Badge>{shipment.status}</Badge>
                                                {!shipment.trackingNumber && (
                                                    <Button
                                                        size="micro"
                                                        onClick={() => {
                                                            const form = new FormData();
                                                            form.append("intent", "updateStatus");
                                                            form.append("shipmentId", shipment.id);
                                                            fetcher.submit(form, { method: "POST" });
                                                        }}
                                                        loading={fetcher.state === 'submitting'}
                                                    >
                                                        Güncelle
                                                    </Button>
                                                )}
                                                <Button
                                                    size="micro"
                                                    onClick={() => {
                                                        const form = new FormData();
                                                        form.append("intent", "getBarcode");
                                                        form.append("shipmentId", shipment.id);
                                                        fetcher.submit(form, { method: "POST" });
                                                    }}
                                                    loading={fetcher.state === 'submitting'}
                                                >
                                                    Barkod
                                                </Button>
                                            </InlineStack>
                                        </div>
                                    ))}
                                    {localShipments.length === 0 && <Text as="p" tone="subdued">Henüz gönderi yok.</Text>}
                                </BlockStack>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>

            {/* Shipment Modal */}
            {selectedOrder && (
                <Modal
                    open={!!selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    title={`Sipariş Gönder: ${selectedOrder.name}`}
                    primaryAction={{
                        content: 'Kargoya Ver (Aras)',
                        onAction: handleCreateShipment,
                        loading: fetcher.state === 'submitting'
                    }}
                    secondaryActions={[
                        {
                            content: 'İptal',
                            onAction: () => setSelectedOrder(null),
                        },
                    ]}
                >
                    <Modal.Section>
                        <BlockStack gap="400">
                            <Select
                                label="Tedarikçi Seç"
                                options={suppliers.map((s: any) => ({ label: s.name, value: s.id }))}
                                value={selectedSupplierId}
                                onChange={setSelectedSupplierId}
                            />

                            <TextField
                                label="Paket Sayısı (Parça Adedi)"
                                type="number"
                                value={String(pieceCount)}
                                onChange={(val) => setPieceCount(Math.max(1, parseInt(val) || 1))}
                                autoComplete="off"
                                helpText="Bu gönderi kaç parça/koli olacak?"
                            />

                            <Text as="h3" variant="headingSm">Ürünler</Text>
                            {selectedOrder.lineItems.edges.map((edge: any) => {
                                const node = edge.node;
                                return (
                                    <InlineStack key={node.id} align="space-between" blockAlign="center">
                                        <Checkbox
                                            label={`${node.title} (${node.sku})`}
                                            checked={selectedItems[node.id]}
                                            onChange={(checked) => setSelectedItems({ ...selectedItems, [node.id]: checked })}
                                        />
                                        {selectedItems[node.id] && (
                                            <TextField
                                                label="Adet"
                                                labelHidden
                                                type="number"
                                                value={String(selectedQuantities[node.id])}
                                                onChange={(val) => setSelectedQuantities({ ...selectedQuantities, [node.id]: parseInt(val) })}
                                                autoComplete="off"
                                            />
                                        )}
                                    </InlineStack>
                                )
                            })}
                        </BlockStack>
                    </Modal.Section>
                </Modal>
            )}
        </Page>
    );
}
