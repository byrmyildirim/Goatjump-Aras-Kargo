import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaultSuppliers = [
    { name: 'Goatjump', supplierCode: 'G04', arasAddressId: '23734' },
    { name: 'Aslı Bisiklet', supplierCode: 'G05', arasAddressId: '635840' },
    { name: 'Grea Coffee', supplierCode: 'G06', arasAddressId: '635850' },
    { name: 'Baytekin/Probike', supplierCode: 'G07', arasAddressId: '8522043' },
    { name: 'Powder Shop / Smith', supplierCode: 'G08', arasAddressId: '8522044' },
    { name: 'Powder Shop / Smith B', supplierCode: 'G08B', arasAddressId: '52341716' },
    { name: 'Hyperice', supplierCode: 'G09', arasAddressId: '8522046' },
    { name: 'Performans Bisiklet', supplierCode: 'G10', arasAddressId: '8522049' },
    { name: 'Mayavelo', supplierCode: 'G11', arasAddressId: '8522047' },
    { name: 'Thule-Tr', supplierCode: 'G12', arasAddressId: '8522048' },
    { name: 'Munchey', supplierCode: 'G13', arasAddressId: '8521065' },
    { name: 'Hurom', supplierCode: 'G14', arasAddressId: '532681' },
    { name: 'Alatin Bisiklet / Trek Beşiktaş', supplierCode: 'G15', arasAddressId: '3430479' },
    { name: 'Alatin Bisiklet / Trek Caddebostan', supplierCode: 'G15B', arasAddressId: '3430479B' },
    { name: 'Puravida', supplierCode: 'G16', arasAddressId: '32183' },
    { name: 'Rawsome', supplierCode: 'G17', arasAddressId: '523437' },
    { name: 'Mamaya', supplierCode: 'G18', arasAddressId: '3053752' },
    { name: 'Footbalance', supplierCode: 'G19', arasAddressId: '61523419' },
    { name: 'Sundu Bisiklet', supplierCode: 'G20', arasAddressId: '52343738' },
    { name: 'Uğur Bisiklet', supplierCode: 'G21', arasAddressId: '523437216' },
    { name: 'Bircom Shokz', supplierCode: 'G22', arasAddressId: '22375234' },
    { name: 'Derintech', supplierCode: 'G23', arasAddressId: '27261918' },
];

async function main() {
    console.log('Seeding suppliers...');

    for (const supplier of defaultSuppliers) {
        await prisma.supplier.upsert({
            where: { supplierCode: supplier.supplierCode },
            update: {},
            create: supplier,
        });
    }

    console.log(`Seeded ${defaultSuppliers.length} suppliers.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
