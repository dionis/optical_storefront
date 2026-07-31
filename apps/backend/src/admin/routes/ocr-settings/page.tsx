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
  Table,
  Text,
  toast,
} from "@medusajs/ui";
import { sdk } from "../../lib/client";

/** Mirrors the payload built by GET/POST /admin/ocr-settings. */
interface OcrCostEstimate {
  model_id: string;
  effective_edge_px: number;
  input_tokens: number;
  output_tokens: number;
  usd_per_read: number;
}
interface OcrModel {
  id: string;
  label: string;
  input_per_mtok: number;
  output_per_mtok: number;
  max_image_edge_px: number;
  thinking_by_default: boolean;
  note: string;
  estimate: OcrCostEstimate;
}
interface OcrSettingsPayload {
  settings: {
    model_id: string;
    escalation_model_id: string | null;
    max_image_px: number;
    source: "database" | "environment";
    updated_by?: string | null;
    updated_at?: string | null;
  };
  models: OcrModel[];
  estimate: {
    primary: OcrCostEstimate | null;
    escalation: OcrCostEstimate | null;
  };
}

const NO_ESCALATION = "none";

/** Sub-cent per-read figures need more precision than a currency formatter gives. */
const usd = (n: number) => `$${n.toFixed(4)}`;
const usdCoarse = (n: number) => `$${n.toFixed(2)}`;

const OcrSettingsPage = () => {
  const queryClient = useQueryClient();

  // Display query — loads on mount, never gated on UI state.
  const { data, isLoading } = useQuery<OcrSettingsPayload>({
    queryFn: () => sdk.client.fetch("/admin/ocr-settings"),
    queryKey: ["ocr-settings"],
  });

  const [modelId, setModelId] = useState("");
  const [escalationId, setEscalationId] = useState(NO_ESCALATION);
  const [maxPx, setMaxPx] = useState("1568");
  // Monthly volume is a local what-if input, not persisted configuration.
  const [monthlyVolume, setMonthlyVolume] = useState("500");
  const [escalationRate, setEscalationRate] = useState("20");

  // Seed the form once the server state arrives.
  useEffect(() => {
    if (!data) return;
    setModelId(data.settings.model_id);
    setEscalationId(data.settings.escalation_model_id ?? NO_ESCALATION);
    setMaxPx(String(data.settings.max_image_px));
  }, [data]);

  const save = useMutation({
    mutationFn: (body: {
      model_id: string;
      escalation_model_id: string | null;
      max_image_px: number;
    }) =>
      sdk.client.fetch("/admin/ocr-settings", { method: "POST", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocr-settings"] });
      toast.success("Configuración de OCR guardada");
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

  const models = data.models;
  const selected = models.find((m) => m.id === modelId);
  const escalation = models.find((m) => m.id === escalationId);

  // Blended cost = every read on the primary model, plus a retry on the
  // escalation model for the share that comes back unusable.
  const volume = Math.max(0, Number(monthlyVolume) || 0);
  const rate = Math.min(100, Math.max(0, Number(escalationRate) || 0)) / 100;
  const primaryCost = selected?.estimate.usd_per_read ?? 0;
  const escalationCost = escalation?.estimate.usd_per_read ?? 0;
  const blendedPerRead = primaryCost + (escalation ? escalationCost * rate : 0);
  const monthlyCost = blendedPerRead * volume;

  const dirty =
    modelId !== data.settings.model_id ||
    escalationId !== (data.settings.escalation_model_id ?? NO_ESCALATION) ||
    Number(maxPx) !== data.settings.max_image_px;

  const handleSave = () => {
    save.mutate({
      model_id: modelId,
      escalation_model_id: escalationId === NO_ESCALATION ? null : escalationId,
      max_image_px: Number(maxPx),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Container className="p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Lectura de recetas (OCR)</Heading>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Modelo usado para leer las recetas subidas por los clientes, y el
              tamaño al que se reducen las imágenes antes de enviarlas.
            </Text>
          </div>
          <Badge size="small" color={data.settings.source === "database" ? "green" : "grey"}>
            {data.settings.source === "database" ? "Configurado" : "Valores por defecto"}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-ui-border-base px-6 py-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Text size="small" leading="compact" weight="plus">
              Modelo principal
            </Text>
            <Select value={modelId} onValueChange={setModelId}>
              <Select.Trigger>
                <Select.Value placeholder="Selecciona un modelo" />
              </Select.Trigger>
              <Select.Content>
                {models.map((m) => (
                  <Select.Item key={m.id} value={m.id}>
                    {m.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            {selected && (
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {selected.note}
              </Text>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Text size="small" leading="compact" weight="plus">
              Modelo de escalado
            </Text>
            <Select value={escalationId} onValueChange={setEscalationId}>
              <Select.Trigger>
                <Select.Value placeholder="Sin escalado" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value={NO_ESCALATION}>Sin escalado</Select.Item>
                {models.map((m) => (
                  <Select.Item key={m.id} value={m.id}>
                    {m.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Solo se usa cuando la primera lectura resulta inservible. Pagas su
              precio únicamente en esas recetas.
            </Text>
          </div>

          <div className="flex flex-col gap-2">
            <Text size="small" leading="compact" weight="plus">
              Lado largo máximo (px)
            </Text>
            <Input
              type="number"
              min={640}
              max={2576}
              value={maxPx}
              onChange={(e) => setMaxPx(e.target.value)}
            />
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              El coste crece con el área: reducir el lado a la mitad divide el
              precio entre cuatro.
            </Text>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ui-border-base px-6 py-4">
          <Button
            size="small"
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setModelId(data.settings.model_id);
              setEscalationId(data.settings.escalation_model_id ?? NO_ESCALATION);
              setMaxPx(String(data.settings.max_image_px));
            }}
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

      <Container className="p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Coste estimado</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Calculado con las tarifas publicadas y una foto 3:4 al tamaño
            configurado. Es una estimación para decidir, no una factura.
          </Text>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-ui-border-base px-6 py-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Text size="small" leading="compact" weight="plus">
              Recetas al mes
            </Text>
            <Input
              type="number"
              min={0}
              value={monthlyVolume}
              onChange={(e) => setMonthlyVolume(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Text size="small" leading="compact" weight="plus">
              % que escala al modelo caro
            </Text>
            <Input
              type="number"
              min={0}
              max={100}
              value={escalationRate}
              onChange={(e) => setEscalationRate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6 border-t border-ui-border-base px-6 py-4">
          <div>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Coste por receta
            </Text>
            <Text size="large" weight="plus">
              {usd(blendedPerRead)}
            </Text>
          </div>
          <div>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Coste mensual estimado
            </Text>
            <Text size="large" weight="plus">
              {usdCoarse(monthlyCost)}
            </Text>
          </div>
        </div>

        <div className="border-t border-ui-border-base px-6 py-4">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Modelo</Table.HeaderCell>
                <Table.HeaderCell>Entrada $/1M</Table.HeaderCell>
                <Table.HeaderCell>Salida $/1M</Table.HeaderCell>
                <Table.HeaderCell>Tokens/lectura</Table.HeaderCell>
                <Table.HeaderCell>$/lectura</Table.HeaderCell>
                <Table.HeaderCell>{volume} lecturas</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {models.map((m) => (
                <Table.Row key={m.id}>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <Text size="small" leading="compact" weight="plus">
                        {m.label}
                      </Text>
                      {m.id === modelId && (
                        <Badge size="2xsmall" color="green">
                          principal
                        </Badge>
                      )}
                      {m.id === escalationId && (
                        <Badge size="2xsmall" color="orange">
                          escalado
                        </Badge>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>${m.input_per_mtok.toFixed(2)}</Table.Cell>
                  <Table.Cell>${m.output_per_mtok.toFixed(2)}</Table.Cell>
                  <Table.Cell>
                    {m.estimate.input_tokens.toLocaleString()} in /{" "}
                    {m.estimate.output_tokens.toLocaleString()} out
                  </Table.Cell>
                  <Table.Cell>{usd(m.estimate.usd_per_read)}</Table.Cell>
                  <Table.Cell>
                    {usdCoarse(m.estimate.usd_per_read * volume)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      </Container>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "OCR de recetas",
});

export default OcrSettingsPage;
