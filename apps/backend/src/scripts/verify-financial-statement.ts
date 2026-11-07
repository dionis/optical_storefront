/**
 * Conciliación del estado de resultados contra el resultado por tienda y el
 * Ejecutivo, sobre la base real (solo LEE; no escribe nada):
 *
 *   npx medusa exec ./src/scripts/verify-financial-statement.ts
 *   FIN_MONTHS=2026-10,2026-11 npx medusa exec ./src/scripts/verify-financial-statement.ts
 *
 * Por cada mes: columna de cada tienda del estado = `monthPnl` (neto, costo,
 * fees, comisiones, fijos, compartidos, resultado) y el consolidado = el
 * Ejecutivo (`salesInsights`: neto, costo, fee, comisión, ganancia) del mismo
 * mes. Imprime esperado / real / diferencia; termina con código 1 si algo no
 * cuadra al centavo.
 */
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { localParts } from "../lib/alerts";
import { buildStatement, lastDayOf, loadLedger, statementOf, WEB_ENTITY } from "../lib/financial-statement";
import { salesInsights } from "../lib/sales-insights";
import { monthPnl } from "../lib/store-pnl";
import { tenant } from "../lib/tenant";

export default async function run({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const today = localParts(new Date(), tenant().timezone).date.slice(0, 7);
  const months = (process.env.FIN_MONTHS || today).split(",").map((m) => m.trim()).filter(Boolean);
  let checks = 0;
  let diffs = 0;
  const eq = (label: string, expected: number, actual: number) => {
    checks++;
    const d = Math.round(actual - expected);
    if (d !== 0) diffs++;
    logger.info(`${d === 0 ? "ok  " : "DIFF"} ${label}: expected ${expected} · actual ${actual}${d ? ` · diff ${d}` : ""}`);
  };
  const c = (v: number | null | undefined) => Math.round(Number(v ?? 0) * 100);

  for (const month of months) {
    const [pnl, loaded, ex] = await Promise.all([
      monthPnl(container, month, null),
      loadLedger(container, [month], null, { web: true }),
      salesInsights(container, { from: `${month}-01`, to: lastDayOf(month), stores: null }, "day", "establishment"),
    ]);
    const lm = loaded.ledger[0];
    for (const s of pnl.stores) {
      const st = statementOf([lm.entities.get(s.establishment_id)!]);
      eq(`${month} ${s.code} net sales`, c(s.net_sales), st.revenue.total);
      eq(`${month} ${s.code} material cost`, c(s.cogs), st.cogs.total);
      eq(`${month} ${s.code} payment fees`, c(s.payment_fees), st.opex.card_fees);
      eq(`${month} ${s.code} commissions`, c(s.commissions), st.opex.commissions);
      eq(`${month} ${s.code} fixed + shared`, c(s.fixed_total), st.memo.fixed_total);
      eq(`${month} ${s.code} contribution`, c(s.contribution), st.memo.contribution);
      eq(`${month} ${s.code} result = net income`, c(s.result), st.net_income);
    }
    const doc = buildStatement(loaded.ledger, "month", [
      ...loaded.shownStores.map((s) => ({ id: s.id, code: s.code, name: s.name, color: null, kind: "store" as const })),
      { id: WEB_ENTITY, code: "WEB", name: "Online", color: null, kind: "web" as const },
      { id: "total", code: "TOTAL", name: "Consolidated", color: null, kind: "total" as const },
    ]);
    const all = doc.statements[month].total;
    eq(`${month} consolidated revenue = Ejecutivo.net`, c(ex.totals.net), all.revenue.total);
    eq(`${month} consolidated material cost = Ejecutivo.cost`, c(ex.totals.cost), all.cogs.total);
    eq(`${month} consolidated fees = Ejecutivo.fee`, c(ex.totals.fee), all.opex.card_fees);
    eq(`${month} consolidated commissions = Ejecutivo.commission`, c(ex.totals.commission), all.opex.commissions);
    eq(`${month} consolidated gross contribution = Ejecutivo.profit`, c(ex.totals.profit), all.memo.gross_contribution);
    eq(`${month} consolidated sales tax = Ejecutivo.tax`, c(ex.totals.tax), all.sales_tax);
    const storesResult = pnl.stores.reduce((a, s) => a + c(s.result), 0);
    const web = doc.statements[month][WEB_ENTITY];
    eq(`${month} consolidated net income = Σ store results + web`, storesResult + web.net_income, all.net_income);
  }
  logger.info(`[finance] ${checks} checks, ${diffs} differences`);
  if (diffs) process.exitCode = 1;
}
