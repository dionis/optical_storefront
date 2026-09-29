import { defineRouteConfig } from "@medusajs/admin-sdk";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
} from "@medusajs/ui";
import { sdk } from "../../lib/client";

interface Measurements {
  pd?: number | null;
  pd_od?: number | null;
  pd_os?: number | null;
  corridor?: number | null;
  seg_height?: number | null;
  eye?: string | number | null;
  bridge?: string | number | null;
  temple?: string | number | null;
  quality?: string | null;
}

interface TryOnResult {
  id: string;
  created_at: string;
  product_name?: string | null;
  brand?: string | null;
  sku?: string | null;
  color_name?: string | null;
  for_whom?: string | null;
  patient_name?: string | null;
  measurements?: Measurements;
  image_url?: string | null;
}

interface TryOnResultsPayload {
  results: TryOnResult[];
  total: number;
  storage_configured: boolean;
}

const mm = (v: unknown): string =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `${Math.round(Number(v) * 10) / 10} mm`;

const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const forWhomLabel = (v?: string | null): string =>
  v === "me" ? "Para mí" : v === "other" ? "Para otra persona" : "—";

const TryOnResultsPage = () => {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<TryOnResultsPayload>({
    queryKey: ["tryon-results"],
    queryFn: async () =>
      (await sdk.client.fetch("/admin/tryon-results", {
        query: { limit: 120 },
      })) as TryOnResultsPayload,
  });

  const results = data?.results ?? [];

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <Heading level="h1">Pruebas con IA</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Cada rostro generado con los espejuelos puestos y sus medidas. Se
            guardan automáticamente cuando un cliente calcula sus medidas.
          </Text>
        </div>
        <Button variant="secondary" size="small" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Actualizando…" : "Actualizar"}
        </Button>
      </div>

      {data && data.storage_configured === false && (
        <div className="px-6 py-4">
          <Text className="text-ui-fg-subtle">
            El almacenamiento de imágenes (R2 / Supabase) no está configurado en
            este backend, así que todavía no se guardan pruebas. Configura
            R2_ENDPOINT, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY.
          </Text>
        </div>
      )}

      {isLoading && (
        <div className="px-6 py-10">
          <Text className="text-ui-fg-subtle">Cargando…</Text>
        </div>
      )}

      {isError && (
        <div className="px-6 py-10">
          <Text className="text-ui-fg-error">No se pudieron cargar las pruebas.</Text>
        </div>
      )}

      {!isLoading && !isError && results.length === 0 && data?.storage_configured !== false && (
        <div className="px-6 py-10">
          <Text className="text-ui-fg-subtle">
            Aún no hay pruebas guardadas. Aparecerán aquí en cuanto un cliente
            genere una prueba con la cámara.
          </Text>
        </div>
      )}

      {results.length > 0 && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle mb-3">
            {data?.total} prueba(s)
          </Text>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "16px",
            }}
          >
            {results.map((r) => (
              <div
                key={r.id}
                className="border rounded-lg overflow-hidden bg-ui-bg-base"
                style={{ display: "flex", flexDirection: "column" }}
              >
                <div style={{ background: "#f3f5f9", aspectRatio: "3 / 4", overflow: "hidden" }}>
                  {r.image_url ? (
                    <a href={r.image_url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={r.image_url}
                        alt={r.product_name ?? "Prueba"}
                        loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    </a>
                  ) : (
                    <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
                      <Text className="text-ui-fg-muted">Sin imagen</Text>
                    </div>
                  )}
                </div>
                <div className="p-3" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div className="flex items-center justify-between gap-2">
                    <Text weight="plus" size="small">
                      {r.product_name ?? "—"}
                      {r.color_name ? ` · ${r.color_name}` : ""}
                    </Text>
                    {r.measurements?.quality && (
                      <Badge size="2xsmall" color={r.measurements.quality === "high" ? "green" : r.measurements.quality === "low" ? "red" : "orange"}>
                        {r.measurements.quality}
                      </Badge>
                    )}
                  </div>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {r.brand ? r.brand + " · " : ""}{forWhomLabel(r.for_whom)}
                    {r.patient_name ? ` (${r.patient_name})` : ""}
                  </Text>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px" }}>
                    <Text size="xsmall" className="text-ui-fg-subtle">DIP: <b>{mm(r.measurements?.pd)}</b></Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">Corredor: <b>{mm(r.measurements?.corridor ?? r.measurements?.seg_height)}</b></Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">OD: <b>{mm(r.measurements?.pd_od)}</b></Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">OI: <b>{mm(r.measurements?.pd_os)}</b></Text>
                  </div>
                  <Text size="xsmall" className="text-ui-fg-muted">{fmtDate(r.created_at)}</Text>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Pruebas con IA",
});

export default TryOnResultsPage;
