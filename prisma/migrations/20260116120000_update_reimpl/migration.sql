-- CreateEnum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShipmentStatus') THEN
        CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'SENT_TO_ARAS', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
    END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "mok" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "pieceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "arasAddressId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Shipment_mok_key" ON "Shipment"("mok");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_supplierCode_key" ON "Supplier"("supplierCode");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'Shipment_supplierId_fkey') THEN
        ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ShipmentItem_shipmentId_fkey') THEN
        ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable ArasKargoSettings
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "addressIdGonderimi" TEXT NOT NULL DEFAULT 'Aktif';
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "parcaBilgisiGonderilsin" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "barkodCiktiTuru" TEXT NOT NULL DEFAULT 'Standart';
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "yaziciKagitGenisligi" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "yaziciKagitYuksekligi" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "yazdirmaYogunlugu" TEXT NOT NULL DEFAULT '8 dpmm (203 dpi)';
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "addressId" TEXT;
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "configurationId" TEXT;
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "iadeKoduGecerlilikSuresi" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "ArasKargoSettings" ADD COLUMN IF NOT EXISTS "iadeBilgilendirmeMetni" TEXT;
