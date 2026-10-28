// Vercel project config for the storefront (Root Directory = apps/capri-storefront).
// Replaces vercel.json — Vercel reads only one of the two — so the /medusa rewrite can
// pick its backend per deployment instead of hardcoding one per branch. A hardcoded
// staging URL on a branch rode along when that branch was merged into develop, and the
// live store spent hours calling the staging backend and database.
//
// The decision itself lives in backend-target.mjs (develop/main → production, always;
// other branches → staging). Vercel only allows computed values in some properties:
// the rewrite destination may be computed, buildCommand must be a static string, so
// scripts/vercel-build.sh asks backend-target.mjs for the same answer on its own.
// scripts/check-vercel-config.mjs (pnpm test, CI) checks all of this.
import { resolveBackend } from "./backend-target.mjs";

const backend = resolveBackend(process.env);

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
  // Static on purpose (Vercel rejects computed values here). The script derives
  // VITE_BACKEND_TARGET from backend-target.mjs, the same decision as the rewrite.
  buildCommand: "bash scripts/vercel-build.sh",
  outputDirectory: "dist",
  installCommand:
    "npm install --fetch-retries=6 --fetch-retry-mintimeout=15000 --fetch-retry-maxtimeout=120000 --fetch-retry-factor=3",
  rewrites: [
    { source: "/medusa/:path*", destination: `${backend.origin}/:path*` },
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
