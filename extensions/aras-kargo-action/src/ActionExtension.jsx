import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
}

function Extension() {
  const { i18n, close, data } = shopify;
  const [orderName, setOrderName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async function getOrderInfo() {
      try {
        const orderId = data.selected[0].id;
        const getOrderQuery = {
          query: `query Order($id: ID!) {
            order(id: $id) {
              name
              displayFulfillmentStatus
              shippingAddress {
                name
                city
                countryCode
              }
            }
          }`,
          variables: { id: orderId },
        };

        const res = await fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          body: JSON.stringify(getOrderQuery),
        });

        if (res.ok) {
          const orderData = await res.json();
          setOrderName(orderData.data.order.name);
        }
      } catch (error) {
        console.error('Error fetching order:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [data.selected]);

  const handleOpenApp = () => {
    const orderId = data.selected[0].id.split('/').pop();
    window.open(`https://goatjump-aras-kargo-production.up.railway.app/app/orders/${orderId}`, '_blank');
    close();
  };

  return (
    <s-admin-action>
      <s-stack direction="block">
        <s-text type="strong">Aras Kargo Gönderimi</s-text>
        {loading ? (
          <s-text>Sipariş bilgileri yükleniyor...</s-text>
        ) : (
          <s-text>Sipariş: {orderName}</s-text>
        )}
        <s-text>Kargo işlemleri için uygulama sayfasına yönlendirileceksiniz.</s-text>
      </s-stack>
      <s-button slot="primary-action" onClick={handleOpenApp}>
        Kargo Sayfasını Aç
      </s-button>
      <s-button slot="secondary-actions" onClick={() => close()}>
        İptal
      </s-button>
    </s-admin-action>
  );
}