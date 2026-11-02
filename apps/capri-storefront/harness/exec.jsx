// Banco de pruebas del Ejecutivo: el AdminShell real con ExecutiveHub dentro y
// un backend simulado (fetch interceptado) para mirar la barra de filtros, el
// selector de tienda y la tira de KPI con sus variaciones, en claro y oscuro.
//   /harness/exec.html?mode=light|dark&tab=exec|salesboard|audit|sellers|storecosts|mysales|pos&store=all|web|<id>&role=owner|manager|seller&lang=es|en&period=month|range…
// La barra de filtros global (GlobalFilterBar.jsx) sale en todas las pestañas
// de BAR_TABS: tienda · período · rango · PDF/Excel/CSV, pegada bajo la cabecera.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "/src/i18n/LanguageContext.jsx";
import { FeedbackProvider } from "/src/components/Feedback.jsx";
import "/src/admin/admin.css";
import AdminShell, { navGroupsFor } from "/src/admin/AdminShell.jsx";
import ExecutiveHub from "/src/admin/ExecutiveHub.jsx";
import SalesBoard from "/src/admin/SalesBoard.jsx";
import AuditLog from "/src/admin/AuditLog.jsx";
import Sellers from "/src/admin/Sellers.jsx";
import StoreCosts from "/src/admin/StoreCosts.jsx";
import StoreStatement from "/src/admin/StoreStatement.jsx";
import Stores from "/src/admin/Stores.jsx";
import MySales from "/src/admin/MySales.jsx";
import { setPeriodState } from "/src/admin/periodStore.js";
import PricingPanel from "../src/admin/PricingPanel.jsx";

const Q = new URLSearchParams(location.search);
const MODE = Q.get("mode") || "light";
const TAB0 = Q.get("tab") || "exec";
const STORE = Q.get("store") || "all";
const ROLE = Q.get("role") || "owner";
try { localStorage.setItem("adm_color_mode", MODE); } catch {}
try { localStorage.setItem("oer_lang", Q.get("lang") || "es"); } catch {}
try { if (STORE === "all") localStorage.removeItem("adm_active_store"); else localStorage.setItem("adm_active_store", STORE); } catch {}
if (Q.get("period")) setPeriodState({ period: Q.get("period"), from: Q.get("from") || "2026-10-01", to: Q.get("to") || "2026-10-31" });
try { sessionStorage.setItem("oer_admin_session", JSON.stringify({ user: "dueno@optica.com", token: "harness", exp: Date.now() + 3600e3 })); } catch {}

const STORES = [
  { id: "est_01", code: "Op1", name: "Fry Family Clinic", color: "#1B7F4C", is_active: true, kind: "partner", settlement_pct: 35, address: "1240 Fry Rd, Katy TX 77449", phone: "(281) 555-0110", created_at: "2025-02-14T10:00:00Z" },
  { id: "est_02", code: "Op2", name: "El Rancho 39", color: "#B5651D", is_active: true, kind: "own", address: "3920 W Flagler St, Miami FL 33134", phone: "(305) 555-0139", created_at: "2025-05-02T10:00:00Z" },
  { id: "est_03", code: "Op3", name: "El Rancho 41", color: "#C2185B", is_active: true, kind: "family", settlement_pct: 40, address: "4100 NW 7th St, Miami FL 33126", phone: "(305) 555-0141", created_at: "2026-01-19T10:00:00Z" },
  { id: "est_04", code: "Op4", name: "Hialeah Gardens", color: "#2563EB", is_active: true, kind: "consignment", settlement_pct: 25, address: "9200 NW 122nd St, Hialeah FL", phone: "(305) 555-0144", created_at: "2026-03-08T10:00:00Z" },
  { id: "est_05", code: "Op5", name: "Kendall Lakes", color: "#7C3AED", is_active: false, kind: "own", address: "13750 SW 88th St, Miami FL", phone: "(305) 555-0155", created_at: "2026-06-21T10:00:00Z" },
  { id: "est_06", code: "Op6", name: "Doral Plaza", color: "#0891B2", is_active: true, kind: "own", address: "8300 NW 53rd St, Doral FL", phone: "(305) 555-0166", created_at: "2026-09-02T10:00:00Z" },
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
  // Panel de precios y costos: maestro (todas las tiendas) o la variación de una.
  if (p === "/admin/pricing/overview") {
    const store = g("store");
    const perStore = store && store !== "all";
    const design = (code, label, tier, prices) => ({ code, label_es: label, label_en: label, category: code === "sv" ? "sv" : code === "bifocal" ? "bifocal" : "prog", tier, prices });
    return json({
      store: perStore ? STORES.find((x) => x.id === store) || null : null,
      frames: {
        rule: { scope: "frame", mode: "percent", value: 35, since: "2026-09-01" },
        case_rule: { scope: "case", mode: "percent", value: 20, since: "2026-09-01" },
        overrides: [
          { product_id: "p1", variant_id: null, title: "DC241", brand: "DiCaprio", sku: "DC241-BG", kind: "frame", base: 66.67, price: 90, since: "2026-10-12", by: "Rubí" },
          { product_id: "p2", variant_id: null, title: "FL 118", brand: "Flexure", sku: "FL118-SV", kind: "frame", base: 51.85, price: 65, since: "2026-10-20", by: "Rubí" },
          { product_id: "p3", variant_id: null, title: "Estuche rígido", brand: "Cases", sku: "CS-RIG", kind: "case", base: 8.33, price: 12, since: "2026-10-02", by: "Rubí" },
        ],
        counts: { frames: 550, cases: 28 },
      },
      lenses: {
        materials: [{ code: "cr39", label_es: "CR-39 (Resina)" }, { code: "poly", label_es: "Policarbonato" }, { code: "1.56", label_es: "Índice 1.56" }, { code: "1.61", label_es: "Índice 1.61" }, { code: "1.67", label_es: "Índice 1.67" }, { code: "1.74", label_es: "Índice 1.74" }],
        designs: [
          design("sv", "Visión Sencilla", null, { cr39: 60, poly: 90, "1.56": 100, "1.61": 100, "1.67": 120, "1.74": 150 }),
          design("bifocal", "Bifocal FT-28", null, { cr39: 130, poly: 140, "1.56": 140, "1.61": 140, "1.67": 160, "1.74": 160 }),
          design("prog-mid", "Progresivo Gama Media", null, { cr39: 180, poly: 180, "1.56": 180, "1.61": 180, "1.67": 200, "1.74": 230 }),
          design("prog-high", "Progresivo Gama Alta", null, { cr39: 240, poly: 240, "1.56": 240, "1.61": 240, "1.67": 280, "1.74": 300 }),
          design("purity-basic", "Purity Basic", "Básico", { cr39: 160, poly: 160, "1.56": 160, "1.61": 160, "1.67": 180, "1.74": 210 }),
          design("dvg-camber", "DVG Camber", "Elite", { cr39: 300, poly: 300, "1.56": 300, "1.61": 300, "1.67": 340, "1.74": 390 }),
        ],
        photo: [
          { code: "photo-grey", label_es: "Fotocromático Grey", sv: 85, bifocal: 110, prog: 90 },
          { code: "trans-s-grey", label_es: "Transitions Gen S Grey", sv: 105, bifocal: 105, prog: 105 },
          { code: "trans-x-grey", label_es: "Transitions XTRActive Grey", sv: 130, bifocal: 130, prog: 130 },
        ],
        ar: [
          { code: "ar-green-basic", label_es: "AR Green Básico", ar_group: "sv", price: 60 },
          { code: "ar-blue-protect", label_es: "AR Blue Protect", ar_group: "sv", price: 90 },
          { code: "adequate", label_es: "Adequate", ar_group: "bifprog", price: 50 },
          { code: "flawless", label_es: "Flawless", ar_group: "bifprog", price: 120 },
        ],
        store: perStore ? { adjust_pct: 5, cells: [{ kind: "base", key: "sv:poly", value: 9500 }] } : null,
      },
      commissions: { default_pct: 5, sellers: [{ code: "DAN", name: "Daniela Ruiz", pct: 6 }, { code: "JOS", name: "José Pérez", pct: 5 }] },
      costs: {
        rules: [
          { id: "r1", kind: "frame_brand", label: "Montura DiCaprio", value: 24, enabled: true },
          { id: "r2", kind: "lens_design", label: "Lente progresivo gama alta", value: 101, enabled: true },
          { id: "r3", kind: "order_percent", label: "Laboratorio", value: 8, enabled: !perStore },
          { id: "r4", kind: "order_fixed", label: "Empaque", value: 2.5, enabled: true },
        ],
        fixed: [{ id: "f1", label: "Renta del local", amount: 213, frequency: "monthly" }, { id: "f2", label: "Sueldos", amount: 484, frequency: "monthly" }],
        variable: [{ id: "v1", label: "Mensajería", amount: 30, frequency: "monthly" }],
        taxes: { rate_pct: 8.25, source: "store_setting" },
      },
    });
  }
  if (p === "/admin/pos/context") return json({ role: ROLE, is_admin: ROLE === "owner", stores: ROLE === "owner" ? STORES : STORES.slice(1, 2), assigned: { establishment_id: "est_02" }, privileges: [], payment_methods: [{ code: "cash", builtin: true }, { code: "card", builtin: true }] });
  if (p === "/admin/sales-analytics/summary") { const f = figures(g("from"), g("to"), g("stores")); return json({ current: { discount: Math.round(f.sales * 0.03) }, previous: { discount: 100 }, balance_due: 1240.5, insurance_due: 380 }); }
  if (p === "/admin/sales-analytics/me") { const f = figures("2026-10-01", "2026-10-31", ""); return json({ today: { total: 820, count: 4, avg_ticket: 205 }, week: { total: 3900, count: 19, avg_ticket: 205 }, month: f, seller_code: "DAN", workplace: { store: STORES[1], terminal: { code: "T1", name: "Mostrador" }, cash_open: true }, commission: { pct: 5, amount: 412 }, goal: { amount: 12000, done: f.sales, left: Math.max(0, 12000 - f.sales) }, balance_due: 310, recent: [], ready: [] }); }
  if (p === "/admin/audit") { const mk = (i, action) => ({ id: `ev${i}`, actor_user_id: "u1", establishment_id: i % 2 ? "est_02" : null, action, entity: "seller", entity_id: null, before: { pct: 5 }, after: { pct: 6 }, created_at: new Date(Date.now() - i * 36e5 * 7).toISOString() }); return json({ events: [mk(1, "seller.update"), mk(2, "seller.update"), mk(3, "price.update"), mk(40, "price.update")], actions: ["seller.update", "price.update"] }); }
  if (p === "/admin/team") return json({ team: [{ id: "u1", email: "dueno@optica.com", first_name: "Rubí", last_name: "Dacosta" }] });
  if (p === "/admin/sellers") return json({ sellers: [{ id: "s1", code: "DAN", name: "Daniela Ruiz", email: "dan@optica.com", commission_pct: 5, active: true, establishment_id: "est_02", terminal_id: "t1", referral_url: "https://rubilens.com/?ref=DAN", dashboard_url: "https://rubilens.com/vendedor?t=x", social: {} }, { id: "s2", code: "JOS", name: "José Pérez", commission_pct: 5, active: true, establishment_id: "est_03", terminal_id: "t2", referral_url: "https://rubilens.com/?ref=JOS", dashboard_url: "https://rubilens.com/vendedor?t=y", social: {} }] });
  if (p === "/admin/pos/terminals") return json({ terminals: [{ id: "t1", code: "T1", establishment_id: "est_02", is_active: true }, { id: "t2", code: "T1", establishment_id: "est_03", is_active: true }] });
  if (p === "/admin/store-costs/pnl") return json({ stores: STORES.slice(1, 3).map((s, i) => ({ establishment_id: s.id, code: s.code, kind: "own", net_sales: 12000 - i * 3000, cogs: 4000, payment_fees: 250, commissions: 600, variable_manual: 300, contribution: 6850, fixed: 3200, shared: 400, result: 3250, contribution_pct: 57, break_even: 6300 })), total: { net_sales: 21000, cogs: 8000, payment_fees: 500, commissions: 1200, variable_manual: 600, contribution: 10700, fixed: 6400, shared: 800, result: 3500, contribution_pct: 51, break_even: 12600 }, sellers: [{ seller_code: "DAN", net_sales: 9000, pct: 5, commission: 450 }], cost_rules_missing: false });
  // Estado de cuenta: el servidor manda `business` con los valores por defecto
  // del backend (RUBI LENS) — el documento debe enseñar la óptica, no eso.
  if (p === "/admin/pos/statement") {
    const id = g("establishment_id");
    const all = id === "all";
    const store = STORES.find((x) => x.id === id) || STORES[1];
    const from = g("from") || "2026-10-01";
    const to = g("to") || "2026-10-31";
    const mkSale = (i) => {
      const total = 18000 + i * 4300;
      const paid = i % 3 === 0 ? Math.round(total / 2) : total;
      return {
        id: `s${i}`, number: `${store.code}-0001${10 + i}`, store_code: all ? STORES[1 + (i % 3)].code : store.code,
        date: `${from}T1${i}:05:00Z`, day: `${from.slice(0, 8)}${String(3 + i).padStart(2, "0")}`,
        seller_code: i % 2 ? "DAN" : "JOS", customer_name: ["Marilin García", "Ana Ruiz", "Luis Soto", null][i % 4],
        delivery: i === 2 ? "ship" : "pickup", status: i === 4 ? "voided" : "completed",
        items: [{ title: "DC241", brand: "DiCaprio", variant: "Black Gold", kind: "frame", qty: 1, frame_cents: 9000, lens_cents: 9000, list_cents: total, lens: { design: "prog-mid", material: "poly", photo: null, ar: "ar-green" } }],
        list_cents: total, discount_cents: i % 2 ? 1500 : 0, tax_cents: 0, total_cents: total, paid_cents: paid, insurance_cents: i === 1 ? 4000 : 0, balance_cents: total - paid,
        payments: [{ method_code: i % 2 ? "cash" : "credit", method: null, kind: "deposit", amount_cents: paid, reference: null, at: `${from}T1${i}:10:00Z` }],
      };
    };
    const sales = [0, 1, 2, 3, 4, 5].map(mkSale);
    const live = sales.filter((x) => x.status !== "voided");
    const sum = (k) => live.reduce((a, x) => a + x[k], 0);
    const by = (key) => [...live.reduce((map, x) => map.set(x[key], (map.get(x[key]) || 0) + x.total_cents), new Map())].map(([k, v]) => [k, v]);
    return json({
      number: `EST-${all ? "ALL" : store.code}-${from.slice(0, 4)}${from.slice(5, 7)}`,
      store: all ? { code: "ALL", name: "RUBI LENS", address: null, phone: null, kind: "all", settlement_pct: null, receipt_note: null }
        : { code: store.code, name: store.name, address: "3920 W Flagler St, Miami FL", phone: "(305) 555-0139", kind: store.id === "est_03" ? "family" : "own", settlement_pct: store.id === "est_03" ? 40 : null, receipt_note: "Garantía de 30 días en monturas." },
      business: { name: "RUBI LENS", legal_name: "RUBI LENS LLC", address: "8300 NW 53rd St, Doral FL", url: "https://www.rubilens.com" },
      period: { from, to },
      generated_at: new Date().toISOString(),
      sales,
      totals: {
        count: live.length, voided_count: sales.length - live.length,
        list_cents: sum("list_cents"), discount_cents: sum("discount_cents"), tax_cents: 0, total_cents: sum("total_cents"),
        paid_cents: sum("paid_cents"), insurance_cents: sum("insurance_cents"), balance_cents: sum("balance_cents"),
        by_method: [{ code: "cash", label: null, cents: Math.round(sum("paid_cents") * 0.4) }, { code: "credit", label: null, cents: sum("paid_cents") - Math.round(sum("paid_cents") * 0.4) }],
        by_seller: by("seller_code").map(([k, v]) => ({ seller_code: k, count: live.filter((x) => x.seller_code === k).length, total_cents: v })),
        by_day: by("day").map(([k, v]) => ({ date: k, count: live.filter((x) => x.day === k).length, total_cents: v })),
      },
      settlement: !all && store.id === "est_03" ? { pct: 40, base_cents: sum("total_cents"), amount_cents: Math.round(sum("total_cents") * 0.4) } : null,
      truncated: false,
    });
  }
  if (p === "/admin/store-costs") return json({ items: [{ id: "c1", establishment_id: "est_02", kind: "fixed", category: "rent", description: "Local", amount: 2400, frequency: "monthly", starts_on: "2026-01-01" }] });
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
  if (p === "/admin/sellers/stats") return json({ sellers: [{ id: "s1", code: "DAN", name: "Daniela Ruiz", orders: 23, revenue: 8420, commission_pct: 5, commission: 421, share_pct: 61, last_order_at: "2026-10-30T10:00:00Z", by_source: [] }, { id: "s2", code: "JOS", name: "José Pérez", orders: 14, revenue: 5300, commission_pct: 5, commission: 265, share_pct: 39, last_order_at: "2026-10-29T10:00:00Z", by_source: [] }], unattributed: { orders: 3, revenue: 600 }, sources: [] });
  return json({});
};

const OWNER = { id: "u1", role: "owner", is_admin: true, display_name: "Rubí Dacosta", privileges: [] };
const MANAGER = { id: "u2", role: "manager", is_admin: false, display_name: "Daniela Ruiz", privileges: ["costs.view"], store_ids: ["est_02"] };
const SELLER = { id: "u3", role: "seller", is_admin: false, display_name: "Daniela Ruiz", privileges: [], seller_code: "DAN", store_ids: ["est_02"] };
const me = ROLE === "owner" ? OWNER : ROLE === "seller" ? SELLER : MANAGER;
const SCREENS = { pricing: (go) => <PricingPanel me={me} go={go} sellers={[]} />, exec: (go) => <ExecutiveHub me={me} go={go} />, salesboard: (go) => <SalesBoard me={me} go={go} tabs={["costs"]} />, audit: () => <AuditLog me={me} />, sellers: (go) => <Sellers me={me} go={go} />, storecosts: () => <StoreCosts me={me} />, statement: (go) => <StoreStatement me={me} go={go} />, stores: () => <Stores />, mysales: (go) => <MySales me={me} go={go} /> };

function App() {
  const [tab, setTab] = useState(TAB0);
  const go = (t, params) => { setTab(t); console.log("go", t, params); };
  return (
    <MemoryRouter>
      <AdminShell tab={tab} onTab={setTab} user="dueno@optica.com" onLogout={() => {}} find={null} me={me} groups={navGroupsFor(me)}>
        {SCREENS[tab] ? SCREENS[tab](go) : (
          <div className="adm-section"><h2>{tab}</h2><p className="adm-sub">Pestaña «{tab}»: aquí el cromo sigue la política de color (operativa = color de la tienda; informativa = neutro).</p></div>
        )}
      </AdminShell>
    </MemoryRouter>
  );
}
document.body.style.background = MODE === "dark" ? "#0f1218" : "#f3f4f6";
createRoot(document.getElementById("root")).render(<LanguageProvider><FeedbackProvider><App /></FeedbackProvider></LanguageProvider>);
