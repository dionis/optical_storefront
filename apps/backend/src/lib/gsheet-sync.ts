/**
 * Réplica de pedidos en una hoja de cálculo de Google Drive.
 *
 * Cada compra confirmada (order.placed), cada cambio de etapa desde el panel y
 * cada cancelación escriben en el archivo del dueño:
 *
 *   - tabla "Pedidos": UNA fila por pedido (upsert por nº de pedido) con los
 *     datos del comprador y de la compra y su ESTADO actual. Es una TABLA de
 *     Google Sheets con la misma estructura que la plantilla de la tienda —
 *     encabezado de color, filas alternas, columnas de tipo desplegable (Tipo,
 *     Estado) y fecha:
 *
 *       Pedido | Tipo | Detalles | Cliente | Estado | Fecha de compra | Archivo | Notas
 *
 *   - pestaña "Historial": una fila POR EVENTO (compra, cada cambio de etapa),
 *     append-only, la réplica cronológica del proceso completo.
 *
 * De la receta se copian SOLO los valores leídos (SPH/CYL/AXIS/ADD/prisma por ojo,
 * DIP, altura, origen) — nunca el documento original (foto/PDF), que se queda en
 * el bucket privado y se abre desde el panel. Tampoco van imágenes del probador:
 * esas viajan adjuntas en los correos.
 *
 * Cero dependencias nuevas: el token OAuth se firma aquí mismo (JWT RS256 con
 * `node:crypto`, flujo de service account) y la API de Sheets v4 se llama con
 * `fetch` (Node 20). Si las variables de entorno no están, TODO es un no-op con
 * un log informativo — nunca toca el flujo del pedido. Configuración:
 *
 *   GSHEET_FILE_URL              dirección del archivo en Drive (la URL tal cual
 *                                se copia del navegador). GSHEET_SPREADSHEET_ID
 *                                sigue valiendo como alternativa (id o URL).
 *   GSHEET_SERVICE_ACCOUNT_EMAIL correo del service account de Google Cloud
 *   GSHEET_SERVICE_ACCOUNT_KEY   clave privada PEM del service account
 *                                (se admite con los saltos escapados como \n)
 *   GSHEET_TIMEZONE              zona horaria de la columna de fecha (def. UTC)
 *
 * El dueño COMPARTE el archivo como editor con el correo del service account, y
 * listo: la tabla y la pestaña de historial se crean solas al primer pedido.
 *
 * El archivo tiene que ser una hoja de Google Sheets. Un .xlsx subido a Drive se
 * abre en Sheets en "modo compatibilidad" y la API no puede escribir en él: hay
 * que convertirlo una vez (Archivo → Guardar como Hojas de cálculo de Google) y
 * usar la URL del archivo convertido.
 */

import { createPrivateKey, createSign } from "node:crypto";
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows";
import type { Knex } from "@mikro-orm/knex";
import { deriveOrderProgress, type OrderStage, type OrderTerminalState } from "./order-status";
import { enrichLensItems, extractPaymentInfo, type PaymentInfo } from "./email/order-enrich";
import { loadPrescriptionRecords } from "./prescription-read";
import { storefrontOrigin } from "./order-access";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const ORDERS_SHEET = process.env.GSHEET_ORDERS_SHEET || "Pedidos";
const ORDERS_TABLE = process.env.GSHEET_ORDERS_TABLE || "Pedidos";
const HISTORY_SHEET = process.env.GSHEET_HISTORY_SHEET || "Historial";

// ── Estructura de la tabla (la de la plantilla) ──────────────────────────────

/** Valores del desplegable "Tipo". */
export const ORDER_TYPE = {
  rx: "Con receta",
  lenses: "Lentes sin receta",
  frame: "Solo montura",
  mixed: "Mixto",
} as const;

/** Valores del desplegable "Estado": las etapas y los estados terminales. */
export const STAGE_LABEL: Record<OrderStage, string> = {
  confirmed: "Nuevo",
  in_lab: "En laboratorio",
  shipped: "Enviado",
  in_transit: "En tránsito",
  delivered: "Entregado",
};
export const TERMINAL_LABEL: Record<OrderTerminalState, string> = {
  canceled: "Cancelado",
  refunded: "Reembolsado",
  payment_pending: "Pago pendiente",
};

type ColumnType = "TEXT" | "DROPDOWN" | "DATE" | "DOUBLE";
interface ColumnSpec {
  name: string;
  type: ColumnType;
  options?: string[];
  /** Ancho en píxeles. */
  width: number;
  /** Texto largo: ajustar a varias líneas. */
  wrap?: boolean;
}

export const ORDER_COLUMNS: ColumnSpec[] = [
  { name: "Pedido", type: "TEXT", width: 110 },
  { name: "Tipo", type: "DROPDOWN", options: Object.values(ORDER_TYPE), width: 150 },
  { name: "Detalles", type: "TEXT", width: 400, wrap: true },
  { name: "Cliente", type: "TEXT", width: 300, wrap: true },
  {
    name: "Estado",
    type: "DROPDOWN",
    options: [...Object.values(STAGE_LABEL), ...Object.values(TERMINAL_LABEL)],
    width: 150,
  },
  { name: "Fecha de compra", type: "DATE", width: 130 },
  // Columnas de las que se alimenta el Resumen (una fila por pedido, siempre
  // al día): importe, si está pagado, marca y si hubo prueba virtual.
  { name: "Total", type: "DOUBLE", width: 90 },
  { name: "Pagado", type: "DROPDOWN", options: ["Sí", "No"], width: 80 },
  { name: "Marca", type: "TEXT", width: 120 },
  { name: "Prueba virtual", type: "DROPDOWN", options: ["Sí", "No"], width: 100 },
  { name: "Archivo", type: "TEXT", width: 240, wrap: true },
  { name: "Notas", type: "TEXT", width: 320, wrap: true },
];
/** Índice (0-based) de una columna de la tabla por nombre. */
const ocol = (name: string): number => {
  const i = ORDER_COLUMNS.findIndex((c) => c.name === name);
  if (i < 0) throw new Error(`order column ${name}`);
  return i;
};
/** Pagado = lo que el panel considera cobrado (autorizado o capturado). */
const PAID_STATUSES = new Set(["authorized", "partially_authorized", "captured", "partially_captured", "partially_refunded"]);

// ── Estilo de marca (el de la tienda: azul marino + dorado) ──────────────────
const rgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};
const NAVY = rgb("#0b2f66");
const GOLD = rgb("#b8921e");
const WHITE = rgb("#ffffff");
/** Encabezado azul marino con letra blanca; filas alternas blanco / azul muy claro. */
const HEADER_COLOR = NAVY;
const BAND_1 = WHITE;
const BAND_2 = rgb("#edf1f8");
/** Chips de color de la columna "Estado" (fondo, texto). */
const STATUS_COLORS: Array<[string, string, string]> = [
  [STAGE_LABEL.confirmed, "#f6efd9", "#7a5b12"],
  [STAGE_LABEL.in_lab, "#e3ecf9", "#0b2f66"],
  [STAGE_LABEL.shipped, "#e8f1ff", "#0b2f66"],
  [STAGE_LABEL.in_transit, "#e8f1ff", "#0b2f66"],
  [STAGE_LABEL.delivered, "#e3f5e9", "#1e6b3a"],
  [TERMINAL_LABEL.canceled, "#fbe5e5", "#8a1c1c"],
  [TERMINAL_LABEL.refunded, "#fbe5e5", "#8a1c1c"],
  [TERMINAL_LABEL.payment_pending, "#fff1d6", "#8a5a00"],
];
/** Pestaña del resumen ejecutivo (primera del archivo). */
const DASHBOARD_SHEET = process.env.GSHEET_DASHBOARD_SHEET || "Resumen";
/** Pestaña del buscador de pedidos (segunda). */
const SEARCH_SHEET = process.env.GSHEET_SEARCH_SHEET || "Buscar";

/**
 * Columnas de la pestaña Historial: una fila POR EVENTO con TODO el pedido —
 * lo mismo que viaja en los correos — para seguirlo y ordenarlo por cualquier
 * columna. `key` identifica la columna en el código (fórmulas del resumen).
 */
interface HistoryColumn {
  key: string;
  name: string;
  width: number;
  type?: "DATETIME" | "MONEY" | "INT" | "TEXT";
  wrap?: boolean;
}
export const HISTORY_COLUMNS: HistoryColumn[] = [
  { key: "at", name: "Fecha/hora", width: 140, type: "DATETIME" },
  { key: "month", name: "Mes", width: 70 },
  { key: "order", name: "Pedido #", width: 80 },
  { key: "event", name: "Evento", width: 170 },
  { key: "status", name: "Estado", width: 130 },
  { key: "type", name: "Tipo de pedido", width: 130 },
  { key: "customer", name: "Cliente", width: 170 },
  { key: "email", name: "Correo", width: 200 },
  { key: "phone", name: "Teléfono", width: 120 },
  { key: "address", name: "Dirección de entrega", width: 220, wrap: true },
  { key: "city", name: "Ciudad", width: 110 },
  { key: "province", name: "Estado/Provincia", width: 100 },
  { key: "zip", name: "Código postal", width: 90 },
  { key: "country", name: "País", width: 60 },
  { key: "delivery", name: "Entrega", width: 150 },
  { key: "tracking", name: "Tracking", width: 160 },
  { key: "brand", name: "Marca", width: 120 },
  { key: "model", name: "Modelo", width: 170 },
  { key: "color", name: "Color", width: 130 },
  { key: "sku", name: "SKU", width: 120 },
  { key: "lenses", name: "Lentes", width: 240, wrap: true },
  { key: "rx", name: "Con receta", width: 90 },
  { key: "rx_od", name: "Receta OD", width: 220 },
  { key: "rx_os", name: "Receta OS", width: 220 },
  { key: "rx_pd", name: "DIP / Altura", width: 150 },
  { key: "rx_source", name: "Origen de la receta", width: 190, wrap: true },
  { key: "tryon", name: "Prueba virtual", width: 100 },
  { key: "qty", name: "Artículos", width: 80, type: "INT" },
  { key: "subtotal", name: "Subtotal", width: 90, type: "MONEY" },
  { key: "discount", name: "Descuento", width: 90, type: "MONEY" },
  { key: "shipping", name: "Envío", width: 80, type: "MONEY" },
  { key: "tax", name: "Impuestos", width: 90, type: "MONEY" },
  { key: "total", name: "Total", width: 100, type: "MONEY" },
  { key: "currency", name: "Moneda", width: 70 },
  { key: "paid", name: "Pagado", width: 80 },
  { key: "payment", name: "Pago", width: 160 },
  { key: "notify", name: "Avisos", width: 120 },
  { key: "locale", name: "Idioma", width: 70 },
  { key: "notes", name: "Notas", width: 260, wrap: true },
  { key: "order_id", name: "Order ID", width: 230 },
];
const HISTORY_HEADERS = HISTORY_COLUMNS.map((c) => c.name);
/** Letra de columna del Historial por clave (para las fórmulas del resumen). */
const hcol = (key: string): string => {
  const i = HISTORY_COLUMNS.findIndex((c) => c.key === key);
  if (i < 0) throw new Error(`history column ${key}`);
  return columnLetter(i);
};
/** Evento en texto legible (lo que ve el dueño en la hoja). */
export const EVENT_LABEL: Record<string, string> = {
  compra_confirmada: "Compra confirmada",
  resincronizado: "Alta en la hoja (resincronización)",
};
export function eventLabel(event: string): string {
  if (EVENT_LABEL[event]) return EVENT_LABEL[event];
  const stage = /^etapa:\s*(\w+)/.exec(event)?.[1] as OrderStage | undefined;
  if (stage && STAGE_LABEL[stage]) return `Etapa: ${STAGE_LABEL[stage]}`;
  if (/^cancelado/.test(event)) return "Cancelado por el cliente";
  return event.charAt(0).toUpperCase() + event.slice(1);
}

// ── Configuración ────────────────────────────────────────────────────────────

interface GsheetConfig {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Id de la hoja a partir de lo que el dueño pegue: la URL de Sheets
 * (…/spreadsheets/d/<id>/edit…), la de Drive (…/file/d/<id>/…, …?id=<id>) o el
 * id pelado.
 */
export function spreadsheetIdFrom(value: string | undefined | null): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const byPath = /\/(?:spreadsheets\/d|file\/d)\/([A-Za-z0-9_-]{20,})/.exec(raw);
  if (byPath) return byPath[1];
  const byQuery = /[?&]id=([A-Za-z0-9_-]{20,})/.exec(raw);
  if (byQuery) return byQuery[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : null;
}

/** Quita comillas envolventes que Coolify/compose dejan dentro del valor. */
function unquote(value: string): string {
  let v = value.trim();
  while (v.length >= 2 && /^(["'`]).*\1$/s.test(v)) v = v.slice(1, -1).trim();
  return v;
}

/**
 * Lo que se haya pegado en GSHEET_SERVICE_ACCOUNT_KEY, llevado a un PEM que
 * OpenSSL acepte. Admite: el PEM con saltos reales, con `\n` literales (una o
 * dos veces escapados), con `\r\n`, entre comillas, el JSON completo del
 * service account, o el PEM en base64. Devuelve también el client_email si
 * venía dentro del JSON.
 */
export function normalizePrivateKey(raw: string | undefined | null): { key: string; email?: string } {
  let v = unquote(raw ?? "");
  let email: string | undefined;
  if (v.startsWith("{")) {
    try {
      const json = JSON.parse(v) as { private_key?: string; client_email?: string };
      v = json.private_key ?? "";
      email = json.client_email;
    } catch {
      // No era JSON válido: se sigue tratando como PEM.
    }
  }
  if (v && !v.includes("-----BEGIN")) {
    const decoded = Buffer.from(v, "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) v = decoded;
  }
  v = v
    .replace(/\\\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "");
  // Rearma el PEM: cabecera, cuerpo base64 sin espacios en líneas de 64, pie.
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(v);
  if (m) {
    const body = m[2].replace(/[^A-Za-z0-9+/=]/g, "");
    const lines = body.match(/.{1,64}/g) ?? [];
    v = `-----BEGIN ${m[1]}-----\n${lines.join("\n")}\n-----END ${m[1]}-----\n`;
  }
  return { key: v.trim() ? v : "", email };
}

/** Por qué la clave no sirve, sin volcar su contenido al log. */
export function privateKeyProblem(key: string): string | null {
  if (!key.includes("-----BEGIN")) {
    return "GSHEET_SERVICE_ACCOUNT_KEY no contiene un bloque '-----BEGIN PRIVATE KEY-----' (¿se pegó el client_id o el private_key_id en vez del private_key?)";
  }
  try {
    createPrivateKey(key);
    return null;
  } catch (error) {
    return `GSHEET_SERVICE_ACCOUNT_KEY no es una clave PEM válida (${(error as Error).message}); pega el campo private_key del JSON completo, desde -----BEGIN hasta -----END PRIVATE KEY-----`;
  }
}

export function gsheetConfig(): GsheetConfig | null {
  const spreadsheetId =
    spreadsheetIdFrom(process.env.GSHEET_FILE_URL) ??
    spreadsheetIdFrom(process.env.GSHEET_SPREADSHEET_ID);
  const { key: privateKey, email } = normalizePrivateKey(process.env.GSHEET_SERVICE_ACCOUNT_KEY);
  const clientEmail = unquote(process.env.GSHEET_SERVICE_ACCOUNT_EMAIL ?? "") || (email ?? "");
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
    const body = (await resp.text()).slice(0, 300);
    // "account not found": el correo no es el client_email de un service account
    // existente (placeholder del .env.example, un Gmail, el client_id, o la cuenta
    // se borró). Se nombra el correo usado — no es secreto — para poder compararlo.
    const hint = /account not found/i.test(body)
      ? ` — Google no reconoce el service account "${cfg.clientEmail}"; GSHEET_SERVICE_ACCOUNT_EMAIL debe ser el campo client_email del JSON de la clave (…@….iam.gserviceaccount.com)`
      : /invalid_grant/i.test(body)
        ? ` — revisa que la clave corresponda al service account "${cfg.clientEmail}" y que no esté revocada`
        : "";
    throw new Error(`google token ${resp.status}: ${body}${hint}`);
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

async function failure(label: string, resp: Response): Promise<Error> {
  const body = (await resp.text()).slice(0, 300);
  // Un .xlsx abierto en Sheets responde así a cualquier operación de la API.
  if (/not supported for this document/i.test(body)) {
    return new Error(
      `${label}: el archivo es un Excel (.xlsx) sin convertir — ábrelo en Google Sheets, ` +
        "Archivo → Guardar como Hojas de cálculo de Google, y pon la URL del archivo nuevo en GSHEET_FILE_URL."
    );
  }
  return new Error(`${label} ${resp.status}: ${body}`);
}

type Reply = Record<string, any>;

async function batchUpdate(cfg: GsheetConfig, requests: unknown[]): Promise<Reply[]> {
  const resp = await sheetsFetch(cfg, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  if (!resp.ok) throw await failure("batchUpdate", resp);
  return ((await resp.json()) as { replies?: Reply[] }).replies ?? [];
}

interface OrdersTable {
  tableId: string;
  sheetId: number;
  sheetTitle: string;
  /** Fila (0-based) del encabezado y columna (0-based) donde empieza la tabla. */
  headerRow: number;
  startCol: number;
  /** Fila (0-based, exclusiva) donde termina la tabla ahora mismo. */
  endRow: number;
}

interface SheetMeta {
  properties?: { sheetId?: number; title?: string };
  tables?: Array<{
    tableId?: string;
    name?: string;
    range?: { startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number };
  }>;
  /** Solo se usa para contar las reglas y reemplazarlas (estilo idempotente). */
  conditionalFormats?: Array<unknown>;
  charts?: Array<unknown>;
}

async function readSheetsMeta(cfg: GsheetConfig): Promise<SheetMeta[]> {
  const resp = await sheetsFetch(
    cfg,
    `?fields=${encodeURIComponent("sheets(properties(sheetId,title),tables(tableId,name,range),conditionalFormats(ranges),charts(chartId))")}`
  );
  if (!resp.ok) throw await failure("spreadsheet meta", resp);
  return ((await resp.json()) as { sheets?: SheetMeta[] }).sheets ?? [];
}

function findOrdersTable(sheets: SheetMeta[]): OrdersTable | null {
  for (const s of sheets) {
    for (const tbl of s.tables ?? []) {
      if (tbl.name === ORDERS_TABLE && tbl.tableId) {
        return {
          tableId: tbl.tableId,
          sheetId: s.properties?.sheetId ?? 0,
          sheetTitle: s.properties?.title ?? ORDERS_SHEET,
          headerRow: tbl.range?.startRowIndex ?? 0,
          startCol: tbl.range?.startColumnIndex ?? 0,
          endRow: tbl.range?.endRowIndex ?? (tbl.range?.startRowIndex ?? 0) + 2,
        };
      }
    }
  }
  return null;
}

/** Pestaña libre para la tabla: la configurada si no existe o está vacía. */
async function pickSheetForTable(
  cfg: GsheetConfig,
  sheets: SheetMeta[]
): Promise<{ sheetId: number; title: string }> {
  const existing = sheets.find((s) => s.properties?.title === ORDERS_SHEET);
  if (existing && !(existing.tables ?? []).length) {
    const head = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${ORDERS_SHEET}!A1:H2`)}`);
    const values = head.ok ? ((await head.json()) as { values?: unknown[][] }).values : undefined;
    if (!values?.length) return { sheetId: existing.properties?.sheetId ?? 0, title: ORDERS_SHEET };
  }
  // La pestaña ya tiene otra cosa (p. ej. la réplica antigua, sin tabla): la
  // tabla va a una pestaña nueva y la antigua se deja intacta.
  const titles = new Set(sheets.map((s) => s.properties?.title ?? ""));
  let title = existing ? `${ORDERS_SHEET} (tabla)` : ORDERS_SHEET;
  for (let n = 2; titles.has(title); n++) title = `${ORDERS_SHEET} (tabla ${n})`;
  const [reply] = await batchUpdate(cfg, [{ addSheet: { properties: { title } } }]);
  return { sheetId: Number(reply?.addSheet?.properties?.sheetId ?? 0), title };
}

function tableColumnProperties() {
  return ORDER_COLUMNS.map((c, columnIndex) => ({
    columnIndex,
    columnName: c.name,
    columnType: c.type,
    ...(c.type === "DROPDOWN"
      ? { dataValidationRule: { condition: { type: "ONE_OF_LIST", values: (c.options ?? []).map((v) => ({ userEnteredValue: v })) } } }
      : {}),
  }));
}

async function createOrdersTable(cfg: GsheetConfig, sheets: SheetMeta[]): Promise<OrdersTable> {
  const { sheetId, title } = await pickSheetForTable(cfg, sheets);
  const cols = ORDER_COLUMNS.length;

  const requests: unknown[] = [
    {
      addTable: {
        table: {
          name: ORDERS_TABLE,
          // Encabezado + una fila vacía: appendCells rellena la primera libre.
          range: { sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: cols },
          columnProperties: tableColumnProperties(),
          rowsProperties: {
            headerColorStyle: { rgbColor: HEADER_COLOR },
            firstBandColorStyle: { rgbColor: BAND_1 },
            secondBandColorStyle: { rgbColor: BAND_2 },
          },
        },
      },
    },
    // Anchos de columna como en la plantilla.
    ...ORDER_COLUMNS.map((c, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: c.width },
        fields: "pixelSize",
      },
    })),
    // Texto largo en varias líneas y alineado arriba.
    ...ORDER_COLUMNS.flatMap((c, i) =>
      c.wrap
        ? [
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
                cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
                fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
              },
            },
          ]
        : []
    ),
    // Fecha en formato d/m/yyyy, como la plantilla.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 },
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "d/m/yyyy" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
  ];

  const [reply] = await batchUpdate(cfg, requests);
  const tableId = reply?.addTable?.table?.tableId as string | undefined;
  if (tableId) return { tableId, sheetId, sheetTitle: title, headerRow: 0, startCol: 0, endRow: 2 };
  const found = findOrdersTable(await readSheetsMeta(cfg));
  if (!found) throw new Error("addTable: the table was not found after creating it");
  return found;
}

/**
 * Escribe los títulos en la fila de encabezado si están vacíos. `columnName`
 * en addTable no siempre llega a las celdas: así quedó una tabla sin títulos en
 * producción. Un encabezado que el dueño ya escribió (aunque lo haya renombrado)
 * no se toca.
 */
async function ensureOrdersHeader(cfg: GsheetConfig, table: OrdersTable): Promise<void> {
  const from = columnLetter(table.startCol);
  const to = columnLetter(table.startCol + ORDER_COLUMNS.length - 1);
  const row = table.headerRow + 1;
  const range = `${quoteSheet(table.sheetTitle)}!${from}${row}:${to}${row}`;
  const head = await sheetsFetch(cfg, `/values/${encodeURIComponent(range)}`);
  if (!head.ok) throw await failure("read header", head);
  const values = ((await head.json()) as { values?: string[][] }).values?.[0] ?? [];
  if (values.some((v) => String(v ?? "").trim())) return;
  const resp = await sheetsFetch(cfg, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [ORDER_COLUMNS.map((c) => c.name)] }),
  });
  if (!resp.ok) throw await failure("write header", resp);
}

/**
 * Localiza (o crea) la tabla de pedidos y la pestaña de historial. Se cachea por
 * proceso; si el dueño borra la tabla, el siguiente fallo de escritura la
 * invalida y se vuelve a crear en el siguiente pedido.
 */
let cachedTable: OrdersTable | null = null;
let historyEnsured = false;
let styleApplied = false;

async function ensureSheets(cfg: GsheetConfig, logger?: Logger): Promise<OrdersTable> {
  if (cachedTable && historyEnsured && styleApplied) return cachedTable;
  const sheets = await readSheetsMeta(cfg);

  const table = findOrdersTable(sheets) ?? (await createOrdersTable(cfg, sheets));
  await ensureOrdersHeader(cfg, table);

  if (!historyEnsured) {
    await ensureHistorySheet(cfg, sheets);
    historyEnsured = true;
  }

  // Estilo de marca una vez por proceso, también sobre un archivo que ya
  // existía con el estilo antiguo. Si falla, el pedido se escribe igual.
  if (!styleApplied) {
    try {
      const meta = await readSheetsMeta(cfg);
      await applyBrandStyle(cfg, table, meta);
      await ensureDashboard(cfg, meta, table);
      await ensureSearchSheet(cfg, meta);
      styleApplied = true;
    } catch (e) {
      logger?.warn(`[gsheet] estilo/resumen no aplicado: ${(e as Error).message}`);
    }
  }

  cachedTable = table;
  return table;
}

/**
 * Pestaña Historial con el esquema actual. Si existe una con otro encabezado
 * (la versión corta anterior), se renombra a "Historial (anterior)" y se crea
 * una nueva: el esquema ancho no cabe en la vieja y los datos antiguos no se
 * pierden.
 */
async function ensureHistorySheet(cfg: GsheetConfig, sheets: SheetMeta[]): Promise<void> {
  const titles = new Set(sheets.map((s) => s.properties?.title ?? ""));
  const existing = sheets.find((s) => s.properties?.title === HISTORY_SHEET);
  if (existing) {
    const head = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${HISTORY_SHEET}!1:1`)}`);
    const row = head.ok ? (((await head.json()) as { values?: string[][] }).values?.[0] ?? []) : [];
    const same = row.length === HISTORY_HEADERS.length && row.every((v, i) => v === HISTORY_HEADERS[i]);
    if (same) return;
    if (row.length) {
      let old = `${HISTORY_SHEET} (anterior)`;
      for (let n = 2; titles.has(old); n++) old = `${HISTORY_SHEET} (anterior ${n})`;
      await batchUpdate(cfg, [
        { updateSheetProperties: { properties: { sheetId: existing.properties?.sheetId, title: old }, fields: "title" } },
        { addSheet: { properties: { title: HISTORY_SHEET, gridProperties: { columnCount: HISTORY_HEADERS.length + 2 } } } },
      ]);
    }
  } else {
    await batchUpdate(cfg, [
      { addSheet: { properties: { title: HISTORY_SHEET, gridProperties: { columnCount: HISTORY_HEADERS.length + 2 } } } },
    ]);
  }
  const resp = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${HISTORY_SHEET}!A1`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [HISTORY_HEADERS] }),
  });
  if (!resp.ok) throw await failure(`headers ${HISTORY_SHEET}`, resp);
}

/**
 * Deja las dos pestañas con el aspecto de la tienda y listas para trabajar:
 *
 *   - Tabla "Pedidos": encabezado azul marino con letra blanca y línea dorada,
 *     filas alternas, columnas anchas con texto ajustado, fecha d/m/yyyy, chips
 *     de color por estado y fila de encabezado fija. Al ser una TABLA, cada
 *     encabezado ya trae su menú de ordenar y filtrar.
 *   - Pestaña "Historial": mismo encabezado, filtro básico sobre todas las
 *     columnas (menú de ordenar/filtrar en cada encabezado), anchos, ajuste de
 *     texto y filas alternas.
 *
 * Idempotente: las reglas de formato condicional de cada pestaña se reemplazan
 * (nunca se acumulan) y el resto son propiedades que se sobrescriben.
 */
async function applyBrandStyle(cfg: GsheetConfig, table: OrdersTable, sheets: SheetMeta[]): Promise<void> {
  const cols = ORDER_COLUMNS.length;
  const { sheetId, headerRow, startCol } = table;
  const headerText = {
    textFormat: { bold: true, fontSize: 11, foregroundColorStyle: { rgbColor: WHITE } },
    verticalAlignment: "MIDDLE",
    wrapStrategy: "WRAP",
  };
  const rulesCount = (id: number) =>
    (sheets.find((s) => s.properties?.sheetId === id)?.conditionalFormats ?? []).length;
  const dropRules = (id: number) =>
    Array.from({ length: rulesCount(id) }, (_, i) => rulesCount(id) - 1 - i).map((index) => ({
      deleteConditionalFormatRule: { sheetId: id, index },
    }));
  const bandRule = (id: number, firstRow: number, lastCol: number) => ({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId: id, startRowIndex: firstRow, startColumnIndex: 0, endColumnIndex: lastCol }],
        booleanRule: {
          condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: "=ISEVEN(ROW())" }] },
          format: { backgroundColorStyle: { rgbColor: BAND_2 } },
        },
      },
    },
  });

  const requests: unknown[] = [
    // Tabla: colores de encabezado y bandas.
    {
      updateTable: {
        table: {
          tableId: table.tableId,
          // Rango con TODAS las columnas actuales (si el esquema creció, la
          // tabla se amplía y las columnas nuevas reciben nombre y tipo).
          range: { sheetId, startRowIndex: headerRow, endRowIndex: Math.max(table.endRow, headerRow + 2), startColumnIndex: startCol, endColumnIndex: startCol + cols },
          columnProperties: tableColumnProperties(),
          rowsProperties: {
            headerColorStyle: { rgbColor: HEADER_COLOR },
            firstBandColorStyle: { rgbColor: BAND_1 },
            secondBandColorStyle: { rgbColor: BAND_2 },
          },
        },
        fields: "range,columnProperties,rowsProperties",
      },
    },
    // Los títulos de las columnas (columnName no siempre llega a las celdas).
    {
      updateCells: {
        range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: startCol, endColumnIndex: startCol + cols },
        rows: [{ values: ORDER_COLUMNS.map((c) => ({ userEnteredValue: { stringValue: c.name } })) }],
        fields: "userEnteredValue",
      },
    },
    // Encabezado: letra blanca en negrita, alto cómodo y línea dorada debajo.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: startCol, endColumnIndex: startCol + cols },
        cell: { userEnteredFormat: headerText },
        fields: "userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)",
      },
    },
    {
      updateBorders: {
        range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: startCol, endColumnIndex: startCol + cols },
        bottom: { style: "SOLID_MEDIUM", colorStyle: { rgbColor: GOLD } },
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: headerRow, endIndex: headerRow + 1 },
        properties: { pixelSize: 36 },
        fields: "pixelSize",
      },
    },
    // Columnas: ancho de la plantilla y texto ajustado y arriba en todas.
    ...ORDER_COLUMNS.map((c, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: startCol + i, endIndex: startCol + i + 1 },
        properties: { pixelSize: c.width },
        fields: "pixelSize",
      },
    })),
    {
      repeatCell: {
        range: { sheetId, startRowIndex: headerRow + 1, startColumnIndex: startCol, endColumnIndex: startCol + cols },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", textFormat: { fontSize: 10 } } },
        fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat.fontSize)",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: headerRow + 1, startColumnIndex: startCol + ocol("Fecha de compra"), endColumnIndex: startCol + ocol("Fecha de compra") + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "d/m/yyyy" }, horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: headerRow + 1, startColumnIndex: startCol + ocol("Total"), endColumnIndex: startCol + ocol("Total") + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0.00" }, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: headerRow + 1, startColumnIndex: startCol, endColumnIndex: startCol + 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10, foregroundColorStyle: { rgbColor: NAVY } } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: headerRow + 1 } }, fields: "gridProperties.frozenRowCount" } },
    // Chips de color por estado (se reemplazan las reglas anteriores).
    ...dropRules(sheetId),
    ...STATUS_COLORS.map(([label, bg, fg]) => ({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId, startRowIndex: headerRow + 1, startColumnIndex: startCol + ocol("Estado"), endColumnIndex: startCol + ocol("Estado") + 1 }],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: label }] },
            format: {
              backgroundColorStyle: { rgbColor: rgb(bg) },
              textFormat: { bold: true, foregroundColorStyle: { rgbColor: rgb(fg) } },
            },
          },
        },
      },
    })),
  ];

  // Pestaña Historial.
  const history = sheets.find((s) => s.properties?.title === HISTORY_SHEET);
  const hid = history?.properties?.sheetId;
  if (hid !== undefined) {
    const hcols = HISTORY_HEADERS.length;
    requests.push(
      {
        repeatCell: {
          range: { sheetId: hid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: hcols },
          cell: { userEnteredFormat: { ...headerText, backgroundColorStyle: { rgbColor: HEADER_COLOR } } },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment,wrapStrategy)",
        },
      },
      {
        updateBorders: {
          range: { sheetId: hid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: hcols },
          bottom: { style: "SOLID_MEDIUM", colorStyle: { rgbColor: GOLD } },
        },
      },
      { updateDimensionProperties: { range: { sheetId: hid, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 36 }, fields: "pixelSize" } },
      ...HISTORY_COLUMNS.map((c, i) => ({
        updateDimensionProperties: { range: { sheetId: hid, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: c.width }, fields: "pixelSize" },
      })),
      // Filas de datos: fondo blanco y letra normal (el azul marino es SOLO del
      // encabezado; una fila añadida heredaba antes el formato de la cabecera).
      {
        repeatCell: {
          range: { sheetId: hid, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: hcols },
          cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: WHITE }, wrapStrategy: "CLIP", verticalAlignment: "TOP", horizontalAlignment: "LEFT", textFormat: { bold: false, italic: false, fontSize: 10, foregroundColorStyle: { rgbColor: rgb("#1e2733") } } } },
          fields: "userEnteredFormat(backgroundColorStyle,wrapStrategy,verticalAlignment,horizontalAlignment,textFormat)",
        },
      },
      ...HISTORY_COLUMNS.flatMap((c, i) => {
        const fmt =
          c.type === "DATETIME" ? { numberFormat: { type: "DATE_TIME", pattern: "d/m/yyyy hh:mm" } }
          : c.type === "MONEY" ? { numberFormat: { type: "NUMBER", pattern: "#,##0.00" }, horizontalAlignment: "RIGHT" }
          : c.type === "INT" ? { numberFormat: { type: "NUMBER", pattern: "0" }, horizontalAlignment: "CENTER" }
          : c.wrap ? { wrapStrategy: "WRAP" }
          : null;
        return fmt
          ? [{ repeatCell: { range: { sheetId: hid, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: fmt }, fields: "userEnteredFormat(" + Object.keys(fmt).join(",") + ")" } }]
          : [];
      }),
      {
        repeatCell: {
          range: { sheetId: hid, startRowIndex: 1, startColumnIndex: HISTORY_COLUMNS.findIndex((c) => c.key === "order"), endColumnIndex: HISTORY_COLUMNS.findIndex((c) => c.key === "order") + 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10, foregroundColorStyle: { rgbColor: NAVY } } } },
          fields: "userEnteredFormat.textFormat",
        },
      },
      { updateSheetProperties: { properties: { sheetId: hid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 3 } }, fields: "gridProperties(frozenRowCount,frozenColumnCount)" } },
      // Menú de ordenar/filtrar en cada encabezado del historial.
      { setBasicFilter: { filter: { range: { sheetId: hid, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: hcols } } } },
      ...dropRules(hid),
      bandRule(hid, 1, hcols),
      ...STATUS_COLORS.map(([label, bg, fg]) => ({
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [{ sheetId: hid, startRowIndex: 1, startColumnIndex: HISTORY_COLUMNS.findIndex((c) => c.key === "status"), endColumnIndex: HISTORY_COLUMNS.findIndex((c) => c.key === "status") + 1 }],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: label }] },
              format: { backgroundColorStyle: { rgbColor: rgb(bg) }, textFormat: { bold: true, foregroundColorStyle: { rgbColor: rgb(fg) } } },
            },
          },
        },
      }))
    );
  }

  await batchUpdate(cfg, requests);
}

// ── Resumen ejecutivo ────────────────────────────────────────────────────────

/**
 * Pestaña "Resumen", la primera del archivo: indicadores del mes y totales,
 * ventas por mes (12 meses), por marca, por tipo de pedido y por estado, con
 * dos gráficos. Todo son fórmulas sobre Historial y Pedidos, así que se
 * recalcula solo con cada fila nueva. Se reescribe en cada arranque
 * (idempotente); los gráficos solo se crean si la pestaña no tiene ninguno.
 */
async function ensureDashboard(cfg: GsheetConfig, sheets: SheetMeta[], table: OrdersTable): Promise<void> {
  let dash = sheets.find((s) => s.properties?.title === DASHBOARD_SHEET);
  if (!dash) {
    const [reply] = await batchUpdate(cfg, [
      { addSheet: { properties: { title: DASHBOARD_SHEET, index: 0, gridProperties: { rowCount: 80, columnCount: 18, hideGridlines: true } } } },
    ]);
    dash = { properties: { sheetId: Number(reply?.addSheet?.properties?.sheetId ?? 0), title: DASHBOARD_SHEET }, charts: [] };
  }
  const sid = dash.properties?.sheetId ?? 0;
  // Todo sale de la tabla "Pedidos": una fila por pedido, refrescada cada 30
  // minutos por el job, así que estado, importe y pago están siempre al día.
  const P = quoteSheet(table.sheetTitle);
  const col = (name: string) => `${P}!$${columnLetter(table.startCol + ocol(name))}:$${columnLetter(table.startCol + ocol(name))}`;
  const paidCrit = `${col("Pagado")},"Sí"`;
  const inMonth = (cell: string) => `${col("Fecha de compra")},">="&${cell},${col("Fecha de compra")},"<"&EDATE(${cell},1)`;
  const SUM = (extra = "") => `=IFERROR(SUMIFS(${col("Total")},${paidCrit}${extra}),0)`;
  const CNT = (extra = "") => `=IFERROR(COUNTIFS(${paidCrit}${extra}),0)`;
  const thisMonth = `DATE(YEAR(TODAY()),MONTH(TODAY()),1)`;

  // Celdas: [fila, col] 0-based. La hoja es de 12 columnas útiles (A..L).
  const V: Array<[number, number, string | number]> = [];
  const put = (r: number, col: number, v: string | number) => V.push([r, col, v]);
  put(0, 0, "RUBI LENS · Resumen ejecutivo");
  put(1, 0, "Se actualiza solo con cada pedido, cada cambio de etapa y cada 30 minutos. Ventas = pedidos pagados (sin cancelados ni reembolsados).");
  put(1, 9, "Actualizado:"); put(1, 10, "=NOW()");

  // Indicadores (fila 3 etiquetas, fila 4 valores; 4 tiles de 3 columnas).
  const tiles: Array<[string, string]> = [
    ["VENTAS ESTE MES", SUM(`,${inMonth(thisMonth)}`)],
    ["PEDIDOS ESTE MES", CNT(`,${inMonth(thisMonth)}`)],
    ["TICKET MEDIO (MES)", `=IFERROR(B5/E5,0)`],
    ["VENTAS TOTALES", SUM()],
  ];
  const E = col("Estado");
  const tiles2: Array<[string, string]> = [
    ["PEDIDOS TOTALES", `=COUNTA(${col("Pedido")})-1`],
    ["EN LABORATORIO", `=COUNTIF(${E},"${STAGE_LABEL.in_lab}")+COUNTIF(${E},"${STAGE_LABEL.confirmed}")`],
    ["ENVIADOS / EN TRÁNSITO", `=COUNTIF(${E},"${STAGE_LABEL.shipped}")+COUNTIF(${E},"${STAGE_LABEL.in_transit}")`],
    ["ENTREGADOS", `=COUNTIF(${E},"${STAGE_LABEL.delivered}")`],
  ];
  tiles.forEach(([l, f], i) => { put(3, 1 + i * 3, l); put(4, 1 + i * 3, f); });
  tiles2.forEach(([l, f], i) => { put(6, 1 + i * 3, l); put(7, 1 + i * 3, f); });

  // Ventas por mes (últimos 12 meses), filas 10..22. La columna Mes es una
  // fecha (día 1 del mes) con formato "mmm yyyy".
  const M0 = 10;
  put(M0, 1, "VENTAS POR MES");
  ["Mes", "Pedidos", "Ventas", "Ticket medio", "Con receta", "Pruebas virtuales"].forEach((h, i) => put(M0 + 1, 1 + i, h));
  for (let i = 0; i < 12; i++) {
    const r = M0 + 2 + i;
    const row = r + 1; // 1-based para las fórmulas
    put(r, 1, `=EDATE(${thisMonth},${i - 11})`);
    put(r, 2, CNT(`,${inMonth(`$B${row}`)}`));
    put(r, 3, SUM(`,${inMonth(`$B${row}`)}`));
    put(r, 4, `=IFERROR(D${row}/C${row},0)`);
    put(r, 5, `=IFERROR(COUNTIFS(${paidCrit},${inMonth(`$B${row}`)},${col("Tipo")},"${ORDER_TYPE.rx}")+COUNTIFS(${paidCrit},${inMonth(`$B${row}`)},${col("Tipo")},"${ORDER_TYPE.mixed}"),0)`);
    put(r, 6, CNT(`,${inMonth(`$B${row}`)},${col("Prueba virtual")},"Sí"`));
  }

  // A la derecha de "Ventas por mes": por marca (I..K), por estado y por tipo
  // (M..O). Así los gráficos quedan justo debajo, a la vista.
  const B0 = M0, BC = 8; // marca: columnas I,J,K
  put(B0, BC, "VENTAS POR MARCA"); ["Marca", "Pedidos", "Ventas"].forEach((h, i) => put(B0 + 1, BC + i, h));
  const brandRange = `${P}!$${columnLetter(table.startCol + ocol("Marca"))}$${table.headerRow + 2}:$${columnLetter(table.startCol + ocol("Marca"))}`;
  const BL = columnLetter(BC);
  put(B0 + 2, BC, `=IFERROR(SORT(UNIQUE(FILTER(${brandRange},${brandRange}<>""))),"")`);
  for (let i = 0; i < 10; i++) {
    const row = B0 + 3 + i;
    put(B0 + 2 + i, BC + 1, `=IF($${BL}${row}="","",COUNTIFS(${paidCrit},${col("Marca")},$${BL}${row}))`);
    put(B0 + 2 + i, BC + 2, `=IF($${BL}${row}="","",SUMIFS(${col("Total")},${paidCrit},${col("Marca")},$${BL}${row}))`);
  }
  const S0 = M0, SC = 12, SL = columnLetter(SC); // estado: columnas M,N
  put(S0, SC, "PEDIDOS POR ESTADO (AHORA)"); ["Estado", "Pedidos"].forEach((h, i) => put(S0 + 1, SC + i, h));
  const STATES = [...Object.values(STAGE_LABEL), ...Object.values(TERMINAL_LABEL)];
  STATES.forEach((st, i) => {
    put(S0 + 2 + i, SC, st);
    put(S0 + 2 + i, SC + 1, `=COUNTIF(${E},$${SL}${S0 + 3 + i})`);
  });
  // Tipo de pedido: debajo de "Ventas por marca" (mismas columnas I,J,K), así
  // las tres tablas de arriba (mes / marca / estado) arrancan a la misma altura.
  const T0 = B0 + 2 + 10 + 1, TC = BC, TL = BL;
  put(T0, TC, "POR TIPO DE PEDIDO"); ["Tipo", "Pedidos", "Ventas"].forEach((h, i) => put(T0 + 1, TC + i, h));
  Object.values(ORDER_TYPE).forEach((t, i) => {
    const row = T0 + 3 + i;
    put(T0 + 2 + i, TC, t);
    put(T0 + 2 + i, TC + 1, `=COUNTIFS(${paidCrit},${col("Tipo")},$${TL}${row})`);
    put(T0 + 2 + i, TC + 2, `=SUMIFS(${col("Total")},${paidCrit},${col("Tipo")},$${TL}${row})`);
  });
  const CH = Math.max(M0 + 15, T0 + 2 + Object.values(ORDER_TYPE).length + 1); // fila de los gráficos

  // Escribir valores (fórmulas con USER_ENTERED).
  const maxR = Math.max(...V.map((v) => v[0])) + 1;
  const grid: (string | number | null)[][] = Array.from({ length: maxR }, () => Array(15).fill(null));
  for (const [r, col, v] of V) grid[r][col] = v;
  const clear = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${DASHBOARD_SHEET}!A1:O${Math.max(maxR, 60)}`)}:clear`, { method: "POST", body: "{}" });
  if (!clear.ok) throw await failure("clear dashboard", clear);
  const write = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${DASHBOARD_SHEET}!A1`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: grid.map((row) => row.map((v) => (v === null ? "" : v))) }),
  });
  if (!write.ok) throw await failure("write dashboard", write);

  // Formato.
  const title = { backgroundColorStyle: { rgbColor: NAVY }, textFormat: { bold: true, fontSize: 18, foregroundColorStyle: { rgbColor: WHITE } }, verticalAlignment: "MIDDLE" };
  const label = { textFormat: { bold: true, fontSize: 9, foregroundColorStyle: { rgbColor: rgb("#8a7340") } }, horizontalAlignment: "LEFT" };
  const value = { textFormat: { bold: true, fontSize: 20, foregroundColorStyle: { rgbColor: NAVY } }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE" };
  const section = { textFormat: { bold: true, fontSize: 11, foregroundColorStyle: { rgbColor: NAVY } } };
  const head = { backgroundColorStyle: { rgbColor: NAVY }, textFormat: { bold: true, fontSize: 10, foregroundColorStyle: { rgbColor: WHITE } } };
  const money = { numberFormat: { type: "NUMBER", pattern: '"USD "#,##0.00' } };
  const range = (r0: number, r1: number, c0: number, c1: number) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const fmt = (rg: unknown, f: Record<string, unknown>) => ({ repeatCell: { range: rg, cell: { userEnteredFormat: f }, fields: "userEnteredFormat(" + Object.keys(f).join(",") + ")" } });
  const req: unknown[] = [
    { unmergeCells: { range: range(0, 60, 0, 15) } },
    { updateSheetProperties: { properties: { sheetId: sid, index: 0, gridProperties: { hideGridlines: true } }, fields: "index,gridProperties.hideGridlines" } },
    { updateSheetProperties: { properties: { sheetId: sid, tabColorStyle: { rgbColor: GOLD } }, fields: "tabColorStyle" } },
    fmt(range(0, 1, 0, 15), title), { mergeCells: { range: range(0, 1, 0, 15), mergeType: "MERGE_ALL" } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 48 }, fields: "pixelSize" } },
    fmt(range(1, 2, 0, 15), { textFormat: { italic: true, fontSize: 9, foregroundColorStyle: { rgbColor: rgb("#5b6472") } } }),
    fmt(range(1, 2, 10, 11), { numberFormat: { type: "DATE_TIME", pattern: "d/m/yyyy hh:mm" }, textFormat: { fontSize: 9, foregroundColorStyle: { rgbColor: rgb("#5b6472") } } }),
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 24 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 1, endIndex: 15 }, properties: { pixelSize: 112 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 11, endIndex: 12 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 8, endIndex: 9 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 12, endIndex: 13 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
    // K es la primera columna del tile "Ventas totales" (K:L, con L como
    // separador estrecho): ancha para que el importe no se corte.
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 10, endIndex: 11 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
  ];
  // Tiles: etiqueta arriba, valor grande abajo, fondo dorado claro con borde.
  for (const [r0, defs] of [[3, tiles], [6, tiles2]] as Array<[number, Array<[string, string]>]>) {
    defs.forEach((_, i) => {
      const c0 = 1 + i * 3;
      req.push(
        fmt(range(r0, r0 + 2, c0, c0 + 2), { backgroundColorStyle: { rgbColor: rgb("#f6efd9") } }),
        fmt(range(r0, r0 + 1, c0, c0 + 1), label),
        fmt(range(r0 + 1, r0 + 2, c0, c0 + 1), value),
        { mergeCells: { range: range(r0, r0 + 1, c0, c0 + 2), mergeType: "MERGE_ALL" } },
        { mergeCells: { range: range(r0 + 1, r0 + 2, c0, c0 + 2), mergeType: "MERGE_ALL" } },
        { updateBorders: { range: range(r0, r0 + 2, c0, c0 + 2), left: { style: "SOLID_THICK", colorStyle: { rgbColor: GOLD } } } }
      );
    });
    req.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: "ROWS", startIndex: r0 + 1, endIndex: r0 + 2 }, properties: { pixelSize: 40 }, fields: "pixelSize" } });
  }
  // Importes de los tiles de dinero.
  req.push(fmt(range(4, 5, 1, 2), money), fmt(range(4, 5, 7, 8), money), fmt(range(4, 5, 10, 11), money));
  // Secciones y tablas.
  req.push(
    fmt(range(M0, M0 + 1, 1, 7), section), fmt(range(M0 + 1, M0 + 2, 1, 7), head),
    fmt(range(M0 + 2, M0 + 14, 3, 5), money), fmt(range(M0 + 2, M0 + 14, 1, 7), { textFormat: { fontSize: 10 } }),
    fmt(range(M0 + 2, M0 + 14, 1, 2), { numberFormat: { type: "DATE", pattern: "mmm yyyy" }, textFormat: { bold: true, fontSize: 10 } }),
    { updateBorders: { range: range(M0 + 1, M0 + 14, 1, 7), innerHorizontal: { style: "SOLID", colorStyle: { rgbColor: rgb("#d9dee7") } } } },
    fmt(range(B0, B0 + 1, BC, BC + 3), section), fmt(range(B0 + 1, B0 + 2, BC, BC + 3), head), fmt(range(B0 + 2, B0 + 12, BC + 2, BC + 3), money),
    { updateBorders: { range: range(B0 + 1, B0 + 12, BC, BC + 3), innerHorizontal: { style: "SOLID", colorStyle: { rgbColor: rgb("#d9dee7") } } } },
    fmt(range(S0, S0 + 1, SC, SC + 3), section), fmt(range(S0 + 1, S0 + 2, SC, SC + 2), head),
    { updateBorders: { range: range(S0 + 1, S0 + 2 + STATES.length, SC, SC + 2), innerHorizontal: { style: "SOLID", colorStyle: { rgbColor: rgb("#d9dee7") } } } },
    fmt(range(T0, T0 + 1, TC, TC + 3), section), fmt(range(T0 + 1, T0 + 2, TC, TC + 3), head), fmt(range(T0 + 2, T0 + 6, TC + 2, TC + 3), money),
    { updateBorders: { range: range(T0 + 1, T0 + 6, TC, TC + 3), innerHorizontal: { style: "SOLID", colorStyle: { rgbColor: rgb("#d9dee7") } } } }
  );
  // Gráficos: se recrean en cada arranque (así siguen a la disposición actual).
  for (const ch of (dash.charts ?? []) as Array<{ chartId?: number }>) {
    if (ch.chartId !== undefined) req.push({ deleteEmbeddedObject: { objectId: ch.chartId } });
  }
  {
    const src = (r0: number, r1: number, col: number) => ({ sourceRange: { sources: [{ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: col, endColumnIndex: col + 1 }] } });
    req.push(
      {
        addChart: {
          chart: {
            spec: {
              title: "Ventas por mes (USD)",
              titleTextFormat: { bold: true, foregroundColorStyle: { rgbColor: NAVY } },
              basicChart: {
                chartType: "COLUMN", legendPosition: "NO_LEGEND", headerCount: 1,
                domains: [{ domain: src(M0 + 1, M0 + 14, 1) }],
                series: [{ series: src(M0 + 1, M0 + 14, 3), targetAxis: "LEFT_AXIS", colorStyle: { rgbColor: NAVY } }],
              },
            },
            position: { overlayPosition: { anchorCell: { sheetId: sid, rowIndex: CH, columnIndex: 1 }, widthPixels: 600, heightPixels: 320 } },
          },
        },
      },
      {
        addChart: {
          chart: {
            spec: {
              title: "Pedidos por estado",
              titleTextFormat: { bold: true, foregroundColorStyle: { rgbColor: NAVY } },
              pieChart: { legendPosition: "RIGHT_LEGEND", domain: src(S0 + 1, S0 + 2 + STATES.length, SC), series: src(S0 + 1, S0 + 2 + STATES.length, SC + 1), pieHole: 0.5 },
            },
            position: { overlayPosition: { anchorCell: { sheetId: sid, rowIndex: CH, columnIndex: 8 }, widthPixels: 460, heightPixels: 320 } },
          },
        },
      }
    );
  }
  await batchUpdate(cfg, req);
}

// ── Buscador ─────────────────────────────────────────────────────────────────

/**
 * Pestaña "Buscar": campos de búsqueda (pedido, cliente, teléfono, marca,
 * estado, fechas) y una sola fórmula que filtra el Historial con todos los
 * criterios a la vez. Por defecto muestra el ÚLTIMO evento de cada pedido (su
 * estado actual); el selector "Mostrar" permite ver todos los eventos. Se
 * reescribe en cada arranque; lo que el dueño teclee en los campos se conserva.
 */
async function ensureSearchSheet(cfg: GsheetConfig, sheets: SheetMeta[]): Promise<void> {
  let sheet = sheets.find((s) => s.properties?.title === SEARCH_SHEET);
  if (!sheet) {
    const [reply] = await batchUpdate(cfg, [
      { addSheet: { properties: { title: SEARCH_SHEET, index: 1, gridProperties: { rowCount: 500, columnCount: 26, hideGridlines: true } } } },
    ]);
    sheet = { properties: { sheetId: Number(reply?.addSheet?.properties?.sheetId ?? 0), title: SEARCH_SHEET } };
  }
  const sid = sheet.properties?.sheetId ?? 0;
  const H = quoteSheet(HISTORY_SHEET);
  const hc = (key: string) => `${H}!$${hcol(key)}$2:$${hcol(key)}`;
  const ALL = `${H}!$A$2:$${columnLetter(HISTORY_COLUMNS.length - 1)}`;

  // Campos (fila 5, 1-based): B pedido, C cliente, D teléfono, E marca, F estado, G desde, H hasta, I mostrar.
  const SHOW_LAST = "Último estado por pedido";
  const SHOW_ALL = "Todos los eventos";
  const RESULT_KEYS = ["at", "order", "event", "status", "type", "customer", "email", "phone", "city", "brand", "model", "color", "lenses", "rx", "delivery", "tracking", "total", "paid"];
  const cols = RESULT_KEYS.map((k) => HISTORY_COLUMNS.findIndex((c) => c.key === k) + 1).join(",");
  const cond =
    `(${hc("order")}<>"")` +
    `*(($B$5="")+(${hc("order")}="#"&SUBSTITUTE($B$5,"#","")))` +
    `*(($C$5="")+ISNUMBER(SEARCH($C$5,${hc("customer")})))` +
    `*(($D$5="")+ISNUMBER(SEARCH(REGEXREPLACE(TO_TEXT($D$5),"\\D",""),REGEXREPLACE(TO_TEXT(${hc("phone")}),"\\D",""))))` +
    `*(($E$5="")+ISNUMBER(SEARCH($E$5,${hc("brand")})))` +
    `*(($F$5="")+(${hc("status")}=$F$5))` +
    `*(($G$5="")+(${hc("at")}>=IF($G$5="",0,$G$5)))` +
    `*(($H$5="")+(${hc("at")}<IF($H$5="",9^9,$H$5+1)))`;
  const sorted = `SORT(FILTER(${ALL},${cond}),1,FALSE)`;
  const orderIdx = HISTORY_COLUMNS.findIndex((c) => c.key === "order") + 1;
  const formula = `=IFERROR(CHOOSECOLS(IF($I$5="${SHOW_ALL}",${sorted},SORT(SORTN(${sorted},9^9,2,${orderIdx},TRUE),1,FALSE)),${cols}),"Sin resultados")`;

  const labels = ["Pedido #", "Cliente", "Teléfono", "Marca", "Estado", "Desde (fecha)", "Hasta (fecha)", "Mostrar"];
  const headers = RESULT_KEYS.map((k) => HISTORY_COLUMNS.find((c) => c.key === k)!.name);
  // Se conservan los valores que el dueño tenga escritos en los campos.
  const current = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${SEARCH_SHEET}!B5:I5`)}`);
  const kept = current.ok ? (((await current.json()) as { values?: unknown[][] }).values?.[0] ?? []) : [];
  const inputs = labels.map((_, i) => (kept[i] ?? "") as string | number);
  if (!inputs[7]) inputs[7] = SHOW_LAST;

  const rows: (string | number)[][] = [];
  rows[0] = ["Buscar pedidos"];
  rows[1] = ["Escribe en uno o varios campos (se combinan) y los resultados se filtran solos. Deja un campo vacío para no filtrar por él. Las fechas: d/m/aaaa."];
  rows[3] = ["", ...labels];
  rows[4] = ["", ...inputs];
  rows[6] = ["", `="Resultados: "&IF(ISNUMBER(A9),COUNTA($A$9:$A),0)`];
  // Listas para el autocompletado de los campos (columnas V..Y, ocultas): se
  // calculan solas a partir del Historial, y cada campo las usa como
  // desplegable no estricto (se puede elegir o escribir libre).
  const LC = 21; // V
  const listOf = (key: string) => {
    const r = hc(key);
    return `=IFERROR(SORT(UNIQUE(FILTER(${r},${r}<>""))),"")`;
  };
  const orderList = `=IFERROR(ARRAYFORMULA("#"&SORT(UNIQUE(VALUE(SUBSTITUTE(FILTER(${hc("order")},${hc("order")}<>""),"#",""))),1,FALSE)),"")`;
  const brandList = `=IFERROR(LET(b,TRIM(FLATTEN(SPLIT(FILTER(${hc("brand")},${hc("brand")}<>""),"|"))),SORT(UNIQUE(FILTER(b,b<>"")))),"")`;
  const lists: Array<[string, string, number]> = [
    ["Pedidos", orderList, 1],
    ["Clientes", listOf("customer"), 2],
    ["Teléfonos", listOf("phone"), 3],
    ["Marcas", brandList, 4],
  ];
  rows[7] = [...headers, ...Array(LC - headers.length).fill(""), ...lists.map((l) => l[0])];
  rows[8] = [formula, ...Array(LC - 1).fill(""), ...lists.map((l) => l[1])];
  // `rows` tiene huecos a propósito (filas vacías de separación): Array.map los
  // salta y la API los descartaría, desplazando todo hacia arriba — se rellenan.
  const grid = Array.from({ length: 9 }, (_, i) => (rows[i] ?? []).map((v) => v ?? ""));
  const clear = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${SEARCH_SHEET}!A1:Z9`)}:clear`, { method: "POST", body: "{}" });
  if (!clear.ok) throw await failure("clear search", clear);
  const write = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${SEARCH_SHEET}!A1`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: grid.map((r) => (r.length ? r : [""])) }),
  });
  if (!write.ok) throw await failure("write search", write);

  const range = (r0: number, r1: number, c0: number, c1: number) => ({ sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const fmt = (rg: unknown, f: Record<string, unknown>) => ({ repeatCell: { range: rg, cell: { userEnteredFormat: f }, fields: "userEnteredFormat(" + Object.keys(f).join(",") + ")" } });
  const n = headers.length;
  const list = (values: string[]) => ({ condition: { type: "ONE_OF_LIST", values: values.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false });
  const req: unknown[] = [
    { unmergeCells: { range: range(0, 9, 0, 20) } },
    { updateSheetProperties: { properties: { sheetId: sid, index: 1, tabColorStyle: { rgbColor: NAVY }, gridProperties: { frozenRowCount: 8, hideGridlines: true, columnCount: 26 } }, fields: "index,tabColorStyle,gridProperties(frozenRowCount,hideGridlines,columnCount)" } },
    // Listas de autocompletado (V..Y): columnas ocultas; cada campo del
    // buscador es un desplegable no estricto sobre su lista.
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: LC, endIndex: LC + lists.length }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
    ...lists.map(([, , inputCol], i) => ({
      setDataValidation: {
        range: range(4, 5, inputCol, inputCol + 1),
        rule: { condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: `=${quoteSheet(SEARCH_SHEET)}!$${columnLetter(LC + i)}$9:$${columnLetter(LC + i)}` }] }, showCustomUi: true, strict: false },
      },
    })),
    fmt(range(0, 1, 0, n), { backgroundColorStyle: { rgbColor: NAVY }, textFormat: { bold: true, fontSize: 18, foregroundColorStyle: { rgbColor: WHITE } }, verticalAlignment: "MIDDLE" }),
    { mergeCells: { range: range(0, 1, 0, n), mergeType: "MERGE_ALL" } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 46 }, fields: "pixelSize" } },
    fmt(range(1, 2, 0, n), { textFormat: { italic: true, fontSize: 9, foregroundColorStyle: { rgbColor: rgb("#5b6472") } } }),
    { mergeCells: { range: range(1, 2, 0, n), mergeType: "MERGE_ALL" } },
    fmt(range(3, 4, 1, 9), { textFormat: { bold: true, fontSize: 9, foregroundColorStyle: { rgbColor: rgb("#8a7340") } } }),
    fmt(range(4, 5, 1, 9), { backgroundColorStyle: { rgbColor: rgb("#f6efd9") }, textFormat: { bold: true, fontSize: 11, foregroundColorStyle: { rgbColor: NAVY } }, verticalAlignment: "MIDDLE", horizontalAlignment: "LEFT" }),
    { updateBorders: { range: range(4, 5, 1, 9), top: { style: "SOLID", colorStyle: { rgbColor: GOLD } }, bottom: { style: "SOLID", colorStyle: { rgbColor: GOLD } }, left: { style: "SOLID", colorStyle: { rgbColor: GOLD } }, right: { style: "SOLID", colorStyle: { rgbColor: GOLD } }, innerVertical: { style: "SOLID", colorStyle: { rgbColor: GOLD } } } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "ROWS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
    fmt(range(4, 5, 6, 8), { numberFormat: { type: "DATE", pattern: "d/m/yyyy" } }),
    { setDataValidation: { range: range(4, 5, 5, 6), rule: list([...Object.values(STAGE_LABEL), ...Object.values(TERMINAL_LABEL)]) } },
    { setDataValidation: { range: range(4, 5, 8, 9), rule: { ...list([SHOW_LAST, SHOW_ALL]), strict: true } } },
    { setDataValidation: { range: range(4, 5, 6, 8), rule: { condition: { type: "DATE_IS_VALID" }, strict: false } } },
    fmt(range(6, 7, 1, 2), { textFormat: { bold: true, fontSize: 11, foregroundColorStyle: { rgbColor: NAVY } } }),
    fmt(range(7, 8, 0, n), { backgroundColorStyle: { rgbColor: NAVY }, textFormat: { bold: true, fontSize: 10, foregroundColorStyle: { rgbColor: WHITE } }, verticalAlignment: "MIDDLE", wrapStrategy: "WRAP" }),
    { updateBorders: { range: range(7, 8, 0, n), bottom: { style: "SOLID_MEDIUM", colorStyle: { rgbColor: GOLD } } } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: "ROWS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
    fmt(range(8, 500, 0, n), { backgroundColorStyle: { rgbColor: WHITE }, wrapStrategy: "CLIP", verticalAlignment: "TOP", textFormat: { bold: false, fontSize: 10, foregroundColorStyle: { rgbColor: rgb("#1e2733") } } }),
    fmt(range(8, 500, 0, 1), { numberFormat: { type: "DATE_TIME", pattern: "d/m/yyyy hh:mm" } }),
    fmt(range(8, 500, 1, 2), { textFormat: { bold: true, fontSize: 10, foregroundColorStyle: { rgbColor: NAVY } } }),
    fmt(range(8, 500, 16, 17), { numberFormat: { type: "NUMBER", pattern: "#,##0.00" }, horizontalAlignment: "RIGHT" }),
    ...RESULT_KEYS.map((k, i) => ({
      updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: Math.max(90, HISTORY_COLUMNS.find((c) => c.key === k)!.width) }, fields: "pixelSize" },
    })),
  ];
  // Bandas y chips de estado en los resultados (reglas reemplazadas, no acumuladas).
  const rules = (sheet.conditionalFormats ?? []).length;
  for (let i = rules - 1; i >= 0; i--) req.push({ deleteConditionalFormatRule: { sheetId: sid, index: i } });
  req.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [range(8, 500, 0, n)],
        booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: "=AND(ISEVEN(ROW()),$A9<>\"\")" }] }, format: { backgroundColorStyle: { rgbColor: BAND_2 } } },
      },
    },
  });
  const statusCol = RESULT_KEYS.indexOf("status");
  for (const [label, bg, fg] of STATUS_COLORS) {
    req.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [range(8, 500, statusCol, statusCol + 1)],
          booleanRule: { condition: { type: "TEXT_EQ", values: [{ userEnteredValue: label }] }, format: { backgroundColorStyle: { rgbColor: rgb(bg) }, textFormat: { bold: true, foregroundColorStyle: { rgbColor: rgb(fg) } } } },
        },
      },
    });
  }
  await batchUpdate(cfg, req);
}

function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const quoteSheet = (title: string) => `'${title.replace(/'/g, "''")}'`;

type Cell = string | number;

/** Enlace dentro del texto de una celda (índices de carácter, fin excluido). */
export interface CellLink { start: number; end: number; uri: string }

/**
 * Celda con varios enlaces: texto plano + runs de formato. Cada run fija el
 * formato hasta el siguiente, así que los tramos sin enlace se declaran
 * explícitamente para que el enlace anterior no "siga" hasta el final.
 */
export function richTextCell(text: string, links: CellLink[]): Record<string, unknown> {
  const plainRun = (startIndex: number) => ({ startIndex, format: { underline: false, foregroundColorStyle: { rgbColor: rgb("#1e2733") } } });
  const runs: unknown[] = [];
  let at = 0;
  for (const l of [...links].sort((a, b) => a.start - b.start)) {
    if (l.start > at) runs.push(plainRun(at));
    runs.push({ startIndex: l.start, format: { link: { uri: l.uri }, underline: true, bold: true, foregroundColorStyle: { rgbColor: NAVY } } });
    at = l.end;
  }
  if (at < text.length) runs.push(plainRun(at));
  return { userEnteredValue: { stringValue: text }, textFormatRuns: runs };
}

async function upsertOrderRow(
  cfg: GsheetConfig,
  table: OrdersTable,
  row: Cell[],
  rich?: { col: number; links: CellLink[] }
): Promise<void> {
  const key = String(row[0]);
  const from = columnLetter(table.startCol);
  const to = columnLetter(table.startCol + row.length - 1);
  const write = async (rowNumber: number) => {
    const range = `${quoteSheet(table.sheetTitle)}!${from}${rowNumber}:${to}${rowNumber}`;
    const resp = await sheetsFetch(cfg, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [row] }),
    });
    if (!resp.ok) throw await failure(`write row ${rowNumber}`, resp);
    // Enlaces dentro de la celda (p. ej. Archivo): texto con runs, por encima
    // del valor plano que acaba de escribirse.
    if (rich && rich.links.length) {
      await batchUpdate(cfg, [
        {
          updateCells: {
            range: { sheetId: table.sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: table.startCol + rich.col, endColumnIndex: table.startCol + rich.col + 1 },
            rows: [{ values: [richTextCell(String(row[rich.col] ?? ""), rich.links)] }],
            fields: "userEnteredValue,textFormatRuns",
          },
        },
      ]);
    }
  };

  // Columna clave completa: localiza el pedido y, si no está, la primera fila
  // libre bajo el encabezado (dentro o justo debajo de la tabla).
  const resp = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${quoteSheet(table.sheetTitle)}!${from}:${from}`)}`);
  if (!resp.ok) throw await failure("read key column", resp);
  const values = ((await resp.json()) as { values?: string[][] }).values ?? [];
  let lastUsed = table.headerRow; // 0-based, última fila con contenido en la clave
  for (let i = table.headerRow + 1; i < values.length; i++) {
    const v = values[i]?.[0];
    if (v === key) {
      await write(i + 1);
      return;
    }
    if (v && String(v).trim()) lastUsed = i;
  }
  const target = lastUsed + 1; // 0-based
  await write(target + 1);

  // La tabla debe abarcar la fila nueva: así hereda bandas, desplegables y
  // filtros. (appendCells con tableId dejaba filas fuera de la tabla o no las
  // escribía; escribir por rango y ampliar la tabla es determinista.)
  if (target + 1 > table.endRow) {
    await batchUpdate(cfg, [
      {
        updateTable: {
          table: {
            tableId: table.tableId,
            range: { sheetId: table.sheetId, startRowIndex: table.headerRow, endRowIndex: target + 1, startColumnIndex: table.startCol, endColumnIndex: table.startCol + ORDER_COLUMNS.length },
          },
          fields: "range",
        },
      },
    ]);
    table.endRow = target + 1;
  }
}

async function appendHistoryRow(cfg: GsheetConfig, row: unknown[]): Promise<void> {
  const resp = await sheetsFetch(
    cfg,
    `/values/${encodeURIComponent(`${HISTORY_SHEET}!A1`)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`,
    { method: "POST", body: JSON.stringify({ values: [row] }) }
  );
  if (!resp.ok) throw await failure("append history", resp);
}

// ── Construcción de la fila desde el pedido ──────────────────────────────────

/**
 * Campos del pedido para la hoja. Se leen con `getOrdersListWorkflow`, no con
 * `query.graph`: los totales solo salen bien cuando vienen las relaciones de
 * las que se suman (items.detail, tax_lines, adjustments, shipping_methods,
 * credit_lines), y `payment_status` / `fulfillment_status` NO existen en el
 * grafo de `order` — con query.graph llegan `undefined`, que se lee como "no
 * pagado": así salieron pedidos a 0,00 y "Pago pendiente" en la hoja.
 */
const ORDER_SHEET_FIELDS = [
  "id", "status", "display_id", "email", "currency_code", "created_at", "metadata", "locale",
  "total", "subtotal", "discount_total", "shipping_total", "tax_total", "item_total", "item_subtotal",
  "items.*", "items.detail.*", "items.tax_lines.*", "items.adjustments.*",
  "shipping_methods.*", "shipping_methods.tax_lines.*", "shipping_methods.adjustments.*",
  "credit_lines.*",
  "shipping_address.*",
  "fulfillments.id", "fulfillments.created_at", "fulfillments.packed_at", "fulfillments.shipped_at",
  "fulfillments.delivered_at", "fulfillments.canceled_at", "fulfillments.labels.*",
];

/** Pedido con totales y estados calculados (ver ORDER_SHEET_FIELDS). */
async function loadOrderForSheet(container: MedusaContainer, orderId: string): Promise<Record<string, any> | undefined> {
  const { result } = await getOrdersListWorkflow(container).run({
    input: { fields: ORDER_SHEET_FIELDS, variables: { filters: { id: orderId }, skip: 0, take: 1 } },
  });
  const rows = (Array.isArray(result) ? result : (result as any).rows) as Array<Record<string, any>>;
  return rows?.[0];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function money(v: unknown): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/**
 * Fecha como número de serie de Sheets (días desde 30/12/1899), del día de la
 * compra en GSHEET_TIMEZONE: la columna es de tipo fecha, así que ordena y
 * filtra como fecha, no como texto.
 */
export function sheetDateSerial(value: string | Date, timeZone = process.env.GSHEET_TIMEZONE || "UTC"): number | "" {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000 + 25_569;
}

/** Fecha y hora como número de serie de Sheets (con fracción de día) en GSHEET_TIMEZONE. */
export function sheetDateTimeSerial(value: string | Date, timeZone = process.env.GSHEET_TIMEZONE || "UTC"): number | "" {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  let parts: Intl.DateTimeFormatPart[];
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false };
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).formatToParts(d);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const hour = get("hour") % 24; // "24" a medianoche en algunos motores
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second")) / 86_400_000 + 25_569;
}

/** "yyyy-mm" del instante en GSHEET_TIMEZONE (columna Mes del Historial). */
export function sheetMonth(value: string | Date, timeZone = process.env.GSHEET_TIMEZONE || "UTC"): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit" }).formatToParts(d);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

export interface RxEyeValues {
  sph: number | null;
  cyl: number | null;
  axis: number | null;
  add: number | null;
  prism: number | null;
  base: string | null;
}

/**
 * Lo que la hoja copia de cada receta del pedido: los valores leídos y su origen,
 * más señales (prueba virtual, documento original guardado) sin el documento.
 */
export interface RxSheetInfo {
  od?: RxEyeValues;
  os?: RxEyeValues;
  pd?: number | null;
  pd_od?: number | null;
  pd_os?: number | null;
  seg_height?: number | null;
  source?: string | null;
  verified_by_user?: boolean;
  patient_for?: string | null;
  patient_name?: string | null;
  measurement_source?: string | null;
  measurement_quality?: string | null;
  has_tryon: boolean;
  has_file: boolean;
}

export interface SheetLineDetail {
  frame_name: string;
  brand?: string | null;
  sku?: string | null;
  /** Medidas ópticas "52□16-140" (ojo□puente-varilla) si el catálogo las trae. */
  size?: string | null;
  /** Slug/handle de la ficha del producto en la tienda (/producto/<handle>). */
  handle?: string | null;
  color: string | null;
  quantity: number;
  design: string | null;
  material: string | null;
  photo: string | null;
  ar: string | null;
  with_rx: boolean;
  total: number;
}

/** Dioptrías con signo explícito; vacío como guion, igual que en los correos. */
const dpt = (v: number | null | undefined): string =>
  v == null ? "—" : v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
const plain = (v: number | string | null | undefined): string =>
  v == null || v === "" ? "—" : String(v);

/** Valores leídos de una receta, en texto para una celda. */
export function rxValuesText(rx: RxSheetInfo): string | null {
  if (!rx.od && !rx.os) return null;
  const eye = (label: string, e?: RxEyeValues) =>
    e
      ? `${label}: SPH ${dpt(e.sph)} CYL ${dpt(e.cyl)} AXIS ${plain(e.axis)} ADD ${dpt(e.add)}` +
        (e.prism != null || e.base ? ` PRISMA ${dpt(e.prism)} BASE ${plain(e.base)}` : "")
      : `${label}: —`;
  const pd =
    rx.pd != null
      ? `${plain(rx.pd)} mm`
      : rx.pd_od != null || rx.pd_os != null
        ? `OD ${plain(rx.pd_od)} / OS ${plain(rx.pd_os)} mm`
        : "—";
  const origin =
    rx.source === "ocr" ? "leída por OCR de la foto" : "ingresada por el cliente";
  const confirmed = rx.verified_by_user ? ", confirmada por el cliente" : "";
  const measures = [`DIP ${pd}`];
  if (rx.seg_height != null) measures.push(`Altura ${plain(rx.seg_height)} mm`);
  return [
    `Receta (${origin}${confirmed}):`,
    eye("OD", rx.od),
    eye("OS", rx.os),
    measures.join(" · "),
  ].join("\n");
}

export function orderType(items: Array<Record<string, any>>): string {
  const kinds = new Set(
    items.map((it) => {
      const md = (it.metadata ?? {}) as Record<string, any>;
      if (md["prescription_id"]) return "rx";
      const design = md["lens_config"]?.["design_code"];
      return design && design !== "frame-only" ? "lenses" : "frame";
    })
  );
  if (kinds.size > 1) return ORDER_TYPE.mixed;
  const [only] = [...kinds];
  return only === "rx" ? ORDER_TYPE.rx : only === "lenses" ? ORDER_TYPE.lenses : ORDER_TYPE.frame;
}

export function buildRows(
  order: Record<string, any>,
  event: string,
  extra: {
    tracking?: { number?: string | null; url?: string | null };
    lines?: SheetLineDetail[];
    rx?: RxSheetInfo[];
    adminUrl?: string;
    payment?: PaymentInfo | null;
  } = {}
) {
  const md = (order.metadata ?? {}) as Record<string, unknown>;
  const addr = (order.shipping_address ?? {}) as Record<string, any>;
  const progress = deriveOrderProgress(order as any);
  const items = (order.items ?? []) as Array<Record<string, any>>;
  const currency = String(order.currency_code ?? "").toUpperCase();

  const labels = ((order.fulfillments ?? []) as Array<Record<string, any>>)
    .flatMap((f) => (f.labels ?? []) as Array<Record<string, any>>);
  const trackingNumber =
    extra.tracking?.number ||
    (labels.map((l) => l.tracking_number).find(Boolean) as string | undefined) ||
    (md["tracking_number"] as string | undefined) || "";
  const trackingUrl =
    extra.tracking?.url ||
    (labels.map((l) => l.tracking_url).find(Boolean) as string | undefined) ||
    (md["tracking_url"] as string | undefined) || "";

  const carrier =
    (md["shipping_carrier_label"] as string | undefined) ||
    ((order.shipping_methods ?? [])[0]?.name as string | undefined) || "";

  const now = new Date().toISOString();
  const displayId = order.display_id != null ? `#${order.display_id}` : String(order.id ?? "");

  // Detalles: cada par con su configuración, luego los importes.
  const lineText = extra.lines?.length
    ? extra.lines.map((l) => {
        const lens = [l.design, l.material, l.photo, l.ar].filter(Boolean).join(", ");
        return (
          `${l.quantity}× ${l.frame_name}${l.color ? ` (${l.color})` : ""}` +
          (lens ? ` — ${lens}` : "") +
          (l.with_rx ? " [receta]" : "") +
          ` — ${money(l.total)} ${currency}`
        );
      })
    : items.map((it) => {
        const lens = (it.metadata ?? {})["lens_config"] ? " +lentes" : "";
        const rx = (it.metadata ?? {})["prescription_id"] ? " [receta]" : "";
        return `${it.quantity ?? 1}× ${it.title ?? "?"}${lens}${rx}`;
      });
  const amounts = [
    `Subtotal ${money(order.subtotal)}`,
    Number(order.discount_total ?? 0) > 0 ? `Descuento -${money(order.discount_total)}` : "",
    `Envío ${money(order.shipping_total)}${carrier ? ` (${carrier})` : ""}`,
    `Impuestos ${money(order.tax_total)}`,
    `TOTAL ${money(order.total)} ${currency}`,
  ].filter(Boolean);
  const details = [...lineText, amounts.join(" · ")].join("\n");

  // Cliente: los datos del comprador.
  const name = [addr.first_name, addr.last_name].filter(Boolean).join(" ");
  const phone = String((md["phone"] as string | undefined) || addr.phone || "");
  const cityLine = [addr.postal_code, addr.city, addr.province].filter(Boolean).join(" ");
  const customer = [
    name,
    String(order.email ?? ""),
    phone ? `Tel. ${phone}` : "",
    [addr.address_1, addr.address_2].filter(Boolean).join(", "),
    [cityLine, String(addr.country_code ?? "").toUpperCase()].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join("\n");

  const status = progress.terminal ? TERMINAL_LABEL[progress.terminal] : STAGE_LABEL[progress.stage];

  // Archivo: referencias con enlace (texto limpio, sin URL a la vista). Cada
  // montura abre su ficha en la tienda (medidas y fotos); la receta y la foto
  // de la prueba virtual abren el pedido en el panel, que ya las muestra.
  // Nada se copia aquí: la receta no sale del bucket privado.
  const rx = extra.rx ?? [];
  const hasTryon = rx.some((r) => r.has_tryon) || items.some((it) => Boolean((it.metadata ?? {})["tryon_image_key"]));
  const hasFile = rx.some((r) => r.has_file);
  const site = (extra.adminUrl ?? "").replace(/\/admin\/?$/, "");
  const panelUrl = extra.adminUrl ? `${extra.adminUrl}?tab=orders&order=${encodeURIComponent(String(order.id ?? ""))}` : "";
  const fileParts: Array<{ text: string; uri?: string }> = [];
  const lineRefs = extra.lines?.length
    ? extra.lines.map((l) => ({
        text: `Montura: ${l.frame_name}${l.color ? ` · ${l.color}` : ""}${l.size ? ` · ${l.size}` : ""}`,
        uri: site ? `${site}/producto/${encodeURIComponent((l.handle || l.frame_name).toLowerCase().replace(/\s+/g, "-"))}` : undefined,
      }))
    : items.map((it) => ({
        text: `Montura: ${String(it.title ?? "?")}`,
        uri: site && it["product_handle"] ? `${site}/producto/${encodeURIComponent(String(it["product_handle"]))}` : undefined,
      }));
  fileParts.push(...lineRefs);
  if (hasFile) fileParts.push({ text: "Receta: ver documento original", uri: panelUrl || undefined });
  if (hasTryon) fileParts.push({ text: "Foto: prueba virtual del cliente", uri: panelUrl || undefined });
  const fileCell = fileParts.map((p) => p.text).join("\n");
  const fileLinks: CellLink[] = [];
  {
    let at = 0;
    for (const p of fileParts) {
      if (p.uri) fileLinks.push({ start: at, end: at + p.text.length, uri: p.uri });
      at += p.text.length + 1;
    }
  }

  // Notas: valores leídos de la receta, para quién, medidas de IA, avisos,
  // tracking y último evento.
  const notes: string[] = [];
  for (const r of rx) {
    const values = rxValuesText(r);
    if (values) notes.push(values);
    if (r.patient_for === "other") notes.push(`Para: otra persona${r.patient_name ? ` (${r.patient_name})` : ""}`);
    else if (r.patient_for === "me") notes.push("Para: el comprador");
    if (r.measurement_source === "ai") {
      notes.push(`Medidas DIP/altura calculadas con IA${r.measurement_quality ? ` (confianza ${r.measurement_quality})` : ""}`);
    }
  }
  notes.push(
    `Avisos: email ${md["notify_email"] === false || md["notify_email"] === "false" ? "no" : "sí"}, ` +
      `SMS ${md["notify_sms"] === true || md["notify_sms"] === "true" ? "sí" : "no"}`
  );
  if (trackingNumber) notes.push(`Tracking: ${trackingNumber}${trackingUrl ? ` ${trackingUrl}` : ""}`);
  notes.push(`Último evento: ${event} (${now})`);

  const lines0 = extra.lines ?? [];
  const brandCell = [...new Set(lines0.map((l) => l.brand).filter((b): b is string => Boolean(b && b.trim())))].join(" | ");
  const isPaid = PAID_STATUSES.has(String(order.payment_status ?? ""));
  const orderRow: Cell[] = [
    displayId,
    orderType(items),
    details,
    customer,
    status,
    order.created_at ? sheetDateSerial(order.created_at) : "",
    Number(money(order.total)),
    isPaid ? "Sí" : "No",
    brandCell,
    hasTryon ? "Sí" : "No",
    fileCell,
    [...new Set(notes)].join("\n"),
  ];

  // Historial: una fila por evento con TODO el pedido, una columna por dato.
  const lines = extra.lines ?? [];
  const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.filter((x): x is string => Boolean(x && x.trim())))].join(" | ");
  const lensText = lines.length
    ? lines.map((l) => [l.design, l.material, l.photo, l.ar].filter(Boolean).join(", ") || "Solo montura").join(" | ")
    : items.map((it) => ((it.metadata ?? {})["lens_config"] ? "Con lentes" : "Solo montura")).join(" | ");
  const withRx = lines.length ? lines.some((l) => l.with_rx) : items.some((it) => Boolean((it.metadata ?? {})["prescription_id"]));
  const eyeText = (e?: RxEyeValues) =>
    e ? `SPH ${dpt(e.sph)} CYL ${dpt(e.cyl)} AXIS ${plain(e.axis)} ADD ${dpt(e.add)}` + (e.prism != null || e.base ? ` PRISMA ${dpt(e.prism)} BASE ${plain(e.base)}` : "") : "";
  const rx0 = rx[0];
  const pdText = rx0
    ? [
        rx0.pd != null ? `DIP ${plain(rx0.pd)} mm` : rx0.pd_od != null || rx0.pd_os != null ? `DIP OD ${plain(rx0.pd_od)} / OS ${plain(rx0.pd_os)} mm` : "",
        rx0.seg_height != null ? `Altura ${plain(rx0.seg_height)} mm` : "",
      ].filter(Boolean).join(" · ")
    : "";
  const rxSource = rx0
    ? [
        rx0.source === "ocr" ? "Leída por OCR de la foto" : "Ingresada por el cliente",
        rx0.verified_by_user ? "confirmada por el cliente" : "",
        rx0.measurement_source === "ai" ? `medidas por IA${rx0.measurement_quality ? ` (${rx0.measurement_quality})` : ""}` : "",
        rx0.patient_for === "other" ? `para ${rx0.patient_name || "otra persona"}` : rx0.patient_for === "me" ? "para el comprador" : "",
      ].filter(Boolean).join(", ")
    : "";
  const paid = isPaid;
  const pay = extra.payment;
  const payText = pay
    ? [pay.provider, pay.method !== "card" ? pay.method : "", pay.brand, pay.last4 ? `•••• ${pay.last4}` : ""].filter(Boolean).join(" ")
    : "";
  const terminalNote = progress.terminal ? `Estado terminal: ${TERMINAL_LABEL[progress.terminal]}` : "";
  const historyRow: Cell[] = [
    sheetDateTimeSerial(now),
    sheetMonth(order.created_at || now),
    displayId,
    eventLabel(event),
    status,
    orderType(items),
    name,
    String(order.email ?? ""),
    phone,
    [addr.address_1, addr.address_2].filter(Boolean).join(", "),
    String(addr.city ?? ""),
    String(addr.province ?? ""),
    String(addr.postal_code ?? ""),
    String(addr.country_code ?? "").toUpperCase(),
    carrier,
    trackingNumber ? (trackingUrl ? `${trackingNumber} ${trackingUrl}` : trackingNumber) : "",
    uniq(lines.map((l) => l.brand)),
    lines.length ? uniq(lines.map((l) => l.frame_name)) : uniq(items.map((it) => (it.product_title as string) || (it.title as string))),
    lines.length ? uniq(lines.map((l) => l.color)) : uniq(items.map((it) => it.variant_title as string)),
    uniq(lines.map((l) => l.sku)),
    lensText,
    withRx ? "Sí" : "No",
    rx0 ? eyeText(rx0.od) : "",
    rx0 ? eyeText(rx0.os) : "",
    pdText,
    rxSource,
    hasTryon ? "Sí" : "No",
    items.reduce((n, it) => n + Number(it.quantity ?? 1), 0),
    Number(money(order.subtotal)),
    Number(money(order.discount_total)),
    Number(money(order.shipping_total)),
    Number(money(order.tax_total)),
    Number(money(order.total)),
    currency,
    paid ? "Sí" : "No",
    payText,
    `email ${md["notify_email"] === false || md["notify_email"] === "false" ? "no" : "sí"} · SMS ${md["notify_sms"] === true || md["notify_sms"] === "true" ? "sí" : "no"}`,
    String(order.locale ?? md["locale"] ?? "es"),
    [terminalNote, hasFile ? "Receta original guardada (solo en el panel)" : ""].filter(Boolean).join(" · "),
    String(order.id ?? ""),
  ];

  return { orderRow, historyRow, fileLinks };
}

/** Datos extra de la fila (desglose de lentes, recetas sin valores). Mejor esfuerzo. */
async function loadRowExtras(
  container: MedusaContainer,
  order: Record<string, any>,
  logger: Logger
): Promise<{ lines?: SheetLineDetail[]; rx?: RxSheetInfo[]; payment?: PaymentInfo | null }> {
  let payment: PaymentInfo | null = null;
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "payment_collections.payments.provider_id", "payment_collections.payments.data"],
      filters: { id: order.id },
    });
    const payments = (((data?.[0] as any)?.payment_collections ?? []) as Array<any>).flatMap((pc) => pc?.payments ?? []);
    payment = await extractPaymentInfo(payments, process.env.STRIPE_SECRET_KEY);
  } catch (error) {
    logger.warn(`[gsheet] order ${order.id}: payment info unavailable (${(error as Error).message})`);
  }
  try {
    const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
    const items = (order.items ?? []) as Array<Record<string, any>>;
    const enriched = await enrichLensItems(pg, items, "es");
    const lines: SheetLineDetail[] = enriched.map((e) => ({
      frame_name: e.frame_name,
      brand: e.collection,
      sku: e.specs?.sku ?? null,
      size: e.specs?.size ?? null,
      handle: String((items.find((it) => it.title === e.frame_name) ?? items[enriched.indexOf(e)] ?? {})["product_handle"] ?? "") || null,
      color: e.color,
      quantity: e.quantity,
      design: e.design,
      material: e.material?.label ?? null,
      photo: e.photo?.label ?? null,
      ar: e.ar?.label ?? null,
      with_rx: e.with_rx,
      total: e.total,
    }));
    const ids = items.map((it) => (it.metadata ?? {})["prescription_id"]).filter(Boolean).map(String);
    const records = await loadPrescriptionRecords(pg, ids);
    const num = (v: unknown): number | null =>
      v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
    const eye = (p: "od" | "os", r: Record<string, unknown>): RxEyeValues => ({
      sph: num(r[`${p}_sph`]),
      cyl: num(r[`${p}_cyl`]),
      axis: num(r[`${p}_axis`]),
      add: num(r[`${p}_add`]),
      prism: num(r[`${p}_prism`]),
      base: (r[`${p}_base`] as string | null) ?? null,
    });
    // Solo los valores leídos; `file_url` (el documento original) se reduce a un
    // booleano y nunca se copia.
    const rx: RxSheetInfo[] = [...records.values()].map((r) => ({
      od: eye("od", r),
      os: eye("os", r),
      pd: num(r["pd"]),
      pd_od: num(r["pd_od"]),
      pd_os: num(r["pd_os"]),
      seg_height: num(r["seg_height"]),
      source: (r["source"] as string | null) ?? null,
      verified_by_user: Boolean(r["verified_by_user"]),
      patient_for: (r["patient_for"] as string | null) ?? null,
      patient_name: (r["patient_name"] as string | null) ?? null,
      measurement_source: (r["measurement_source"] as string | null) ?? null,
      measurement_quality: (r["measurement_quality"] as string | null) ?? null,
      has_tryon: Boolean(r["tryon_image_url"]),
      has_file: Boolean(r["file_url"]),
    }));
    return { lines, rx, payment };
  } catch (error) {
    logger.warn(`[gsheet] order ${order.id}: row details unavailable (${(error as Error).message})`);
    return { payment };
  }
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
  tracking?: { number?: string | null; url?: string | null },
  options: { history?: boolean } = {}
): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const cfg = gsheetConfig();
  if (!cfg) {
    logger.info(
      `[gsheet] not configured (GSHEET_FILE_URL / GSHEET_SERVICE_ACCOUNT_EMAIL / GSHEET_SERVICE_ACCOUNT_KEY) — order ${orderId} not mirrored.`
    );
    return;
  }
  const keyProblem = privateKeyProblem(cfg.privateKey);
  if (keyProblem) {
    logger.error(`[gsheet] order ${orderId} (${event}) could not be mirrored: ${keyProblem}`);
    return;
  }

  try {
    const order = await loadOrderForSheet(container, orderId);
    if (!order) {
      logger.warn(`[gsheet] order ${orderId} not found — nothing mirrored.`);
      return;
    }

    const table = await ensureSheets(cfg, logger);
    const extras = await loadRowExtras(container, order, logger);
    const { orderRow, historyRow, fileLinks } = buildRows(order, event, {
      tracking,
      ...extras,
      adminUrl: `${storefrontOrigin()}/admin`,
    });
    try {
      await upsertOrderRow(cfg, table, orderRow, { col: ocol("Archivo"), links: fileLinks });
    } catch (error) {
      // La tabla pudo haber sido borrada o renombrada: se vuelve a buscar (o
      // crear) en la próxima escritura.
      cachedTable = null;
      throw error;
    }
    if (options.history !== false) await appendHistoryRow(cfg, historyRow);
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

/**
 * Pone al día la hoja sin esperar a un pedido nuevo: asegura pestañas, estilo
 * y resumen, y da de alta en la tabla "Pedidos" cualquier pedido que falte
 * (p. ej. los que fallaron cuando la tabla no tenía títulos). Lo usa el job
 * programado; devuelve cuántos pedidos se añadieron.
 */
export async function backfillOrdersToSheet(container: MedusaContainer): Promise<number> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const cfg = gsheetConfig();
  if (!cfg || privateKeyProblem(cfg.privateKey)) return 0;
  try {
    const table = await ensureSheets(cfg, logger);
    const col = columnLetter(table.startCol);
    const resp = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${quoteSheet(table.sheetTitle)}!${col}:${col}`)}`);
    const values = resp.ok ? (((await resp.json()) as { values?: string[][] }).values ?? []) : [];
    const present = new Set(values.slice(table.headerRow + 1).map((r) => r?.[0]).filter(Boolean));

    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({ entity: "order", fields: ["id", "display_id"], pagination: { take: 500, order: { created_at: "ASC" } } });
    const all = (data ?? []) as Array<Record<string, any>>;
    const missing = all.filter((o) => !present.has(`#${o.display_id}`));
    for (const o of missing) await syncOrderToSheet(container, String(o.id), "resincronizado");
    // Los que ya están se refrescan en la tabla (estado, importes, tracking)
    // sin añadir filas al historial: así la tabla nunca se queda desfasada.
    for (const o of all) {
      if (!present.has(`#${o.display_id}`)) continue;
      await syncOrderToSheet(container, String(o.id), "refresco", undefined, { history: false });
    }
    if (missing.length) logger.info(`[gsheet] backfill: ${missing.length} pedido(s) añadidos a la hoja.`);
    return missing.length;
  } catch (error) {
    logger.warn(`[gsheet] backfill no realizado: ${(error as Error).message}`);
    return 0;
  }
}
