import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function fix() {
  await prisma.shipment.updateMany({
    where: {
      status: 'DELIVERED',
      trackingNumber: { not: null }
    },
    data: {
      status: 'IN_TRANSIT'
    }
  });
  
  await prisma.shipment.updateMany({
    where: {
      trackingNumber: null
    },
    data: {
      status: 'SENT_TO_ARAS'
    }
  });

  console.log("DB Fixed: Reset DELIVERED -> IN_TRANSIT, and no-tracking to SENT_TO_ARAS");
}

fix().catch(console.error).finally(() => prisma.$disconnect());
