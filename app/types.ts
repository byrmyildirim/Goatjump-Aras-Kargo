
export interface ArasKargoConfig {
    senderUsername: string;
    senderPassword?: string;
    senderCustomerCode: string;
    queryUsername: string;
    queryPassword?: string;
    queryCustomerCode: string;
    addressIdGonderimi: 'Aktif' | 'Pasif';
    parcaBilgisiGonderilsin: boolean;
    barkodCiktiTuru: string;
    yaziciKagitGenisligi: number;
    yaziciKagitYuksekligi: number;
    yazdirmaYogunlugu: string;
    addressId: string;
    configurationId: string;
    iadeKoduGecerlilikSuresi: number;
    iadeBilgilendirmeMetni: string;
    manualSuppliers: ManualSupplier[];
}

export interface ManualSupplier {
    id: string; // Prisma ID is string (cuid)
    name: string;
    supplierCode: string;
    arasAddressId: string;
}

// Minimal Shopify types needed for the UI
export interface ShopifyLineItem {
    id: number;
    title: string;
    quantity: number;
    fulfillable_quantity: number;
    price: string;
    sku: string;
    imageUrl?: string;
    variant_id: number;
    vendor: string;
}

export interface ShopifyAddress {
    firstName: string;
    lastName: string;
    company: string | null;
    address1: string;
    address2: string | null;
    phone: string;
    city: string;
    zip: string;
    province: string;
    country: string;
}

export interface ShopifyOrder {
    id: number; // Numeric ID from Shopify REST API
    gid: string; // GraphQL ID
    orderNumber: string;
    createdAt: string;
    totalPrice: string;
    paymentStatus: string;
    fulfillmentStatus: string | null;
    lineItems: ShopifyLineItem[];
    customer: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
    } | null;
    shippingAddress: ShopifyAddress | null;
}

export interface StagedPackage {
    supplierId: string; // ID of the selected ManualSupplier
    supplierName: string;
    items: {
        lineItemId: number;
        sku: string;
        title: string;
        quantity: number;
    }[];
    mok?: string;
}
