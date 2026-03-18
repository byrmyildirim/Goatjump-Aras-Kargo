import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link as RemixLink, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { DeliveryIcon, PackageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

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

  // Fetch customer names from Shopify for these shipments
  const enrichedShipments = await Promise.all(recentShipments.map(async (s) => {
    let gid = s.orderId;
    if (!gid.startsWith('gid://')) {
        gid = `gid://shopify/Order/${gid}`;
    }
    
    try {
      const response = await admin.graphql(`#graphql
        query getOrder($id: ID!) {
          order(id: $id) {
            customer {
              firstName
              lastName
            }
          }
        }
      `, { variables: { id: gid } });
      const responseJson = await response.json();
      const customer = responseJson.data?.order?.customer;
      return { 
        ...s, 
        customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Bilinmiyor" 
      };
    } catch (e) {
      console.error(`Error fetching customer for ${s.orderNumber}:`, e);
      return { ...s, customerName: "Bilinmiyor" };
    }
  }));

  return json({ stats: { pendingCount, sentCount, inTransitCount, deliveredCount }, recentShipments: enrichedShipments });
};

// Status badge helper
const getStatusBadge = (status: string) => {
  const statusMap: Record<string, { class: string; label: string }> = {
    'PENDING': { class: 'pending', label: 'Bekliyor' },
    'SENT_TO_ARAS': { class: 'sent', label: 'Hazırlanıyor' },
    'IN_TRANSIT': { class: 'in-transit', label: 'Kargoda' },
    'DELIVERED': { class: 'delivered', label: 'Teslim Edildi' },
    'CANCELLED': { class: 'cancelled', label: 'İptal' },
  };
  const info = statusMap[status] || { class: 'pending', label: status };
  return <span className={`gj-badge ${info.class}`}>{info.label}</span>;
};

export default function Index() {
  const { stats, recentShipments } = useLoaderData<typeof loader>();

  return (
    <Page fullWidth>
      <TitleBar title="Goatjump Aras Kargo" />
      <BlockStack gap="500">

        {/* Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
          <div className="gj-stat-card warning">
            <div className="stat-icon">📦</div>
            <div className="stat-label">Hazırlanıyor (MÖK Alındı)</div>
            <div className="stat-value">{stats.sentCount}</div>
          </div>
          <div className="gj-stat-card info">
            <div className="stat-icon">🚚</div>
            <div className="stat-label">Kargoda</div>
            <div className="stat-value">{stats.inTransitCount}</div>
          </div>
          <div className="gj-stat-card success">
            <div className="stat-icon">✅</div>
            <div className="stat-label">Teslim Edildi</div>
            <div className="stat-value">{stats.deliveredCount}</div>
          </div>
        </div>

        <Layout>
          <Layout.Section>
            {/* Hero Section */}
            <div className="gj-hero gj-animate-in">
              <h2>🚚 Aras Kargo Entegrasyonu</h2>
              <p>
                Bu uygulama ile Shopify siparişlerinizi kolayca Aras Kargo'ya
                gönderebilir, takip numaralarını çekebilir ve fulfillment
                işlemlerini yönetebilirsiniz.
              </p>
              <InlineStack gap="300">
                <RemixLink to="/app/shipments">
                  <Button variant="primary" size="large" icon={DeliveryIcon}>Kargo İşlemleri</Button>
                </RemixLink>
                <RemixLink to="/app/settings">
                  <Button size="large" icon={PackageIcon}>Ayarlar</Button>
                </RemixLink>
              </InlineStack>
            </div>

            {/* Recent Activity */}
            <div style={{ marginTop: '20px' }} className="gj-card gj-animate-in">
              <div className="gj-card-header">
                <h3>Son İşlemler</h3>
              </div>
              <div className="gj-card-body">
                {recentShipments.length === 0 ? (
                  <Text as="p" tone="subdued">Henüz işlem yok.</Text>
                ) : (
                  <div className="gj-activity-table">
                    {recentShipments.map((s: any) => (
                      <div key={s.id} className="gj-activity-row">
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '15px' }}>
                          <span className="order-num">#{s.orderNumber}</span>
                          <span className="customer-name-inline" style={{ fontWeight: 500 }}>{s.customerName}</span>
                        </div>
                        <span className="mok">{s.mok}</span>
                        {getStatusBadge(s.status)}
                        <span className="date">{new Date(s.createdAt).toLocaleDateString('tr-TR')}</span>
                        <RemixLink to={`/app/orders/${s.orderId.split('/').pop()}`}>
                           <Button size="micro" variant="secondary">Siparişe Git</Button>
                        </RemixLink>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Quick Start */}
              <div className="gj-card gj-animate-in">
                <div className="gj-card-header">
                  <h3>Hızlı Başlangıç</h3>
                </div>
                <div className="gj-card-body">
                  <div className="gj-step">
                    <span className="gj-step-number">1</span>
                    <div className="gj-step-content">
                      <Text as="p" variant="bodyMd">
                        <strong>Ayarlar</strong> sayfasından Aras Kargo API bilgilerinizi girin.
                      </Text>
                    </div>
                  </div>
                  <div className="gj-step">
                    <span className="gj-step-number">2</span>
                    <div className="gj-step-content">
                      <Text as="p" variant="bodyMd">
                        En az bir <strong>Tedarikçi</strong> ekleyin (Ad, Kod, AddressID).
                      </Text>
                    </div>
                  </div>
                  <div className="gj-step">
                    <span className="gj-step-number">3</span>
                    <div className="gj-step-content">
                      <Text as="p" variant="bodyMd">
                        <strong>Kargo İşlemleri</strong> sayfasından siparişleri kargoya verin.
                      </Text>
                    </div>
                  </div>
                </div>
              </div>

              {/* Features */}
              <div className="gj-card gj-animate-in">
                <div className="gj-card-header">
                  <h3>Özellikler</h3>
                </div>
                <div className="gj-card-body">
                  <ul className="gj-feature-list">
                    <li>Aras Kargo SOAP API Entegrasyonu</li>
                    <li>Otomatik MÖK Oluşturma</li>
                    <li>Parçalı Gönderim Desteği</li>
                    <li>Takip Numarası Sorgulama</li>
                    <li>Türkiye Adres Düzeltme</li>
                  </ul>
                </div>
              </div>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
