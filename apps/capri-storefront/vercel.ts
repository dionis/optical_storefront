// Vercel project config for the storefront (Root Directory = apps/capri-storefront).
// Replaces vercel.json — Vercel reads only one of the two — so the /medusa rewrite can
// pick its backend per deployment instead of hardcoding one per branch. A hardcoded
// staging URL on a branch rode along when that branch was merged into develop, and the
// live store spent hours calling the staging backend and database.
//
//   - Builds of develop or main, and any Production deployment → production backend.
//   - Every other branch (e.g. develop_optical_storepos) → staging.
//   - MEDUSA_BACKEND_ORIGIN, if set in the Vercel environment, overrides both.
//
// Keyed on the branch, not only on VERCEL_ENV: www.rubilens.com is attached to the
// develop branch, so the live store is served by develop's *Preview* deployments.
// Evaluated at build time; VERCEL_GIT_COMMIT_REF and VERCEL_ENV are Vercel system
// variables.

const PRODUCTION_BACKEND = "https://api.161-153-9-98.sslip.io";
const STAGING_BACKEND = "https://api-staging.161-153-9-98.sslip.io";
/** Branches whose builds serve real customers. */
const PRODUCTION_BRANCHES = new Set(["develop", "main"]);

function backendOrigin(): string {
  const override = process.env.MEDUSA_BACKEND_ORIGIN?.trim();
  if (override) {
    // Fail the build rather than ship a store that proxies to a typo.
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(override)) {
      throw new Error(`MEDUSA_BACKEND_ORIGIN must be an https origin without a path, got "${override}"`);
    }
    return override;
  }
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";
  const live = PRODUCTION_BRANCHES.has(branch) || process.env.VERCEL_ENV === "production";
  return live ? PRODUCTION_BACKEND : STAGING_BACKEND;
}

const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
const noStore = [
  { key: "Cache-Control", value: "no-store" },
  { key: "CDN-Cache-Control", value: "no-store" },
];
const noStoreRevalidate = [
  { key: "Cache-Control", value: "no-store, must-revalidate" },
  { key: "CDN-Cache-Control", value: "no-store" },
];

export const config = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: "vite",
  buildCommand: "bash scripts/vercel-build.sh",
  outputDirectory: "dist",
  installCommand:
    "npm install --fetch-retries=6 --fetch-retry-mintimeout=15000 --fetch-retry-maxtimeout=120000 --fetch-retry-factor=3",
  rewrites: [
    { source: "/medusa/:path*", destination: `${backendOrigin()}/:path*` },
    { source: "/(.*)", destination: "/index.html" },
  ],
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value:
            'camera=(self), microphone=(), geolocation=(), payment=(self "https://js.stripe.com" "https://checkout.stripe.com")',
        },
        { key: "X-DNS-Prefetch-Control", value: "off" },
      ],
    },
    { source: "/medusa/(.*)", headers: noStore },
    { source: "/assets/(.*)", headers: immutable },
    { source: "/tryon-3d/assets/(.*)", headers: immutable },
    { source: "/tryon-3d/mediapipe/(.*)", headers: immutable },
    { source: "/tryon-3d/draco/(.*)", headers: immutable },
    { source: "/tryon-3d/models/(.*)", headers: immutable },
    { source: "/(catalog|cases|catalog-meta|catalog-history|build-id).json", headers: noStore },
    { source: "/(.*\\.html)", headers: noStoreRevalidate },
    { source: "/((?!assets/|.*\\.).*)", headers: noStoreRevalidate },
  ],
};
