// REAL analytics source for the admin panel: pulls the store's actual orders
// from the Medusa order board (the same API the Orders tab uses) and maps them
// to the shape `summarizeOrders()` (analytics.js) already aggregates. This is
// what turns Resumen/Ventas/Precios from demo charts into the store's truth.
//
// No language hook here (module rule): anything user-facing travels as an
// i18n KEY and the panel resolves it at render time.
//
// Scan window: the backend reads at most `scan_limit` (300) newest orders in
// the date range per call (see order-board route). We page through that window
// (≤3 calls of 100) and surface `truncated` so the panel can SAY the numbers
// cover the newest N orders instead of silently under-reporting.
import { fetchOrders, orderLabel } from "./adminOrders.js";

// ---- date helpers (LOCAL time — toISOString would shift the day near midnight) ----
const ymdLocal = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ---- catalog index: order line title -> { brand, kind } ----
// Real order lines carry no brand/sku, only the Medusa product title, which
// matches the catalog name (medusaCatalog keeps title = name = sku).
const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export function buildCatalogIndex(products = [], cases = []) {
  const idx = {};
  for (const p of products) idx[normKey(p.name)] = { brand: p.brand || "", kind: "frame", image: p.colors?.[0]?.image || null };
  for (const c of cases) idx[normKey(c.name)] = { brand: c.brand || "Cases", kind: "case", image: c.colors?.[0]?.image || null };
  return idx;
}

// Revenue truth: an order counts when it is not canceled/refunded/payment-pending.
const isRevenueOrder = (o) => !o.terminal;

// Board order -> analytics order (the shape summarizeOrders consumes).
export function toAnalyticsOrder(o, catalogIndex) {
  const items = (o.items || []).map((it) => {
    const hit = catalogIndex ? catalogIndex[normKey(it.title)] : null;
    return {
      sku: it.title,
      name: it.title,
      qty: it.quantity || 1,
      brand: hit ? hit.brand : "—",
      kind: hit ? hit.kind : (it.lens && it.lens.design_code ? "frame" : "other"),
      total: it.total || 0,
      thumbnail: it.thumbnail || (hit ? hit.image : null),
    };
  });
  return {
    id: orderLabel(o),
    t: o.created_at,
    total: o.total || 0,
    currency: o.currency_code || "usd",
    itemsCount: items.reduce((s, it) => s + (it.qty || 1), 0),
    items,
    stage: o.stage,
    terminal: o.terminal,
    has_prescription: !!o.has_prescription,
    demo: false,
  };
}

// ---- windowed fetch over the order board, with a small in-memory cache ----
const cache = new Map(); // key -> { at, value }
const CACHE_MS = 60_000;

export async function fetchBoardWindow({ from, to }) {
  // "all" range (year 2000 sentinel from rangeFor) -> no from filter at all.
  const fromStr = from && from.getFullYear() > 2001 ? ymdLocal(from) : "";
  const toStr = to ? ymdLocal(to) : "";
  const key = `${fromStr}|${toStr}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const orders = [];
  let truncated = false, scanLimit = 300, count = 0, offset = 0;
  for (let page = 0; page < 3; page++) {
    const res = await fetchOrders({ from: fromStr, to: toStr, limit: 100, offset });
    orders.push(...(res.orders || []));
    truncated = !!res.truncated;
    scanLimit = res.scan_limit || 300;
    count = res.count || orders.length;
    offset += 100;
    if (orders.length >= count || (res.orders || []).length === 0) break;
  }
  const value = { orders, truncated, scanLimit };
  cache.set(key, value);
  return value;
}

// One call for the panel: real orders, already mapped and split into
// revenue (counted) vs excluded (canceled/refunded/pending) for the charts.
export async function fetchRealAnalyticsOrders(range, catalogIndex) {
  const { orders, truncated, scanLimit } = await fetchBoardWindow(range);
  const mapped = orders.map((o) => toAnalyticsOrder(o, catalogIndex));
  return {
    revenueOrders: orders.filter(isRevenueOrder).map((o) => toAnalyticsOrder(o, catalogIndex)),
    allOrders: mapped,
    truncated,
    scanLimit,
  };
}
