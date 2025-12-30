import {
  reactExtension,
  useApi,
  AdminAction,
  BlockStack,
  Button,
  Text,
  Box,
} from '@shopify/ui-extensions-react/admin';

const TARGET = 'admin.order-details.action.render';

export default reactExtension(TARGET, () => <App />);

function App() {
  const api = useApi(TARGET);

  // Sipariş ID'sini al
  const orderId = api.data?.selected?.[0]?.id?.split('/').pop() || '';

  const handleOpenApp = () => {
    // Uygulama sipariş sayfasını yeni sekmede aç
    const url = `https://goatjump-aras-kargo-production.up.railway.app/app/orders/${orderId}`;

    // Admin extension'larda window.open çalışmayabilir, alternatif olarak close ve mesaj
    try {
      window.open(url, '_blank');
    } catch (e) {
      console.log('Redirect URL:', url);
    }
  };

  return (
    <AdminAction
      primaryAction={
        <Button onPress={handleOpenApp}>
          Kargo Sayfasını Aç
        </Button>
      }
    >
      <BlockStack>
        <Text>Aras Kargo işlemleri için uygulama sayfasına yönlendirileceksiniz.</Text>

        {orderId ? (
          <Box paddingBlockStart="base">
            <Text>Sipariş No: #{orderId}</Text>
          </Box>
        ) : (
          <Box paddingBlockStart="base">
            <Text>Sipariş bilgisi yükleniyor...</Text>
          </Box>
        )}
      </BlockStack>
    </AdminAction>
  );
}