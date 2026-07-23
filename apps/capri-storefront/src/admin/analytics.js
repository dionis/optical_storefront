// Client-side analytics + orders layer for the storefront.
// Model:
//   oer_daily  = { "YYYY-MM-DD": { access, view, atc, fav } }  (funnel top counts)
//   oer_orders = [ { id, t(iso), items:[{sku,name,brand,kind,total}], itemsCount, total, demo? } ]
// The storefront calls track*(...) as the user browses/buys; the admin dashboard reads
// these with time filters. Demo data is seeded once (labelled demo) so charts aren't empty.
//
// NOTE: localStorage is per-browser. For real cross-device SaaS analytics this layer should
// post events to Dionis's backend — the track*/recordOrder functions are the seam for that.
import { generateDemo } from "./seed.js";
import { getUser } from "../components/userAuth.js";

const DAILY = "oer_daily";
const ORDERS = "oer_orders";
const SEEDED = "oer_seeded_v1";
const ACCESS_FLAG = "oer_access_logged";

const rd = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const todayKey = () => { const d = new Date(); return d.toISOString().slice(0, 10); };

export function ensureSeed() {
  if (localStorage.getItem(SEEDED)) return;
  try {
    const { daily, orders } = generateDemo(90);
    const curDaily = rd(DAILY, {});
    for (const k of Object.keys(daily)) if (!curDaily[k]) curDaily[k] = daily[k];
    wr(DAILY, curDaily);
    const curOrders = rd(ORDERS, []);
    wr(ORDERS, [...orders, ...curOrders]);
    localStorage.setItem(SEEDED, "1");
    bump();
  } catch {}
}

export function clearDemo() {
  // remove demo orders + all daily buckets, keep real (non-demo) orders
  const real = getOrders().filter((o) => !o.demo);
  wr(ORDERS, real);
  wr(DAILY, {});
  localStorage.removeItem(SEEDED);
  bump();
}

// ---- tracking (called from the storefront) ----
function incDaily(field, n = 1) {
  const d = rd(DAILY, {});
  const k = todayKey();
  d[k] = d[k] || { access: 0, view: 0, atc: 0, fav: 0 };
  d[k][field] = (d[k][field] || 0) + n;
  wr(DAILY, d);
  bump();
}
export function trackAccess() {
  if (sessionStorage.getItem(ACCESS_FLAG)) return;
  sessionStorage.setItem(ACCESS_FLAG, "1");
  incDaily("access");
}
export function trackView() { incDaily("view"); }
export function trackAddToCart() { incDaily("atc"); }
export function trackFav() { incDaily("fav"); }

export function recordOrder(order) {
  const list = getOrders();
  const rec = {
    id: order.id || "ORD-" + Date.now(),
    t: new Date().toISOString(),
    items: order.items || [],
    itemsCount: (order.items || []).length,
    total: Math.round((order.total || 0) * 100) / 100,
    user: (getUser() && getUser().email) || null,   // ties the order to the logged-in customer
    status: "processing",                             // for future order tracking
  };
  wr(ORDERS, [rec, ...list]);
  bump();
  return rec;
}

// ---- reads ----
export function getDaily() { return rd(DAILY, {}); }
export function getOrders() { return rd(ORDERS, []); }
// a customer's own orders (used by the "Mi cuenta" area)
export function ordersByUser(email) {
  if (!email) return [];
  return getOrders().filter((o) => o.user === email).sort((a, b) => new Date(b.t) - new Date(a.t));
}

// ---- change notifications (so the dashboard re-renders live) ----
const subs = new Set();
export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
function bump() { for (const f of subs) f(); }

// ---- time ranges ----
export function rangeFor(preset) {
  const to = new Date(); to.setHours(23, 59, 59, 999);
  const from = new Date(); from.setHours(0, 0, 0, 0);
  switch (preset) {
    case "today": break;
    case "7d": from.setDate(from.getDate() - 6); break;
    case "30d": from.setDate(from.getDate() - 29); break;
    case "90d": from.setDate(from.getDate() - 89); break;
    case "ytd": from.setMonth(0, 1); break;
    case "all": from.setFullYear(2000, 0, 1); break;
    default: from.setDate(from.getDate() - 29);
  }
  return { from, to };
}

const inRange = (iso, from, to) => { const t = new Date(iso).getTime(); return t >= from.getTime() && t <= to.getTime(); };
const eachDay = (from, to) => {
  const out = []; const d = new Date(from); d.setHours(12, 0, 0, 0);
  const end = new Date(to);
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
};

// ---- aggregations for the dashboard ----
export function summarize({ from, to }) {
  const daily = getDaily();
  const orders = getOrders().filter((o) => inRange(o.t, from, to));
  const days = eachDay(from, to);
  let access = 0, view = 0, atc = 0, fav = 0;
  for (const k of days) { const b = daily[k]; if (b) { access += b.access || 0; view += b.view || 0; atc += b.atc || 0; fav += b.fav || 0; } }
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const ordersCount = orders.length;
  const units = orders.reduce((s, o) => s + o.itemsCount, 0);
  const aov = ordersCount ? revenue / ordersCount : 0;
  const conv = access ? (ordersCount / access) * 100 : 0;

  // sales over time (revenue per day)
  const revByDay = Object.fromEntries(days.map((k) => [k, 0]));
  const ordByDay = Object.fromEntries(days.map((k) => [k, 0]));
  for (const o of orders) { const k = o.t.slice(0, 10); if (k in revByDay) { revByDay[k] += o.total; ordByDay[k] += 1; } }
  const salesSeries = days.map((k) => ({ label: k.slice(5), value: Math.round(revByDay[k] * 100) / 100 }));
  const ordersSeries = days.map((k) => ({ label: k.slice(5), value: ordByDay[k] }));
  const accessSeries = days.map((k) => ({ label: k.slice(5), value: (daily[k]?.access) || 0 }));
  // accesses vs purchases on the SAME daily chart
  const accessVsBuy = days.map((k) => ({ label: k.slice(5), access: (daily[k]?.access) || 0, orders: ordByDay[k] }));
  // day-of-week analysis: which weekdays get more visits / more purchases
  const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const wAcc = [0, 0, 0, 0, 0, 0, 0], wOrd = [0, 0, 0, 0, 0, 0, 0], wCnt = [0, 0, 0, 0, 0, 0, 0];
  for (const k of days) {
    const dow = new Date(k + "T12:00:00").getDay();
    wAcc[dow] += (daily[k]?.access) || 0; wOrd[dow] += ordByDay[k]; wCnt[dow] += 1;
  }
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon-first
  const weekday = order.map((d) => ({
    label: DOW[d], access: wAcc[d], orders: wOrd[d],
    conv: wAcc[d] ? Math.round((wOrd[d] / wAcc[d]) * 1000) / 10 : 0,
  }));

  // top products / brands by revenue
  const prodMap = {}, brandMap = {};
  for (const o of orders) for (const it of o.items) {
    prodMap[it.name] = (prodMap[it.name] || 0) + it.total;
    brandMap[it.brand] = (brandMap[it.brand] || 0) + it.total;
  }
  const top = (m, n) => Object.entries(m).map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value).slice(0, n);

  return {
    kpis: { revenue, ordersCount, units, aov, access, view, atc, fav, conv },
    salesSeries, ordersSeries, accessSeries, accessVsBuy, weekday,
    funnel: [
      { label: "Accesos", value: access },
      { label: "Vistas de producto", value: view },
      { label: "Añadido al carrito", value: atc },
      { label: "Compras", value: ordersCount },
    ],
    topProducts: top(prodMap, 8),
    topBrands: top(brandMap, 6),
    orders,
    hasDemo: orders.some((o) => o.demo),
  };
}
