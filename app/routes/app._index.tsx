import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link as RemixLink, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Icon,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { DeliveryIcon, PackageIcon, ClipboardIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // Statistics
  const pendingCount = await prisma.shipment.count({ where: { status: 'PENDING' } });
  const sentCount = await prisma.shipment.count({ where: { status: 'SENT_TO_ARAS' } });
  const inTransitCount = await prisma.shipment.count({ where: { status: 'IN_TRANSIT' } });
  const deliveredCount = await prisma.shipment.count({ where: { status: 'DELIVERED' } });

  // Recent 5
  const recentShipments = await prisma.shipment.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' }
  });

  return json({ stats: { pendingCount, sentCount, inTransitCount, deliveredCount }, recentShipments });
};

export default function Index() {
  const { stats, recentShipments } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Goatjump Aras Kargo" />
      <BlockStack gap="500">

        {/* Stats Row */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200" align="center">
                <Text as="h2" variant="headingSm" tone="subdued">Hazırlanıyor (MÖK Alındı)</Text>
                <Text as="p" variant="heading2xl">{stats.sentCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200" align="center">
                <Text as="h2" variant="headingSm" tone="subdued">Kargoda</Text>
                <Text as="p" variant="heading2xl">{stats.inTransitCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200" align="center">
                <Text as="h2" variant="headingSm" tone="subdued">Teslim Edildi</Text>
                <Text as="p" variant="heading2xl">{stats.deliveredCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

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
                    <Button variant="primary" size="large" icon={DeliveryIcon}>Kargo İşlemleri</Button>
                  </RemixLink>
                  <RemixLink to="/app/settings">
                    <Button size="large" icon={PackageIcon}>Ayarlar</Button>
                  </RemixLink>
                  <RemixLink to="/app/tracking-test">
                    <Button size="large" variant="plain">Test Aracı</Button>
                  </RemixLink>
                </InlineStack>
              </BlockStack>
            </Card>

            <div style={{ marginTop: '20px' }}>
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">Son İşlemler</Text>
                  <Divider />
                  {recentShipments.length === 0 ? (
                    <Text as="p" tone="subdued">Henüz işlem yok.</Text>
                  ) : (
                    <BlockStack gap="200">
                      {recentShipments.map(s => (
                        <InlineStack key={s.id} align="space-between">
                          <Text as="span" fontWeight="bold">{s.orderNumber}</Text>
                          <Text as="span" tone="subdued">{s.mok}</Text>
                          <Text as="span" tone={s.status === 'DELIVERED' ? 'success' : 'subdued'}>{s.status}</Text>
                          <Text as="span" tone="subdued">{new Date(s.createdAt).toLocaleDateString('tr-TR')}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </div>
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
