/**
 * The owner-edited tenant profile (module `tenantProfile`, table
 * `tenant_profile`, one row "default") — docs/MULTI-TENANT-TECNICO.md §7.
 *
 *   - `cleanTenantProfileInput` is pure: what the panel may send and how it is
 *     trimmed. Anything too long is refused, not cut (same rule as field-rules).
 *   - `readTenantProfile` caches the row for a minute and feeds the identity
 *     overlay of src/lib/tenant.ts, so `tenant()` reflects what the owner saved.
 *   - `explicitOwnerId` is the owner the panel names; src/lib/staff-scope.ts
 *     falls back to the oldest admin when it is unset (or points at a user who
 *     no longer exists).
 *
 * Ownership transfer lives in src/lib/tenant-owner.ts, which needs the staff
 * helpers; keeping it out of here avoids an import cycle with staff-scope.
 */
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { TENANT_PROFILE_MODULE } from "../modules/tenant-profile/index";
import type TenantProfileModuleService from "../modules/tenant-profile/service";
import { FIELD_LIMITS, isValidPhone } from "./field-rules";
import { setTenantOverlay, tenant } from "./tenant";

export const TENANT_PROFILE_ID = "default";

export const SOCIAL_NETWORKS = ["instagram", "facebook", "tiktok", "youtube", "x"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
const PICKUP_LANGS = ["es", "en", "fr"] as const;

export interface PickupInfo {
  enabled: boolean;
  name: string | null;
  address: string | null;
  hours: Partial<Record<(typeof PICKUP_LANGS)[number], string>>;
  maps_url: string | null;
}

export interface TenantProfileView {
  display_name: string | null;
  legal_name: string | null;
  support_phone: string | null;
  whatsapp: string | null;
  social: Partial<Record<SocialNetwork, string>>;
  pickup: PickupInfo | null;
  owner_user_id: string | null;
  setup_completed_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

/** What the panel may change. `owner_user_id` is not here: it moves only through a transfer. */
export type TenantProfilePatch = Partial<
  Pick<TenantProfileView, "display_name" | "legal_name" | "support_phone" | "whatsapp" | "social" | "pickup">
> & { setup_completed?: boolean };

export type CleanResult = { ok: true; patch: TenantProfilePatch } | { ok: false; reason: string; field: string };

const LIMITS = { name: FIELD_LIMITS.name, legal: 160, address: 200, hours: 120, url: 300 };

const isHttpsUrl = (v: string): boolean => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

/** Validates a PATCH-style body: only the keys present are changed; "" clears a text field. */
export function cleanTenantProfileInput(body: unknown): CleanResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: TenantProfilePatch = {};
  const fail = (field: string, reason: string): CleanResult => ({ ok: false, field, reason });

  const textField = (key: "display_name" | "legal_name", max: number): CleanResult | null => {
    if (!(key in b)) return null;
    const v = b[key];
    if (v !== null && typeof v !== "string") return fail(key, "invalid_type");
    const s = (v ?? "").trim();
    if (s.length > max) return fail(key, "too_long");
    patch[key] = s || null;
    return null;
  };
  const phoneField = (key: "support_phone" | "whatsapp"): CleanResult | null => {
    if (!(key in b)) return null;
    const v = b[key];
    if (v !== null && typeof v !== "string") return fail(key, "invalid_type");
    const s = (v ?? "").trim();
    if (s && !isValidPhone(s)) return fail(key, "invalid_phone");
    patch[key] = s || null;
    return null;
  };

  for (const r of [textField("display_name", LIMITS.name), textField("legal_name", LIMITS.legal), phoneField("support_phone"), phoneField("whatsapp")]) {
    if (r) return r;
  }

  if ("social" in b) {
    const v = b.social;
    if (v !== null && (typeof v !== "object" || Array.isArray(v))) return fail("social", "invalid_type");
    const social: Partial<Record<SocialNetwork, string>> = {};
    for (const [k, raw] of Object.entries((v ?? {}) as Record<string, unknown>)) {
      if (!(SOCIAL_NETWORKS as readonly string[]).includes(k)) return fail(`social.${k}`, "unknown_network");
      if (raw === null || raw === "") continue;
      if (typeof raw !== "string") return fail(`social.${k}`, "invalid_type");
      const s = raw.trim();
      if (s.length > LIMITS.url || !isHttpsUrl(s)) return fail(`social.${k}`, "invalid_url");
      social[k as SocialNetwork] = s;
    }
    patch.social = social;
  }

  if ("pickup" in b) {
    const v = b.pickup;
    if (v === null) patch.pickup = null;
    else {
      if (typeof v !== "object" || Array.isArray(v)) return fail("pickup", "invalid_type");
      const p = v as Record<string, unknown>;
      const str = (key: string, max: number): string | null | CleanResult => {
        const raw = p[key];
        if (raw === undefined || raw === null || raw === "") return null;
        if (typeof raw !== "string") return fail(`pickup.${key}`, "invalid_type");
        const s = raw.trim();
        return s.length > max ? fail(`pickup.${key}`, "too_long") : s || null;
      };
      const name = str("name", LIMITS.name);
      const address = str("address", LIMITS.address);
      const maps = str("maps_url", LIMITS.url);
      for (const r of [name, address, maps]) if (r && typeof r === "object") return r;
      if (typeof maps === "string" && !isHttpsUrl(maps)) return fail("pickup.maps_url", "invalid_url");
      const hours: PickupInfo["hours"] = {};
      const rawHours = p.hours ?? {};
      if (typeof rawHours !== "object" || Array.isArray(rawHours)) return fail("pickup.hours", "invalid_type");
      for (const [lang, raw] of Object.entries(rawHours as Record<string, unknown>)) {
        if (!(PICKUP_LANGS as readonly string[]).includes(lang)) return fail(`pickup.hours.${lang}`, "unknown_language");
        if (raw === null || raw === "") continue;
        if (typeof raw !== "string") return fail(`pickup.hours.${lang}`, "invalid_type");
        if (raw.trim().length > LIMITS.hours) return fail(`pickup.hours.${lang}`, "too_long");
        hours[lang as (typeof PICKUP_LANGS)[number]] = raw.trim();
      }
      const enabled = p.enabled === undefined ? true : p.enabled;
      if (typeof enabled !== "boolean") return fail("pickup.enabled", "invalid_type");
      if (enabled && !address) return fail("pickup.address", "required");
      patch.pickup = { enabled, name: name as string | null, address: address as string | null, hours, maps_url: maps as string | null };
    }
  }

  if ("setup_completed" in b) {
    if (typeof b.setup_completed !== "boolean") return fail("setup_completed", "invalid_type");
    patch.setup_completed = b.setup_completed;
  }

  return { ok: true, patch };
}

type Row = Record<string, unknown>;

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export function toView(row: Row | null | undefined): TenantProfileView {
  const r = row ?? {};
  const obj = <T>(v: unknown): T | null => (v && typeof v === "object" ? (v as T) : null);
  return {
    display_name: (r.display_name as string | null) ?? null,
    legal_name: (r.legal_name as string | null) ?? null,
    support_phone: (r.support_phone as string | null) ?? null,
    whatsapp: (r.whatsapp as string | null) ?? null,
    social: obj<TenantProfileView["social"]>(r.social) ?? {},
    pickup: obj<PickupInfo>(r.pickup),
    owner_user_id: (r.owner_user_id as string | null) ?? null,
    setup_completed_at: iso(r.setup_completed_at),
    updated_by: (r.updated_by as string | null) ?? null,
    updated_at: iso(r.updated_at),
  };
}

const TTL_MS = 60_000;
let cache: { at: number; view: TenantProfileView } | null = null;

const service = (c: MedusaContainer) => c.resolve<TenantProfileModuleService>(TENANT_PROFILE_MODULE);

function remember(view: TenantProfileView): TenantProfileView {
  cache = { at: Date.now(), view };
  setTenantOverlay({ display_name: view.display_name, legal_name: view.legal_name });
  return view;
}

/** Forget the cached row (tests, and after a write made elsewhere). */
export function invalidateTenantProfile(): void {
  cache = null;
}

export async function readTenantProfile(container: MedusaContainer, { fresh = false } = {}): Promise<TenantProfileView> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.view;
  const rows = await service(container).listTenantProfiles({ id: TENANT_PROFILE_ID }, { take: 1 });
  return remember(toView(rows[0] as Row | undefined));
}

/**
 * Best-effort refresh for the request path: never throws, never makes the
 * request wait for more than the cached value. A failure keeps the last overlay.
 */
let refreshing: Promise<unknown> | null = null;
export function warmTenantProfile(container: MedusaContainer): void {
  if (refreshing || (cache && Date.now() - cache.at < TTL_MS)) return;
  refreshing = readTenantProfile(container)
    .catch((e: Error) =>
      container.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[tenant-profile] could not refresh: ${e.message}`)
    )
    .finally(() => {
      refreshing = null;
    });
}

/** Saves the cleaned patch on the single row, creating it on first use. */
export async function saveTenantProfile(
  container: MedusaContainer,
  patch: TenantProfilePatch & { owner_user_id?: string | null },
  actorId: string | null
): Promise<TenantProfileView> {
  const svc = service(container);
  const { setup_completed, ...fields } = patch;
  const data: Row = { ...fields, updated_by: actorId };
  if (setup_completed !== undefined) data.setup_completed_at = setup_completed ? new Date() : null;
  const existing = await svc.listTenantProfiles({ id: TENANT_PROFILE_ID }, { take: 1 });
  if (existing.length) await svc.updateTenantProfiles({ id: TENANT_PROFILE_ID, ...data });
  else await svc.createTenantProfiles({ id: TENANT_PROFILE_ID, ...data });
  return readTenantProfile(container, { fresh: true });
}

/** The owner named in the profile, or null (then staff-scope uses the oldest admin). */
export async function explicitOwnerId(container: MedusaContainer): Promise<string | null> {
  return (await readTenantProfile(container)).owner_user_id;
}

/** What a shopper may see: identity and contact, never who the owner is. */
export function publicTenantProfile(view: TenantProfileView) {
  const t = tenant();
  return {
    name: t.name,
    legal_name: t.legalName,
    support_email: t.supportEmail,
    support_phone: view.support_phone,
    whatsapp: view.whatsapp,
    social: view.social,
    pickup: view.pickup?.enabled ? view.pickup : null,
    currency: t.currency,
    country: t.country,
    timezone: t.timezone,
  };
}
