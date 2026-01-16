import { useEffect, useState } from 'react';
import {
    AdminAction,
    Button,
    BlockStack,
    Text,
    useApi,
} from '@shopify/ui-extensions-react/admin';

export default function ActionExtension() {
    const { close, data, navigation } = useApi<'admin.order-details.action.render'>();
    const orderId = data.selected?.[0]?.id; // Gets 'gid://shopify/Order/12345'

    // Extract numeric ID
    const numericId = orderId ? orderId.split('/').pop() : '';

    // Construct the app URL (assuming embedded app context or direct validation)
    // We can't easily guess the shop domain here without `data.shop.url`?
    // `useApi` provides `i18n`, `extension`, etc.

    return (
        <AdminAction primaryAction={
            <Button
                onPress={async () => {
                    if (numericId) {
                        // Navigate to the app's route for this order
                        // We use the full app URL or a relative path if supported?
                        // Shopify Admin Action navigation typically supports absolute URLs.
                        // We will point to the app's production URL + /app/orders/ID
                        const appUrl = `https://goatjump-aras-kargo-production.up.railway.app/app/orders/${numericId}`;
                        await navigation.navigate(appUrl);
                    }
                    close();
                }}
            >
                Panelde Aç
            </Button>
        } secondaryAction={
            <Button onPress={() => close()}>İptal</Button>
        }>
            <BlockStack gap="large">
                <Text fontWeight="bold">
                    Aras Kargo İşlemleri
                </Text>
                <Text>
                    Sipariş detaylarını görüntülemek ve kargo etiketi oluşturmak için kargo panelini açın.
                </Text>
            </BlockStack>
        </AdminAction>
    );
}
