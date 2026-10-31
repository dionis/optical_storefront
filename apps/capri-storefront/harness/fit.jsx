// Harness del sistema «una vista» (fit.css): ?v=status | charts | stage, &mode=light|dark.
// Monta StoreStatus con un GET /admin/store-status simulado, la pareja de
// gráficos del Resumen a 150 px y la tira de etapas, dentro del AdminShell real.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "/src/i18n/LanguageContext.jsx";
import { FeedbackProvider } from "/src/components/Feedback.jsx";
import { T } from "/src/i18n/translations.js";
import fit from "/src/i18n/parts/fit.js";
import "/src/admin/admin.css";
import AdminShell from "/src/admin/AdminShell.jsx";
import StoreStatus from "/src/admin/StoreStatus.jsx";
import { StageBarCard } from "/src/admin/StageBar.jsx";
import { KpiCard, LineChart, BarChart, DonutChart, Funnel, AccessVsBuyChart, WeekdayChart } from "/src/admin/charts.jsx";
import { Card, useChartHeight } from "/src/admin/ui.jsx";
import Icon from "/src/admin/icons.jsx";

// El diccionario de fit.js aún no está en parts/index.js: se funde aquí.
Object.assign(T.es, fit.es); Object.assign(T.en, fit.en);

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
      </AdminShell>
    </MemoryRouter>
  );
}
document.body.style.background = MODE === "dark" ? "#0f1218" : "#f3f4f6";
createRoot(document.getElementById("root")).render(<LanguageProvider><FeedbackProvider><App /></FeedbackProvider></LanguageProvider>);
