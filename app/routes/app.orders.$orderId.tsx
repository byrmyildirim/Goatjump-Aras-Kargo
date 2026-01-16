import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    Text,
    Badge,
    Button,
    BlockStack,
    InlineStack,
    TextField,
    Select,
    Checkbox,
    Banner,
    Divider,
    Box,
    DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendPackageToAras, getShipmentStatus } from "../services/arasKargo.server";
import { useState, useEffect } from "react";
import ShippingLabelModal from "../components/ShippingLabelModal";

interface LineItem {
    id: string;
    title: string;
    sku: string;
    quantity: number;
    fulfillableQuantity: number;
}

interface StagedPackage {
    supplier: { id: string; name: string; supplierCode: string; arasAddressId: string };
    items: { id: string; title: string; sku: string; quantity: number }[];
    mok: string;
    pieceCount: number;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const orderId = params.orderId;

    if (!orderId) {
        return redirect("/app/shipments");
    }

    // Fetch order from Shopify
    const response = await admin.graphql(
        `#graphql
        query getOrder($id: ID!) {
            order(id: $id) {
                id
                name
                createdAt
                displayFinancialStatus
                displayFulfillmentStatus
                totalPriceSet {
                    shopMoney {
                        amount
                        currencyCode
                    }
                }
                customer {
                    firstName
                    lastName
                    email
                    phone
                }
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
                            fulfillableQuantity
                            image {
                                url
                            }
                        }
                    }
                }
                fulfillments {
                    id
                    status
                    trackingInfo {
                        company
                        number
                        url
                    }
                    fulfillmentLineItems(first: 50) {
                        edges {
                            node {
                                lineItem {
                                    title
                                }
                                quantity
                            }
                        }
                    }
                }
            }
        }`,
        { variables: { id: `gid://shopify/Order/${orderId}` } }
    );

    const data = await response.json();

    if ((data as any).errors) {
        console.error("GraphQL Errors:", JSON.stringify((data as any).errors, null, 2));
    }

    console.log("Loader Params OrderID:", orderId);

    const order = data.data?.order;

    if (!order) {
        return redirect("/app/shipments");
    }

    // Fetch suppliers and settings from database
    const suppliers = await prisma.supplier.findMany();
    const settings = await prisma.arasKargoSettings.findFirst();

    // Fetch past shipments for this order
    const localShipments = await prisma.shipment.findMany({
        where: { orderId: orderId },
        include: { items: true }
    });

    return json({ order, suppliers, settings, localShipments });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const orderId = params.orderId;

    if (intent === "stagePackage") {
        const supplierId = formData.get("supplierId") as string;
        const orderName = formData.get("orderName") as string;
        const itemsJson = formData.get("items") as string;
        const shippingAddressJson = formData.get("shippingAddress") as string;
        const pieceCount = parseInt(formData.get("pieceCount") as string) || 1;

        const items = JSON.parse(itemsJson);
        const shippingAddress = JSON.parse(shippingAddressJson);

        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        const settings = await prisma.arasKargoSettings.findFirst();

        if (!supplier || !settings) {
            return json({ status: "error", message: "Tedarikçi veya Ayarlar bulunamadı." });
        }

        // 1. Update Shopify Address (Persistence)
        try {
            const updateResponse = await admin.graphql(
                `#graphql
                mutation orderUpdate($input: OrderInput!) {
                    orderUpdate(input: $input) {
                        order {
                            id
                            shippingAddress {
                                province
                                city
                            }
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }`,
                {
                    variables: {
                        input: {
                            id: `gid://shopify/Order/${orderId}`,
                            shippingAddress: {
                                firstName: shippingAddress.firstName,
                                lastName: shippingAddress.lastName,
                                address1: shippingAddress.address1,
                                address2: shippingAddress.address2,
                                city: shippingAddress.city,
                                province: shippingAddress.province,
                                zip: shippingAddress.zip,
                                phone: shippingAddress.phone
                            }
                        }
                    }
                }
            );
            const updateResult = await updateResponse.json();
            if (updateResult.data?.orderUpdate?.userErrors?.length > 0) {
                console.error("Address Update Error:", updateResult.data.orderUpdate.userErrors);
                // We continue even if update fails, but warn?
            }
        } catch (err) {
            console.error("Failed to update Shopify address:", err);
        }

        // Call Aras Kargo API
        const result = await sendPackageToAras({
            orderNumber: orderName,
            items: items.map((i: any) => ({ title: i.title, quantity: i.quantity })),
            shippingAddress: {
                firstName: shippingAddress.firstName || "",
                lastName: shippingAddress.lastName || "",
                address1: shippingAddress.address1 || "",
                address2: shippingAddress.address2 || "",
                city: shippingAddress.city || "",
                province: shippingAddress.province || "",
                phone: shippingAddress.phone || "",
                zip: shippingAddress.zip || ""
            },
            supplier: {
                name: supplier.name,
                supplierCode: supplier.supplierCode,
                arasAddressId: supplier.arasAddressId
            },
            pieceCount
        }, settings);

        if (!result.success) {
            return json({ status: "error", message: result.message });
        }

        // Save to database
        await prisma.shipment.create({
            data: {
                orderId: orderId!,
                orderNumber: orderName,
                mok: result.mok || "",
                supplierId: supplier.id,
                supplierName: supplier.name,
                addressId: supplier.arasAddressId,
                pieceCount,
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

        return json({
            status: "success",
            message: `Paket hazırlandı! MÖK: ${result.mok}`,
            mok: result.mok,
            supplier: {
                id: supplier.id,
                name: supplier.name,
                supplierCode: supplier.supplierCode,
                arasAddressId: supplier.arasAddressId
            }
        });
    }

    if (intent === "createFulfillment") {
        const packagesJson = formData.get("packages") as string;
        const orderGid = formData.get("orderGid") as string;
        const packages = JSON.parse(packagesJson);

        try {
            // Get fulfillment orders
            const foResponse = await admin.graphql(
                `#graphql
                query getFulfillmentOrder($id: ID!) {
                    order(id: $id) {
                        fulfillmentOrders(first: 10) {
                            edges {
                                node {
                                    id
                                    lineItems(first: 50) {
                                        edges {
                                            node {
                                                id
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
                { variables: { id: orderGid } }
            );

            const foData = await foResponse.json();
            const fulfillmentOrder = foData.data?.order?.fulfillmentOrders?.edges?.[0]?.node;

            if (!fulfillmentOrder) {
                return json({ status: "error", message: "Fulfillment order bulunamadı." });
            }

            let successCount = 0;
            const errors: string[] = [];

            // Process each package as a separate fulfillment
            for (const pkg of packages) {
                // Map items
                const fulfillmentOrderLineItems = pkg.items.map((item: any) => {
                    const foLineItem = fulfillmentOrder.lineItems.edges.find((edge: any) =>
                        edge.node.lineItem.id === item.id || edge.node.lineItem.id === `gid://shopify/LineItem/${item.id}`
                    );
                    if (foLineItem) {
                        return {
                            id: foLineItem.node.id,
                            quantity: item.quantity
                        };
                    }
                    return null;
                }).filter(Boolean);

                if (fulfillmentOrderLineItems.length === 0) {
                    errors.push(`Paket ${pkg.mok} için eşleşen ürün bulunamadı.`);
                    continue;
                }

                // Create fulfillment
                const response = await admin.graphql(
                    `#graphql
                    mutation fulfillmentCreate($fulfillment: FulfillmentV2Input!) {
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
                                    fulfillmentOrderId: fulfillmentOrder.id,
                                    fulfillmentOrderLineItems
                                }],
                                trackingInfo: {
                                    company: "Aras Kargo",
                                    number: pkg.mok,
                                    url: `http://kargotakip.araskargo.com.tr/mainpage.aspx?code=${pkg.mok}`
                                },
                                notifyCustomer: true
                            }
                        }
                    }
                );

                const result = await response.json();
                if (result.data?.fulfillmentCreateV2?.userErrors?.length > 0) {
                    errors.push(`Paket ${pkg.id} hatası: ${result.data.fulfillmentCreateV2.userErrors[0].message}`);
                } else {
                    successCount++;
                }
            }

            if (errors.length > 0) {
                return json({
                    status: successCount > 0 ? "success" : "error", // Partial success is still success-ish
                    message: `${successCount} paket gönderildi. Hatalar: ${errors.join(", ")}`
                });
            }

            return json({ status: "success", message: `${successCount} paket başarıyla Shopify'a gönderildi!` });

        } catch (error) {
            return json({ status: "error", message: "Fulfillment oluşturulamadı: " + (error as Error).message });
        }
    }

    return null;
};

export default function OrderDetail() {
    const { order, suppliers, settings, localShipments } = useLoaderData<typeof loader>();
    const fetcher = useFetcher();
    const navigate = useNavigate();

    // State
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
    const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
    const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
    const [pieceCount, setPieceCount] = useState<number>(1);
    const [stagedPackages, setStagedPackages] = useState<StagedPackage[]>([]);
    const [showLabelModal, setShowLabelModal] = useState(false);
    const [currentLabelData, setCurrentLabelData] = useState<{
        mok: string;
        supplier: { name: string };
        items: { title: string; quantity: number }[];
    } | null>(null);

    // Address editing state
    const [isEditingAddress, setIsEditingAddress] = useState(false);
    const [editedAddress, setEditedAddress] = useState<any>(null);

    // Initialize selections
    useEffect(() => {
        const lineItems = order.lineItems.edges.map((e: any) => e.node);
        const newSelection: Record<string, boolean> = {};
        const newQuantities: Record<string, number> = {};
        lineItems.forEach((item: LineItem) => {
            newSelection[item.id] = item.fulfillableQuantity > 0;
            newQuantities[item.id] = item.fulfillableQuantity;
        });
        setSelectedItems(newSelection);
        setSelectedQuantities(newQuantities);
        if (suppliers.length > 0) {
            setSelectedSupplierId(suppliers[0].id);
        }

        // Initialize edited address
        if (order.shippingAddress) {
            setEditedAddress(order.shippingAddress);
        }
    }, [order, suppliers]);

    // Handle fetcher response
    useEffect(() => {
        const data = fetcher.data as any;
        if (!data) return;

        if (data.status === 'error') {
            // Show error via app bridge toast would be ideal, but we'll use alert for now
            alert(data.message);
        } else if (data.status === 'success') {
            if (data.mok) {
                // Package staged successfully, show label modal
                const supplier = suppliers.find((s: any) => s.id === selectedSupplierId);
                const items = order.lineItems.edges
                    .map((e: any) => e.node)
                    .filter((node: any) => selectedItems[node.id] && selectedQuantities[node.id] > 0)
                    .map((node: any) => ({ title: node.title, quantity: selectedQuantities[node.id] }));

                setCurrentLabelData({
                    mok: data.mok,
                    supplier: { name: supplier?.name || "Tedarikçi" },
                    items
                });
                setShowLabelModal(true);

                // Add to staged packages - IMPORTANT: Keep original Shopify LineItem IDs for fulfillment matching
                const itemsWithOriginalIds = order.lineItems.edges
                    .map((e: any) => e.node)
                    .filter((node: any) => selectedItems[node.id] && selectedQuantities[node.id] > 0)
                    .map((node: any) => ({
                        id: node.id,  // Keep original Shopify LineItem ID!
                        title: node.title,
                        sku: node.sku || "",
                        quantity: selectedQuantities[node.id]
                    }));

                setStagedPackages(prev => [...prev, {
                    supplier: data.supplier,
                    items: itemsWithOriginalIds,
                    mok: data.mok,
                    pieceCount
                }]);

                // Reset selection
                setSelectedItems({});
                setSelectedQuantities({});
            } else {
                alert(data.message);
            }
        }
    }, [fetcher.data]);

    const handleStagePackage = () => {
        if (!selectedSupplierId) {
            alert("Lütfen bir tedarikçi seçin");
            return;
        }

        const itemsToShip = order.lineItems.edges
            .map((e: any) => e.node)
            .filter((node: any) => selectedItems[node.id] && selectedQuantities[node.id] > 0)
            .map((node: any) => ({
                id: node.id,
                title: node.title,
                sku: node.sku,
                quantity: selectedQuantities[node.id]
            }));

        if (itemsToShip.length === 0) {
            alert("Lütfen en az bir ürün seçin");
            return;
        }

        const formData = new FormData();
        formData.append("intent", "stagePackage");
        formData.append("orderName", order.name);
        formData.append("supplierId", selectedSupplierId);
        formData.append("items", JSON.stringify(itemsToShip));
        // Use edited address if available, otherwise original
        formData.append("shippingAddress", JSON.stringify(editedAddress || order.shippingAddress));
        formData.append("pieceCount", pieceCount.toString());

        fetcher.submit(formData, { method: "POST" });
    };

    const handleCreateFulfillment = () => {
        if (stagedPackages.length === 0) {
            alert("Önce paket hazırlamalısınız");
            return;
        }

        const formData = new FormData();
        formData.append("intent", "createFulfillment");
        formData.append("orderGid", order.id);
        formData.append("packages", JSON.stringify(stagedPackages));

        fetcher.submit(formData, { method: "POST" });
    };

    const lineItems = order.lineItems.edges.map((e: any) => e.node) as LineItem[];
    const shippingAddress = order.shippingAddress;

    const getStatusBadge = (status: string | null) => {
        if (!status) return <Badge>Bilinmiyor</Badge>;
        const map: Record<string, "success" | "warning" | "info" | "attention"> = {
            'FULFILLED': 'success',
            'PARTIALLY_FULFILLED': 'info',
            'UNFULFILLED': 'warning',
            'PAID': 'success',
            'PENDING': 'attention',
        };
        return <Badge tone={map[status] || undefined}>{status}</Badge>;
    };

    return (
        <Page
            backAction={{ content: 'Geri', onAction: () => navigate('/app/shipments') }}
            title={`Sipariş ${order.name}`}
            titleMetadata={
                <InlineStack gap="200">
                    {getStatusBadge(order.displayFinancialStatus)}
                    {getStatusBadge(order.displayFulfillmentStatus)}
                </InlineStack>
            }
            subtitle={`Tarih: ${new Date(order.createdAt).toLocaleDateString('tr-TR')}`}
        >
            <TitleBar title={`Sipariş ${order.name}`} />

            <Layout>
                {/* Left Column - Order Details */}
                <Layout.Section>
                    <BlockStack gap="500">
                        {/* Line Items Selection */}
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Ürünler</Text>
                                <Divider />

                                {lineItems.map((item) => (
                                    <Box key={item.id} padding="200" borderRadius="200" background="bg-surface-secondary">
                                        <InlineStack align="space-between" blockAlign="center" gap="400">
                                            <InlineStack gap="300" blockAlign="center">
                                                <Checkbox
                                                    label=""
                                                    checked={selectedItems[item.id] || false}
                                                    onChange={(checked) => {
                                                        setSelectedItems(prev => ({ ...prev, [item.id]: checked }));
                                                        if (!checked) {
                                                            setSelectedQuantities(prev => ({ ...prev, [item.id]: 0 }));
                                                        } else {
                                                            setSelectedQuantities(prev => ({ ...prev, [item.id]: item.fulfillableQuantity }));
                                                        }
                                                    }}
                                                    disabled={item.fulfillableQuantity === 0}
                                                />
                                                <BlockStack gap="100">
                                                    <Text as="span" variant="bodyMd" fontWeight="semibold">{item.title}</Text>
                                                    <Text as="span" variant="bodySm" tone="subdued">SKU: {item.sku || '-'}</Text>
                                                </BlockStack>
                                            </InlineStack>

                                            <InlineStack gap="200" blockAlign="center">
                                                {selectedItems[item.id] && (
                                                    <div style={{ width: '80px' }}>
                                                        <TextField
                                                            label=""
                                                            labelHidden
                                                            type="number"
                                                            value={String(selectedQuantities[item.id] || 0)}
                                                            onChange={(val) => {
                                                                const num = Math.min(Math.max(0, parseInt(val) || 0), item.fulfillableQuantity);
                                                                setSelectedQuantities(prev => ({ ...prev, [item.id]: num }));
                                                            }}
                                                            autoComplete="off"
                                                            min={0}
                                                            max={item.fulfillableQuantity}
                                                        />
                                                    </div>
                                                )}
                                                <Text as="span" variant="bodySm" tone="subdued">
                                                    / {item.fulfillableQuantity} adet kaldı
                                                </Text>
                                            </InlineStack>
                                        </InlineStack>
                                    </Box>
                                ))}

                                <Divider />

                                {/* Supplier Selection and Actions */}
                                <InlineStack gap="400" blockAlign="end" wrap={false}>
                                    <div style={{ flex: 1 }}>
                                        <Select
                                            label="Tedarikçi"
                                            options={suppliers.map((s: any) => ({ label: s.name, value: s.id }))}
                                            value={selectedSupplierId}
                                            onChange={setSelectedSupplierId}
                                        />
                                    </div>
                                    <div style={{ width: '100px' }}>
                                        <TextField
                                            label="Paket Sayısı"
                                            type="number"
                                            value={String(pieceCount)}
                                            onChange={(val) => setPieceCount(Math.max(1, parseInt(val) || 1))}
                                            autoComplete="off"
                                            min={1}
                                        />
                                    </div>
                                    <Button
                                        variant="primary"
                                        onClick={handleStagePackage}
                                        loading={fetcher.state === 'submitting'}
                                    >
                                        Paketi Hazırla
                                    </Button>
                                </InlineStack>
                            </BlockStack>
                        </Card>

                        {/* Staged Packages */}
                        {stagedPackages.length > 0 && (
                            <Card>
                                <BlockStack gap="400">
                                    <Text as="h2" variant="headingMd">Hazırlanan Paketler</Text>
                                    <Divider />

                                    {stagedPackages.map((pkg, idx) => (
                                        <Box key={idx} padding="300" borderRadius="200" background="bg-surface-success">
                                            <InlineStack align="space-between" blockAlign="center">
                                                <BlockStack gap="100">
                                                    <Text as="span" fontWeight="bold">{pkg.supplier.name}</Text>
                                                    <Text as="span" variant="bodySm">MÖK: {pkg.mok}</Text>
                                                    <Text as="span" variant="bodySm" tone="subdued">
                                                        {pkg.items.map(i => `${i.quantity}x ${i.title}`).join(', ')}
                                                    </Text>
                                                </BlockStack>
                                                <Badge tone="success">{`${pkg.pieceCount} Parça`}</Badge>
                                            </InlineStack>
                                        </Box>
                                    ))}

                                    <Button
                                        variant="primary"
                                        tone="success"
                                        onClick={handleCreateFulfillment}
                                        loading={fetcher.state === 'submitting'}
                                        fullWidth
                                    >
                                        Shopify'a Gönder ({`${stagedPackages.length} paket`})
                                    </Button>
                                </BlockStack>
                            </Card>
                        )}

                        {/* Past Fulfillments */}
                        {order.fulfillments && order.fulfillments.length > 0 && (
                            <Card>
                                <BlockStack gap="400">
                                    <Text as="h2" variant="headingMd">Geçmiş Gönderiler</Text>
                                    <Divider />

                                    {order.fulfillments.map((f: any, idx: number) => (
                                        <Box key={idx} padding="300" borderRadius="200" background="bg-surface-secondary">
                                            <InlineStack align="space-between" blockAlign="center">
                                                <BlockStack gap="100">
                                                    <Text as="span" fontWeight="bold">
                                                        {f.trackingInfo?.[0]?.company || 'Kargo Firması Belirtilmemiş'}
                                                    </Text>
                                                    {f.trackingInfo?.[0]?.number && (
                                                        <Text as="span" variant="bodySm">
                                                            Takip: {f.trackingInfo[0].number}
                                                        </Text>
                                                    )}
                                                </BlockStack>
                                                <Badge tone={f.status === 'SUCCESS' ? 'success' : 'info'}>{f.status}</Badge>
                                            </InlineStack>
                                        </Box>
                                    ))}
                                </BlockStack>
                            </Card>
                        )}
                    </BlockStack>
                </Layout.Section>

                {/* Right Column - Customer & Address */}
                <Layout.Section variant="oneThird">
                    <BlockStack gap="500">
                        {/* Customer Info */}
                        <Card>
                            <BlockStack gap="300">
                                <Text as="h2" variant="headingMd">Müşteri</Text>
                                <Divider />
                                {order.customer ? (
                                    <BlockStack gap="100">
                                        <Text as="p" fontWeight="semibold">
                                            {order.customer.firstName} {order.customer.lastName}
                                        </Text>
                                        <Text as="p" variant="bodySm">{order.customer.email}</Text>
                                        {order.customer.phone && (
                                            <Text as="p" variant="bodySm">{order.customer.phone}</Text>
                                        )}
                                    </BlockStack>
                                ) : (
                                    <Text as="p" tone="subdued">Müşteri bilgisi yok</Text>
                                )}
                            </BlockStack>
                        </Card>


                        {/* Shipping Address */}
                        <Card>
                            <BlockStack gap="300">
                                <InlineStack align="space-between">
                                    <Text as="h2" variant="headingMd">Teslimat Adresi</Text>
                                    <Button
                                        variant="plain"
                                        onClick={() => setIsEditingAddress(!isEditingAddress)}
                                    >
                                        {isEditingAddress ? 'İptal' : 'Düzenle'}
                                    </Button>
                                </InlineStack>
                                <Divider />

                                {isEditingAddress && editedAddress ? (
                                    <BlockStack gap="300">
                                        <InlineStack gap="300">
                                            <TextField
                                                label="Ad"
                                                value={editedAddress.firstName}
                                                onChange={(val) => setEditedAddress({ ...editedAddress, firstName: val })}
                                                autoComplete="off"
                                            />
                                            <TextField
                                                label="Soyad"
                                                value={editedAddress.lastName}
                                                onChange={(val) => setEditedAddress({ ...editedAddress, lastName: val })}
                                                autoComplete="off"
                                            />
                                        </InlineStack>
                                        <TextField
                                            label="Telefon"
                                            value={editedAddress.phone}
                                            onChange={(val) => setEditedAddress({ ...editedAddress, phone: val })}
                                            autoComplete="off"
                                        />
                                        <TextField
                                            label="Adres 1"
                                            value={editedAddress.address1}
                                            onChange={(val) => setEditedAddress({ ...editedAddress, address1: val })}
                                            autoComplete="off"
                                        />
                                        <TextField
                                            label="Adres 2"
                                            value={editedAddress.address2 || ''}
                                            onChange={(val) => setEditedAddress({ ...editedAddress, address2: val })}
                                            autoComplete="off"
                                        />
                                        <InlineStack gap="300">
                                            <TextField
                                                label="Şehir (İlçe)"
                                                value={editedAddress.city}
                                                onChange={(val) => setEditedAddress({ ...editedAddress, city: val })}
                                                autoComplete="off"
                                            />
                                            <TextField
                                                label="İl"
                                                value={editedAddress.province}
                                                onChange={(val) => setEditedAddress({ ...editedAddress, province: val })}
                                                autoComplete="off"
                                            />
                                        </InlineStack>
                                        <TextField
                                            label="Posta Kodu"
                                            value={editedAddress.zip}
                                            onChange={(val) => setEditedAddress({ ...editedAddress, zip: val })}
                                            autoComplete="off"
                                        />
                                        <Button variant="primary" onClick={() => setIsEditingAddress(false)}>Kaydet</Button>
                                    </BlockStack>
                                ) : (
                                    editedAddress ? (
                                        <BlockStack gap="100">
                                            <Text as="p" fontWeight="semibold">
                                                {editedAddress.firstName} {editedAddress.lastName}
                                            </Text>
                                            <Text as="p" variant="bodySm">{editedAddress.address1}</Text>
                                            {editedAddress.address2 && (
                                                <Text as="p" variant="bodySm">{editedAddress.address2}</Text>
                                            )}
                                            <Text as="p" variant="bodySm">
                                                {editedAddress.zip} {editedAddress.city}
                                            </Text>
                                            <Text as="p" variant="bodySm">{editedAddress.province}</Text>
                                            <Text as="p" variant="bodySm">{editedAddress.phone}</Text>
                                        </BlockStack>
                                    ) : (
                                        <Banner tone="warning">
                                            <p>Teslimat adresi bulunamadı!</p>
                                        </Banner>
                                    )
                                )}
                            </BlockStack>
                        </Card>

                        {/* Local Shipments */}
                        {localShipments.length > 0 && (
                            <Card>
                                <BlockStack gap="300">
                                    <Text as="h2" variant="headingMd">Aras Kargo Kayıtları</Text>
                                    <Divider />
                                    {localShipments.map((shipment: any) => (
                                        <Box key={shipment.id} padding="200" borderRadius="200" background="bg-surface-secondary">
                                            <BlockStack gap="100">
                                                <Text as="span" fontWeight="semibold">{shipment.supplierName}</Text>
                                                <Text as="span" variant="bodySm">MÖK: {shipment.mok}</Text>
                                                <Badge>{shipment.status}</Badge>
                                            </BlockStack>
                                        </Box>
                                    ))}
                                </BlockStack>
                            </Card>
                        )}
                    </BlockStack>
                </Layout.Section>
            </Layout>

            {/* Shipping Label Modal */}
            {showLabelModal && currentLabelData && (
                <ShippingLabelModal
                    open={showLabelModal}
                    onClose={() => setShowLabelModal(false)}
                    mok={currentLabelData.mok}
                    orderName={order.name}
                    supplierName={currentLabelData.supplier.name}
                    receiverName={`${shippingAddress?.firstName || ''} ${shippingAddress?.lastName || ''}`}
                    receiverAddress={shippingAddress?.address1 || ''}
                    receiverCity={`${shippingAddress?.city || ''}, ${shippingAddress?.province || ''}`}
                    items={currentLabelData.items}
                />
            )}
        </Page>
    );
}
