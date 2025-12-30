import {
  reactExtension,
  useApi,
  AdminAction,
  BlockStack,
  Button,
  Text,
  Box,
  Banner,
} from '@shopify/ui-extensions-react/admin';
import { useState, useEffect } from 'react';

const TARGET = 'admin.order-details.action.render';

export default reactExtension(TARGET, () => <App />);

function App() {
  const { data } = useApi(TARGET);
  const [orderName, setOrderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Get order info from extension data
    if (data?.selected?.[0]?.id) {
      const gid = data.selected[0].id;
      setOrderName(gid);
    }
  }, [data]);

  const handleAction = () => {
    setLoading(true);
    // Sipariş detay sayfasına yönlendir
    const orderId = orderName.split('/').pop();
    window.open(`https://goatjump-aras-kargo-production.up.railway.app/app/orders/${orderId}`, '_blank');
    setLoading(false);
    setMessage('Kargo sayfası yeni sekmede açıldı');
  };

  return (
    <AdminAction
      primaryAction={
        <Button onPress={handleAction} disabled={loading}>
          Kargo Sayfasını Aç
        </Button>
      }
    >
      <BlockStack>
        <Text>Aras Kargo işlemleri için uygulama sayfasına yönlendirileceksiniz.</Text>

        {orderName && (
          <Box paddingBlockStart="base">
            <Text>Sipariş: {orderName.split('/').pop()}</Text>
          </Box>
        )}

        {message && (
          <Box paddingBlockStart="base">
            <Banner tone="success">{message}</Banner>
          </Box>
        )}
      </BlockStack>
    </AdminAction>
  );
}