// La guía contable enseña un ejemplo con números: aquí se comprueba que suma,
// que el estado y el «vector fiscal» llegan al mismo resultado, y que cada
// frecuencia se lleva al mes como en el libro. `node scripts/test-finance-guide.mjs`.
import assert from "node:assert/strict";
import { EXAMPLE_MONTH, EXAMPLE_ORDER, guideMonth, guideOrder } from "../src/admin/finance/guideExample.js";
import { cadenceOf, landsOf, percentSharesOf, whoOf } from "../src/admin/finance/explain.js";

let n = 0;
const test = (name, fn) => { fn(); n += 1; console.log(`ok  ${name}`); };
const m = guideMonth();
const item = (k) => m.items.find((i) => i.key === k);

test("frequencies are carried to a month like the ledger does", () => {
  assert.equal(item("rent").monthly, 3000);
  assert.equal(item("cleaning").monthly, 433.33); // 100 × 52 ÷ 12
  assert.equal(item("insurance").monthly, 100); // 1200 ÷ 12
  assert.equal(item("license").monthly, 50);
  assert.equal(item("packaging").monthly, 200); // 2 × 100 sales
});
test("a shared cost charges the store its part only", () => {
  assert.equal(item("software").monthly, 400);
  assert.equal(item("software").charged, 160);
});
test("the month adds up", () => {
  assert.equal(m.salesTax, 700);
  assert.equal(m.charged, 20700);
  assert.equal(m.cogs, 7000);
  assert.equal(m.grossProfit, 13000);
  assert.equal(m.commissions, 1000);
  assert.equal(m.variable, 1927);
  assert.equal(m.contribution, 11073);
  assert.equal(m.contributionPct, 55.4);
  assert.equal(m.fixed, 3743.33);
  assert.equal(m.result, 7329.67);
  assert.equal(m.breakEven, 6761.18);
});
test("the fiscal vector reaches the same result as the store result", () => {
  const net = m.fiscal.find((l) => l.key === "net_income");
  assert.equal(net.amount, m.result);
  const expenses = m.fiscal.filter((l) => l.expense);
  assert.equal(Math.round(expenses.reduce((s, e) => s + e.amount, 0) * 100) / 100, m.opex);
  assert.equal(expenses.find((e) => e.key === "supplies").amount, 500); // supplies 300 + packaging 200
  assert.deepEqual(m.fiscal.map((l) => l.schedule_c), ["1", "4", "5", "10", "15", "18", "20b", "21", "22", "23", "27a", "28", "31"]);
  assert.ok(m.fiscal.every((l) => l.schedule_c && l.f1120s));
});
test("sales tax is not in the result", () => {
  assert.equal(m.fiscal.find((l) => l.key === "revenue").amount, EXAMPLE_MONTH.net);
});
test("the online order: 3 × cost, $30 delivery, gateway on what was paid", () => {
  const o = guideOrder();
  assert.equal(o.framePrice, 75);
  assert.equal(o.paid, 165);
  assert.equal(o.gateway, 5.09);
  assert.equal(o.left, 104.91);
  assert.equal(EXAMPLE_ORDER.delivery, 30);
});
test("a row says whose it is", () => {
  assert.equal(whoOf({ establishment_id: "s1" }), "own");
  assert.equal(whoOf({ establishment_id: null }), "shared");
  assert.equal(whoOf({ establishment_id: "s1", per_sale: true }), "perSaleOwn");
  assert.equal(whoOf({ establishment_id: null, per_sale: true }), "perSaleAll");
});
test("…how often, and what it weighs a month", () => {
  assert.deepEqual(cadenceOf({ amount: "100", frequency: "weekly" }), { key: "weekly", amount: 100, monthly: 433.33, times: 52, over: 12 });
  assert.deepEqual(cadenceOf({ amount: 90, frequency: "quarterly" }), { key: "quarterly", amount: 90, monthly: 30, times: 1, over: 3 });
  assert.deepEqual(cadenceOf({ amount: 6000, frequency: "one_time", amortize_months: 12 }), { key: "oneTimeSpread", amount: 6000, monthly: 500, n: 12 });
  assert.deepEqual(cadenceOf({ amount: 250, frequency: "one_time", starts_on: "2026-11-03" }), { key: "oneTime", amount: 250, monthly: 250, month: "2026-11" });
  assert.deepEqual(cadenceOf({ amount: 2, per_sale: true }, 37), { key: "perSale", amount: 2, monthly: 74, n: 37 });
  assert.equal(cadenceOf({ amount: 5, frequency: "nope" }).key, "monthly");
});
test("…and where it lands", () => {
  assert.deepEqual(landsOf({ kind: "fixed", tax_category: "rent" }), { bucket: "fixed", tax: "rent", schedule_c: "20b", f1120s: "11" });
  assert.equal(landsOf({ kind: "fixed", per_sale: true, tax_category: "supplies" }).bucket, "variable");
  assert.equal(landsOf({ kind: "variable", tax_category: "cost_of_goods" }).bucket, "cogs");
  assert.equal(landsOf({ kind: "fixed", category: "licenses" }).schedule_c, "23");
});
test("fixed percentages of a shared cost, in store order", () => {
  const stores = [{ id: "a", code: "Op1" }, { id: "b", code: "Op2" }, { id: "c", code: "Op3" }];
  assert.deepEqual(percentSharesOf({ establishment_id: null, allocation: { method: "percent", shares: { b: 60, a: 40 } } }, stores).map((x) => `${x.code} ${x.pct}`), ["Op1 40", "Op2 60"]);
  assert.deepEqual(percentSharesOf({ establishment_id: null, allocation: { method: "sales" } }, stores), []);
  assert.deepEqual(percentSharesOf({ establishment_id: "a", allocation: { method: "percent", shares: { a: 100 } } }, stores), []);
});
console.log(`\n${n} tests passed`);
