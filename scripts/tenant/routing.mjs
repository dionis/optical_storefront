/**
 * Which backend each optician's storefront talks to (docs/MULTI-TENANT-TECNICO.md §9).
 *
 * vercel.json is one file shared by every Vercel project built from this repo,
 * so a merge can never re-point a live store. The two stores that existed before
 * the module keep their fixed rewrites and the branch rule of backend-target.mjs:
 *   /medusa          → RUBI LENS production (develop/main)
 *   /medusa-staging  → staging (every other branch: Óptica El Rancho, previews)
 * Every other optician gets ONE more fixed rewrite, `/medusa-t-<slug>` → the
 * `domains.api` of its manifest, and its builds (TENANT_FILE set in its Vercel
 * project) always use that prefix — production and previews alike, because a
 * new optician has no staging backend of its own.
 *
 * `pnpm tenant vercel` writes these rewrites; scripts/check-vercel-config.mjs
 * fails when vercel.json and the manifests disagree. Plain Node, no dependencies.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Stores served by the original two rewrites; they keep the branch rule. */
export const LEGACY_TENANTS = new Set(["rubi-lens", "el-rancho"]);

/** Hosts that never get a rewrite: sample manifests (RFC 2606 / 6761 names). */
const RESERVED_TLD = /\.(example|test|invalid|localhost)$/i;

export const tenantProxyPath = (slug) => `/medusa-t-${slug}`;

/** The `domains.api` origin a manifest routes to, or null when it gets no rewrite. */
export function routedApi(manifest) {
  if (!manifest || LEGACY_TENANTS.has(manifest.slug)) return null;
  let url;
  try {
    url = new URL(manifest.domains?.api ?? "");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || RESERVED_TLD.test(url.hostname)) return null;
  return url.origin;
}

export function readManifests(repoRoot) {
  const dir = join(repoRoot, "tenants");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => !d.startsWith("_") && existsSync(join(dir, d, "tenant.json")))
    .sort()
    .map((d) => JSON.parse(readFileSync(join(dir, d, "tenant.json"), "utf8")));
}

/** Rewrites and no-store headers vercel.json must carry for the manifests given. */
export function tenantVercelRules(manifests) {
  const rewrites = [];
  const headers = [];
  for (const m of manifests) {
    const api = routedApi(m);
    if (!api) continue;
    const prefix = tenantProxyPath(m.slug);
    rewrites.push({ source: `${prefix}/:path*`, destination: `${api}/:path*` });
    headers.push({
      source: `${prefix}/(.*)`,
      headers: [
        { key: "Cache-Control", value: "no-store" },
        { key: "CDN-Cache-Control", value: "no-store" },
      ],
    });
  }
  return { rewrites, headers };
}

const isTenantSource = (src) => typeof src === "string" && src.startsWith("/medusa-t-");

/**
 * vercel.json with exactly the tenant rules for these manifests: rewrites right
 * before the SPA fallback, headers right after the /medusa-staging one. Every
 * other rule is left as it is.
 */
export function applyTenantRules(config, manifests) {
  const { rewrites, headers } = tenantVercelRules(manifests);
  const baseRewrites = (config.rewrites ?? []).filter((r) => !isTenantSource(r.source));
  const spa = baseRewrites.findIndex((r) => r.source === "/(.*)");
  const at = spa === -1 ? baseRewrites.length : spa;
  const baseHeaders = (config.headers ?? []).filter((h) => !isTenantSource(h.source));
  const after = baseHeaders.findIndex((h) => h.source === "/medusa-staging/(.*)");
  const hAt = after === -1 ? baseHeaders.length : after + 1;
  return {
    ...config,
    rewrites: [...baseRewrites.slice(0, at), ...rewrites, ...baseRewrites.slice(at)],
    headers: [...baseHeaders.slice(0, hAt), ...headers, ...baseHeaders.slice(hAt)],
  };
}
