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
// One deliberate exception: BACKEND_TARGET_OVERRIDE=staging, set by hand in the
// Vercel project, sends that project's builds to staging WHATEVER the branch —
// live branches included (the owner's decision, 2026-11-08: www.rubilens.com on
// the staging backend). It is an environment variable on purpose, not code: a
// merge can never turn it on, and deleting it + redeploying turns it off. Any
// other value fails the build instead of being ignored.
//
// scripts/vercel-build.sh runs `node backend-target.mjs` and turns the answer into
// VITE_BACKEND_TARGET (the STAGING banner) and VITE_BACKEND_PROXY (the prefix every
// API call uses: data/medusa.js, admin/adminApi.js, data/visionMeasure.js and the
// try-on's VITE_VISION_API_BASE). scripts/check-vercel-config.mjs checks it all.
import { pathToFileURL } from "node:url";

/** Branches whose builds serve real customers. */
export const PRODUCTION_BRANCHES = new Set(["develop", "main"]);
/** Path prefix per target; both are fixed rewrites in vercel.json. */
export const PROXY_PATHS = { production: "/medusa", staging: "/medusa-staging" };
/** The only value BACKEND_TARGET_OVERRIDE accepts. */
export const OVERRIDE_TARGETS = new Set(["staging"]);

/** @returns {{ target: "production" | "staging", proxy: string, override: boolean }} */
export function resolveBackend(env) {
  const override = String(env.BACKEND_TARGET_OVERRIDE ?? "").trim();
  if (override) {
    if (!OVERRIDE_TARGETS.has(override)) throw new Error(`backend-target: BACKEND_TARGET_OVERRIDE="${override}" — the only accepted value is "staging" (delete the variable for the branch rule)`);
    return { target: override, proxy: PROXY_PATHS[override], override: true };
  }
  const branch = env.VERCEL_GIT_COMMIT_REF ?? "";
  const live = PRODUCTION_BRANCHES.has(branch) || env.VERCEL_ENV === "production";
  const target = live ? "production" : "staging";
  return { target, proxy: PROXY_PATHS[target], override: false };
}

// `node backend-target.mjs` prints "<target> <proxy>" for scripts/vercel-build.sh.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { target, proxy, override } = resolveBackend(process.env);
  process.stdout.write(`${target} ${proxy} ${override ? "override" : "branch"}`);
}
