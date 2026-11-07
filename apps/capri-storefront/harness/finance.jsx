// Banco de pruebas de «Reglas y comisiones» en acordeones y del estado de
// resultados: carga el mismo armazón que exec.jsx y, por encima de su fetch
// simulado, contesta /admin/finance/* con datos de ejemplo.
//   /harness/finance.html?tab=products&sub=rules[-statement]&mode=light|dark&lang=es|en&store=all|est_02
import "./exec.jsx";

const STORES = [
  { id: "est_01", code: "Op1", name: "Fry Family Clinic", color: "#1B7F4C", is_active: true, kind: "partner" },
  { id: "est_02", code: "Op2", name: "El Rancho 39", color: "#B5651D", is_active: true, kind: "own" },
  { id: "est_03", code: "Op3", name: "El Rancho 41", color: "#C2185B", is_active: true, kind: "family" },
];
const item = (o) => ({ kind: "fixed", category: "rent", tax_category: "rent", description: "", amount: 0, monthly: 0, frequency: "monthly", amortize_months: null, starts_on: "2026-01-01", ends_on: null, vendor: null, notes: null, active: true, per_sale: false, allocation: null, ...o });
let ITEMS = [
  item({ id: "c1", establishment_id: "est_02", description: "Renta local Flagler", amount: 2500, monthly: 2500 }),
  item({ id: "c2", establishment_id: "est_03", description: "Renta local NW 7th", amount: 1800, monthly: 1800 }),
  item({ id: "c3", establishment_id: "est_02", description: "Nómina óptica", category: "salaries", tax_category: "payroll", amount: 1200, frequency: "biweekly", monthly: 2600 }),
  item({ id: "c4", establishment_id: "est_02", kind: "variable", description: "Luz", category: "utilities", tax_category: "utilities", amount: 180, monthly: 180 }),
  item({ id: "c5", establishment_id: "est_03", kind: "variable", description: "Publicidad Instagram", category: "other", tax_category: "advertising", amount: 75, frequency: "weekly", monthly: 325 }),
  item({ id: "c6", establishment_id: null, description: "Software (POS + contabilidad)", category: "subscriptions", tax_category: "software", amount: 300, monthly: 300, allocation: { method: "sales" } }),
  item({ id: "c7", establishment_id: null, description: "Contador", category: "accounting", tax_category: "professional_fees", amount: 1350, frequency: "quarterly", monthly: 450, allocation: { method: "percent", shares: { est_01: 20, est_02: 50, est_03: 30 } } }),
  item({ id: "c8", establishment_id: null, kind: "variable", description: "Bolsa + paño", category: "supplies", tax_category: "supplies", amount: 0.75, per_sale: true, monthly: 30, allocation: { method: "sales" } }),
  item({ id: "c9", establishment_id: "est_02", description: "Licencia municipal", category: "licenses", tax_category: "taxes_licenses", amount: 600, frequency: "annual", monthly: 50 }),
  item({ id: "c10", establishment_id: "est_03", description: "Seguro (apagado)", category: "insurance", tax_category: "insurance", amount: 90, monthly: 90, active: false }),
];
const SELLERS = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, code: ["DAN", "JOS", "ANA", "LUI", "MAR", "PED", "SOF", "CAR", "ELE", "RAU", "TER", "VIC", "NOE", "IVA"][i], name: ["Daniela Ruiz", "José Pérez", "Ana López", "Luis Gómez", "María Díaz", "Pedro Sánchez", "Sofía Vendedora", "Carlos Influencer", "Elena Torres", "Raúl Castro", "Teresa Vega", "Víctor Núñez", "Noemí Paz", "Iván Ríos"][i], pct: [5, 5, 7, 8, 6, 7, 8, 5, 7, 7, 6, 5, 7, 7][i], active: i !== 12, establishment_id: STORES[i % 3].id }));
const PNL = {
  month: "2026-11",
  total: { net_sales: 21000, cogs: 8000, payment_fees: 500, commissions: 1200, variable_manual: 600, fixed: 6400, shared: 800, variable_total: 2300, contribution: 10700, contribution_pct: 51, fixed_total: 7200, result: 3500, break_even: 14117.65 },
  stores: STORES.map((s, i) => ({ establishment_id: s.id, code: s.code, name: s.name, kind: s.kind, sales_count: [12, 18, 10][i], net_sales: [6000, 9000, 6000][i], cogs: 2600, payment_fees: 160, commissions: 400, variable_manual: 200, fixed: [0, 4400, 1800][i], shared: [150, 375, 275][i], variable_total: 760, contribution: [2640, 5640, 2640][i], contribution_pct: 44, fixed_total: [150, 4775, 2075][i], result: [2490, 865, 565][i], break_even: [340.9, 7616, 4713][i], settlement: null })),
  sellers: [{ seller_code: "DAN", net_sales: 4200, pct: 5, commission: 210 }, { seller_code: "ANA", net_sales: 3100, pct: 7, commission: 217 }],
};
const RULES = [
  { id: "r1", kind: "order_fixed", match_key: "lab", label: "Laboratorio (montaje)", amount: 1, unit: "fixed", active: true, enabled: true, sort_order: 0 },
  { id: "r2", kind: "order_fixed", match_key: "packaging", label: "Empaque", amount: 0.5, unit: "fixed", active: true, enabled: false, sort_order: 0 },
  { id: "r3", kind: "order_percent", match_key: "payment_fee", label: "Comisión del cobro (porcentaje)", amount: 2.9, unit: "percent", active: true, enabled: true, sort_order: 0 },
  { id: "r4", kind: "payment_fixed", match_key: "payment_fee_fixed", label: "Comisión del cobro (fija por pedido)", amount: 0.3, unit: "fixed", active: true, enabled: true, sort_order: 0 },
];
let DEFAULT = 7;

const OPEX = ["rent", "utilities", "payroll", "payroll_taxes", "insurance", "advertising", "software", "professional_fees", "bank_fees", "repairs", "supplies", "taxes_licenses", "depreciation", "other"];
function st(k) {
  const pos = 6000 * k, web = k > 1 ? 900 : 0;
  const cogs = { frames: 1400 * k, lenses: 900 * k, treatments: 200 * k, per_order: 30 * k, total: 2530 * k, items: 45, total_all: 2530 * k + 45 };
  const opex = Object.fromEntries(OPEX.map((c) => [c, 0]));
  Object.assign(opex, { rent: 2500 * (k > 1 ? 1 : 0.6), payroll: 2600 * (k > 1 ? 1 : 0.5), utilities: 180, advertising: 325, software: 100, professional_fees: 150, supplies: 22.5, taxes_licenses: 50 });
  opex.card_fees = 160 * k; opex.commissions = 400 * k;
  opex.total = OPEX.reduce((a, c) => a + opex[c], 0) + opex.card_fees + opex.commissions;
  const revenue = pos + web, gross_profit = revenue - cogs.total_all, operating_income = gross_profit - opex.total;
  const r = (v) => Math.round(v * 1000) / 10;
  return { revenue: { pos, web, total: revenue }, sales_tax: 120 * k, gross_sales: revenue + 120 * k, sales_count: 12 * k, cogs, gross_profit, opex, operating_income, net_income: operating_income,
    memo: { gross_contribution: revenue - cogs.total - opex.card_fees - opex.commissions, contribution: revenue - cogs.total - opex.card_fees - opex.commissions - 200, fixed_total: 5800, variable_items: 200, per_sale_items: 22.5, break_even: 9876.5 },
    pct: { gross_margin: r(gross_profit / revenue), operating_margin: r(operating_income / revenue), net_margin: r(operating_income / revenue), contribution_margin: 44.1 } };
}
function statement(url) {
  const group = url.searchParams.get("group") || "month";
  const periods = group === "year" ? ["2026"] : group === "quarter" ? ["2026-Q3", "2026-Q4"] : ["2026-08", "2026-09", "2026-10", "2026-11"];
  const entities = [...STORES.map((s) => ({ id: s.id, code: s.code, name: s.name, color: s.color, kind: "store" })), { id: "web", code: "WEB", name: "Online", color: null, kind: "web" }, { id: "total", code: "TOTAL", name: "Consolidated", color: null, kind: "total" }];
  const statements = {};
  for (const p of [...periods, "all"]) statements[p] = Object.fromEntries(entities.map((e, i) => [e.id, st(p === "all" ? 4 : 1 + (i % 3))]));
  const tax_lines = { revenue: { schedule_c: "1", f1120s: "1a" }, cogs: { schedule_c: "4 (Part III)", f1120s: "2 (Form 1125-A)" }, cost_of_goods: { schedule_c: "4 (Part III, 39)", f1120s: "2" }, gross_profit: { schedule_c: "5", f1120s: "3" }, advertising: { schedule_c: "8", f1120s: "16" }, commissions: { schedule_c: "10", f1120s: "19" }, card_fees: { schedule_c: "27a (Part V)", f1120s: "19" }, rent: { schedule_c: "20b", f1120s: "11" }, payroll: { schedule_c: "26", f1120s: "8" }, utilities: { schedule_c: "25", f1120s: "19" }, opex: { schedule_c: "28", f1120s: "20" }, net_income: { schedule_c: "31", f1120s: "21" }, software: { schedule_c: "18", f1120s: "19" }, professional_fees: { schedule_c: "17", f1120s: "19" }, supplies: { schedule_c: "22", f1120s: "19" }, taxes_licenses: { schedule_c: "23", f1120s: "12" } };
  return { from: "2026-08-01", to: "2026-11-30", group, months: ["2026-08", "2026-09", "2026-10", "2026-11"], periods, entities, statements, tax_lines, business: { name: "RUBI LENS", legal_name: "Rubi Lens LLC", timezone: "America/Chicago", currency: "USD" }, generated_at: new Date().toISOString() };
}
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const inner = window.fetch;
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.origin);
  const p = url.pathname.replace("/medusa", "");
  const method = (init?.method || "GET").toUpperCase();
  if (p === "/admin/finance/rules") return json({ month: "2026-11", stores: STORES, sales_count: { est_01: 12, est_02: 18, est_03: 10 }, items: ITEMS, rules: RULES, commissions: { default_pct: DEFAULT, sellers: SELLERS }, taxes: { rate_pct: 7, source: "database" }, profit_target_pct: 30, pnl: PNL });
  if (p === "/admin/finance/statement") return json(statement(url));
  if (p === "/admin/finance/rules/import") return json({ changes: [{ sheet: "costs", op: "update", id: "c1", label: "Renta local Flagler", fields: { amount_cents: [250000, 260000], frequency: ["monthly", "biweekly"] } }, { sheet: "costs", op: "create", id: null, label: "Bolsa", fields: { establishment_id: [null, "est_02"], amount_cents: [null, 75], per_sale: [null, true] } }], errors: [], unchanged: 12, counts: { create: 1, update: 1 }, applied: false });
  if (p === "/admin/pricing/commissions" && method === "GET") return json({ default_pct: DEFAULT });
  if (p === "/admin/pricing/commissions" && method === "POST") { const b = JSON.parse(init.body); if (b.default_pct != null) DEFAULT = b.default_pct; return json({ ok: true }); }
  if (p.startsWith("/admin/store-costs") && method === "POST") return json({ ok: true });
  return inner(input, init);
};
