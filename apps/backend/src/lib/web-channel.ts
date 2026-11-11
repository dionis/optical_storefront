/**
 * The online store on this backend — is it wired so a purchase on the web
 * lands in the panel? (docs/TIENDA-ONLINE-UNIFICADA.md)
 *
 * One backend serves the stores' tills and the web shop. What can silently
 * break that is configuration, not code: a web domain that is not listed (its
 * orders lose their domain and their brand), a brand entry with a typo, no
 * publishable key bound to a sales channel (the shop shows no products), a
 * region without the card provider (nobody can pay), no shipping option. These
 * are the items of the «Tienda online» group of the Seguridad tab.
 *
 *   - `webChannelChecks` is pure: facts in, pass/fail items out.
 *   - `gatherWebChannelFacts` reads them; every read is independent and a
 *     failing one becomes `null` ("could not check" → the item is left out).
 *
 * Never a value: hosts, counts and an order number only.
 */
import type { Knex } from "@mikro-orm/knex";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { onlineStore } from "./online-store";
import type { SecurityCheck } from "./security";
import { defaultStorefrontOrigin, normalizeOrigin, storefrontOrigins } from "./storefront-origin";
import { parseStorefrontBrands } from "./tenant";

export interface WebChannelFacts {
  /** Publishable keys (not revoked) bound to at least one sales channel. */
  publishableKeys: number | null;
  /** Payment providers enabled in a region, by id (`pp_stripe_stripe`, `pp_system_default`…). */
  regionProviders: string[] | null;
  shippingOptions: number | null;
  /** Published products in a sales channel that a publishable key opens (what the web shop can list). */
  webProducts: number | null;
  /** The newest web order (no till sale behind it). */
  lastWebOrder: { display_id: number; created_at: string; origin: string | null } | null | undefined;
  /** Web orders of the last 30 days. */
  webOrders30d: number | null;
  /** The store the owner runs the web shop with (lib/online-store.ts); null = none; undefined = not read. */
  onlineStore?: { code: string; name: string } | null;
}

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/** The «Tienda online» items. Pure. */
export function webChannelChecks(f: WebChannelFacts, env: NodeJS.ProcessEnv = process.env): SecurityCheck[] {
  const checks: SecurityCheck[] = [];
  const def = normalizeOrigin(defaultStorefrontOrigin(env));
  const listed = storefrontOrigins(env);
  const extras = listed.filter((o) => o !== def);
  const raw = String(env.STOREFRONT_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const production = env.NODE_ENV === "production";

  // Every domain written in STOREFRONT_URLS is a usable origin (https in production).
  const badOrigins = raw.filter((o) => !normalizeOrigin(o) || (production && !/^https:\/\//i.test(o)));
  checks.push({ key: "web.origins", ok: badOrigins.length === 0, detail: [def, ...extras].filter((o): o is string => Boolean(o)).map(hostOf).join(", ") });

  // A brand entry that was dropped, or one for a domain this backend does not serve, is a typo to fix.
  const { brands, problems } = parseStorefrontBrands(env.STOREFRONT_BRANDS);
  const orphan = brands.filter((b) => !listed.includes(b.origin)).map((b) => `not_listed:${b.origin}`);
  if (String(env.STOREFRONT_BRANDS ?? "").trim() || extras.length) {
    checks.push({
      key: "web.brand",
      ok: problems.length + orphan.length === 0,
      detail: problems.length + orphan.length ? [...problems, ...orphan].join(", ") : brands.map((b) => `${hostOf(b.origin)} → ${b.name}`).join(", "),
    });
  }

  // The store the web shop is run with: its prices and its costs are the web's.
  // Only a failure when this backend actually serves a web catalogue.
  if (f.onlineStore !== undefined) {
    const serves = (f.webProducts ?? 0) > 0;
    checks.push({ key: "web.store", ok: Boolean(f.onlineStore) || !serves, detail: f.onlineStore ? `${f.onlineStore.code} · ${f.onlineStore.name}` : "—" });
  }

  if (f.publishableKeys !== null) checks.push({ key: "web.publishable_key", ok: f.publishableKeys > 0, detail: String(f.publishableKeys) });
  if (f.webProducts !== null) checks.push({ key: "web.catalog", ok: f.webProducts > 0, detail: String(f.webProducts) });
  if (f.regionProviders !== null) {
    const card = f.regionProviders.some((p) => /^pp_(stripe|paypal|square)/.test(p));
    // Outside production the manual provider is how a test order is paid.
    checks.push({ key: "web.payment_provider", ok: card || (!production && f.regionProviders.length > 0), detail: f.regionProviders.map((p) => p.replace(/^pp_/, "")).join(", ") });
  }
  if (f.shippingOptions !== null) checks.push({ key: "web.shipping", ok: f.shippingOptions > 0, detail: String(f.shippingOptions) });

  // Information, never a failure: when the last purchase on the web reached this panel.
  if (f.lastWebOrder !== undefined) {
    const o = f.lastWebOrder;
    checks.push({
      key: "web.last_order",
      ok: true,
      detail: o ? [`#${o.display_id}`, o.created_at.slice(0, 10), o.origin ? hostOf(o.origin) : null, f.webOrders30d !== null ? `${f.webOrders30d}/30d` : null].filter(Boolean).join(" · ") : "0",
    });
  }
  return checks;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

const NOT_POS = "COALESCE(o.metadata->>'source', '') <> 'pos'";

export async function gatherWebChannelFacts(container: MedusaContainer): Promise<WebChannelFacts> {
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const [publishableKeys, webProducts, regionProviders, shippingOptions, lastWebOrder, webOrders30d] = await Promise.all([
    safe(async () => {
      const [r] = (await pg("api_key as k")
        .join("publishable_api_key_sales_channel as l", "l.publishable_key_id", "k.id")
        .where("k.type", "publishable")
        .whereNull("k.revoked_at")
        .whereNull("k.deleted_at")
        .whereNull("l.deleted_at")
        .countDistinct({ n: "k.id" })) as Array<{ n: string | number }>;
      return Number(r?.n ?? 0);
    }),
    safe(async () => {
      const [r] = (await pg("product_sales_channel as ps")
        .join("publishable_api_key_sales_channel as l", "l.sales_channel_id", "ps.sales_channel_id")
        .join("api_key as k", "k.id", "l.publishable_key_id")
        .join("product as p", "p.id", "ps.product_id")
        .whereNull("ps.deleted_at")
        .whereNull("l.deleted_at")
        .whereNull("k.revoked_at")
        .whereNull("k.deleted_at")
        .whereNull("p.deleted_at")
        .where("p.status", "published")
        .countDistinct({ n: "p.id" })) as Array<{ n: string | number }>;
      return Number(r?.n ?? 0);
    }),
    safe(async () => ((await pg("region_payment_provider").whereNull("deleted_at").distinct("payment_provider_id")) as Array<{ payment_provider_id: string }>).map((r) => String(r.payment_provider_id)).sort()),
    safe(async () => {
      const [r] = (await pg("shipping_option").whereNull("deleted_at").count({ n: "*" })) as Array<{ n: string | number }>;
      return Number(r?.n ?? 0);
    }),
    safe(async () => {
      const row = (await pg("order as o").whereNull("o.deleted_at").whereRaw(NOT_POS).orderBy("o.created_at", "desc").first("o.display_id", "o.created_at", pg.raw("o.metadata->>'storefront_origin' AS origin"))) as
        | { display_id: number; created_at: Date | string; origin: string | null }
        | undefined;
      return row ? { display_id: Number(row.display_id), created_at: new Date(row.created_at).toISOString(), origin: normalizeOrigin(row.origin) } : null;
    }),
    safe(async () => {
      const [r] = (await pg("order as o").whereNull("o.deleted_at").whereRaw(NOT_POS).where("o.created_at", ">=", new Date(Date.now() - 30 * 86_400_000)).count({ n: "*" })) as Array<{ n: string | number }>;
      return Number(r?.n ?? 0);
    }),
  ]);
  // `safe` answers null for both "no web order yet" and "could not read": tell them apart for the item.
  const readable = webOrders30d !== null;
  const store = await onlineStore(container);
  return {
    publishableKeys,
    webProducts,
    regionProviders,
    shippingOptions,
    lastWebOrder: readable ? lastWebOrder : undefined,
    webOrders30d,
    onlineStore: store ? { code: store.code, name: store.name } : null,
  };
}

export interface WebChannelSummary {
  /** Every storefront domain of this backend: the default first. `name` = its own brand, null = the deployment's. */
  storefronts: Array<{ host: string; url: string; name: string | null; is_default: boolean }>;
  /** The establishment the web shop is run with; null = none (master prices). */
  store: { id: string; code: string; name: string; color: string } | null;
  orders_30d: number | null;
  last_order: { display_id: number; created_at: string; host: string | null } | null;
}

/** What «Tiendas» shows about the online store: its domains, its brand and when it last sold. */
export async function webChannelSummary(container: MedusaContainer, env: NodeJS.ProcessEnv = process.env): Promise<WebChannelSummary> {
  const f = await gatherWebChannelFacts(container);
  const def = normalizeOrigin(defaultStorefrontOrigin(env));
  const brands = parseStorefrontBrands(env.STOREFRONT_BRANDS).brands;
  return {
    storefronts: storefrontOrigins(env).map((o) => ({ host: hostOf(o), url: o, name: brands.find((b) => b.origin === o)?.name ?? null, is_default: o === def })),
    store: await onlineStore(container),
    orders_30d: f.webOrders30d,
    last_order: f.lastWebOrder ? { display_id: f.lastWebOrder.display_id, created_at: f.lastWebOrder.created_at, host: f.lastWebOrder.origin ? hostOf(f.lastWebOrder.origin) : null } : null,
  };
}
