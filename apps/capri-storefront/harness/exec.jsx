// Banco de pruebas del Ejecutivo: el AdminShell real con ExecutiveHub dentro y
// un backend simulado (fetch interceptado) para mirar la barra de filtros, el
// selector de tienda y la tira de KPI con sus variaciones, en claro y oscuro.
//   /harness/exec.html?mode=light|dark&tab=exec|pos&store=all|web|<id>&role=owner|manager&lang=es|en
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "/src/i18n/LanguageContext.jsx";
import { FeedbackProvider } from "/src/components/Feedback.jsx";
import "/src/admin/admin.css";
import AdminShell, { navGroupsFor } from "/src/admin/AdminShell.jsx";
import ExecutiveHub from "/src/admin/ExecutiveHub.jsx";

const Q = new URLSearchParams(location.search);
const MODE = Q.get("mode") || "light";
const TAB0 = Q.get("tab") || "exec";
const STORE = Q.get("store") || "all";
const ROLE = Q.get("role") || "owner";
try { localStorage.setItem("adm_color_mode", MODE); } catch {}
try { localStorage.setItem("oer_lang", Q.get("lang") || "es"); } catch {}
try { if (STORE === "all") localStorage.removeItem("adm_active_store"); else localStorage.setItem("adm_active_store", STORE); } catch {}
try { sessionStorage.setItem("oer_admin_session", JSON.stringify({ user: "dueno@optica.com", token: "harness", exp: Date.now() + 3600e3 })); } catch {}

const STORES = [
  { id: "est_01", code: "Op1", name: "Fry Family Clinic", color: "#1B7F4C", is_active: true },
  { id: "est_02", code: "Op2", name: "El Rancho 39", color: "#B5651D", is_active: true },
  { id: "est_03", code: "Op3", name: "El Rancho 41", color: "#C2185B", is_active: true },
  { id: "est_04", code: "Op4", name: "Hialeah Gardens", color: "#2563EB", is_active: true },
  { id: "est_05", code: "Op5", name: "Kendall Lakes", color: "#7C3AED", is_active: true },
  { id: "est_06", code: "Op6", name: "Doral Plaza", color: "#0891B2", is_active: true },
];

// Cifras deterministas a partir del rango: el período anterior sale distinto.
const seed = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 1000) / 1000; };
const figures = (from, to, stores) => {
  const k = 0.6 + seed(`${from}${to}${stores}`) * 0.8;
  const sales = Math.round(18450 * k * 100) / 100;
  const net = sales / 1.07;
  const cost = Math.round(net * 0.42 * 100) / 100;
  const fee = Math.round(sales * 0.021 * 100) / 100;
  const commission = Math.round(net * 0.05 * 100) / 100;
  const profit = Math.round((net - cost - fee - commission) * 100) / 100;
  const count = Math.round(64 * k);
  return { sales, net, tax: sales - net, cost, fee, commission, profit, margin_pct: Math.round((profit / net) * 1000) / 10, count, units: Math.round(count * 1.8), avg_ticket: Math.round((sales / count) * 100) / 100 };
};
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.origin);
  if (!url.pathname.startsWith("/medusa/admin/")) return realFetch(input, init);
  const p = url.pathname.replace("/medusa", "");
  const g = (k) => url.searchParams.get(k) || "";
  await new Promise((r) => setTimeout(r, 120));
  if (p === "/admin/establishments") return json({ establishments: STORES });
  if (p === "/admin/pos/context") return json({ role: ROLE, is_admin: false, stores: STORES.slice(1, 2), assigned: { establishment_id: "est_02" }, privileges: [] });
  if (p === "/admin/sales-analytics/insights") {
    const f = figures(g("from"), g("to"), g("stores"));
    const rows = [["DAN", "Daniela Ruiz", 0.46], ["JOS", "José Pérez", 0.34], [null, null, 0.2]].map(([key, label, sh]) => ({ key, label, sales: Math.round(f.sales * sh * 100) / 100, count: Math.round(f.count * sh), units: Math.round(f.units * sh), profit: Math.round(f.profit * sh * 100) / 100, commission: Math.round(f.commission * sh * 100) / 100, margin_pct: f.margin_pct, share: sh * 100 }));
    return json({ totals: f, previous: f, rows, access: { profit: true, commission: true }, series: [], compare: [] });
  }
  if (p === "/admin/sales-analytics/sales") {
    const f = figures(g("from"), g("to"), g("stores"));
    const n = Math.min(f.count, 12);
    const sales = Array.from({ length: n }, (_, i) => {
      const total = Math.round((f.sales / f.count) * (0.6 + ((i * 37) % 10) / 12) * 100) / 100;
      const paid = i % 4 === 0 ? Math.round(total * 0.5 * 100) / 100 : total;
      return { id: `s${i}`, number: `R39-0001${10 + i}`, created_at: `${g("from")}T10:${String(10 + i).padStart(2, "0")}:00Z`, customer_name: ["Marilin García", "Ana Ruiz", "Luis Soto"][i % 3], seller_code: i % 2 ? "DAN" : "JOS", units: 2, total, discount: 0, net: total / 1.07, cost: total * 0.4, fee: total * 0.02, commission: total * 0.05, profit: total * 0.45, margin_pct: 45, paid, balance: total - paid, status: "completed", establishment_id: "est_02", items: "DiCaprio DC241 · lentes" };
    });
    return json({ sales, access: { profit: true, commission: true }, has_more: false });
  }
  if (p === "/admin/pos/cash-report") {
    const f = figures(g("from"), g("to"), g("establishment_id"));
    const c = Math.round(f.sales * 100);
    return json({ totals: { payments_cents: c, cash_net_cents: Math.round(c * 0.31), movements_in_cents: 20000, movements_out_cents: 45000 }, by_method: [{ code: "cash", builtin: true, kind: "cash", counts_as_cash: true, in_count: 20, in_cents: Math.round(c * 0.33), refund_cents: 0, fee_cents: 0, net_cents: Math.round(c * 0.33) }, { code: "card", builtin: true, kind: "card", in_count: 30, in_cents: Math.round(c * 0.5), refund_cents: 2000, fee_cents: 4000, net_cents: Math.round(c * 0.5) - 6000 }, { code: "zelle", builtin: true, kind: "transfer", in_count: 6, in_cents: Math.round(c * 0.17), refund_cents: 0, fee_cents: 0, net_cents: Math.round(c * 0.17) }], movements: [] });
  }
  if (p === "/admin/order-board") return json({ orders: [], total: 0, truncated: false });
  if (p === "/admin/sellers/stats") return json({ rows: [] });
  return json({});
};

const OWNER = { id: "u1", role: "owner", is_admin: true, display_name: "Rubí Dacosta", privileges: [] };
const MANAGER = { id: "u2", role: "manager", is_admin: false, display_name: "Daniela Ruiz", privileges: ["costs.view"] };
const me = ROLE === "owner" ? OWNER : MANAGER;

function App() {
  const [tab, setTab] = useState(TAB0);
  const go = (t, params) => { setTab(t); console.log("go", t, params); };
  return (
    <MemoryRouter>
      <AdminShell tab={tab} onTab={setTab} user="dueno@optica.com" onLogout={() => {}} find={null} me={me} groups={navGroupsFor(me)}>
        {tab === "exec" ? <ExecutiveHub me={me} go={go} /> : (
          <div className="adm-section"><h2>{tab}</h2><p className="adm-sub">Pestaña «{tab}»: aquí el cromo sigue la política de color (operativa = color de la tienda; informativa = neutro).</p></div>
        )}
      </AdminShell>
    </MemoryRouter>
  );
}
document.body.style.background = MODE === "dark" ? "#0f1218" : "#f3f4f6";
createRoot(document.getElementById("root")).render(<LanguageProvider><FeedbackProvider><App /></FeedbackProvider></LanguageProvider>);
