// The one place that decides which backend a storefront build talks to.
//
// vercel.json is identical on every branch and has two fixed rewrites:
//   /medusa/*          → production backend
//   /medusa-staging/*  → staging backend
// so merging a branch can never change where the live store points. What differs
// per build is which of the two prefixes the app calls, and that is decided here,
// at build time, in this order:
//
//   1. a build of the tenant-deploy branch must name a NEW optician
//      (TENANT_FILE) — assertTenantDeployBuild, scripts/tenant/routing.mjs;
//   2. any OTHER optician (TENANT_FILE whose slug is not RUBI LENS / El Rancho)
//      always uses its own fixed rewrite `/medusa-t-<slug>` (target "tenant"),
//      whatever the branch. A manifest without an https `domains.api` fails the
//      build instead of falling back to another store's backend, and the
//      override below is REFUSED for it: a new optician can never be sent to
//      the backend of the two original stores;
//   3. BACKEND_TARGET_OVERRIDE=staging, set by hand in a Vercel project, sends
//      that project's builds to staging WHATEVER the branch — live branches
//      included (owner's decision, 2026-11-08: www.rubilens.com, built from
//      develop, runs on the panel's backend). It is an environment variable on
//      purpose, not code: a merge can never turn it on, and deleting it +
//      redeploying turns it off. Any other value fails the build;
//   4. otherwise the branch rule: develop and main serve the live store →
//      "production" (/medusa); every other branch → "staging".
//
// scripts/vercel-build.sh runs `node backend-target.mjs` and turns the answer into
// VITE_BACKEND_TARGET (checked by the build guard) and VITE_BACKEND_PROXY (the prefix every
// API call uses: data/medusa.js, admin/adminApi.js, data/visionMeasure.js and the
// try-on's VITE_VISION_API_BASE). scripts/check-vercel-config.mjs checks it all.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertTenantDeployBuild, LEGACY_TENANTS, routedApi, tenantProxyPath } from "../../scripts/tenant/routing.mjs";

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
/** The only value BACKEND_TARGET_OVERRIDE accepts. */
export const OVERRIDE_TARGETS = new Set(["staging"]);

/**
 * @returns {{ target: "production" | "staging" | "tenant", proxy: string, override: boolean, decidedBy: "tenant" | "override" | "branch" }}
 */
export function resolveBackend(env, manifest = tenantManifestOf(env)) {
  assertTenantDeployBuild(env, manifest);
  const override = String(env.BACKEND_TARGET_OVERRIDE ?? "").trim();
  if (manifest && !LEGACY_TENANTS.has(manifest.slug)) {
    if (override) throw new Error(`backend-target: BACKEND_TARGET_OVERRIDE is only for RUBI LENS / El Rancho — tenant "${manifest.slug}" always uses ${tenantProxyPath(manifest.slug)}; delete the variable from its Vercel project`);
    if (!routedApi(manifest)) throw new Error(`backend-target: tenant "${manifest.slug}" needs an https domains.api (and \`pnpm tenant vercel\`)`);
    return { target: "tenant", proxy: tenantProxyPath(manifest.slug), override: false, decidedBy: "tenant" };
  }
  if (override) {
    if (!OVERRIDE_TARGETS.has(override)) throw new Error(`backend-target: BACKEND_TARGET_OVERRIDE="${override}" — the only accepted value is "staging" (delete the variable for the branch rule)`);
    return { target: override, proxy: PROXY_PATHS[override], override: true, decidedBy: "override" };
  }
  const branch = env.VERCEL_GIT_COMMIT_REF ?? "";
  const live = PRODUCTION_BRANCHES.has(branch) || env.VERCEL_ENV === "production";
  const target = live ? "production" : "staging";
  return { target, proxy: PROXY_PATHS[target], override: false, decidedBy: "branch" };
}

// `node backend-target.mjs` prints "<target> <proxy> <tenant|override|branch>" for scripts/vercel-build.sh.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { target, proxy, decidedBy } = resolveBackend(process.env);
  process.stdout.write(`${target} ${proxy} ${decidedBy}`);
}
