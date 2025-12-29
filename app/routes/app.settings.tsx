import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSubmit } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    FormLayout,
    TextField,
    Button,
    BlockStack,
    Text,
    Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);

    const settings = await prisma.arasKargoSettings.findFirst() || {};
    const suppliers = await prisma.supplier.findMany();

    return json({ settings, suppliers });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "saveSettings") {
        const senderUsername = formData.get("senderUsername") as string;
        const senderPassword = formData.get("senderPassword") as string;
        const senderCustomerCode = formData.get("senderCustomerCode") as string;
        const queryUsername = formData.get("queryUsername") as string;
        const queryPassword = formData.get("queryPassword") as string;
        const queryCustomerCode = formData.get("queryCustomerCode") as string;

        // simplistic update or create
        const existing = await prisma.arasKargoSettings.findFirst();
        if (existing) {
            await prisma.arasKargoSettings.update({
                where: { id: existing.id },
                data: { senderUsername, senderPassword, senderCustomerCode, queryUsername, queryPassword, queryCustomerCode }
            });
        } else {
            await prisma.arasKargoSettings.create({
                data: { senderUsername, senderPassword, senderCustomerCode, queryUsername, queryPassword, queryCustomerCode }
            });
        }
        return json({ status: "success", message: "Ayarlar kaydedildi" });
    }

    if (intent === "addSupplier") {
        const name = formData.get("name") as string;
        const supplierCode = formData.get("supplierCode") as string;
        const arasAddressId = formData.get("arasAddressId") as string;

        await prisma.supplier.create({
            data: { name, supplierCode, arasAddressId }
        });
        return json({ status: "success", message: "Tedarikçi eklendi" });
    }

    if (intent === "deleteSupplier") {
        const id = formData.get("id") as string;
        await prisma.supplier.delete({ where: { id } });
        return json({ status: "success", message: "Tedarikçi silindi" });
    }

    return json({ status: "error", message: "Bilinmeyen işlem" });
};

export default function Settings() {
    const { settings, suppliers } = useLoaderData<typeof loader>();
    const fetcher = useFetcher();
    const submit = useSubmit();

    // Setting States
    const [formState, setFormState] = useState(settings || {});

    // Supplier State
    const [newSupplier, setNewSupplier] = useState({ name: "", supplierCode: "", arasAddressId: "" });

    const handleTextChange = (value: string, id: string) => {
        setFormState({ ...formState, [id]: value });
    };

    const handleSupplierChange = (value: string, id: string) => {
        setNewSupplier({ ...newSupplier, [id]: value });
    };

    const handleSaveSettings = () => {
        const formData = new FormData();
        formData.append("intent", "saveSettings");
        Object.keys(formState).forEach(key => {
            if (formState[key] !== null && formState[key] !== undefined) {
                formData.append(key, formState[key]);
            }
        });
        fetcher.submit(formData, { method: "POST" });
    };

    const handleAddSupplier = () => {
        const formData = new FormData();
        formData.append("intent", "addSupplier");
        formData.append("name", newSupplier.name);
        formData.append("supplierCode", newSupplier.supplierCode);
        formData.append("arasAddressId", newSupplier.arasAddressId);
        fetcher.submit(formData, { method: "POST" });
        setNewSupplier({ name: "", supplierCode: "", arasAddressId: "" });
    };

    const handleDeleteSupplier = (id: string) => {
        const formData = new FormData();
        formData.append("intent", "deleteSupplier");
        formData.append("id", id);
        fetcher.submit(formData, { method: "POST" });
    }

    useEffect(() => {
        if (fetcher.data?.message) {
            shopify.toast.show(fetcher.data.message);
        }
    }, [fetcher.data]);

    return (
        <Page>
            <TitleBar title="Ayarlar" />
            <BlockStack gap="500">
                <Layout>
                    <Layout.AnnotatedSection
                        title="Aras Kargo API"
                        description="Aras Kargo entegrasyonu için gerekli API bilgilerini girin."
                    >
                        <Card>
                            <FormLayout>
                                <Text as="h3" variant="headingSm">Gönderici Bilgileri</Text>
                                <TextField label="Kullanıcı Adı" value={formState.senderUsername || ""} onChange={v => handleTextChange(v, 'senderUsername')} autoComplete="off" />
                                <TextField label="Tedarikçi Kodu" value={formState.senderCustomerCode || ""} onChange={v => handleTextChange(v, 'senderCustomerCode')} autoComplete="off" />
                                <TextField label="Şifre" type="password" value={formState.senderPassword || ""} onChange={v => handleTextChange(v, 'senderPassword')} autoComplete="off" />

                                <Divider />

                                <Text as="h3" variant="headingSm">Sorgu Bilgileri</Text>
                                <TextField label="Sorgu Kullanıcı Adı" value={formState.queryUsername || ""} onChange={v => handleTextChange(v, 'queryUsername')} autoComplete="off" />
                                <TextField label="Sorgu Tedarikçi Kodu" value={formState.queryCustomerCode || ""} onChange={v => handleTextChange(v, 'queryCustomerCode')} autoComplete="off" />
                                <TextField label="Sorgu Şifresi" type="password" value={formState.queryPassword || ""} onChange={v => handleTextChange(v, 'queryPassword')} autoComplete="off" />

                                <Button onClick={handleSaveSettings} variant="primary" loading={fetcher.state === 'submitting'}>Kaydet</Button>
                            </FormLayout>
                        </Card>
                    </Layout.AnnotatedSection>

                    <Layout.AnnotatedSection
                        title="Tedarikçiler"
                        description="Farklı tedarikçiler için gönderici kodlarını tanımlayın."
                    >
                        <Card>
                            <FormLayout>
                                <Text as="p">Yeni Tedarikçi Ekle</Text>
                                <FormLayout.Group>
                                    <TextField label="Ad" value={newSupplier.name} onChange={v => handleSupplierChange(v, 'name')} autoComplete="off" />
                                    <TextField label="Kod (MÖK)" value={newSupplier.supplierCode} onChange={v => handleSupplierChange(v, 'supplierCode')} autoComplete="off" />
                                    <TextField label="Address ID" value={newSupplier.arasAddressId} onChange={v => handleSupplierChange(v, 'arasAddressId')} autoComplete="off" />
                                </FormLayout.Group>
                                <Button onClick={handleAddSupplier} disabled={!newSupplier.name || !newSupplier.supplierCode} loading={fetcher.state === 'submitting'}>Ekle</Button>
                            </FormLayout>

                            <div style={{ marginTop: '20px' }}>
                                <BlockStack gap="300">
                                    {suppliers.map((s: any) => (
                                        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid #eee' }}>
                                            <div>
                                                <Text as="span" fontWeight="bold">{s.name}</Text>
                                                <Text as="span" tone="subdued"> ({s.supplierCode}) - ID: {s.arasAddressId}</Text>
                                            </div>
                                            <Button onClick={() => handleDeleteSupplier(s.id)} tone="critical" variant="plain">Sil</Button>
                                        </div>
                                    ))}
                                </BlockStack>
                            </div>
                        </Card>
                    </Layout.AnnotatedSection>
                </Layout>
            </BlockStack>
        </Page>
    );
}
