import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
    Select,
    Checkbox,
    InlineStack,
    Box,
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
        const data: any = {};
        // Strings
        ['senderUsername', 'senderPassword', 'senderCustomerCode', 'queryUsername', 'queryPassword', 'queryCustomerCode',
            'addressIdGonderimi', 'barkodCiktiTuru', 'yazdirmaYogunlugu', 'addressId', 'configurationId', 'iadeBilgilendirmeMetni']
            .forEach(field => {
                data[field] = formData.get(field) as string;
            });

        // Numbers & Booleans helpfully handled manually
        data.yaziciKagitGenisligi = parseInt(formData.get("yaziciKagitGenisligi") as string) || 100;
        data.yaziciKagitYuksekligi = parseInt(formData.get("yaziciKagitYuksekligi") as string) || 100;
        data.iadeKoduGecerlilikSuresi = parseInt(formData.get("iadeKoduGecerlilikSuresi") as string) || 7;
        data.parcaBilgisiGonderilsin = formData.get("parcaBilgisiGonderilsin") === "true";

        const existing = await prisma.arasKargoSettings.findFirst();
        if (existing) {
            await prisma.arasKargoSettings.update({
                where: { id: existing.id },
                data
            });
        } else {
            await prisma.arasKargoSettings.create({ data });
        }
        return json({ status: "success", message: "Tüm ayarlar kaydedildi" });
    }

    if (intent === "addSupplier") {
        await prisma.supplier.create({
            data: {
                name: formData.get("name") as string,
                supplierCode: formData.get("supplierCode") as string,
                arasAddressId: formData.get("arasAddressId") as string
            }
        });
        return json({ status: "success", message: "Tedarikçi eklendi" });
    }

    if (intent === "deleteSupplier") {
        await prisma.supplier.delete({ where: { id: formData.get("id") as string } });
        return json({ status: "success", message: "Tedarikçi silindi" });
    }

    return json({ status: "error", message: "Bilinmeyen işlem" });
};

export default function Settings() {
    const { settings, suppliers } = useLoaderData<typeof loader>();
    const fetcher = useFetcher();

    const [formState, setFormState] = useState<any>(settings || {});
    const [newSupplier, setNewSupplier] = useState({ name: "", supplierCode: "", arasAddressId: "" });

    // Update form state when loader data changes (after save)
    useEffect(() => {
        if (settings) setFormState((prev: any) => ({ ...prev, ...settings }));
    }, [settings]);

    useEffect(() => {
        const data = fetcher.data as { message?: string } | undefined;
        if (data?.message) {
            shopify.toast.show(data.message);
        }
    }, [fetcher.data]);

    const handleChange = (value: string | boolean | number, id: string) => {
        setFormState((prev: any) => ({ ...prev, [id]: value }));
    };

    const handleSave = () => {
        const formData = new FormData();
        formData.append("intent", "saveSettings");
        Object.keys(formState).forEach(key => {
            formData.append(key, String(formState[key]));
        });
        fetcher.submit(formData, { method: "POST" });
    };

    const handleSupplierAction = (action: string, id?: string) => {
        const formData = new FormData();
        formData.append("intent", action);
        if (action === "addSupplier") {
            formData.append("name", newSupplier.name);
            formData.append("supplierCode", newSupplier.supplierCode);
            formData.append("arasAddressId", newSupplier.arasAddressId);
        }
        if (action === "deleteSupplier" && id) {
            formData.append("id", id);
        }
        fetcher.submit(formData, { method: "POST" });
        if (action === "addSupplier") setNewSupplier({ name: "", supplierCode: "", arasAddressId: "" });
    };

    return (
        <Page>
            <TitleBar title="Aras Kargo Ayarları" />
            <BlockStack gap="500">

                {/* API Credentials */}
                <Layout>
                    <Layout.AnnotatedSection title="API Bağlantısı" description="Aras Kargo entegrasyonu için gerekli kullanıcı bilgileri.">
                        <Card>
                            <FormLayout>
                                <Text as="h3" variant="headingSm">Gönderici (Sender) Bilgileri</Text>
                                <FormLayout.Group>
                                    <TextField label="Kullanıcı Adı" value={formState.senderUsername} onChange={v => handleChange(v, 'senderUsername')} autoComplete="off" />
                                    <TextField label="Şifre" type="password" value={formState.senderPassword} onChange={v => handleChange(v, 'senderPassword')} autoComplete="off" />
                                    <TextField label="Müşteri Kodu" value={formState.senderCustomerCode} onChange={v => handleChange(v, 'senderCustomerCode')} autoComplete="off" />
                                </FormLayout.Group>
                                <Divider />
                                <Text as="h3" variant="headingSm">Sorgu (Query) Bilgileri</Text>
                                <FormLayout.Group>
                                    <TextField label="Kullanıcı Adı" value={formState.queryUsername} onChange={v => handleChange(v, 'queryUsername')} autoComplete="off" />
                                    <TextField label="Şifre" type="password" value={formState.queryPassword} onChange={v => handleChange(v, 'queryPassword')} autoComplete="off" />
                                    <TextField label="Müşteri Kodu" value={formState.queryCustomerCode} onChange={v => handleChange(v, 'queryCustomerCode')} autoComplete="off" />
                                </FormLayout.Group>
                            </FormLayout>
                        </Card>
                    </Layout.AnnotatedSection>

                    {/* Advanced Shipment Settings */}
                    <Layout.AnnotatedSection title="Gönderi Ayarları" description="Barkod, kağıt boyutu ve özel gönderim tercihleri.">
                        <Card>
                            <FormLayout>
                                <FormLayout.Group>
                                    <Select
                                        label="Barkod Çıktı Türü"
                                        options={['Standart', 'ZPL', 'EPL']}
                                        value={formState.barkodCiktiTuru}
                                        onChange={v => handleChange(v, 'barkodCiktiTuru')}
                                    />
                                    <Select
                                        label="Yazdırma Yoğunluğu"
                                        options={['6 dpmm (152 dpi)', '8 dpmm (203 dpi)', '12 dpmm (300 dpi)']}
                                        value={formState.yazdirmaYogunlugu}
                                        onChange={v => handleChange(v, 'yazdirmaYogunlugu')}
                                    />
                                </FormLayout.Group>
                                <FormLayout.Group>
                                    <TextField type="number" label="Kağıt Genişliği (mm)" value={String(formState.yaziciKagitGenisligi || 100)} onChange={v => handleChange(v, 'yaziciKagitGenisligi')} autoComplete="off" />
                                    <TextField type="number" label="Kağıt Yüksekliği (mm)" value={String(formState.yaziciKagitYuksekligi || 100)} onChange={v => handleChange(v, 'yaziciKagitYuksekligi')} autoComplete="off" />
                                </FormLayout.Group>
                                <FormLayout.Group>
                                    <Select
                                        label="AddressID Gönderimi"
                                        options={['Aktif', 'Pasif']}
                                        value={formState.addressIdGonderimi || 'Aktif'}
                                        onChange={v => handleChange(v, 'addressIdGonderimi')}
                                        helpText="Aktif seçilirse şube ID gönderilir."
                                    />
                                    <div style={{ marginTop: '24px' }}>
                                        <Checkbox
                                            label="Parça Bilgisi Gönderilsin"
                                            checked={formState.parcaBilgisiGonderilsin}
                                            onChange={v => handleChange(v, 'parcaBilgisiGonderilsin')}
                                        />
                                    </div>
                                </FormLayout.Group>
                            </FormLayout>
                        </Card>
                    </Layout.AnnotatedSection>

                    {/* Return Settings */}
                    <Layout.AnnotatedSection title="İade Ayarları" description="İade işlemleri için varsayılan yapılandırma.">
                        <Card>
                            <FormLayout>
                                <FormLayout.Group>
                                    <TextField label="Varsayılan Şube ID (Return AddressID)" value={formState.addressId} onChange={v => handleChange(v, 'addressId')} autoComplete="off" />
                                    <TextField label="Konfigürasyon ID" value={formState.configurationId} onChange={v => handleChange(v, 'configurationId')} autoComplete="off" />
                                    <TextField type="number" label="İade Kodu Geçerlilik (Gün)" value={String(formState.iadeKoduGecerlilikSuresi || 7)} onChange={v => handleChange(v, 'iadeKoduGecerlilikSuresi')} autoComplete="off" />
                                </FormLayout.Group>
                                <TextField
                                    label="İade Bilgilendirme Metni"
                                    value={formState.iadeBilgilendirmeMetni}
                                    onChange={v => handleChange(v, 'iadeBilgilendirmeMetni')}
                                    multiline={4}
                                    autoComplete="off"
                                />
                            </FormLayout>
                        </Card>
                    </Layout.AnnotatedSection>

                    {/* Save Button */}
                    <Layout.Section>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button variant="primary" onClick={handleSave} loading={fetcher.state === 'submitting'}>Tüm Ayarları Kaydet</Button>
                        </div>
                    </Layout.Section>

                    <Layout.AnnotatedSection title="Tedarikçiler" description="XML veya Manuel tedarikçi gönderim kodları.">
                        <Card>
                            <FormLayout>
                                <Text as="h3" variant="headingSm">Yeni Ekle</Text>
                                <InlineStack gap="300" align="start">
                                    <div style={{ flexGrow: 1 }}>
                                        <TextField label="Tedarikçi Adı" placeholder="Örn: Goatjump" value={newSupplier.name} onChange={v => setNewSupplier({ ...newSupplier, name: v })} autoComplete="off" />
                                    </div>
                                    <div style={{ flexGrow: 1 }}>
                                        <TextField label="Kısa Kod (MÖK)" placeholder="Örn: G01" value={newSupplier.supplierCode} onChange={v => setNewSupplier({ ...newSupplier, supplierCode: v })} autoComplete="off" helpText="MÖK üretiminde kullanılır." />
                                    </div>
                                    <div style={{ flexGrow: 1 }}>
                                        <TextField label="Şube ID" placeholder="Aras AddressID" value={newSupplier.arasAddressId} onChange={v => setNewSupplier({ ...newSupplier, arasAddressId: v })} autoComplete="off" />
                                    </div>
                                    <div style={{ marginTop: '28px' }}>
                                        <Button onClick={() => handleSupplierAction('addSupplier')} disabled={!newSupplier.name || !newSupplier.supplierCode}>Ekle</Button>
                                    </div>
                                </InlineStack>

                                <Divider />

                                <BlockStack gap="200">
                                    {suppliers.map((s: any) => (
                                        <Box key={s.id} padding="300" borderRadius="200" background="bg-surface-secondary">
                                            <InlineStack align="space-between" blockAlign="center">
                                                <BlockStack gap="100">
                                                    <Text as="span" fontWeight="bold">{s.name}</Text>
                                                    <Text as="span" variant="bodySm">Kod: {s.supplierCode} | Şube ID: {s.arasAddressId}</Text>
                                                </BlockStack>
                                                <Button tone="critical" variant="plain" onClick={() => handleSupplierAction('deleteSupplier', s.id)}>Sil</Button>
                                            </InlineStack>
                                        </Box>
                                    ))}
                                    {suppliers.length === 0 && <Text as="p" tone="subdued">Henüz tedarikçi eklenmedi.</Text>}
                                </BlockStack>
                            </FormLayout>
                        </Card>
                    </Layout.AnnotatedSection>

                </Layout>
            </BlockStack>
        </Page>
    );
}
