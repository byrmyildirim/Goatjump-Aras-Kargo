import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSubmit, useNavigate } from "@remix-run/react";
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

// Cargo companies list with tracking URL patterns
const CARGO_COMPANIES = [
    { value: 'Aras Kargo', label: 'Aras Kargo', urlPattern: 'http://kargotakip.araskargo.com.tr/mainpage.aspx?code={tracking}' },
    { value: 'MNG Kargo', label: 'MNG Kargo', urlPattern: 'https://www.mngkargo.com.tr/wps/portal/kargotakip?code={tracking}' },
    { value: 'Yurtiçi Kargo', label: 'Yurtiçi Kargo', urlPattern: 'https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code={tracking}' },
    { value: 'Sürat Kargo', label: 'Sürat Kargo', urlPattern: 'https://www.suratkargo.com.tr/KargoTakip?kargotakipno={tracking}' },
    { value: 'PTT Kargo', label: 'PTT Kargo', urlPattern: 'https://gonderitakip.ptt.gov.tr/Track/Verify?q={tracking}' },
    { value: 'UPS Kargo', label: 'UPS Kargo', urlPattern: 'https://www.ups.com/track?tracknum={tracking}' },
    { value: 'DHL', label: 'DHL', urlPattern: 'https://www.dhl.com/tr-tr/home/tracking.html?tracking-id={tracking}' },
    { value: 'FedEx', label: 'FedEx', urlPattern: 'https://www.fedex.com/fedextrack/?trknbr={tracking}' },
    { value: 'Trendyol Express', label: 'Trendyol Express', urlPattern: 'https://www.trendyolexpress.com/gonderi-takip/{tracking}' },
    { value: 'Hepsijet', label: 'Hepsijet', urlPattern: 'https://www.hepsijet.com/gonderi-takip?trackingNumber={tracking}' },
    { value: 'Kargoist', label: 'Kargoist', urlPattern: 'https://kargoist.com/gonderi-takip/{tracking}' },
    { value: 'Kolay Gelsin', label: 'Kolay Gelsin', urlPattern: 'https://kolaygelsin.com/tr/gonderi-takip?gonderiNo={tracking}' },
    { value: 'Sendeo', label: 'Sendeo', urlPattern: 'https://www.sendeo.com.tr/takip/{tracking}' },
    { value: 'Scotty', label: 'Scotty', urlPattern: 'https://scotty.com.tr/{tracking}' },
    { value: 'Kuryenet', label: 'Kuryenet', urlPattern: 'https://www.kuryenet.com/gonderi-sorgula/{tracking}' },
    { value: 'Horoz Lojistik', label: 'Horoz Lojistik', urlPattern: 'https://www.horozlojistik.com.tr/gonderi-takip/{tracking}' },
    { value: 'Diğer', label: 'Diğer', urlPattern: '' },
];

const getTrackingUrl = (company: string, trackingNumber: string): string => {
    const found = CARGO_COMPANIES.find(c => c.value === company);
    if (found && found.urlPattern) {
        return found.urlPattern.replace('{tracking}', trackingNumber);
    }
    return '';
};

// Status badge helper for shipments
const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { class: string; label: string }> = {
        'PENDING': { class: 'pending', label: 'Bekliyor' },
        'SENT_TO_ARAS': { class: 'sent', label: 'Hazırlanıyor' },
        'IN_TRANSIT': { class: 'in-transit', label: 'Kargoda' },
        'DELIVERED': { class: 'delivered', label: 'Teslim Edildi' },
        'CANCELLED': { class: 'cancelled', label: 'İptal' },
    };
    const info = statusMap[status] || { class: 'pending', label: status };
    return <span className={`gj-badge ${info.class}`}>{info.label}</span>;
};

// Order status badge helper
const getOrderStatusBadge = (status: string) => {
    const isPartial = status === 'PARTIALLY_FULFILLED';
    return (
        <span className={`gj-badge ${isPartial ? 'partially-fulfilled' : 'pending'}`}>
            {isPartial ? 'Kısmi Tamamlandı' : 'Bekliyor'}
        </span>
    );
};

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
                orders(first: 50, query: "(fulfillment_status:unfulfilled OR fulfillment_status:partial) AND (financial_status:paid) AND (status:open)") {
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
        console.log("Action received: createShipment");
        const orderId = formData.get("orderId") as string;
        const orderName = formData.get("orderName") as string;
        const supplierId = formData.get("supplierId") as string;
        const itemsJson = formData.get("items") as string; // JSON string of items to ship
        const shippingAddressJson = formData.get("shippingAddress") as string;
        const pieceCount = parseInt(formData.get("pieceCount") as string) || 1;

        console.log(`Processing shipment for ${orderName}, Supplier: ${supplierId}, Pieces: ${pieceCount} `);

        const items = JSON.parse(itemsJson);
        const shippingAddress = JSON.parse(shippingAddressJson);

        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
        const settings = await prisma.arasKargoSettings.findFirst();

        if (!supplier || !settings) {
            console.error("Supplier or Settings not found");
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

        // 1.5. Try to get Real Tracking Number immediately
        let trackingNumber = null;
        if (result.mok) {
            const statusResult = await getShipmentStatus(result.mok, settings);
            if (statusResult.success && statusResult.trackingNumber) {
                trackingNumber = statusResult.trackingNumber;
            }
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
                pieceCount: pieceCount, // FIX: Use the variable, not hardcoded 1
                status: "SENT_TO_ARAS",
                trackingNumber: trackingNumber, // Save if found
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
                query getFulfillmentOrder($id: ID!) {
            order(id: $id) {
                fulfillmentOrders(first: 10) {
                      edges {
                        node {
                            id
                            status
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
        } `,
                { variables: { id: `gid://shopify/Order/${orderId}` } }
            );

            const fulfillmentOrdersData = await fulfillmentOrdersResponse.json();
            const fulfillmentOrders = fulfillmentOrdersData.data?.order?.fulfillmentOrders?.edges?.map((e: any) => e.node) || [];

            // Find the first OPEN or IN_PROGRESS fulfillment order
            const fulfillmentOrder = fulfillmentOrders.find((fo: any) =>
                fo.status === 'OPEN' || fo.status === 'IN_PROGRESS' || fo.status === 'SCHEDULED'
            );

            if (fulfillmentOrder) {
                // Map items to fulfillment order line items
                const fulfillmentOrderLineItems = items.map((item: any) => {
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

                if (fulfillmentOrderLineItems.length > 0) {
                    // Only include tracking info if we have a REAL tracking number
                    // If trackingNumber found: use it.
                    // If not: pass nothing (undefined/null) to leave it "Fulfilled" but "No Tracking"
                    // This satisfies "mök işlemeyecek" (Don't use MOK as tracking)
                    const trackingInfo = trackingNumber ? {
                        company: "Aras Kargo",
                        number: trackingNumber,
                        url: `http://kargotakip.araskargo.com.tr/mainpage.aspx?code=${trackingNumber}`
                    } : undefined;

                    await admin.graphql(
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
                                        fulfillmentOrderLineItems: fulfillmentOrderLineItems
                                    }],
                                    trackingInfo: trackingInfo,
                                    notifyCustomer: true
                                }
                            }
                        }
                    );
                }
            }

        } catch (fError) {
            console.error("Shopify Fulfillment Error (Non-blocking):", fError);
            // We do not return error here to ensure Aras shipment is recorded as success
        }

        return json({ status: "success", message: result.message });
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

    // Helper for updating a single shipment (DB + Shopify)
    const updateShipmentAndShopify = async (shipment: any, trackingNumber: string, admin: any) => {
        // 1. Update DB
        await prisma.shipment.update({
            where: { id: shipment.id },
            data: {
                trackingNumber: trackingNumber,
                status: "IN_TRANSIT"
            }
        });

        // 2. Update Shopify Fulfillment
        try {
            const fulfillmentQuery = await admin.graphql(
                `#graphql
                query getFulfillmentId($id: ID!) {
                    order(id: $id) {
                        fulfillments(first: 10) {
                            id
                            status
                            trackingInfo {
                                number
                                company
                            }
                            fulfillmentLineItems(first: 50) {
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
                }`,
                { variables: { id: `gid://shopify/Order/${shipment.orderId}` } }
            );

            const fData = await fulfillmentQuery.json();
            const fulfillments = fData.data?.order?.fulfillments || [];

            // Fetch shipment items from DB to match
            const shipmentItems = await prisma.shipmentItem.findMany({
                where: { shipmentId: shipment.id }
            });

            // Filter out cancelled fulfillments
            const activeFulfillments = fulfillments.filter((f: any) => f.status !== 'CANCELLED');

            if (activeFulfillments.length === 0) {
                return { success: false, message: "Shopify'da aktif gönderim bulunamadı. Veritabanı güncellendi." };
            }

            // Find the fulfillment that contains the items in this shipment
            let targetFulfillment = activeFulfillments.find((f: any) => {
                const fInfos = f.fulfillmentLineItems.edges.map((e: any) => e.node.lineItem.id);
                // Check intersection
                const hasItems = shipmentItems.some(sItem =>
                    fInfos.includes(sItem.lineItemId) || fInfos.includes(`gid://shopify/LineItem/${sItem.lineItemId}`)
                );
                return hasItems;
            });

            // Fallback: If strict item match failed, try tracking number match (MOK)
            if (!targetFulfillment && shipment.mok) {
                targetFulfillment = activeFulfillments.find((f: any) =>
                    f.trackingInfo?.some((t: any) => t.number === shipment.mok)
                );
            }

            // Fallback 2: If only one active fulfillment exists, use it
            if (!targetFulfillment && activeFulfillments.length === 1) {
                targetFulfillment = activeFulfillments[0];
            }

            if (targetFulfillment) {
                const mutationResponse = await admin.graphql(
                    `#graphql
                    mutation fulfillmentTrackingInfoUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
                        fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
                            fulfillment {
                                id
                                status
                                trackingInfo {
                                    number
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
                            fulfillmentId: targetFulfillment.id,
                            trackingInfoInput: {
                                company: "Aras Kargo",
                                number: trackingNumber,
                                url: `http://kargotakip.araskargo.com.tr/mainpage.aspx?code=${trackingNumber}`
                            },
                            notifyCustomer: true
                        }
                    }
                );

                const mutationData = await mutationResponse.json();
                const userErrors = mutationData.data?.fulfillmentTrackingInfoUpdate?.userErrors;

                if (userErrors && userErrors.length > 0) {
                    const errorMsg = userErrors.map((e: any) => e.message).join(", ");
                    return { success: false, message: `Shopify Hatası: ${errorMsg}. (DB Güncellendi)` };
                }
            } else {
                return { success: false, message: "Eşleşen Shopify gönderimi bulunamadı. (DB Güncellendi)" };
            }
        } catch (err) {
            console.error("Shopify Sync Error:", err);
            // Parse error message if possible
            let errorMsg = "Shopify güncellenirken hata oluştu.";
            if (err instanceof Error) errorMsg += " (" + err.message + ")";
            return { success: false, message: errorMsg + " DB güncellendi." };
        }
        return { success: true, trackingNumber: trackingNumber };
    };

    // Helper for updating a single shipment with custom cargo company
    const updateShipmentAndShopifyWithCompany = async (
        shipment: any,
        trackingNumber: string,
        cargoCompany: string,
        trackingUrl: string,
        admin: any
    ) => {
        // 1. Update DB
        await prisma.shipment.update({
            where: { id: shipment.id },
            data: {
                trackingNumber: trackingNumber,
                status: "IN_TRANSIT"
            }
        });

        // 2. Update Shopify Fulfillment
        try {
            const fulfillmentQuery = await admin.graphql(
                `#graphql
                query getFulfillmentId($id: ID!) {
                    order(id: $id) {
                        fulfillments(first: 10) {
                            id
                            status
                            trackingInfo {
                                number
                                company
                            }
                            fulfillmentLineItems(first: 50) {
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
                }`,
                { variables: { id: `gid://shopify/Order/${shipment.orderId}` } }
            );

            const fData = await fulfillmentQuery.json();
            const fulfillments = fData.data?.order?.fulfillments || [];
            const activeFulfillments = fulfillments.filter((f: any) => f.status !== 'CANCELLED');

            if (activeFulfillments.length === 0) {
                return { success: false, message: "Shopify'da aktif gönderim bulunamadı. Veritabanı güncellendi." };
            }

            // Find matching fulfillment
            const shipmentItems = await prisma.shipmentItem.findMany({
                where: { shipmentId: shipment.id }
            });

            let targetFulfillment = activeFulfillments.find((f: any) => {
                const fInfos = f.fulfillmentLineItems.edges.map((e: any) => e.node.lineItem.id);
                return shipmentItems.some(sItem =>
                    fInfos.includes(sItem.lineItemId) || fInfos.includes(`gid://shopify/LineItem/${sItem.lineItemId}`)
                );
            });

            if (!targetFulfillment && shipment.mok) {
                targetFulfillment = activeFulfillments.find((f: any) =>
                    f.trackingInfo?.some((t: any) => t.number === shipment.mok)
                );
            }

            if (!targetFulfillment && activeFulfillments.length === 1) {
                targetFulfillment = activeFulfillments[0];
            }

            if (targetFulfillment) {
                const mutationResponse = await admin.graphql(
                    `#graphql
                    mutation fulfillmentTrackingInfoUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
                        fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
                            fulfillment {
                                id
                                status
                                trackingInfo {
                                    number
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
                            fulfillmentId: targetFulfillment.id,
                            trackingInfoInput: {
                                company: cargoCompany,
                                number: trackingNumber,
                                url: trackingUrl || undefined
                            },
                            notifyCustomer: true
                        }
                    }
                );

                const mutationData = await mutationResponse.json();
                const userErrors = mutationData.data?.fulfillmentTrackingInfoUpdate?.userErrors;

                if (userErrors && userErrors.length > 0) {
                    const errorMsg = userErrors.map((e: any) => e.message).join(", ");
                    return { success: false, message: `Shopify Hatası: ${errorMsg}. (DB Güncellendi)` };
                }
            } else {
                return { success: false, message: "Eşleşen Shopify gönderimi bulunamadı. (DB Güncellendi)" };
            }
        } catch (err) {
            console.error("Shopify Sync Error:", err);
            let errorMsg = "Shopify güncellenirken hata oluştu.";
            if (err instanceof Error) errorMsg += " (" + err.message + ")";
            return { success: false, message: errorMsg + " DB güncellendi." };
        }
        return { success: true, trackingNumber: trackingNumber };
    };

    // Helper for updating a single shipment
    const checkAndUpdateShipment = async (shipment: any, settings: any, admin: any) => {
        if (!shipment.mok) return { success: false, message: "MÖK yok" };

        const result = await getShipmentStatus(shipment.mok, settings);

        if (result.success && result.trackingNumber) {
            return await updateShipmentAndShopify(shipment, result.trackingNumber, admin);
        }
        return { success: false, message: result.message };
    };

    if (intent === "manualUpdateTracking") {
        const shipmentId = formData.get("shipmentId") as string;
        const trackingNumber = formData.get("trackingNumber") as string;
        const cargoCompany = formData.get("cargoCompany") as string || "Aras Kargo";

        if (!trackingNumber) return json({ status: "error", message: "Takip numarası girilmedi." });

        const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
        if (!shipment) return json({ status: "error", message: "Gönderi bulunamadı." });

        const trackingUrl = getTrackingUrl(cargoCompany, trackingNumber);
        const result = await updateShipmentAndShopifyWithCompany(shipment, trackingNumber, cargoCompany, trackingUrl, admin);
        if (result.success) {
            return json({ status: "success", message: `Takip no kaydedildi: ${result.trackingNumber}` });
        } else {
            return json({ status: "error", message: result.message || "Bir hata oluştu." });
        }
    }

    if (intent === "updateStatus") {
        const shipmentId = formData.get("shipmentId") as string;
        const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
        if (!shipment) return json({ status: "error", message: "Gönderi bulunamadı." });

        const settings = await prisma.arasKargoSettings.findFirst();
        if (!settings) return json({ status: "error", message: "Ayarlar bulunamadı." });

        const result = await checkAndUpdateShipment(shipment, settings, admin);

        if (result.success) {
            return json({ status: "success", message: `Takip no güncellendi: ${result.trackingNumber}` });
        } else {
            return json({ status: "error", message: result.message || "Takip bilgisi alınamadı." });
        }
    }

    if (intent === "bulkUpdateStatus") {
        const settings = await prisma.arasKargoSettings.findFirst();
        if (!settings) return json({ status: "error", message: "Ayarlar bulunamadı." });

        // Find all shipments that are 'SENT_TO_ARAS' or generally don't have a tracking number yet
        const pendingShipments = await prisma.shipment.findMany({
            where: {
                // status: "SENT_TO_ARAS", // Optionally filter by status
                trackingNumber: null // Safer check: filter by missing tracking number
            },
            take: 20 // Batch size limit
        });

        if (pendingShipments.length === 0) {
            return json({ status: "success", message: "Güncellenecek gönderi yok." });
        }

        let updatedCount = 0;
        for (const shipment of pendingShipments) {
            // Sequential to avoid rate limits
            const result = await checkAndUpdateShipment(shipment, settings, admin);
            if (result.success) updatedCount++;
        }

        return json({ status: "success", message: `${updatedCount} adet gönderi güncellendi.` });
    }

    if (intent === "deleteShipment") {
        const shipmentId = formData.get("shipmentId") as string;
        try {
            // Fix foreign key constraint by deleting items first
            await prisma.shipmentItem.deleteMany({ where: { shipmentId: shipmentId } });
            await prisma.shipment.delete({ where: { id: shipmentId } });
            return json({ status: "success", message: "Gönderi silindi." });
        } catch (error) {
            console.error("Delete Shipment Error:", error);
            return json({ status: "error", message: "Silme işlemi başarısız: " + (error as any).message });
        }
    }

    return null;
};

export default function Shipments() {
    const { orders, localShipments, suppliers, errors } = useLoaderData<typeof loader>();
    const fetcher = useFetcher();
    const navigate = useNavigate();

    const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
    const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
    const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
    const [pieceCount, setPieceCount] = useState<number>(1);

    // Extract order ID from GID for navigation
    const [selectedManualShipment, setSelectedManualShipment] = useState<any | null>(null);
    const [manualTrackingNo, setManualTrackingNo] = useState("");
    const [selectedCargoCompany, setSelectedCargoCompany] = useState("Aras Kargo");

    const handleOrderClick = (order: any) => {
        // Extract numeric ID from gid://shopify/Order/12345 format
        const orderId = order.id.split('/').pop();
        navigate(`/app/orders/${orderId}`);
    };

    const handleCreateShipment = () => {
        console.log("Handle Create Shipment Triggered");
        if (!selectedOrder) {
            console.log("No selected order");
            return;
        }
        if (!selectedSupplierId) {
            console.log("No selected supplier");
            shopify.toast.show("Lütfen bir tedarikçi seçin");
            return;
        }

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

        console.log("Items to ship:", itemsToShip);

        if (itemsToShip.length === 0) {
            console.log("No items selected");
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

        console.log("Submitting form data...");
        fetcher.submit(formData, { method: "POST" });
        setSelectedOrder(null); // Close modal
    };

    // Handle barcode response and general messages
    useEffect(() => {
        const data = fetcher.data as any;
        if (!data) return;

        if (data.status === 'error') {
            shopify.toast.show(data.message, { isError: true });
        } else if (data.status === 'success') {
            // If message exists, show it. Even if it's barcode, we can show "Received".
            if (data.message) shopify.toast.show(data.message);
        }

        if (data.barcodeBase64) {
            // Create a link to download or view
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
                        <div className="gj-card">
                            <div className="gj-card-header">
                                <h3>Bekleyen Siparişler</h3>
                            </div>
                            <div className="gj-card-body">
                                {orders.length === 0 ? (
                                    <Text as="p" tone="subdued">Gönderilecek sipariş bulunamadı.</Text>
                                ) : (
                                    <BlockStack gap="300">
                                        {orders.map((item: any) => {
                                            const { id, name, createdAt, displayFulfillmentStatus, shippingAddress } = item;
                                            return (
                                                <div
                                                    key={id}
                                                    className="gj-order-card"
                                                    onClick={() => handleOrderClick(item)}
                                                >
                                                    <InlineStack align="space-between">
                                                        <div>
                                                            <span className="order-number">{name}</span>
                                                            <span className="order-date"> - {new Date(createdAt).toLocaleDateString('tr-TR')}</span>
                                                            <div className="customer-name">
                                                                {shippingAddress?.firstName} {shippingAddress?.lastName} - {shippingAddress?.city}
                                                            </div>
                                                        </div>
                                                        {getOrderStatusBadge(displayFulfillmentStatus)}
                                                    </InlineStack>
                                                </div>
                                            );
                                        })}
                                    </BlockStack>
                                )}
                            </div>
                        </div>
                    </Layout.Section>

                    <Layout.Section variant="oneThird">
                        <div className="gj-card">
                            <div className="gj-card-header">
                                <h3>Son Gönderiler</h3>
                                <Button
                                    size="micro"
                                    onClick={() => {
                                        const form = new FormData();
                                        form.append("intent", "bulkUpdateStatus");
                                        fetcher.submit(form, { method: "POST" });
                                    }}
                                    loading={fetcher.state === 'submitting'}
                                >
                                    Tümünü Güncelle
                                </Button>
                            </div>
                            <div className="gj-card-body">
                                <BlockStack gap="300">
                                    {localShipments.map((shipment: any) => (
                                        <div key={shipment.id} className="gj-shipment-card">
                                            <div style={{ marginBottom: '8px' }}>
                                                <Text as="p" fontWeight="bold">{shipment.orderNumber}</Text>
                                                <Text as="p" tone="subdued" variant="bodySm">
                                                    <span className="mok-code">{shipment.mok}</span>
                                                </Text>
                                                {shipment.trackingNumber && (
                                                    <a
                                                        href={`http://kargotakip.araskargo.com.tr/mainpage.aspx?code=${shipment.trackingNumber}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="tracking-link"
                                                    >
                                                        Takip: {shipment.trackingNumber}
                                                    </a>
                                                )}
                                            </div>
                                            <InlineStack gap="200" align="start" wrap>
                                                {getStatusBadge(shipment.status)}
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
                                                        Takip No Çek
                                                    </Button>
                                                )}
                                                {!shipment.trackingNumber && (
                                                    <Button
                                                        size="micro"
                                                        onClick={() => {
                                                            setSelectedManualShipment(shipment);
                                                            setManualTrackingNo("");
                                                        }}
                                                    >
                                                        Manuel No
                                                    </Button>
                                                )}
                                                <Button
                                                    size="micro"
                                                    tone="critical"
                                                    onClick={() => {
                                                        if (confirm("Bu gönderiyi silmek istediğinize emin misiniz?")) {
                                                            const form = new FormData();
                                                            form.append("intent", "deleteShipment");
                                                            form.append("shipmentId", shipment.id);
                                                            fetcher.submit(form, { method: "POST" });
                                                        }
                                                    }}
                                                    loading={fetcher.state === 'submitting'}
                                                >
                                                    Sil
                                                </Button>
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
                            </div>
                        </div>
                    </Layout.Section>
                </Layout>
            </BlockStack >

            {/* Shipment Modal */}
            {
                selectedOrder && (
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
                )
            }

            {/* Manual Tracking Modal */}
            {
                selectedManualShipment && (
                    <Modal
                        open={!!selectedManualShipment}
                        onClose={() => setSelectedManualShipment(null)}
                        title={`Manuel Takip No Gir`}
                        primaryAction={{
                            content: 'Kaydet',
                            onAction: () => {
                                const form = new FormData();
                                form.append("intent", "manualUpdateTracking");
                                form.append("shipmentId", selectedManualShipment.id);
                                form.append("trackingNumber", manualTrackingNo);
                                form.append("cargoCompany", selectedCargoCompany);
                                fetcher.submit(form, { method: "POST" });
                                setSelectedManualShipment(null);
                            },
                        }}
                        secondaryActions={[{ content: 'İptal', onAction: () => setSelectedManualShipment(null) }]}
                    >
                        <Modal.Section>
                            <BlockStack gap="400">
                                <Select
                                    label="Kargo Firması"
                                    options={CARGO_COMPANIES.map(c => ({ label: c.label, value: c.value }))}
                                    value={selectedCargoCompany}
                                    onChange={setSelectedCargoCompany}
                                />
                                <TextField
                                    label="Takip Numarası"
                                    value={manualTrackingNo}
                                    onChange={setManualTrackingNo}
                                    autoComplete="off"
                                    placeholder="Örn: 1234567890"
                                />
                            </BlockStack>
                        </Modal.Section>
                    </Modal>
                )
            }
        </Page >
    );
}
