// Harness del sistema «una vista» (fit.css): ?v=status | charts | stage | costchart | datatable | pending, &mode=light|dark.
// datatable = «Ventas de tienda» (PosSales) sobre DataTable.jsx con /admin/pos/context,
// /admin/pos/sales y /admin/sales-analytics/sales simulados: selector «Columnas»,
// cabeceras que ordenan, totales, fila clicable y exportación con las columnas visibles.
// costchart = el acordeón «Costos y margen» completo (ExecutiveCosts) con un
// GET /admin/costing/summary simulado: KPI de una palabra, glosario, reparto,
// vendedores con sus redes y la gráfica Ventas vs costo.
// Monta StoreStatus con un GET /admin/store-status simulado, la pareja de
// gráficos del Resumen a 150 px y la tira de etapas, dentro del AdminShell real.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "/src/i18n/LanguageContext.jsx";
import { FeedbackProvider } from "/src/components/Feedback.jsx";
import { T } from "/src/i18n/translations.js";
import fit from "/src/i18n/parts/fit.js";
import costs from "/src/i18n/parts/costs.js";
import "/src/admin/admin.css";
import AdminShell from "/src/admin/AdminShell.jsx";
import StoreStatus from "/src/admin/StoreStatus.jsx";
import { StageBarCard } from "/src/admin/StageBar.jsx";
import { KpiCard, LineChart, BarChart, DonutChart, Funnel, AccessVsBuyChart, WeekdayChart, CompareBarChart } from "/src/admin/charts.jsx";
import ExecutiveCosts from "/src/admin/ExecutiveCosts.jsx";
import PosSales from "/src/admin/PosSales.jsx";
import PendingBalances from "/src/admin/PendingBalances.jsx";
import { Card, useChartHeight } from "/src/admin/ui.jsx";
import Icon from "/src/admin/icons.jsx";

// El diccionario de fit.js aún no está en parts/index.js: se funde aquí.
Object.assign(T.es, fit.es); Object.assign(T.en, fit.en);
// Idem costs.js mientras no esté registrado en parts/index.js (no rompe si ya lo está).
Object.assign(T.es, costs.es); Object.assign(T.en, costs.en);

const Q = new URLSearchParams(location.search);
const MODE = Q.get("mode") || "light";
const VIEW = Q.get("v") || "status";
try { localStorage.setItem("adm_color_mode", MODE); localStorage.setItem("oer_lang", Q.get("lang") || "es"); localStorage.setItem("adm_active_store", "est_1"); } catch {}
try { sessionStorage.setItem("oer_admin_session", JSON.stringify({ user: { email: "dueno@optica.com" }, token: "x", exp: Date.now() + 3600e3 })); } catch {}
for (const k of ["adm.acc.ss-alerts", "adm.acc.ss-tills", "adm.acc.ss-pending", "adm.acc.ss-sellers", "adm.acc.ss-recent"]) { try { localStorage.removeItem(k); } catch {} }

const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60e3).toISOString();
const STORES = { establishments: [{ id: "est_1", code: "R41", name: "El Rancho 41", color: "#4f5bd5", is_active: true }, { id: "est_2", code: "FFC", name: "Fry Family Clinic", color: "#2d8f78", is_active: true }] };
const STATUS = {
  stores: STORES.establishments,
  status: {
    store: { id: "est_1", code: "R41", name: "El Rancho 41" },
    today: { total: 4320, count: 27, avg_ticket: 160 }, yesterday: { total: 3860, count: 24, avg_ticket: 160.8 },
    week: { total: 18240, count: 112, avg_ticket: 162.9 }, month: { total: 61230, count: 388, avg_ticket: 157.8 },
    balance_due: 2140.5, insurance_due: 980,
    tills: [
      { id: "t1", code: "T1", name: "Mostrador", is_active: true, register: { id: "r1", opened_at: iso(9 * 60 + 12), opening: 150, expected: 1265.5, cash_in_sales: 1115.5 }, sellers: [{ id: "s1", code: "DAN", name: "Daniel", active: true }, { id: "s2", code: "MAR", name: "Marilin", active: true }] },
      { id: "t2", code: "T2", name: "Optometría", is_active: true, register: null, sellers: [{ id: "s3", code: "JOS", name: "José", active: true }] },
      { id: "t3", code: "T3", name: "Antiguo", is_active: false, register: null, sellers: [] },
    ],
    sellers: [
      { id: "s1", code: "DAN", name: "Daniel Pérez", active: true, has_user: true, terminal_code: "T1", today_total: 2180, today_count: 13 },
      { id: "s2", code: "MAR", name: "Marilin García", active: true, has_user: true, terminal_code: "T1", today_total: 1540, today_count: 9 },
      { id: "s3", code: "JOS", name: "José Ruiz", active: true, has_user: true, terminal_code: "T2", today_total: 600, today_count: 5 },
      { id: "s4", code: "ANA", name: "Ana Torres", active: false, has_user: false, terminal_code: null, today_total: 0, today_count: 0 },
    ],
    pending: { approvals: 2, voids: 1, with_balance: { count: 6, amount: 2140.5 }, insurance_claims: 3, ready: [
      { id: "o1", number: "R41-000119", balance: 80, stage: "shipped", seller_code: "DAN" }, { id: "o2", number: "R41-000121", balance: 0, stage: "in_transit", seller_code: "MAR" }, { id: "o3", number: "R41-000123", balance: 120, stage: "shipped", seller_code: "JOS" },
    ] },
    recent: Array.from({ length: 14 }, (_, i) => ({ id: `v${i}`, number: `R41-0001${String(27 - i).padStart(2, "0")}`, seller_code: ["DAN", "MAR", "JOS"][i % 3], terminal_code: ["T1", "T1", "T2"][i % 3], total: [270, 145, 390, 95, 520][i % 5], balance: i % 4 === 0 ? 60 : 0, status: i === 5 ? "voided" : "completed", delivered: i % 3 === 2, created_at: iso(i * 37 + 5) })),
    attention: [
      { kind: "register_open_long", n: 14, ref: "T1", tone: "bad" },
      { kind: "approvals_pending", n: 2, tone: "warn" },
      { kind: "voids_requested", n: 1, tone: "warn" },
      { kind: "ready_to_hand", n: 3, tone: "info" },
    ],
  },
};
const ME = { email: "dueno@optica.com", role: "owner", is_admin: true };
const realFetch = window.fetch.bind(window);
window.fetch = (url, opts) => {
  const u = String(url);
  const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } }));
  if (u.includes("/admin/store-status")) return new Promise((r) => setTimeout(() => r(json(STATUS)), 120));
  if (u.includes("/admin/establishments")) return json(STORES);
  if (u.includes("/admin/costing/summary")) return new Promise((r) => setTimeout(() => r(json(COSTING)), 80));
  if (u.includes("/admin/pos/context")) return json(POS_CTX);
  if (u.includes("/admin/pos/sales")) return new Promise((r) => setTimeout(() => r(json({ sales: POS_SALES })), 100));
  if (u.includes("/admin/sales-analytics/sales")) return new Promise((r) => setTimeout(() => r(json({ access: { profit: true, commission: true }, sales: POS_DETAILS, page: 0, has_more: false })), 250));
  if (u.includes("/admin/team/me")) return json(ME);
  if (u.includes("/admin/")) return json({});
  return realFetch(url, opts);
};

const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(now - (29 - i) * 864e5); return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
const rnd = (seed) => { let x = seed; return () => (x = (x * 9301 + 49297) % 233280) / 233280; };
const r = rnd(7);
const sales = days.map((label) => ({ label, value: Math.round(200 + r() * 900) }));
const orders = days.map((label) => ({ label, value: Math.round(r() * 9) }));
const avb = days.map((label, i) => ({ label, access: Math.round(20 + r() * 80), orders: orders[i].value }));
const weekday = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((label, i) => ({ label, access: i === 5 ? 0 : Math.round(60 + r() * 200), orders: i === 5 ? 15 : Math.round(r() * 30), conv: 0 }));
const brands = [{ label: "DiCaprio", value: 8420 }, { label: "Flexure", value: 5120 }, { label: "Mileniall", value: 3310 }, { label: "Peachtrie", value: 1980 }, { label: "For You", value: 1210 }, { label: "Trendy", value: 760 }];
const funnel = [{ label: "Accesos", value: 1840 }, { label: "Vieron producto", value: 920 }, { label: "Al carrito", value: 210 }, { label: "Compras", value: 96 }];
const stages = [
  { key: "confirmed", label: "Confirmado", icon: "receipt", count: 12, amount: 1840 },
  { key: "in_lab", label: "En laboratorio", icon: "lab", count: 23, amount: 4120.5 },
  { key: "shipped", label: "Salió del lab", icon: "box", count: 7, amount: 1230 },
  { key: "in_transit", label: "En camino", icon: "truck", count: 9, amount: 1555 },
  { key: "delivered", label: "Entregado", icon: "checkCircle", count: 41, amount: 7210.75 },
];
const money = (v) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Costos y margen: 30 días de ventas con su costo (un martes en pérdida). ──
const rc = rnd(11);
const r2 = (v) => Math.round(v * 100) / 100;
const costDays = days.map((label, i) => {
  const date = new Date(now - (29 - i) * 864e5);
  const orders = i % 7 === 5 ? 0 : Math.round(1 + rc() * 5);
  const revenue = orders === 0 ? 0 : r2(orders * (180 + rc() * 160));
  const cost = orders === 0 ? 0 : r2(revenue * (i === 16 ? 1.07 : 0.52 + rc() * 0.2));
  return { date: `${date.getFullYear()}-${label}`, orders, revenue, cost, margin: r2(revenue - cost) };
});
const totRev = r2(costDays.reduce((a, d) => a + d.revenue, 0));
const totCost = r2(costDays.reduce((a, d) => a + d.cost, 0));
const ded = r2(totRev * 0.163), mat = r2(totRev * 0.28), pc = r2(totRev * 0.17), com = r2(totRev * 0.04);
const net = r2(totRev - ded);
const SELLERS = [["DAN", "Daniel Pérez"], ["MAR", "Marilin García"], ["JOS", "José Ruiz"], ["ANA", "Ana Torres"]];
const SRC = ["whatsapp", "instagram", "tiktok", "facebook", "link", "instagram", "whatsapp"];
const costOrders = Array.from({ length: 24 }, (_, i) => {
  const gross = r2(140 + rc() * 420); const d = r2(gross * 0.163); const nb = r2(gross - d); const cost = r2(nb * (i === 3 ? 1.1 : 0.45 + rc() * 0.3)); const margin = r2(nb - cost);
  const seller = i % 5 === 4 ? null : SELLERS[i % 4];
  return { id: `o${i}`, display_id: 180 - i, created_at: new Date(now - i * 7.3 * 36e5).toISOString(), customer_name: ["María Fernanda Rodríguez de la Torre", "Juan Pérez", "Ana Lucía Gómez", "Carlos Méndez", "Sofía Castro Villanueva"][i % 5],
    seller_code: seller?.[0] ?? null, seller_source: seller ? SRC[i % SRC.length] : null, gross, revenue: gross, deductions_total: d, net_base: nb, cost_total: cost, margin, margin_pct: r2((margin / gross) * 100), profit_pct_net: r2((margin / nb) * 100),
    profit_target_amount: r2(nb * 0.3), profit_gap: r2(margin - nb * 0.3), undefined_costs: i === 7 || i === 12 ? 1 : 0 };
});
const bySeller = SELLERS.map(([code, name]) => { const os = costOrders.filter((o) => o.seller_code === code); const revenue = r2(os.reduce((a, o) => a + o.gross, 0)); return { code, name, orders: os.length, revenue, cost: r2(os.reduce((a, o) => a + o.cost_total, 0)), margin: r2(os.reduce((a, o) => a + o.margin, 0)), commission: r2(revenue * 0.05) }; });
const noneOs = costOrders.filter((o) => !o.seller_code);
const COSTING = {
  from: costDays[0].date, to: costDays[29].date, truncated: false, rules_defined: true,
  totals: { orders: 86, gross: totRev, revenue: totRev, deductions: ded, net_base: net, materials: mat, percent_items: pc, commission: com, cost: totCost, profit: r2(totRev - totCost), margin: r2(totRev - totCost), margin_pct: r2(((totRev - totCost) / totRev) * 100), profit_pct_net: r2(((totRev - totCost) / net) * 100), profit_target_pct: 30, profit_target_amount: r2(net * 0.3), profit_gap: r2(totRev - totCost - net * 0.3) },
  by_kind: [
    { kind: "frame_brand", key: "frame:dicaprio", label: "Montura DiCaprio", amount: r2(mat * 0.3) }, { kind: "lens_design", key: "lens:sv", label: "Lente monofocal", amount: r2(mat * 0.25) }, { kind: "frame_brand", key: "frame:flexure", label: "Montura Flexure", amount: r2(mat * 0.18) },
    { kind: "shipping", key: "shipping", label: "Envío", amount: r2(ded * 0.5) }, { kind: "tax", key: "tax", label: "Impuestos", amount: r2(ded * 0.32) }, { kind: "order_percent", key: "order_percent:payment_fee", label: "Stripe 2.9 % + $0.30", amount: r2(ded * 0.18) },
    { kind: "order_percent", key: "order_percent:rent", label: "Renta 10 %", amount: r2(pc * 0.5) }, { kind: "order_percent", key: "order_percent:lab", label: "Laboratorio 8 %", amount: r2(pc * 0.3) }, { kind: "order_percent", key: "order_percent:packaging", label: "Empaque 2 %", amount: r2(pc * 0.1) }, { kind: "order_percent", key: "order_percent:service", label: "Atención al cliente 2 %", amount: r2(pc * 0.1) },
    { kind: "lens_ar", key: "lens_ar:ar", label: "Antirreflejo", amount: r2(mat * 0.12) }, { kind: "lens_photo", key: "lens_photo:photo", label: "Fotocromático", amount: r2(mat * 0.08) }, { kind: "frame_brand", key: "frame:mileniall", label: "Montura Mileniall", amount: r2(mat * 0.07) },
    { kind: "seller_commission", key: "seller:all", label: "Comisión vendedor", amount: com }, { kind: "manual", key: "manual:courier", label: "Mensajería extra", amount: 38 },
  ].sort((a, b) => b.amount - a.amount),
  by_seller: [...bySeller, { code: null, name: "none", orders: noneOs.length, revenue: r2(noneOs.reduce((a, o) => a + o.gross, 0)), cost: 0, margin: 0, commission: 0 }],
  by_day: costDays,
  by_brand: [{ slug: "dicaprio", name: "DiCaprio", orders: 31, revenue: 8420, frame_cost: 1240, margin_share: 0 }, { slug: "flexure", name: "Flexure", orders: 19, revenue: 5120, frame_cost: 760, margin_share: 0 }, { slug: "mileniall", name: "Mileniall", orders: 12, revenue: 3310, frame_cost: 420, margin_share: 0 }, { slug: "peachtrie", name: "Peachtrie", orders: 8, revenue: 1980, frame_cost: 280, margin_share: 0 }, { slug: "trendy", name: "Trendy", orders: 5, revenue: 760, frame_cost: 110, margin_share: 0 }],
  orders: costOrders,
};

// ── DataTable: «Ventas de tienda» con 18 ventas simuladas (una anulada, dos con saldo, una montura propia). ──
const POS_CTX = {
  is_admin: true, role: "owner",
  stores: STORES.establishments.map((s) => ({ ...s, terminals: [{ id: `${s.id}-t1`, code: "T1" }, { id: `${s.id}-t2`, code: "T2" }], payment_methods: ["cash", "card"] })),
  payment_methods: [{ code: "cash", kind: "cash", builtin: true }, { code: "card", kind: "card", builtin: true }],
};
const CUSTOMERS = [["María Fernanda Rodríguez", "+1 305 555 0101"], ["Juan Pérez", "+1 305 555 0102"], ["Ana Lucía Gómez", "+1 305 555 0103"], ["Carlos Méndez", null], ["Sofía Castro", "+1 305 555 0105"]];
const FRAMES = [["DiCaprio", "DC 3401", "Negro mate", "DC3401-BLK-52"], ["Flexure", "FX 220", "Carey", "FX220-TOR-54"], ["Mileniall", "ML 15", "Azul", "ML15-BLU-50"], ["Peachtrie", "PT 88", "Rosa", "PT88-PNK-51"], [null, "Montura del cliente (Ray-Ban)", null, null]];
const rp = rnd(23);
const POS_SALES = Array.from({ length: 18 }, (_, i) => {
  const total = Math.round((120 + rp() * 480) * 100) / 100;
  const balance = i % 5 === 1 ? Math.round(total * 0.4 * 100) / 100 : 0;
  return {
    id: `sale_${i}`, number: `R41-0002${String(40 - i).padStart(2, "0")}`, establishment_id: i % 4 === 3 ? "est_2" : "est_1", terminal_id: i % 3 === 2 ? "est_1-t2" : "est_1-t1",
    seller_id: `s${(i % 3) + 1}`, seller_code: ["DAN", "MAR", "JOS"][i % 3], customer_id: `cus_${i % 5}`, list: total, discount: i % 4 === 0 ? 20 : 0, discount_pct: i % 4 === 0 ? 5 : 0,
    total, paid: total - balance, insurance: 0, balance, status: i === 6 ? "voided" : "completed", tray: `R41-${i + 1}`, promised_on: new Date(now + (3 - i) * 864e5).toISOString().slice(0, 10),
    delivery: i % 6 === 5 ? "ship" : "pickup", delivered_at: i % 3 === 0 && i !== 6 ? iso(i * 60) : null, voided_at: i === 6 ? iso(100) : null, void_reason: null, void_requested_at: i === 8 ? iso(30) : null,
    created_at: iso(i * 190 + 12), payments: [],
  };
});
const POS_DETAILS = POS_SALES.map((s, i) => {
  const [customer, customer_phone] = CUSTOMERS[i % 5];
  const [frame_brand, frame_model, frame_color, frame_sku] = FRAMES[i % 5];
  const own = i % 5 === 4;
  const cost = Math.round(s.total * 0.46 * 100) / 100;
  return {
    order_id: `order_${i}`, sale_id: s.id, number: s.number, channel: "pos", establishment_id: s.establishment_id, seller_code: s.seller_code, customer, customer_phone,
    sold_at: s.created_at, total: s.total, discount: s.discount, units: 2, status: s.status === "voided" ? "voided" : "active",
    items: own ? "Lentes progresivos · Montura del cliente" : `${frame_brand} ${frame_model} · Lentes monofocales CR-39`, paid: s.paid, balance: s.balance,
    frame_brand, frame_model, frame_color, frame_sku, own_frame: own, has_rx: i % 3 !== 1,
    lens_summary: i % 3 === 1 ? null : { es: own ? "Progresivo · Policarbonato · AR" : "Monofocal · CR-39 · Fotocromático", en: own ? "Progressive · Polycarbonate · AR" : "Single vision · CR-39 · Photochromic" },
    cost, fee: Math.round(s.total * 0.029 * 100) / 100, commission: Math.round(s.total * 0.05 * 100) / 100, profit: Math.round((s.total - cost) * 100) / 100, margin_pct: Math.round(((s.total - cost) / s.total) * 1000) / 10,
  };
});
function DataTableView() {
  return <PosSales me={ME} />;
}
// pending = «Cobros pendientes» sobre la misma tabla (DataTable) y los mismos datos; ?q=&overdue=&stage=&seller= se pasan como `params`.
function PendingView() {
  const params = { q: Q.get("q") || "", overdue: Q.get("overdue") || "", stage: Q.get("stage") || "", seller: Q.get("seller") || "" };
  return <PendingBalances me={ME} openSale={(id) => console.log("openSale", id)} params={params} />;
}

function ChartsView() {
  const H = useChartHeight(0.14, 100, 150);
  return (
    <div className="adm-section">
      <div className="adm-exec">
        <div className="adm-kpis">
          <KpiCard label="Ingresos" value={money(20800)} icon={<Icon name="dollar" />} sub="412 unidades" />
          <KpiCard label="Pedidos" value="96" icon={<Icon name="receipt" />} />
          <KpiCard label="Ticket medio" value={money(216.67)} icon={<Icon name="trendUp" />} />
          <KpiCard label="Accesos" value="1,840" icon={<Icon name="eye" />} />
          <KpiCard label="Conversión" value="5.2%" icon={<Icon name="gauge" />} sub="compras ÷ accesos" />
        </div>
        <div className="adm-grid-2 pair">
          <Card title="Ventas por día" name="salesByDay" hint="Ingresos por día"><LineChart data={sales} valuePrefix="$" height={H} /></Card>
          <Card title="Embudo" name="funnel" hint="De acceso a compra"><Funnel steps={funnel} height={H} /></Card>
        </div>
        <div className="adm-grid-2 pair">
          <Card title="Ventas por marca" name="salesByBrand" hint="Reparto"><DonutChart data={brands} height={H} size={Math.min(140, H)} /></Card>
          <Card title="Pedidos por día" name="ordersByDay" hint="Pedidos"><BarChart data={orders} height={H} /></Card>
        </div>
        <div className="adm-grid-2 pair">
          <Card title="Accesos vs Compras por día" name="accessVsBuy" hint="…"><AccessVsBuyChart data={avb} height={H} /></Card>
          <Card title="Por día de la semana" name="weekday" hint="…"><WeekdayChart data={weekday} height={H} /></Card>
        </div>
      </div>
    </div>
  );
}

// Costos y margen completo (ExecutiveCosts) + la gráfica suelta a dos alturas.
function CostChartView() {
  const H = useChartHeight(0.14, 100, 150);
  const [seller, setSeller] = useState(null);
  const range = { from: new Date(now - 29 * 864e5), to: new Date(now) };
  return (
    <div className="adm-section">
      {seller && <div className="adm-demo-banner">onSeller("{seller}")</div>}
      <ExecutiveCosts range={range} store="" go={(tab, p) => console.log("go", tab, p)} onSeller={(code) => setSeller(code)} />
      <div className="adm-exec" style={{ marginTop: 14 }}>
        <div className="adm-grid-2 pair">
          <Card title="CompareBarChart · 14 días · 120 px" name="cmp14" hint="…"><CompareBarChart data={costDays.slice(-14).map((d) => ({ label: d.date.slice(5), sales: d.revenue, cost: d.cost }))} height={120} format={money} /></Card>
          <Card title="CompareBarChart · 90 días · 150 px" name="cmp90" hint="…"><CompareBarChart data={Array.from({ length: 90 }, (_, i) => { const d = costDays[i % 30]; return { label: d.date.slice(5), sales: d.revenue * (0.8 + (i % 7) * 0.06), cost: d.cost }; })} height={H} format={money} /></Card>
        </div>
      </div>
    </div>
  );
}

function StageView() {
  const [active, setActive] = useState(null);
  return (
    <div className="adm-section">
      <div className="adm-exec">
        <StageBarCard icon="layers" title="Pedidos por etapa" hint="Cuántos pedidos hay en cada etapa y cuánto suman." onGo={() => {}} goLabel="Pedidos" name="pipeline" stages={stages} active={active} onPick={(st) => setActive(st.key)} />
        <div className="adm-fit-row cols-3 tight">
          <Card icon="sales" title="Ventas por día" hint="…"><LineChart data={sales.slice(-14)} valuePrefix="$" height={120} /></Card>
          <Card icon="orders" title="Pedidos por día" hint="…"><BarChart data={orders.slice(-14)} height={120} /></Card>
          <Card icon="tagIcon" title="Ventas por marca" hint="…"><DonutChart data={brands.slice(0, 4)} height={120} size={110} /></Card>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState(VIEW === "status" ? "storestatus" : "exec");
  const tabs = ["storestatus", "salesboard", "approvals", "possales", "cash", "stores", "sellers"];
  return (
    <MemoryRouter>
      <AdminShell tab={tab} onTab={setTab} user="dueno@optica.com" onLogout={() => {}} find="" onFind={() => {}} badges={{ approvals: 2 }} me={ME}>
        {VIEW === "status" && <StoreStatus go={(t) => console.log("go", t)} tabs={tabs} me={ME} />}
        {VIEW === "charts" && <ChartsView />}
        {VIEW === "stage" && <StageView />}
        {VIEW === "costchart" && <CostChartView />}
        {VIEW === "datatable" && <DataTableView />}
        {VIEW === "pending" && <PendingView />}
      </AdminShell>
    </MemoryRouter>
  );
}
document.body.style.background = MODE === "dark" ? "#0f1218" : "#f3f4f6";
createRoot(document.getElementById("root")).render(<LanguageProvider><FeedbackProvider><App /></FeedbackProvider></LanguageProvider>);
