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

import { createSign } from "node:crypto";
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { deriveOrderProgress, type OrderStage, type OrderTerminalState } from "./order-status";
import { enrichLensItems } from "./email/order-enrich";
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

type ColumnType = "TEXT" | "DROPDOWN" | "DATE";
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
  { name: "Detalles", type: "TEXT", width: 340, wrap: true },
  { name: "Cliente", type: "TEXT", width: 260, wrap: true },
  {
    name: "Estado",
    type: "DROPDOWN",
    options: [...Object.values(STAGE_LABEL), ...Object.values(TERMINAL_LABEL)],
    width: 150,
  },
  { name: "Fecha de compra", type: "DATE", width: 130 },
  { name: "Archivo", type: "TEXT", width: 220, wrap: true },
  { name: "Notas", type: "TEXT", width: 300, wrap: true },
];

/** Colores de la plantilla: encabezado granate, filas alternas blanco / gris. */
const HEADER_COLOR = { red: 158 / 255, green: 53 / 255, blue: 65 / 255 };
const BAND_1 = { red: 1, green: 1, blue: 1 };
const BAND_2 = { red: 246 / 255, green: 247 / 255, blue: 249 / 255 };

/** Columnas de la pestaña Historial (una fila por evento, append). */
const HISTORY_HEADERS = [
  "Fecha/hora", "Pedido #", "Order ID", "Evento", "Estado", "Total", "Moneda", "Tracking", "Detalle",
];

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

export function gsheetConfig(): GsheetConfig | null {
  const spreadsheetId =
    spreadsheetIdFrom(process.env.GSHEET_FILE_URL) ??
    spreadsheetIdFrom(process.env.GSHEET_SPREADSHEET_ID);
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
}

interface SheetMeta {
  properties?: { sheetId?: number; title?: string };
  tables?: Array<{
    tableId?: string;
    name?: string;
    range?: { startRowIndex?: number; startColumnIndex?: number };
  }>;
}

async function readSheetsMeta(cfg: GsheetConfig): Promise<SheetMeta[]> {
  const resp = await sheetsFetch(
    cfg,
    `?fields=${encodeURIComponent("sheets(properties(sheetId,title),tables(tableId,name,range))")}`
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
          columnProperties: ORDER_COLUMNS.map((c, columnIndex) => ({
            columnIndex,
            columnName: c.name,
            columnType: c.type,
            ...(c.type === "DROPDOWN"
              ? {
                  dataValidationRule: {
                    condition: {
                      type: "ONE_OF_LIST",
                      values: (c.options ?? []).map((v) => ({ userEnteredValue: v })),
                    },
                  },
                }
              : {}),
          })),
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
  if (tableId) return { tableId, sheetId, sheetTitle: title, headerRow: 0, startCol: 0 };
  const found = findOrdersTable(await readSheetsMeta(cfg));
  if (!found) throw new Error("addTable: the table was not found after creating it");
  return found;
}

/**
 * Localiza (o crea) la tabla de pedidos y la pestaña de historial. Se cachea por
 * proceso; si el dueño borra la tabla, el siguiente fallo de escritura la
 * invalida y se vuelve a crear en el siguiente pedido.
 */
let cachedTable: OrdersTable | null = null;
let historyEnsured = false;

async function ensureSheets(cfg: GsheetConfig): Promise<OrdersTable> {
  if (cachedTable && historyEnsured) return cachedTable;
  const sheets = await readSheetsMeta(cfg);

  const table = findOrdersTable(sheets) ?? (await createOrdersTable(cfg, sheets));

  if (!historyEnsured) {
    const titles = new Set(sheets.map((s) => s.properties?.title ?? ""));
    if (!titles.has(HISTORY_SHEET)) {
      await batchUpdate(cfg, [{ addSheet: { properties: { title: HISTORY_SHEET } } }]);
    }
    const head = await sheetsFetch(cfg, `/values/${encodeURIComponent(`${HISTORY_SHEET}!1:1`)}`);
    const rows = head.ok ? ((await head.json()) as { values?: string[][] }).values : null;
    if (!rows?.length) {
      const resp = await sheetsFetch(
        cfg,
        `/values/${encodeURIComponent(`${HISTORY_SHEET}!A1`)}?valueInputOption=RAW`,
        { method: "PUT", body: JSON.stringify({ values: [HISTORY_HEADERS] }) }
      );
      if (!resp.ok) throw await failure(`headers ${HISTORY_SHEET}`, resp);
    }
    historyEnsured = true;
  }

  cachedTable = table;
  return table;
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

/** Fila (1-based) del pedido dentro de la tabla, buscando en la columna "Pedido". */
async function findOrderRow(cfg: GsheetConfig, table: OrdersTable, key: string): Promise<number | null> {
  const col = columnLetter(table.startCol);
  const resp = await sheetsFetch(
    cfg,
    `/values/${encodeURIComponent(`${quoteSheet(table.sheetTitle)}!${col}:${col}`)}`
  );
  if (!resp.ok) return null;
  const values = ((await resp.json()) as { values?: string[][] }).values ?? [];
  for (let i = table.headerRow + 1; i < values.length; i++) {
    if (values[i]?.[0] === key) return i + 1;
  }
  return null;
}

type Cell = string | number;

async function upsertOrderRow(cfg: GsheetConfig, table: OrdersTable, row: Cell[]): Promise<void> {
  const key = String(row[0]);
  const existing = await findOrderRow(cfg, table, key);
  if (existing) {
    const from = columnLetter(table.startCol);
    const to = columnLetter(table.startCol + row.length - 1);
    const range = `${quoteSheet(table.sheetTitle)}!${from}${existing}:${to}${existing}`;
    const resp = await sheetsFetch(cfg, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [row] }),
    });
    if (!resp.ok) throw await failure("update row", resp);
    return;
  }
  // appendCells con tableId: la fila entra en el cuerpo de la tabla (hereda el
  // formato, los desplegables y las bandas), no debajo de ella.
  await batchUpdate(cfg, [
    {
      appendCells: {
        tableId: table.tableId,
        rows: [
          {
            values: row.map((v) => ({
              userEnteredValue: typeof v === "number" ? { numberValue: v } : { stringValue: v },
            })),
          },
        ],
        fields: "userEnteredValue",
      },
    },
  ]);
}

async function appendHistoryRow(cfg: GsheetConfig, row: unknown[]): Promise<void> {
  const resp = await sheetsFetch(
    cfg,
    `/values/${encodeURIComponent(`${HISTORY_SHEET}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) }
  );
  if (!resp.ok) throw await failure("append history", resp);
}

// ── Construcción de la fila desde el pedido ──────────────────────────────────

const ORDER_SHEET_FIELDS = [
  "id", "display_id", "email", "currency_code", "created_at", "metadata", "locale",
  "status", "payment_status", "fulfillment_status",
  "subtotal", "shipping_total", "tax_total", "discount_total", "total",
  "items.title", "items.product_title", "items.variant_title", "items.product_id",
  "items.quantity", "items.unit_price", "items.total", "items.metadata",
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

  // Archivo: qué archivos tiene el pedido y dónde verlos. Ninguno se copia aquí:
  // la prueba virtual va adjunta en los correos y el documento original de la
  // receta no sale del bucket privado (solo se ve en el panel autenticado).
  const rx = extra.rx ?? [];
  const hasTryon = rx.some((r) => r.has_tryon) || items.some((it) => Boolean((it.metadata ?? {})["tryon_image_key"]));
  const hasFile = rx.some((r) => r.has_file);
  const files = [
    hasTryon ? "Prueba virtual (imagen adjunta en el correo)" : "",
    hasFile ? "Receta original guardada (solo en el panel)" : "",
  ].filter(Boolean);
  if (files.length && extra.adminUrl) files.push(`Panel: ${extra.adminUrl}`);
  const fileCell = files.join("\n");

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

  const orderRow: Cell[] = [
    displayId,
    orderType(items),
    details,
    customer,
    status,
    order.created_at ? sheetDateSerial(order.created_at) : "",
    fileCell,
    [...new Set(notes)].join("\n"),
  ];

  const historyRow = [
    now,
    displayId,
    String(order.id ?? ""),
    event,
    status,
    money(order.total),
    currency,
    trackingNumber,
    progress.terminal ? `terminal: ${progress.terminal}` : "",
  ];

  return { orderRow, historyRow };
}

/** Datos extra de la fila (desglose de lentes, recetas sin valores). Mejor esfuerzo. */
async function loadRowExtras(
  container: MedusaContainer,
  order: Record<string, any>,
  logger: Logger
): Promise<{ lines?: SheetLineDetail[]; rx?: RxSheetInfo[] }> {
  try {
    const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
    const items = (order.items ?? []) as Array<Record<string, any>>;
    const enriched = await enrichLensItems(pg, items, "es");
    const lines: SheetLineDetail[] = enriched.map((e) => ({
      frame_name: e.frame_name,
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
    return { lines, rx };
  } catch (error) {
    logger.warn(`[gsheet] order ${order.id}: row details unavailable (${(error as Error).message})`);
    return {};
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
  tracking?: { number?: string | null; url?: string | null }
): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const cfg = gsheetConfig();
  if (!cfg) {
    logger.info(
      `[gsheet] not configured (GSHEET_FILE_URL / GSHEET_SERVICE_ACCOUNT_EMAIL / GSHEET_SERVICE_ACCOUNT_KEY) — order ${orderId} not mirrored.`
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

    const table = await ensureSheets(cfg);
    const extras = await loadRowExtras(container, order, logger);
    const { orderRow, historyRow } = buildRows(order, event, {
      tracking,
      ...extras,
      adminUrl: `${storefrontOrigin()}/admin`,
    });
    try {
      await upsertOrderRow(cfg, table, orderRow);
    } catch (error) {
      // La tabla pudo haber sido borrada o renombrada: se vuelve a buscar (o
      // crear) en la próxima escritura.
      cachedTable = null;
      throw error;
    }
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
