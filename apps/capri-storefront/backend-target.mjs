// The one place that decides which backend a storefront deployment talks to.
//
// Used twice from the same code, so the two can never disagree:
//   - vercel.ts imports resolveBackend() for the /medusa rewrite destination;
//   - scripts/vercel-build.sh runs this file (`node backend-target.mjs`) to get the
//     target for VITE_BACKEND_TARGET (the STAGING banner). vercel.ts cannot pass it
//     itself: Vercel requires buildCommand to be a static value.
//
// develop and main serve the live store (www.rubilens.com is attached to develop),
// so they always use production; a MEDUSA_BACKEND_ORIGIN that says otherwise is an
// error, which fails the build and keeps the previous deployment live. Every other
// branch uses staging, or MEDUSA_BACKEND_ORIGIN if set for it.
// scripts/check-vercel-config.mjs (pnpm test, CI) checks every case.

import { pathToFileURL } from "node:url";

export const PRODUCTION_BACKEND = "https://api.161-153-9-98.sslip.io";
export const STAGING_BACKEND = "https://api-staging.161-153-9-98.sslip.io";
/** Branches whose builds serve real customers. */
export const PRODUCTION_BRANCHES = new Set(["develop", "main"]);

/** @returns {{ target: "production" | "staging" | "custom", origin: string }} */
export function resolveBackend(env) {
  const branch = env.VERCEL_GIT_COMMIT_REF ?? "";
  const live = PRODUCTION_BRANCHES.has(branch) || env.VERCEL_ENV === "production";
  const override = env.MEDUSA_BACKEND_ORIGIN?.trim().replace(/\/+$/, "");
  if (live) {
    if (override && override !== PRODUCTION_BACKEND) {
      throw new Error(
        `MEDUSA_BACKEND_ORIGIN="${override}" is set for a production build (branch "${branch}"). ` +
          `Production always uses ${PRODUCTION_BACKEND}; scope the variable to Preview branches only.`
      );
    }
    return { target: "production", origin: PRODUCTION_BACKEND };
  }
  if (override) {
    // Fail the build rather than ship a store that proxies to a typo.
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(override)) {
      throw new Error(`MEDUSA_BACKEND_ORIGIN must be an https origin without a path, got "${override}"`);
    }
    if (override === PRODUCTION_BACKEND) return { target: "production", origin: PRODUCTION_BACKEND };
    return { target: override === STAGING_BACKEND ? "staging" : "custom", origin: override };
  }
  return { target: "staging", origin: STAGING_BACKEND };
}

// `node backend-target.mjs` prints the target (used by scripts/vercel-build.sh).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(resolveBackend(process.env).target);
  } catch (e) {
    console.error(`backend-target: ${e.message}`);
    process.exit(1);
  }
}
