// The one place that decides which backend a storefront build talks to.
//
// vercel.json is identical on every branch and has two fixed rewrites:
//   /medusa/*          → production backend
//   /medusa-staging/*  → staging backend
// so merging a branch can never change where the live store points. What differs
// per build is which of the two prefixes the app calls, and that is decided here,
// at build time, from the branch Vercel is building:
//   - develop and main serve the live store (www.rubilens.com is attached to
//     develop) → always "production" (/medusa);
//   - every other branch (e.g. develop_optical_storepos) → "staging".
//
// scripts/vercel-build.sh runs `node backend-target.mjs` and turns the answer into
// VITE_BACKEND_TARGET (checked by the build guard) and VITE_BACKEND_PROXY (the prefix every
// API call uses: data/medusa.js, admin/adminApi.js, data/visionMeasure.js and the
// try-on's VITE_VISION_API_BASE). scripts/check-vercel-config.mjs checks it all.
//
// Any OTHER optician (multi-tenant module, scripts/tenant/routing.mjs) is built
// by its own Vercel project with TENANT_FILE set: its builds always use its own
// fixed rewrite `/medusa-t-<slug>` (target "tenant"), whatever the branch. A
// manifest without an https `domains.api` makes the build fail instead of
// falling back to another store's backend.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LEGACY_TENANTS, routedApi, tenantProxyPath } from "../../scripts/tenant/routing.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The manifest named by TENANT_FILE, or null when the variable is unset. */
export function tenantManifestOf(env) {
  const rel = String(env.TENANT_FILE ?? "").trim();
  if (!rel) return null;
  const file = isAbsolute(rel) ? rel : join(REPO_ROOT, rel);
  if (!existsSync(file)) throw new Error(`backend-target: TENANT_FILE=${rel} does not exist`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Branches whose builds serve real customers. */
export const PRODUCTION_BRANCHES = new Set(["develop", "main"]);
/** Path prefix per target; both are fixed rewrites in vercel.json. */
export const PROXY_PATHS = { production: "/medusa", staging: "/medusa-staging" };

/** @returns {{ target: "production" | "staging" | "tenant", proxy: string }} */
export function resolveBackend(env, manifest = tenantManifestOf(env)) {
  if (manifest && !LEGACY_TENANTS.has(manifest.slug)) {
    if (!routedApi(manifest)) throw new Error(`backend-target: tenant "${manifest.slug}" needs an https domains.api (and \`pnpm tenant vercel\`)`);
    return { target: "tenant", proxy: tenantProxyPath(manifest.slug) };
  }
  const branch = env.VERCEL_GIT_COMMIT_REF ?? "";
  const live = PRODUCTION_BRANCHES.has(branch) || env.VERCEL_ENV === "production";
  const target = live ? "production" : "staging";
  return { target, proxy: PROXY_PATHS[target] };
}

// `node backend-target.mjs` prints "<target> <proxy>" for scripts/vercel-build.sh.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { target, proxy } = resolveBackend(process.env);
  process.stdout.write(`${target} ${proxy}`);
}
