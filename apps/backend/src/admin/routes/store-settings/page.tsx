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
  Textarea,
  toast,
} from "@medusajs/ui";
import { sdk } from "../../lib/client";

/** Mirrors the payload built by GET/POST /admin/store-settings. */
interface StoreSettingsPayload {
  settings: {
    owner_notification_email: string | null;
    owner_notification_sms: string | null;
    admin_notification_emails: string[];
    support_email: string | null;
    active_payment_provider: string;
    frame_tax_rate: number;
    source: "database" | "env";
    updated_by?: string | null;
    updated_at?: string | null;
  };
  payment_providers: string[];
  /**
   * Whether each channel can actually deliver. Absent on a backend deployed
   * before this field existed, so every read of it must tolerate undefined.
   */
  notification_health?: {
    email: { configured: boolean; provider: string; missing: string[] };
    sms: { configured: boolean; provider: string; missing: string[] };
  };
}

/**
 * Banner for a channel with no real provider behind it.
 *
 * Filling in a recipient above does nothing in that state — the notification
 * module writes the message to the server log and reports success — so this
 * warning belongs next to the fields it invalidates, not only in the boot log
 * nobody re-reads.
 */
const ChannelWarning = ({
  label,
  health,
}: {
  label: string;
  health?: { configured: boolean; missing: string[] };
}) => {
  if (!health || health.configured) return null;
  return (
    <Text size="small" className="text-ui-fg-error">
      ⚠ {label}: no se está enviando nada. Falta configurar {health.missing.join(", ")} en
      el entorno del backend; mientras tanto los mensajes sólo se escriben en el log.
    </Text>
  );
};

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
  // Edited as free text (one per line) because that is how people paste a list;
  // the API splits, lowercases and de-duplicates it.
  const [admins, setAdmins] = useState("");
  const [support, setSupport] = useState("");
  const [provider, setProvider] = useState("");
  // Tax rate is edited as a percentage for humans; sent to the API with a "%".
  const [taxPct, setTaxPct] = useState("0");

  /** The saved list, shown one per line in the textarea. */
  const adminsText = (data?.settings.admin_notification_emails ?? []).join("\n");

  useEffect(() => {
    if (!data) return;
    setEmail(data.settings.owner_notification_email ?? "");
    setSms(data.settings.owner_notification_sms ?? "");
    setAdmins(data.settings.admin_notification_emails.join("\n"));
    setSupport(data.settings.support_email ?? "");
    setProvider(data.settings.active_payment_provider);
    setTaxPct(String(Math.round((data.settings.frame_tax_rate ?? 0) * 10000) / 100));
  }, [data]);

  const save = useMutation({
    mutationFn: (body: {
      owner_notification_email: string | null;
      owner_notification_sms: string | null;
      admin_notification_emails: string | null;
      support_email: string | null;
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
    admins.trim() !== adminsText ||
    support !== (data.settings.support_email ?? "") ||
    provider !== data.settings.active_payment_provider ||
    taxPct !== currentTaxPct;

  const handleSave = () => {
    save.mutate({
      owner_notification_email: email.trim() || null,
      owner_notification_sms: sms.trim() || null,
      // Empty string (not null) so clearing the box really clears the list —
      // null means "never configured" and falls back to the env var.
      admin_notification_emails: admins.trim(),
      support_email: support.trim() || null,
      active_payment_provider: provider || null,
      // Send as a percentage string; the API normalizes to a decimal.
      frame_tax_rate: taxPct.trim() === "" ? null : `${taxPct.trim()}%`,
    });
  };

  const reset = () => {
    setEmail(data.settings.owner_notification_email ?? "");
    setSms(data.settings.owner_notification_sms ?? "");
    setAdmins(adminsText);
    setSupport(data.settings.support_email ?? "");
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

        {(data.notification_health &&
          (!data.notification_health.email.configured || !data.notification_health.sms.configured)) && (
          <div className="flex flex-col gap-1 border-t border-ui-border-base bg-ui-bg-subtle px-6 py-4">
            <ChannelWarning label="Correo" health={data.notification_health.email} />
            <ChannelWarning label="SMS" health={data.notification_health.sms} />
          </div>
        )}

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

          <div className="flex flex-col gap-2 md:col-span-2">
            <Text size="small" leading="compact" weight="plus">
              Administradores notificados de cada pago (uno por línea)
            </Text>
            <Textarea
              rows={4}
              placeholder={"admin1@ejemplo.com\nadmin2@ejemplo.com"}
              value={admins}
              onChange={(e) => setAdmins(e.target.value)}
            />
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Cada uno recibe su propia copia del pedido, así no se ven las
              direcciones entre ellos. El correo del dueño se incluye siempre, no
              hace falta repetirlo aquí. Si dejas la lista vacía se usa la
              variable STORE_ADMIN_NOTIFICATION_EMAILS del servidor.
            </Text>
          </div>

          <div className="flex flex-col gap-2 md:col-span-2">
            <Text size="small" leading="compact" weight="plus">
              Correo de soporte (reclamos y demoras)
            </Text>
            <Input
              type="email"
              placeholder="soporte@ejemplo.com"
              value={support}
              onChange={(e) => setSupport(e.target.value)}
            />
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Recibe los mensajes que los clientes envían desde la página de
              seguimiento de su pedido. Si lo dejas vacío se usa el correo del
              dueño.
            </Text>
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
