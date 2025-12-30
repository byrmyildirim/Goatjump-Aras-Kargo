import {
  reactExtension,
  AdminAction,
  BlockStack,
  Text,
} from '@shopify/ui-extensions-react/admin';

const TARGET = 'admin.order-details.action.render';

export default reactExtension(TARGET, () => <App />);

function App() {
  return (
    <AdminAction
      title="Aras Kargo"
    >
      <BlockStack>
        <Text>Aras Kargo işlemleri için bu sayfayı kullanabilirsiniz.</Text>
        <Text>Sipariş detayları yükleniyor...</Text>
      </BlockStack>
    </AdminAction>
  );
}