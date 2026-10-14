import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows";
import { deriveOrderProgress, stageIndex, ORDER_STAGES, type OrderStage } from "../../../lib/order-status";

/**
 * POST /store/order-track — rastreo PÚBLICO por número de recibo + correo.
 *
 * Pedido del dueño: el cliente pone el número de su recibo (el display_id que
 * llega en el correo de confirmación) y ve la traza del pedido desde la compra
 * hasta la entrega, con todos los estados. Sin enlace mágico: la pareja
 * (número de pedido, correo) basta — es el mismo estándar de las mensajerías.
 *
 * Por eso la respuesta es una PROYECCIÓN MÍNIMA: etapas y fechas, el número de
 * guía FedEx si existe, y nada más. Ni dirección, ni artículos, ni receta, ni
 * ids internos — para eso está /my-orders con su enlace verificado. Un número
 * de pedido es adivinable (es secuencial); lo que no es adivinable es el par
 * con el correo, y aun acertándolo lo único visible es "va en camino".
 *
 * La combinación equivocada responde SIEMPRE igual (404 not_found), exista o
 * no el pedido: no confirmamos números de recibo ajenos.
 */

interface TrackBody {
  display_id?: string | number;
  email?: string;
}

const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "status",
  "created_at",
  "metadata",
  "fulfillments.created_at",
  "fulfillments.packed_at",
  "fulfillments.shipped_at",
  "fulfillments.canceled_at",
  "items.id",
  "items.metadata",
];

export async function POST(req: MedusaRequest<TrackBody>, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as TrackBody;
  const displayId = Number(String(body.display_id ?? "").replace(/[^0-9]/g, ""));
  const email = String(body.email ?? "").trim().toLowerCase();

  if (!displayId || !email || !/\S+@\S+\.\S+/.test(email)) {
    res.status(400).json({ reason: "bad_request" });
    return;
  }

  const { result } = await getOrdersListWorkflow(req.scope).run({
    input: {
      fields: ORDER_FIELDS,
      variables: {
        filters: { display_id: displayId, is_draft_order: false },
        skip: 0,
        take: 2,
      },
    },
  });

  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
  const order = rows.find((o) => String(o["email"] ?? "").trim().toLowerCase() === email);
  if (!order) {
    // Misma respuesta exista o no: un recibo ajeno no se confirma.
    res.status(404).json({ reason: "not_found" });
    return;
  }

  const progress = deriveOrderProgress(order as Parameters<typeof deriveOrderProgress>[0]);
  const md = (order["metadata"] ?? {}) as Record<string, unknown>;

  // Fechas por etapa: primero el historial escrito por el panel del dueño
  // (metadata.stage_history, cada cambio con su instante); de respaldo, lo que
  // Medusa sí registra solo (creación y fulfillment).
  const history = Array.isArray(md["stage_history"]) ? (md["stage_history"] as { stage?: string; at?: string }[]) : [];
  const firstAt = (stage: OrderStage): string | null => {
    const hit = history.find((h) => h && h.stage === stage && typeof h.at === "string");
    return hit ? String(hit.at) : null;
  };
  const fulfillments = (order["fulfillments"] ?? []) as { packed_at?: string | null; shipped_at?: string | null; canceled_at?: string | null }[];
  const live = fulfillments.filter((f) => !f.canceled_at);
  const packedAt = live.map((f) => f.packed_at).filter(Boolean).sort()[0] ?? null;
  const shippedAt = live.map((f) => f.shipped_at).filter(Boolean).sort()[0] ?? null;

  const fallbackAt: Record<OrderStage, string | null> = {
    confirmed: order["created_at"] ? String(order["created_at"]) : null,
    in_lab: null,
    shipped: packedAt ? String(packedAt) : null,
    in_transit: shippedAt ? String(shippedAt) : null,
    delivered: null,
  };

  const currentIdx = stageIndex(progress.stage);
  const timeline = ORDER_STAGES.map((stage) => ({
    stage,
    done: stageIndex(stage) <= currentIdx && !progress.terminal,
    current: stage === progress.stage && !progress.terminal,
    at: firstAt(stage) ?? fallbackAt[stage],
  }));

  res.status(200).json({
    display_id: displayId,
    created_at: order["created_at"] ?? null,
    stage: progress.stage,
    terminal: progress.terminal,
    has_prescription: progress.has_prescription,
    carrier: "FedEx",
    tracking_number: typeof md["tracking_number"] === "string" ? md["tracking_number"] : null,
    tracking_url: typeof md["tracking_url"] === "string" ? md["tracking_url"] : null,
    timeline,
  });
}
