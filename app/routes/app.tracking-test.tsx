import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useNavigation, Form } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    FormLayout,
    TextField,
    Button,
    BlockStack,
    Text,
    Banner,
    Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShipmentStatus, getShipmentBarcode, getTrackingNumberByQueryService } from "../services/arasKargo.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
    await authenticate.admin(request);
    const formData = await request.formData();
    const mok = formData.get("mok") as string;
    const actionType = formData.get("actionType") as string;

    if (!mok) {
        return json({ success: false, message: "Lütfen bir MÖK kodu girin." });
    }

    const settings = await prisma.arasKargoSettings.findFirst();
    if (!settings) {
        return json({ success: false, message: "Ayarlar bulunamadı. Lütfen önce ayarları kaydedin." });
    }

    try {
        if (actionType === 'barcode') {
            // Use ArasCargoIntegrationService (GetQueryDS/GetQueryJSON) - from user's PDF documentation
            const result = await getTrackingNumberByQueryService(mok, settings);
            return json({ success: true, result, type: 'barcode' });
        } else {
            const result = await getShipmentStatus(mok, settings);
            return json({ success: true, result, type: 'status' });
        }
    } catch (error) {
        return json({ success: false, message: (error as Error).message });
    }
};

export default function TrackingTest() {
    const actionData = useActionData<typeof action>() as any;
    const nav = useNavigation();
    const isLoading = nav.state === "submitting";
    const [mokValue, setMokValue] = useState("");
    const [actionType, setActionType] = useState("status");

    return (
        <Page>
            <TitleBar title="Kargo Takip Test Aracı" />
            <BlockStack gap="500">
                <Layout>
                    <Layout.Section>
                        <Card>
                            <Form method="post">
                                <FormLayout>
                                    <Text as="h2" variant="headingMd">
                                        MÖK ile Sorgulama
                                    </Text>
                                    <Text as="p" variant="bodyMd">
                                        Manuel olarak bir entegrasyon kodu (MÖK) girerek Aras Kargo'dan durum ve takip numarası sorgulayabilirsiniz.
                                    </Text>

                                    <TextField
                                        label="MÖK (Entegrasyon Kodu)"
                                        name="mok"
                                        value={mokValue}
                                        onChange={(val) => setMokValue(val)}
                                        autoComplete="off"
                                        placeholder="Örn: G01-1024"
                                    />

                                    <input type="hidden" name="actionType" value={actionType} />
                                    <BlockStack gap="200" inlineAlign="start">
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <Button onClick={() => setActionType('status')} submit variant="primary" loading={isLoading} disabled={!mokValue}>
                                                Durum Sorgula
                                            </Button>
                                            <Button onClick={() => setActionType('barcode')} submit variant="secondary" loading={isLoading} disabled={!mokValue}>
                                                Takip No & Barkod Getir
                                            </Button>
                                        </div>
                                    </BlockStack>
                                </FormLayout>
                            </Form>
                        </Card>
                    </Layout.Section>

                    {actionData && (
                        <Layout.Section>
                            <Card>
                                <BlockStack gap="400">
                                    <Text as="h3" variant="headingMd">Sonuç</Text>

                                    {actionData.success ? (
                                        <Banner tone={actionData.result?.success ? "success" : "warning"}>
                                            <p>{actionData.result?.message || (actionData.result?.success ? "Başarılı" : "Bir sorun oluştu")}</p>
                                        </Banner>
                                    ) : (
                                        <Banner tone="critical">
                                            <p>{actionData.message}</p>
                                        </Banner>
                                    )}

                                    {actionData.result && (
                                        <Box padding="400" background="bg-surface-secondary" borderRadius="200" overflowX="scroll">
                                            <BlockStack gap="200">
                                                <Text as="h4" variant="headingSm">API Yanıt Detayı:</Text>
                                                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                                    {JSON.stringify(actionData.result, null, 2)}
                                                </pre>
                                                {actionData.result?.rawResponse && (
                                                    <>
                                                        <Text as="h4" variant="headingSm">Ham XML Yanıtı:</Text>
                                                        <Box padding="200" background="bg-surface-active" borderRadius="100">
                                                            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '10px' }}>
                                                                {actionData.result.rawResponse}
                                                            </pre>
                                                        </Box>
                                                    </>
                                                )}
                                            </BlockStack>
                                        </Box>
                                    )}
                                </BlockStack>
                            </Card>
                        </Layout.Section>
                    )}
                </Layout>
            </BlockStack>
        </Page>
    );
}
