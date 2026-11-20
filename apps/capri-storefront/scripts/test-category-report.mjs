// The panel's model of the accounting report by category
// (src/admin/finance/categoryReport.js): rows add up to the statement, filters
// and search behave, and the columns read the right figures.
import assert from "node:assert/strict";
import { categoriesOf, columnsOf, costShares, rowsOf, SECTION_TOTAL } from "../src/admin/finance/categoryReport.js";

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };

const opex0 = Object.fromEntries(["rent", "utilities", "payroll", "payroll_taxes", "insurance", "advertising", "software", "professional_fees", "bank_fees", "repairs", "supplies", "taxes_licenses", "depreciation", "other"].map((k) => [k, 0]));
const st = (o) => {
  const cogs = { frames: 0, lenses: 0, treatments: 0, per_order: 0, items: 0, ...o.cogs };
  cogs.total = cogs.frames + cogs.lenses + cogs.treatments + cogs.per_order;
  cogs.total_all = cogs.total + cogs.items;
  const opex = { ...opex0, card_fees: 0, commissions: 0, ...o.opex };
  opex.total = Object.values(opex).reduce((a, b) => a + b, 0);
  const revenue = { pos: 0, web: 0, shipping: 0, ...o.revenue };
  revenue.total = revenue.pos + revenue.web + revenue.shipping;
  const gross_profit = revenue.total - cogs.total_all;
  const net_income = gross_profit - opex.total;
  return { revenue, cogs, opex, gross_profit, operating_income: net_income, net_income, sales_tax: 0, sales_count: 2, pct: { net_margin: revenue.total ? Math.round((net_income / revenue.total) * 1000) / 10 : null } };
};
const oct = st({ revenue: { pos: 1000 }, cogs: { frames: 200, per_order: 20 }, opex: { rent: 500, supplies: 4, commissions: 30 } });
const nov = st({ revenue: { pos: 500 }, cogs: { frames: 100, per_order: 10 }, opex: { rent: 500, supplies: 2, commissions: 15 } });
const all = st({ revenue: { pos: 1500 }, cogs: { frames: 300, per_order: 30 }, opex: { rent: 1000, supplies: 6, commissions: 45 } });
const DOC = {
  periods: ["2026-10", "2026-11"],
  months: ["2026-10", "2026-11"],
  entities: [{ id: "e1", code: "Op1", name: "One", kind: "store" }, { id: "e3", code: "Op3", name: "Three", kind: "store" }, { id: "total", code: "TOTAL", name: "C", kind: "total" }],
  statements: { "2026-10": { total: oct }, "2026-11": { total: nov }, all: { total: all, e1: st({ revenue: { pos: 1400 }, cogs: { frames: 300, per_order: 26 }, opex: { rent: 1000, commissions: 45 } }), e3: st({ revenue: { pos: 100 }, cogs: { per_order: 4 }, opex: { supplies: 6 } }) } },
  cogs_detail: [
    { key: "frame_brand:flexure", label: "Flexure", line: "frames", total: 300, by_period: { "2026-10": 200, "2026-11": 100 }, by_entity: { e1: 300 } },
    { key: "order_fixed:laboratorio", label: "Laboratorio", line: "per_order", total: 30, by_period: { "2026-10": 20, "2026-11": 10 }, by_entity: { e1: 26, e3: 4 } },
  ],
  items: [
    { id: "rent1", tax_category: "rent", bucket: "fixed", per_sale: false, description: "Renta Katy", vendor: "Landlord LLC", frequency: "monthly", owner_store: "Op1", total: 1000, by_period: { "2026-10": 500, "2026-11": 500 }, by_entity: { e1: 1000 } },
    { id: "kit", tax_category: "supplies", bucket: "variable", per_sale: true, description: "Estuche, líquido y bolsa", vendor: null, frequency: "per_sale", owner_store: "Op3", total: 6, by_period: { "2026-10": 4, "2026-11": 2 }, by_entity: { e3: 6 } },
  ],
  sellers: [{ key: "u1", seller_id: "u1", seller_code: "ANA", name: "Ana", net_sales: 1500, total: 45, by_period: { "2026-10": 30, "2026-11": 15 }, by_entity: {} }],
};

check("columns by period: each period + Total, reading the consolidated statement", () => {
  const cols = columnsOf(DOC, "periods");
  assert.deepEqual(cols.map((c) => c.key), ["2026-10", "2026-11", "all"]);
  assert.equal(cols[0].s, oct);
  assert.equal(cols[2].amountOf({ total: 9, by_period: {} }), 9);
});
check("columns by store: each store + Total; a seller has no store split (null)", () => {
  const cols = columnsOf(DOC, "stores");
  assert.deepEqual(cols.map((c) => c.key), ["e1", "e3", "all"]);
  assert.equal(cols[0].amountOf({ by_entity: null }), null);
});
check("every row of a section adds up to the statement's section total; the result rows close", () => {
  const cols = columnsOf(DOC, "periods");
  const rows = rowsOf(DOC, cols);
  for (const section of ["revenue", "cogs", "opex"]) {
    const sum = rows.find((r) => r.type === "sum" && r.section === section);
    for (const c of cols) assert.equal(sum.values[c.key], SECTION_TOTAL[section](c.s), `${section} ${c.key}`);
    assert.equal(sum.complete, true);
  }
  const net = rows.find((r) => r.id === "net_income");
  assert.equal(net.values.all, 1500 - 330 - 1051);
  assert.equal(net.pct, Math.round((119 / 1500) * 1000) / 10);
});
check("zero categories are hidden unless asked; details only when open", () => {
  const cols = columnsOf(DOC, "periods");
  const closed = rowsOf(DOC, cols);
  assert.equal(closed.some((r) => r.id === "revenue.web"), false);
  assert.equal(closed.some((r) => r.type === "det"), false);
  assert.equal(rowsOf(DOC, cols, { showZero: true }).some((r) => r.id === "revenue.web"), true);
  const open = rowsOf(DOC, cols, { open: (id) => id === "cogs.per_order" });
  const det = open.filter((r) => r.type === "det");
  assert.deepEqual(det.map((r) => r.label), ["Laboratorio"]);
  assert.deepEqual(det[0].values, { "2026-10": 20, "2026-11": 10, all: 30 });
});
check("category filter: only the chosen ones, partial subtotals and the chosen costs' total (no net income)", () => {
  const cols = columnsOf(DOC, "periods");
  const rows = rowsOf(DOC, cols, { selected: new Set(["opex.rent", "opex.supplies"]) });
  assert.deepEqual(rows.filter((r) => r.type === "cat").map((r) => r.id), ["opex.rent", "opex.supplies"]);
  assert.equal(rows.find((r) => r.type === "sum").complete, false);
  assert.equal(rows.some((r) => r.id === "net_income"), false);
  assert.equal(rows.find((r) => r.id === "selected_costs").values.all, 1006);
});
check("search: finds a cost item by vendor and shows only the matching item", () => {
  const cols = columnsOf(DOC, "periods");
  const rows = rowsOf(DOC, cols, { q: "landlord", matchText: (d) => `${d.label} ${d.item?.vendor || ""}` });
  assert.deepEqual(rows.filter((r) => r.type === "cat").map((r) => r.id), ["opex.rent"]);
  assert.deepEqual(rows.filter((r) => r.type === "det").map((r) => r.label), ["Renta Katy"]);
});
check("by store, a seller's commission reads «—» per store and its total in Total", () => {
  const cols = columnsOf(DOC, "stores");
  const rows = rowsOf(DOC, cols, { open: () => true });
  const ana = rows.find((r) => r.type === "det" && r.label === "Ana");
  assert.deepEqual(ana.values, { e1: null, e3: null, all: 45 });
  const kit = rows.find((r) => r.type === "det" && r.label === "Estuche, líquido y bolsa");
  assert.deepEqual(kit.values, { e1: 0, e3: 6, all: 6 });
});
check("cost shares: biggest first, adding to 100 %", () => {
  const s = costShares(DOC);
  assert.equal(s[0].id, "opex.rent");
  assert.ok(Math.abs(s.reduce((a, x) => a + x.share, 0) - 100) < 0.5);
  assert.equal(categoriesOf().length, 24);
});
console.log(`${n} passed`);
