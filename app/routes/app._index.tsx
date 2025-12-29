import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link as RemixLink } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Icon,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <Page>
      <TitleBar title="Goatjump Aras Kargo" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  🚚 Aras Kargo Entegrasyonu
                </Text>
                <Text as="p" variant="bodyMd">
                  Bu uygulama ile Shopify siparişlerinizi kolayca Aras Kargo'ya
                  gönderebilir, takip numaralarını çekebilir ve fulfillment
                  işlemlerini yönetebilirsiniz.
                </Text>
                <InlineStack gap="300">
                  <RemixLink to="/app/shipments">
                    <Button variant="primary">Kargo İşlemleri</Button>
                  </RemixLink>
                  <RemixLink to="/app/settings">
                    <Button>Ayarlar</Button>
                  </RemixLink>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Hızlı Başlangıç
                  </Text>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">
                      1. <strong>Ayarlar</strong> sayfasından Aras Kargo API bilgilerinizi girin.
                    </Text>
                    <Text as="p" variant="bodyMd">
                      2. En az bir <strong>Tedarikçi</strong> ekleyin (Ad, Kod, AddressID).
                    </Text>
                    <Text as="p" variant="bodyMd">
                      3. <strong>Kargo İşlemleri</strong> sayfasından siparişleri kargoya verin.
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Özellikler
                  </Text>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">✅ Aras Kargo SOAP API Entegrasyonu</Text>
                    <Text as="p" variant="bodyMd">✅ Otomatik MÖK Oluşturma</Text>
                    <Text as="p" variant="bodyMd">✅ Parçalı Gönderim Desteği</Text>
                    <Text as="p" variant="bodyMd">✅ Takip Numarası Sorgulama</Text>
                    <Text as="p" variant="bodyMd">✅ Türkiye Adres Düzeltme</Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
