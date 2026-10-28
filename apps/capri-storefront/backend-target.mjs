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
// VITE_BACKEND_TARGET (the STAGING banner) and VITE_BACKEND_PROXY (the prefix every
// API call uses: data/medusa.js, admin/adminApi.js, data/visionMeasure.js and the
// try-on's VITE_VISION_API_BASE). scripts/check-vercel-config.mjs checks it all.
import { pathToFileURL } from "node:url";

/** Branches whose builds serve real customers. */
export const PRODUCTION_BRANCHES = new Set(["develop", "main"]);
/** Path prefix per target; both are fixed rewrites in vercel.json. */
export const PROXY_PATHS = { production: "/medusa", staging: "/medusa-staging" };

/** @returns {{ target: "production" | "staging", proxy: string }} */
export function resolveBackend(env) {
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
