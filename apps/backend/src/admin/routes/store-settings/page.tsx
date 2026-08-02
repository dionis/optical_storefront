import { defineRouteConfig } from "@medusajs/admin-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Select,
  Text,
  toast,
} from "@medusajs/ui";
import { sdk } from "../../lib/client";

/** Mirrors the payload built by GET/POST /admin/store-settings. */
interface StoreSettingsPayload {
  settings: {
    owner_notification_email: string | null;
    owner_notification_sms: string | null;
    active_payment_provider: string;
    frame_tax_rate: number;
    source: "database" | "env";
    updated_by?: string | null;
    updated_at?: string | null;
  };
  payment_providers: string[];
}

const PROVIDER_LABELS: Record<string, string> = {
  pp_stripe_stripe: "Stripe",
  pp_paypal_paypal: "PayPal",
  pp_square_square: "Square",
};

const StoreSettingsPage = () => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<StoreSettingsPayload>({
    queryFn: () => sdk.client.fetch("/admin/store-settings"),
    queryKey: ["store-settings"],
  });

  const [email, setEmail] = useState("");
  const [sms, setSms] = useState("");
  const [provider, setProvider] = useState("");
  // Tax rate is edited as a percentage for humans; sent to the API with a "%".
  const [taxPct, setTaxPct] = useState("0");

  useEffect(() => {
    if (!data) return;
    setEmail(data.settings.owner_notification_email ?? "");
    setSms(data.settings.owner_notification_sms ?? "");
    setProvider(data.settings.active_payment_provider);
    setTaxPct(String(Math.round((data.settings.frame_tax_rate ?? 0) * 10000) / 100));
  }, [data]);

  const save = useMutation({
    mutationFn: (body: {
      owner_notification_email: string | null;
      owner_notification_sms: string | null;
      active_payment_provider: string | null;
      frame_tax_rate: string | null;
    }) => sdk.client.fetch("/admin/store-settings", { method: "POST", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["store-settings"] });
      toast.success("Configuración de la tienda guardada");
    },
    onError: (error: Error) => {
      toast.error(error.message || "No se pudo guardar la configuración");
    },
  });

  if (isLoading || !data) {
    return (
      <Container className="p-0">
        <div className="px-6 py-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Cargando configuración…
          </Text>
        </div>
      </Container>
    );
  }

  const providers = data.payment_providers.length
    ? data.payment_providers
    : ["pp_stripe_stripe"];

  const currentTaxPct = String(
    Math.round((data.settings.frame_tax_rate ?? 0) * 10000) / 100
  );
  const dirty =
    email !== (data.settings.owner_notification_email ?? "") ||
    sms !== (data.settings.owner_notification_sms ?? "") ||
    provider !== data.settings.active_payment_provider ||
    taxPct !== currentTaxPct;

  const handleSave = () => {
    save.mutate({
      owner_notification_email: email.trim() || null,
      owner_notification_sms: sms.trim() || null,
      active_payment_provider: provider || null,
      // Send as a percentage string; the API normalizes to a decimal.
      frame_tax_rate: taxPct.trim() === "" ? null : `${taxPct.trim()}%`,
    });
  };

  const reset = () => {
    setEmail(data.settings.owner_notification_email ?? "");
    setSms(data.settings.owner_notification_sms ?? "");
    setProvider(data.settings.active_payment_provider);
    setTaxPct(currentTaxPct);
  };

  return (
    <div className="flex flex-col gap-3">
      <Container className="p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Configuración de la tienda</Heading>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Correo y teléfono del dueño donde llegan los pedidos, proveedor de
              pago activo, e impuesto de montura sola. Las llaves/credenciales
              siguen siendo del servidor; aquí solo se elige qué se usa.
            </Text>
          </div>
          <Badge size="small" color={data.settings.source === "database" ? "green" : "grey"}>
            {data.settings.source === "database" ? "Configurado" : "Valores por defecto"}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-ui-border-base px-6 py-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Text size="small" leading="compact" weight="plus">
              Correo del dueño (recibe cada pedido)
            </Text>
            <Input
              type="email"
              placeholder="dueno@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Text size="small" leading="compact" weight="plus">
              SMS del dueño (E.164, opcional)
            </Text>
            <Input
              type="tel"
              placeholder="+13055551234"
              value={sms}
              onChange={(e) => setSms(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Text size="small" leading="compact" weight="plus">
              Proveedor de pago
            </Text>
            <Select value={provider} onValueChange={setProvider}>
              <Select.Trigger>
                <Select.Value placeholder="Selecciona un proveedor" />
              </Select.Trigger>
              <Select.Content>
                {providers.map((p) => (
                  <Select.Item key={p} value={p}>
                    {PROVIDER_LABELS[p] ?? p}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              El proveedor debe estar registrado con sus credenciales en el
              servidor para poder cobrar.
            </Text>
          </div>

          <div className="flex flex-col gap-2">
            <Text size="small" leading="compact" weight="plus">
              Impuesto de montura sola (%)
            </Text>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={taxPct}
              onChange={(e) => setTaxPct(e.target.value)}
            />
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Solo se aplica a monturas sin receta. Los lentes con receta quedan
              exentos. 0 = sin impuesto.
            </Text>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ui-border-base px-6 py-4">
          <Button
            size="small"
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={reset}
          >
            Descartar
          </Button>
          <Button
            size="small"
            disabled={!dirty || save.isPending}
            isLoading={save.isPending}
            onClick={handleSave}
          >
            Guardar
          </Button>
        </div>
      </Container>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Configuración de la tienda",
});

export default StoreSettingsPage;
