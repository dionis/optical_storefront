/**
 * "Primeros pasos" — what is still missing before the owner runs the store on
 * their own (docs/MULTI-TENANT-TECNICO.md §7.3).
 *
 *   - `buildSetupChecklist` is pure: facts in, ordered steps out. Each step names
 *     the panel tab that fixes it, so the panel never decides on its own.
 *   - `gatherSetupFacts` reads those facts. Every read is independent and a
 *     failing one becomes `null` ("could not check"), never a crash: a store
 *     without the POS module still gets its checklist.
 *   - `tenantSecurityChecks` turns the same facts into items of the Seguridad
 *     tab (group "tenant"), so both screens agree.
 *
 * Nothing here is a gate: the owner can finish the setup with steps pending
 * (the panel asks for confirmation). The checklist is advice, the server rules
 * stay where they were.
 */
import type { Knex } from "@mikro-orm/knex";
import type { IUserModuleService, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { securityAudit, type SecurityCheck } from "./security";
import { resolveStoreSettings } from "./store-settings";
import { readTenantProfile, type TenantProfileView } from "./tenant-profile";

export type SetupStepKey =
  | "profile"
  | "notifications"
  | "pickup"
  | "prices"
  | "stores"
  | "team"
  | "owner"
  | "security"
  | "test_sale";

export interface SetupStep {
  key: SetupStepKey;
  /** null = could not be checked (a read failed); the panel shows it as unknown. */
  ok: boolean | null;
  /** Panel tab that fixes it (`go(tab)`). */
  tab: string;
  /** Short machine detail (a count), never personal data. */
  detail?: string;
}

export interface SetupFacts {
  profile: TenantProfileView | null;
  /** At least one address receives the order notices. */
  notifyEmails: number | null;
  /** Rows in lens_base_price with a price. */
  lensPrices: number | null;
  establishments: number | null;
  /** Active panel users. */
  users: number | null;
  /** The profile names an owner and that user exists. */
  ownerExplicit: boolean | null;
  /** Failing items of the Seguridad tab (environment only). */
  securityFailing: number | null;
  /** Web orders + POS sales ever registered. */
  sales: number | null;
}

export interface SetupChecklist {
  completed_at: string | null;
  steps: SetupStep[];
  /** Steps known to be pending (unknown ones are not counted). */
  pending: number;
}

const has = (v: string | null | undefined): boolean => Boolean(v && v.trim());

/** The profile is complete when the store has a name and a way to be reached. */
export function profileComplete(p: TenantProfileView | null): boolean | null {
  if (!p) return null;
  return has(p.display_name) && (has(p.support_phone) || has(p.whatsapp));
}

const count = (n: number | null, min = 1): boolean | null => (n === null ? null : n >= min);

export function buildSetupChecklist(f: SetupFacts): SetupChecklist {
  const steps: SetupStep[] = [
    { key: "profile", ok: profileComplete(f.profile), tab: "setup" },
    { key: "notifications", ok: count(f.notifyEmails), tab: "security" },
    // Pickup counts as done once decided either way (offered or explicitly off).
    { key: "pickup", ok: f.profile ? f.profile.pickup !== null : null, tab: "setup" },
    { key: "prices", ok: count(f.lensPrices), tab: "pricing", detail: f.lensPrices === null ? undefined : String(f.lensPrices) },
    { key: "stores", ok: count(f.establishments), tab: "stores", detail: f.establishments === null ? undefined : String(f.establishments) },
    // The owner plus at least one more person: nobody should be the only key.
    { key: "team", ok: count(f.users, 2), tab: "team", detail: f.users === null ? undefined : String(f.users) },
    { key: "owner", ok: f.ownerExplicit, tab: "team" },
    { key: "security", ok: f.securityFailing === null ? null : f.securityFailing === 0, tab: "security", detail: f.securityFailing ? String(f.securityFailing) : undefined },
    { key: "test_sale", ok: count(f.sales), tab: "pos" },
  ];
  return {
    completed_at: f.profile?.setup_completed_at ?? null,
    steps,
    pending: steps.filter((s) => s.ok === false).length,
  };
}

/** Group "tenant" of GET /admin/security-status. */
export function tenantSecurityChecks(f: SetupFacts): SecurityCheck[] {
  const checks: SecurityCheck[] = [];
  const profile = profileComplete(f.profile);
  if (profile !== null) checks.push({ key: "tenant.profile", ok: profile });
  if (f.ownerExplicit !== null) checks.push({ key: "tenant.owner_explicit", ok: f.ownerExplicit });
  if (f.profile) checks.push({ key: "tenant.setup_completed", ok: Boolean(f.profile.setup_completed_at) });
  return checks;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function countRows(pg: Knex, table: string, where?: (q: Knex.QueryBuilder) => void): Promise<number> {
  const q = pg(table).count<{ n: string | number }[]>({ n: "*" });
  if (where) where(q);
  const rows = await q;
  return Number(rows[0]?.n ?? 0);
}

export async function gatherSetupFacts(container: MedusaContainer): Promise<SetupFacts> {
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const notDeleted = (q: Knex.QueryBuilder) => q.whereNull("deleted_at");

  const [profile, settings, lensPrices, establishments, userList, orders, posSales] = await Promise.all([
    safe(() => readTenantProfile(container, { fresh: true })),
    safe(() => resolveStoreSettings(container)),
    safe(() => countRows(pg, "lens_base_price", (q) => q.whereNull("deleted_at").where("price_cents", ">", 0))),
    safe(() => countRows(pg, "establishment", notDeleted)),
    safe(() => users.listUsers({}, { select: ["id"], take: 500 })),
    safe(() => countRows(pg, "order", notDeleted)),
    safe(() => countRows(pg, "pos_sale", notDeleted)),
  ]);

  const named = profile?.owner_user_id ?? null;
  const ownerExplicit = profile === null || userList === null ? null : Boolean(named && userList.some((u) => u.id === named));
  const sales = orders === null && posSales === null ? null : (orders ?? 0) + (posSales ?? 0);

  return {
    profile,
    notifyEmails: settings ? settings.admin_notification_emails.length : null,
    lensPrices,
    establishments,
    users: userList ? userList.length : null,
    ownerExplicit,
    securityFailing: securityAudit().failing,
    sales,
  };
}

export async function readSetupChecklist(container: MedusaContainer): Promise<SetupChecklist> {
  return buildSetupChecklist(await gatherSetupFacts(container));
}
