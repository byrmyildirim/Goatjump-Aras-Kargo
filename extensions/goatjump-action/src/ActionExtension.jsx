import {
  reactExtension,
  useApi,
  AdminAction,
  BlockStack,
  Button,
  Text,
  TextField,
  Select,
  Box,
  Banner,
} from '@shopify/ui-extensions-react/admin';
import { useState, useEffect } from 'react';

// TARGET: admin.order-details.action.render
const TARGET = 'admin.order-details.action.render';

export default reactExtension(TARGET, () => <App />);

function App() {
  const { data, getSessionToken } = useApi(TARGET);
  const [orderId, setOrderId] = useState('');
  const [appData, setAppData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form State
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [pieceCount, setPieceCount] = useState('1');

  // CHANGE THIS TO YOUR PRODUCTION URL
  // During dev, use your tunnel URL (npm run dev output)
  // For production, use your Railway URL
  const APP_URL = "https://shopify-kargo-app-production.up.railway.app";

  useEffect(() => {
    // data.selected is array of selected items. For order details action, it usually contains the resource ID.
    // For 'admin.order-details.action.render', the context provides the order ID in data.selected? 
    // Actually, check documentation: data.selected might be undefined for details page action, 
    // but data.resource might exist? 
    // Let's assume data.selected[0].id exists and is the gid.

    if (data?.selected?.[0]?.id) {
      // gid://shopify/Order/12345
      const gid = data.selected[0].id;
      const id = gid.split('/').pop();
      setOrderId(id);
      fetchOrderData(id);
    } else {
      setError('Sipariş ID bulunamadı.');
      setLoading(false);
    }
  }, [data]);

  const fetchOrderData = async (id) => {
    try {
      setLoading(true);
      const token = await getSessionToken();
      const response = await fetch(`${APP_URL}/api/shipment?orderId=${id}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const json = await response.json();
      if (json.status === 'success') {
        setAppData(json.data);
        if (json.data.suppliers?.length > 0) {
          setSelectedSupplier(json.data.suppliers[0].id);
        }
      } else {
        setError(json.message || 'Veri çekilemedi');
      }
    } catch (e) {
      setError('Bağlantı hatası: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStagePackage = async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getSessionToken();

      // Prepare items (Ship all fulfillable items for now - simple version)
      const items = appData.order.lineItems.edges
        .map(e => e.node)
        .filter(item => item.fulfillableQuantity > 0)
        .map(item => ({
          id: item.id,
          title: item.title,
          sku: item.sku,
          quantity: item.fulfillableQuantity
        }));

      if (items.length === 0) {
        setError('Gönderilecek ürün yok');
        setLoading(false);
        return;
      }

      const payload = {
        intent: "stagePackage",
        orderId: orderId,
        orderName: appData.order.name,
        supplierId: selectedSupplier,
        items,
        shippingAddress: appData.order.shippingAddress,
        pieceCount: parseInt(pieceCount)
      };

      const response = await fetch(`${APP_URL}/api/shipment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.status === 'success') {
        setSuccess(`Paket Hazır! MÖK: ${result.mok}`);
        // Refresh data
        fetchOrderData(orderId);

        // Auto-fulfill logic? Maybe user wants to check first.
        // We can show a "Send to Shopify" button now.
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError('Hata: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFulfillment = async () => {
    // Find the staged package (latest)
    // Simpler: Just send "createFulfillment" for locally stored packages via API
    // Since API is stateless regarding UI state, we need to pass the packages.
    // But here we don't have the packages in state easily unless we parse localShipments

    // Backend api/shipment doesn't support "fetch my staged packages", it expects them in payload.
    // But localShipments in appData has "mok" and "items". We can construct it.

    const sentShipments = appData.localShipments.filter(s => s.status === 'SENT_TO_ARAS' || s.status === 'SUCCESS');
    // Actually if status is SUCCESS it might be already fulfilled in Shopify?
    // Let's assume we want to fulfill everything that has a MOK but isn't fulfilled in Shopify?
    // Complicated logic for embedded. 

    // Let's use the response from stagePackage if available, OR use localShipments.

    if (!appData.localShipments || appData.localShipments.length === 0) {
      setError("Hazır paket bulunamadı.");
      return;
    }

    // Reconstruct packages payload
    const packages = appData.localShipments.map(s => ({
      id: s.id,
      mok: s.mok,
      items: s.items.map(i => ({ id: i.lineItemId, quantity: i.quantity }))
    }));

    try {
      setLoading(true);
      const token = await getSessionToken();
      const response = await fetch(`${APP_URL}/api/shipment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          intent: "createFulfillment",
          orderGid: `gid://shopify/Order/${orderId}`,
          packages
        })
      });

      const result = await response.json();
      if (result.status === 'success') {
        setSuccess(result.message);
        // Close modal?
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError('Hata: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminAction
      primaryAction={
        !appData ? undefined : (
          <Button
            onPress={handleStagePackage}
            loading={loading}
            disabled={loading || !!success}
          >
            Paketi Hazırla & MÖK Al
          </Button>
        )
      }
      secondaryAction={
        (appData?.localShipments?.length > 0 && !success) ? (
          <Button
            onPress={handleCreateFulfillment}
            loading={loading}
          >
            Shopify'a Gönder (Tümü)
          </Button>
        ) : undefined
      }
    >
      <BlockStack gap>
        {loading && !appData && <Text>Yükleniyor...</Text>}

        {error && <Banner tone="critical">{error}</Banner>}
        {success && <Banner tone="success">{success}</Banner>}

        {appData && (
          <>
            <Text fontWeight="bold" size="large">Sipariş: {appData.order.name}</Text>

            <Box paddingBlockStart="large">
              <Select
                label="Tedarikçi"
                value={selectedSupplier}
                onChange={setSelectedSupplier}
                options={appData.suppliers.map(s => ({ label: s.name, value: s.id }))}
              />
            </Box>

            <Box paddingBlockStart="base">
              <TextField
                label="Parça Sayısı"
                value={pieceCount}
                onChange={setPieceCount}
                type="number"
              />
            </Box>

            {appData.localShipments.length > 0 && (
              <Box paddingBlockStart="large">
                <Text fontWeight="bold">Hazırlanan Paketler:</Text>
                {appData.localShipments.map(s => (
                  <Text key={s.id}>{s.supplierName} - MÖK: {s.mok}</Text>
                ))}
              </Box>
            )}
          </>
        )}
      </BlockStack>
    </AdminAction>
  );
}