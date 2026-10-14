/**
 * Réplica de pedidos en Google Sheets.
 *
 * Cada compra confirmada (order.placed) y cada cambio de etapa desde el panel
 * escriben en una hoja de cálculo del dueño:
 *
 *   - pestaña "Pedidos":   UNA fila por pedido (upsert por Order ID) con toda la
 *     información de la venta — cliente, dirección, artículos, totales,
 *     transportista elegido, receta, tracking — y su ESTADO actual;
 *   - pestaña "Historial": una fila POR EVENTO (compra, cada cambio de etapa),
 *     append-only, la réplica cronológica del proceso completo.
 *
 * Cero dependencias nuevas: el token OAuth se firma aquí mismo (JWT RS256 con
 * `node:crypto`, flujo de service account) y la API de Sheets v4 se llama con
 * `fetch` (Node 20). Si las variables de entorno no están, TODO es un no-op con
 * un log informativo — nunca toca el flujo del pedido. Configuración:
 *
 *   GSHEET_SPREADSHEET_ID        id de la hoja (está en su URL)
 *   GSHEET_SERVICE_ACCOUNT_EMAIL correo del service account de Google Cloud
 *   GSHEET_SERVICE_ACCOUNT_KEY   clave privada PEM del service account
 *                                (se admite con los saltos escapados como \n)
 *
 * El dueño crea la hoja, la COMPARTE como editor con el correo del service
 * account, y listo: las pestañas y encabezados se crean solos al primer pedido.
 */

import { createSign } from "node:crypto";
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { deriveOrderProgress, type OrderStage } from "./order-status";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const ORDERS_SHEET = process.env.GSHEET_ORDERS_SHEET || "Pedidos";
const HISTORY_SHEET = process.env.GSHEET_HISTORY_SHEET || "Historial";

/** Columnas de la pestaña Pedidos (una fila por pedido, upsert). */
const ORDER_HEADERS = [
  "Pedido #", "Order ID", "Fecha compra", "Estado", "Terminal",
  "Cliente", "Email", "Teléfono",
  "Dirección", "Ciudad", "Estado/Prov.", "ZIP", "País",
  "Artículos", "Receta",
  "Subtotal", "Envío", "Transportista", "Impuestos", "Descuento", "Total", "Moneda",
  "Notif. email", "Notif. SMS",
  "Tracking", "Tracking URL",
  "Última actualización", "Último evento",
];

/** Columnas de la pestaña Historial (una fila por evento, append). */
const HISTORY_HEADERS = [
  "Fecha/hora", "Pedido #", "Order ID", "Evento", "Estado", "Total", "Moneda", "Tracking", "Detalle",
];

interface GsheetConfig {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
}

export function gsheetConfig(): GsheetConfig | null {
  const spreadsheetId = (process.env.GSHEET_SPREADSHEET_ID ?? "").trim();
  const clientEmail = (process.env.GSHEET_SERVICE_ACCOUNT_EMAIL ?? "").trim();
  // Coolify/compose suelen guardar la clave PEM con \n literales.
  const privateKey = (process.env.GSHEET_SERVICE_ACCOUNT_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!spreadsheetId || !clientEmail || !privateKey) return null;
  return { spreadsheetId, clientEmail, privateKey };
}

export function isGsheetConfigured(): boolean {
  return gsheetConfig() !== null;
}

// ── OAuth: JWT de service account firmado localmente ─────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function accessToken(cfg: GsheetConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 120 > now) return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: cfg.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(cfg.privateKey).toString("base64url");
  const assertion = `${header}.${claims}.${signature}`;

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!resp.ok) {
    throw new Error(`google token ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = (await resp.json()) as { access_token: string; expires_in?: number };
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

// ── Llamadas a la API de Sheets ──────────────────────────────────────────────

async function sheetsFetch(
  cfg: GsheetConfig,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const token = await accessToken(cfg);
  return fetch(`${SHEETS_API}/${cfg.spreadsheetId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** Crea las pestañas y encabezados que falten. Idempotente; corre una vez por proceso. */
let ensured = false;
async function ensureSheets(cfg: GsheetConfig): Promise<void> {
  if (ensured) return;
  const meta = await sheetsFetch(cfg, "?fields=sheets.properties.title");
  if (!meta.ok) throw new Error(`spreadsheet meta ${meta.status}: ${(await meta.text()).slice(0, 300)}`);
  const titles = new Set(
    (((await meta.json()) as { sheets?: Array<{ properties?: { title?: string } }> }).sheets ?? [])
      .map((s) => s.properties?.title ?? "")
  );

  const missing = [ORDERS_SHEET, HISTORY_SHEET].filter((t) => !titles.has(t));
  if (missing.length) {
    const resp = await sheetsFetch(cfg, ":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
    });
    if (!resp.ok) throw new Error(`addSheet ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }

  // Encabezados si la primera fila está vacía (hoja recién creada o vaciada).
  for (const [title, headers] of [
    [ORDERS_SHEET, ORDER_HEADERS],
    [HISTORY_SHEET, HISTORY_HEADERS],
  ] as const) {
    const head = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${title}!1:1`)}`);
    const rows = head.ok ? ((await head.json()) as { values?: string[][] }).values : null;
    if (!rows?.length) {
      const resp = await sheetsFetch(
        cfg,
        `/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`,
        { method: "PUT", body: JSON.stringify({ values: [headers as unknown as string[]] }) }
      );
      if (!resp.ok) throw new Error(`headers ${title} ${resp.status}`);
    }
  }
  ensured = true;
}

/** Fila existente del pedido en la pestaña Pedidos (busca por Order ID, col B). */
async function findOrderRow(cfg: GsheetConfig, orderId: string): Promise<number | null> {
  const resp = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${ORDERS_SHEET}!B:B`)}`);
  if (!resp.ok) return null;
  const values = ((await resp.json()) as { values?: string[][] }).values ?? [];
  for (let i = 0; i < values.length; i++) {
    if (values[i]?.[0] === orderId) return i + 1; // filas de Sheets: 1-based
  }
  return null;
}

async function upsertOrderRow(cfg: GsheetConfig, orderId: string, row: unknown[]): Promise<void> {
  const existing = await findOrderRow(cfg, orderId);
  const body = JSON.stringify({ values: [row] });
  const resp = existing
    ? await sheetsFetch(
        cfg,
        `/values/${encodeURIComponent(`${ORDERS_SHEET}!A${existing}`)}?valueInputOption=RAW`,
        { method: "PUT", body }
      )
    : await sheetsFetch(
        cfg,
        `/values/${encodeURIComponent(`${ORDERS_SHEET}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: "POST", body }
      );
  if (!resp.ok) throw new Error(`upsert ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
}

async function appendHistoryRow(cfg: GsheetConfig, row: unknown[]): Promise<void> {
  const resp = await sheetsFetch(
    cfg,
    `/values/${encodeURIComponent(`${HISTORY_SHEET}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) }
  );
  if (!resp.ok) throw new Error(`append history ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
}

// ── Construcción de la fila desde el pedido ──────────────────────────────────

const ORDER_SHEET_FIELDS = [
  "id", "display_id", "email", "currency_code", "created_at", "metadata", "locale",
  "status", "payment_status", "fulfillment_status",
  "subtotal", "shipping_total", "tax_total", "discount_total", "total",
  "items.title", "items.quantity", "items.metadata",
  "shipping_address.first_name", "shipping_address.last_name", "shipping_address.phone",
  "shipping_address.address_1", "shipping_address.address_2", "shipping_address.city",
  "shipping_address.province", "shipping_address.postal_code", "shipping_address.country_code",
  "shipping_methods.name", "shipping_methods.amount",
  "fulfillments.labels.tracking_number", "fulfillments.labels.tracking_url",
  "fulfillments.created_at", "fulfillments.packed_at", "fulfillments.shipped_at", "fulfillments.canceled_at",
];

/* eslint-disable @typescript-eslint/no-explicit-any */
function money(v: unknown): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function buildRows(order: Record<string, any>, event: string, trackingOverride?: { number?: string | null; url?: string | null }) {
  const md = (order.metadata ?? {}) as Record<string, unknown>;
  const addr = (order.shipping_address ?? {}) as Record<string, any>;
  const progress = deriveOrderProgress(order as any);

  const items = ((order.items ?? []) as Array<Record<string, any>>)
    .map((it) => {
      const lens = (it.metadata ?? {})["lens_config"] ? " +lentes" : "";
      const rx = (it.metadata ?? {})["prescription_id"] ? " [receta]" : "";
      return `${it.quantity ?? 1}× ${it.title ?? "?"}${lens}${rx}`;
    })
    .join(" | ");

  const labels = ((order.fulfillments ?? []) as Array<Record<string, any>>)
    .flatMap((f) => (f.labels ?? []) as Array<Record<string, any>>);
  const trackingNumber =
    trackingOverride?.number ||
    (labels.map((l) => l.tracking_number).find(Boolean) as string | undefined) ||
    (md["tracking_number"] as string | undefined) || "";
  const trackingUrl =
    trackingOverride?.url ||
    (labels.map((l) => l.tracking_url).find(Boolean) as string | undefined) ||
    (md["tracking_url"] as string | undefined) || "";

  const carrier =
    (md["shipping_carrier_label"] as string | undefined) ||
    ((order.shipping_methods ?? [])[0]?.name as string | undefined) || "";

  const now = new Date().toISOString();
  const displayId = order.display_id != null ? `#${order.display_id}` : "";

  const orderRow = [
    displayId,
    String(order.id ?? ""),
    order.created_at ? new Date(order.created_at).toISOString() : "",
    progress.stage,
    progress.terminal ?? "",
    [addr.first_name, addr.last_name].filter(Boolean).join(" "),
    String(order.email ?? ""),
    String((md["phone"] as string | undefined) || addr.phone || ""),
    [addr.address_1, addr.address_2].filter(Boolean).join(", "),
    String(addr.city ?? ""),
    String(addr.province ?? ""),
    String(addr.postal_code ?? ""),
    String(addr.country_code ?? "").toUpperCase(),
    items,
    progress.has_prescription ? "sí" : "no",
    money(order.subtotal),
    money(order.shipping_total),
    carrier,
    money(order.tax_total),
    money(order.discount_total),
    money(order.total),
    String(order.currency_code ?? "").toUpperCase(),
    md["notify_email"] === false || md["notify_email"] === "false" ? "no" : "sí",
    md["notify_sms"] === true || md["notify_sms"] === "true" ? "sí" : "no",
    trackingNumber,
    trackingUrl,
    now,
    event,
  ];

  const historyRow = [
    now,
    displayId,
    String(order.id ?? ""),
    event,
    progress.stage,
    money(order.total),
    String(order.currency_code ?? "").toUpperCase(),
    trackingNumber,
    progress.terminal ? `terminal: ${progress.terminal}` : "",
  ];

  return { orderRow, historyRow };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Punto de entrada único ───────────────────────────────────────────────────

/**
 * Replica el estado del pedido en la hoja. `event` describe qué acaba de pasar
 * ("compra_confirmada", "etapa: in_lab", "cancelado"...). Nunca lanza: todo
 * fallo se loguea y se traga — la hoja es un espejo, no una dependencia.
 */
export async function syncOrderToSheet(
  container: MedusaContainer,
  orderId: string,
  event: string,
  tracking?: { number?: string | null; url?: string | null }
): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const cfg = gsheetConfig();
  if (!cfg) {
    logger.info(
      `[gsheet] not configured (GSHEET_SPREADSHEET_ID / GSHEET_SERVICE_ACCOUNT_EMAIL / GSHEET_SERVICE_ACCOUNT_KEY) — order ${orderId} not mirrored.`
    );
    return;
  }

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "order",
      fields: ORDER_SHEET_FIELDS,
      filters: { id: orderId },
    });
    const order = data?.[0] as Record<string, unknown> | undefined;
    if (!order) {
      logger.warn(`[gsheet] order ${orderId} not found — nothing mirrored.`);
      return;
    }

    await ensureSheets(cfg);
    const { orderRow, historyRow } = buildRows(order, event, tracking);
    await upsertOrderRow(cfg, String(order.id), orderRow);
    await appendHistoryRow(cfg, historyRow);
    logger.info(`[gsheet] order ${orderId} mirrored (${event}).`);
  } catch (error) {
    // La hoja jamás tumba un pedido ni un cambio de etapa.
    logger.error(`[gsheet] order ${orderId} (${event}) could not be mirrored: ${(error as Error).message}`);
  }
}

/** Helper para cambios de etapa desde el panel. */
export function sheetStageEvent(stage: OrderStage): string {
  return `etapa: ${stage}`;
}
