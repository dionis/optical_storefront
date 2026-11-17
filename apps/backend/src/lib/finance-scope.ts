import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http";
import { localParts } from "./alerts";
import { MAX_STATEMENT_MONTHS, monthsBetween, STATEMENT_GROUPS, WEB_ENTITY, type StatementGroup } from "./financial-statement";
import { onlineStoreId } from "./online-store";
import { PosError } from "./pos-data";
import { costScope } from "./store-costs-route";
import { tenant } from "./tenant";

const DAY = /^\d{4}-\d{2}(-\d{2})?$/;

/**
 * What a finance document reads (`?from&to&store&group`): whole local months
 * (at most 36), the stores in view and whether the web is its own column.
 * Same scope as the store result: admins see every store and the web; a
 * person with the costs privilege, only their stores (and no web). When the
 * owner runs the web as a store (lib/online-store.ts), `store=web` IS that store.
 * Used by GET /admin/finance/statement and /admin/finance/category-report.
 */
export async function financeScope(req: AuthenticatedMedusaRequest): Promise<{ from: string; to: string; group: StatementGroup; storeIds: string[] | null; web: boolean }> {
  const { storeIds } = await costScope(req);
  const q = req.query as Record<string, string | undefined>;
  const today = localParts(new Date(), tenant().timezone).date;
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const from = q.from && DAY.test(q.from) ? q.from : `${to.slice(0, 4)}-01-01`;
  if (from.slice(0, 7) > to.slice(0, 7)) throw new PosError("bad_range");
  if (monthsBetween(from, to).length > MAX_STATEMENT_MONTHS) throw new PosError("range_too_long");
  const group = (STATEMENT_GROUPS as readonly string[]).includes(String(q.group)) ? (q.group as StatementGroup) : "month";
  const store = String(q.store ?? "all");
  if (storeIds !== null && !storeIds.length) throw new PosError("forbidden_store", 403);
  let ids: string[] | null = storeIds;
  let web = storeIds === null;
  const online = store === WEB_ENTITY ? await onlineStoreId(req.scope) : null;
  if (store === WEB_ENTITY && online) {
    if (storeIds !== null && !storeIds.includes(online)) throw new PosError("forbidden_store", 403);
    ids = [online];
    web = false;
  } else if (store === WEB_ENTITY) {
    if (storeIds !== null) throw new PosError("forbidden_store", 403);
    ids = [];
  } else if (store && store !== "all") {
    if (storeIds !== null && !storeIds.includes(store)) throw new PosError("forbidden_store", 403);
    ids = [store];
    web = false;
  }
  return { from, to, group, storeIds: ids, web };
}
