/**
 * Which storefront domain a customer-facing link points at.
 *
 * One backend can serve several storefronts (e.g. staging behind both
 * opticaelrancho.com and www.rubilens.com). `STOREFRONT_URL` stays the default
 * domain; `STOREFRONT_URLS` (comma separated) lists the other domains this
 * backend may link to. The domain of a link is, in order:
 *
 *   1. the one set for the current piece of work (`withStorefrontOrigin`):
 *      a `/store/*` request takes it from its `Origin` (or `Referer`) header,
 *      an order's emails take it from `order.metadata.storefront_origin`, which
 *      the cart recorded from the customer's requests (`captureCartOrigin`);
 *   2. the default (`STOREFRONT_URL`).
 *
 * Only domains on the list are ever used: a forged header can at most pick
 * another domain of the same business. Links for staff (the panel, alerts,
 * approvals, seller links) use `defaultStorefrontOrigin()` on purpose: the
 * panel lives on the default domain.
 *
 * No imports from the rest of lib/ (order-access.ts and tenant.ts import this).
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** Metadata key on the cart (and, through complete-cart, on the order). */
export const STOREFRONT_ORIGIN_KEY = "storefront_origin";

const trimSlash = (v: string) => v.trim().replace(/\/+$/, "");

/** `https://Host:443/path` → `https://host`; null for anything that is not an http(s) URL. */
export function normalizeOrigin(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** STOREFRONT_URL, else the first STORE_CORS entry, else the dev server. */
export function defaultStorefrontOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return trimSlash(env.STOREFRONT_URL || env.STORE_CORS?.split(",")[0] || "http://localhost:5198");
}

/** Every domain this backend may link to: the default first, then STOREFRONT_URLS. */
export function storefrontOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = [defaultStorefrontOrigin(env), ...String(env.STOREFRONT_URLS ?? "").split(",")]
    .map(normalizeOrigin)
    .filter((v): v is string => Boolean(v));
  return [...new Set(list)];
}

/** The candidate when it is one of ours (normalized), else null. */
export function allowedStorefrontOrigin(candidate: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  const o = normalizeOrigin(candidate);
  return o && storefrontOrigins(env).includes(o) ? o : null;
}

const scope = new AsyncLocalStorage<string>();

/** Runs `fn` with links pointing at `origin` when it is one of ours; otherwise at the default. */
export function withStorefrontOrigin<T>(origin: unknown, fn: () => T): T {
  const allowed = allowedStorefrontOrigin(origin);
  return allowed ? scope.run(allowed, fn) : fn();
}

/** Public origin of the storefront for the link being built now. */
export function storefrontOrigin(): string {
  return scope.getStore() ?? defaultStorefrontOrigin();
}

/** The storefront an order was bought on (its metadata), or null. */
export function orderStorefrontOrigin(metadata: Record<string, unknown> | null | undefined): string | null {
  return allowedStorefrontOrigin(metadata?.[STOREFRONT_ORIGIN_KEY]);
}

type HeaderBag = Record<string, string | string[] | undefined>;
const header = (h: HeaderBag, name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

/** The storefront a request comes from: `Origin`, else the origin of `Referer`; only ours. */
export function requestStorefrontOrigin(headers: HeaderBag): string | null {
  return allowedStorefrontOrigin(header(headers, "origin")) ?? allowedStorefrontOrigin(header(headers, "referer"));
}
