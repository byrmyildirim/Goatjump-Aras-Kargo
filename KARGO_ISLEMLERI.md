# Kargo İşlemleri Modülü Dokümantasyonu

Bu doküman, `shopify-kargo-app` projesi içerisindeki kargo gönderim süreçleri, veri yapıları ve entegrasyon fonksiyonlarını detaylandırmaktadır. Modül, **Aras Kargo** servisi ile entegre çalışmaktadır.

## 1. Veri Modelleri (Prisma Schema)

Veritabanında kargo süreçlerini yönetmek için kullanılan temel tablolar (`prisma/schema.prisma`):

### `Shipment` (Kargo Gönderimi)
Bir sipariş için oluşturulan kargo kaydını tutar.
- **`id`**: Benzersiz kayıt kimliği (CUID).
- **`orderId`**: Shopify sipariş ID'si (gid formatında).
- **`orderNumber`**: Okunabilir sipariş numarası (örn: #1001).
- **`mok`**: (Müşteri Özel Kodu) Aras Kargo entegrasyonu için üretilen benzersiz gönderi kodu.
- **`trackingNumber`**: Aras Kargo'dan dönen takip numarası.
- **`status`**: Gönderi durumu (`PENDING`, `SENT_TO_ARAS`, `IN_TRANSIT`, `DELIVERED`, `CANCELLED`).
- **`addressId`**: Gönderici (Tedarikçi) çıkış şubesi ID'si.
- **`pieceCount`**: Paket/Koli adedi.

### `ShipmentItem` (Gönderi İçeriği)
Bir kargo paketinin içindeki ürünleri listeler.
- **`sku`**, **`title`**, **`quantity`**: Ürün bilgileri.
- **`lineItemId`**: Shopify satır kalemi ID's.

### `Supplier` (Tedarikçi)
Ürünü gönderen tedarikçi/depo bilgisi.
- **`supplierCode`**: MÖK üretiminde kullanılan kısa kod (örn: G04).
- **`arasAddressId`**: Aras Kargo sistemindeki çıkış adresi ID'si.

### `ArasKargoSettings` (Entegrasyon Ayarları)
Aras Kargo API erişim bilgileri.
- **`senderUsername`** / **`senderPassword`**: Gönderim servisi kimlik bilgileri.
- **`queryUsername`** / **`queryPassword`**: Sorgulama servisi kimlik bilgileri.

---

## 2. Kargo Servisi (`app/services/arasKargo.server.ts`)

Aras Kargo API (SOAP) ile iletişim kuran çekirdek fonksiyonlar.

### `sendPackageToAras(input, settings)`
Yeni bir gönderi oluşturur.
- **İşlev**: Sipariş bilgilerini alır, MÖK üretir ve Aras Kargo `SetOrder` servisine XML gönderir.
- **Adres Düzeltme**: Girilen il ve ilçe bilgilerini, bilinen Türk illeri listesi (`turkishProvinces`) ve posta kodu eşleşmeleriyle (`getDistrictFromZip`) doğrular ve düzeltir.
- **MÖK Üretimi**: `SiparişNo + TedarikçiKodu + UniqueID` formatında benzersiz bir kod üretir (`generateMOK`).
- **Parça Detayı**: Çoklu paket (`pieceCount > 1`) durumunda her parça için alt barkodlar (`MOK-1`, `MOK-2`) oluşturur.

### `getShipmentStatus(mok, settings)`
Gönderi durumunu sorgular.
- **İşlev**: MÖK kullanarak `GetOrderWithIntegrationCode` servisine istek atar.
- **Dönüş**: Varsa kargo takip numarasını (`CargoBarcode`) ve durum bilgisini döner.

### `getBarcode(mok, settings)`
Barkod görselini/verisini çeker.
- **İşlev**: `GetBarcode` servisini kullanarak etiket yazdrımak için ZPL veya Base64 formatında barkod verisi alır.

---

## 3. Uygulama Akışı ve Rotalar

### 3.1. Sipariş Detayı ve Paketleme (`app/routes/app.orders.$orderId.tsx`)
Sipariş bazlı işlem sayfası.

- **Veri Yükleme (`loader`)**:
  - Shopify'dan sipariş detaylarını (GraphQL) çeker.
  - Veritabanından geçmiş kargo gönderilerini (`localShipments`) listeler.
  - Tedarikçi listesini getirir.

- **İşlemler (`action`)**:
  - `stagePackage`: Seçilen ürünleri Aras Kargo servisine iletir (`sendPackageToAras`) ve veritabanına `Shipment` kaydı atar. Başarılı olursa etiket modalını açar.
  - `createFulfillment`: Hazırlanan paketleri ("stagedPackages") Shopify tarafında "Fulfillment" (Teslimat) olarak işaretler ve müşteriye bildirim/takip numarası gönderir.

- **Özellikler**:
  - Ürün seçimi (partial fulfillment destekli).
  - Adres düzenleme (gönderim öncesi alıcı adresi güncelleme).
  - Canlı etiket yazdırma modalı (`ShippingLabelModal`).

### 3.2. Kargo Listesi (`app/routes/app.shipments.tsx`)
Tüm bekleyen ve gönderilen kargoların yönetim paneli.

- **Bekleyen Siparişler**: Shopify'dan `unfulfilled` (gönderilmemiş) siparişleri çeker.
- **Son Gönderiler**: Veritabanındaki son `Shipment` kayıtlarını listeler.
- **Hızlı İşlemler**:
  - Durum Güncelle: Takip numarasını servisten sorgular ve günceller.
  - Barkod: Barkod çıktısı alır.

---

## 4. Kullanılan Yardımcı Bileşenler

### `ShippingLabelModal.tsx`
- Kargo etiketini ekranda gösterir ve yazdırma işlemi başlatır.
- **JsBarcode** kütüphanesini kullanarak MÖK bilgisini Code128 formatında barkoda çevirir.
- Gönderici, Alıcı ve İçerik bilgilerini standart bir etiket formatında sunar.
