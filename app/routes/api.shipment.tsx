import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendPackageToAras } from "../services/arasKargo.server";

// Loader: Fetch Order Data and Settings for the Extension
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");

    if (!orderId) {
        return json({ status: "error", message: "Order ID is required" }, { status: 400 });
    }

    try {
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
                    }
                }
            }`,
            { variables: { id: `gid://shopify/Order/${orderId}` } }
        );

        const data = await response.json();
        const order = data.data?.order;

        if (!order) {
            return json({ status: "error", message: "Order not found" }, { status: 404 });
        }

        // Fetch suppliers and settings from database
        const suppliers = await prisma.supplier.findMany();
        const settings = await prisma.arasKargoSettings.findFirst();

        // Fetch past shipments for this order
        const localShipments = await prisma.shipment.findMany({
            where: { orderId: orderId },
            include: { items: true }
        });

        return json({
            status: "success",
            data: {
                order,
                suppliers,
                settings: !!settings, // Just checking if settings exist
                localShipments
            }
        });

    } catch (error) {
        console.error("API Loader Error:", error);
        return json({ status: "error", message: "Failed to load order data" }, { status: 500 });
    }
};

// Action: Handle Stage Package and Create Fulfillment
export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const method = request.method;

    if (method !== "POST") {
        return json({ status: "error", message: "Method not allowed" }, { status: 405 });
    }

    try {
        const payload = await request.json();
        const { intent } = payload;

        if (intent === "stagePackage") {
            const { supplierId, orderName, items, shippingAddress, pieceCount, orderId } = payload;

            const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
            const settings = await prisma.arasKargoSettings.findFirst();

            if (!supplier || !settings) {
                return json({ status: "error", message: "Tedarikçi veya Ayarlar bulunamadı." });
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
                pieceCount: pieceCount || 1
            }, settings);

            if (!result.success) {
                return json({ status: "error", message: result.message });
            }

            // Save to database
            await prisma.shipment.create({
                data: {
                    orderId: String(orderId),
                    orderNumber: orderName,
                    mok: result.mok || "",
                    supplierId: supplier.id,
                    supplierName: supplier.name,
                    addressId: supplier.arasAddressId,
                    pieceCount: pieceCount || 1,
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
                    name: supplier.name
                }
            });
        }

        if (intent === "createFulfillment") {
            const { packages, orderGid } = payload;

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

            // Process each package
            for (const pkg of packages) {
                const fulfillmentOrderLineItems = pkg.items.map((item: any) => {
                    const foLineItem = fulfillmentOrder.lineItems.edges.find((edge: any) =>
                        edge.node.lineItem.id === item.id || edge.node.lineItem.id === `gid://shopify/LineItem/${item.id}`
                    );
                    if (foLineItem) {
                        return { id: foLineItem.node.id, quantity: item.quantity };
                    }
                    return null;
                }).filter(Boolean);

                if (fulfillmentOrderLineItems.length === 0) {
                    errors.push(`Paket ${pkg.id} için ürün bulunamadı.`);
                    continue;
                }

                // Create fulfillment with tracking
                const response = await admin.graphql(
                    `#graphql
                    mutation fulfillmentCreate($fulfillment: FulfillmentCreateV2Input!) {
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
                    errors.push(`Hata (${pkg.mok}): ${result.data.fulfillmentCreateV2.userErrors[0].message}`);
                } else {
                    successCount++;
                }
            }

            if (errors.length > 0) {
                return json({
                    status: successCount > 0 ? "success" : "error",
                    message: `${successCount} paket gönderildi. Hatalar: ${errors.join(", ")}`
                });
            }

            return json({ status: "success", message: `${successCount} paket başarıyla Shopify'a gönderildi!` });
        }

        return json({ status: "error", message: "Unknown intent" }, { status: 400 });

    } catch (error) {
        console.error("API Action Error:", error);
        return json({ status: "error", message: (error as Error).message }, { status: 500 });
    }
};
