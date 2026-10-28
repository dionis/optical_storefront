// Guards the storefront's backend wiring.
//
// On 2026-10-27 a staging-only /medusa rewrite was merged into develop and the
// live store sent cart, checkout, orders and the try-on's AI calls to the staging
// backend for hours. The design that prevents it:
//   - apps/capri-storefront/vercel.json is the same on every branch, with two fixed
//     rewrites: /medusa → production, /medusa-staging → staging. A merge cannot
//     change where the live store points. (vercel.ts was tried and dropped: Vercel
//     validates its static properties from the source, which kept rejecting it.)
//   - apps/capri-storefront/backend-target.mjs picks the prefix per build from the
//     branch: develop/main → /medusa, always; any other branch → /medusa-staging.
//   - the app takes the prefix from VITE_BACKEND_PROXY, which scripts/vercel-build.sh
//     sets from backend-target.mjs (and refuses to build a live branch otherwise).
// This check fails whenever any of that stops being true.
//
// Run: node scripts/check-vercel-config.mjs (part of `pnpm test` and CI).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STOREFRONT = join(ROOT, "apps", "capri-storefront");
const PRODUCTION = "https://api.161-153-9-98.sslip.io";
const STAGING = "https://api-staging.161-153-9-98.sslip.io";
const STAGING_HOST = "api-staging.";

const failures = [];
const fail = (msg) => failures.push(msg);
const read = (p) => readFileSync(p, "utf8");

// 1. One static config file, with exactly the two backend rewrites.
for (const name of ["vercel.ts", "vercel.js", "vercel.mjs", "vercel.cjs", "vercel.mts", "vercel.toml"]) {
  if (existsSync(join(STOREFRONT, name))) fail(`apps/capri-storefront/${name} exists — the storefront uses vercel.json only`);
}
const configPath = join(STOREFRONT, "vercel.json");
let config = null;
try {
  config = JSON.parse(read(configPath));
} catch (e) {
  fail(`apps/capri-storefront/vercel.json is missing or invalid (${e.message})`);
}
if (config) {
  const rewrites = config.rewrites ?? [];
  const backendRules = rewrites.filter((r) => /^https?:\/\//.test(r.destination ?? ""));
  const prod = rewrites.findIndex((r) => r.source === "/medusa/:path*");
  const stag = rewrites.findIndex((r) => r.source === "/medusa-staging/:path*");
  const spa = rewrites.findIndex((r) => r.source === "/(.*)");
  if (prod === -1 || rewrites[prod].destination !== `${PRODUCTION}/:path*`) fail("vercel.json: /medusa/:path* must rewrite to the production backend");
  if (stag === -1 || rewrites[stag].destination !== `${STAGING}/:path*`) fail("vercel.json: /medusa-staging/:path* must rewrite to the staging backend");
  if (backendRules.length !== 2) fail(`vercel.json: expected exactly 2 backend rewrites, found ${backendRules.length}`);
  if (spa !== -1 && (spa < prod || spa < stag)) fail("vercel.json: the SPA fallback /(.*) must come after the backend rewrites");
  for (const prefix of ["/medusa/(.*)", "/medusa-staging/(.*)"]) {
    const h = (config.headers ?? []).find((x) => x.source === prefix);
    if (!h || !h.headers.some((x) => x.key === "Cache-Control" && x.value === "no-store")) fail(`vercel.json: ${prefix} must be served no-store`);
  }
  if (!/^bash scripts\/vercel-build\.sh$/.test(config.buildCommand ?? "")) fail(`vercel.json: unexpected buildCommand "${config.buildCommand}"`);
}

// 2. The per-build decision: live branches can only ever get production.
const { resolveBackend, PROXY_PATHS } = await import(pathToFileURL(join(STOREFRONT, "backend-target.mjs")).href);
const CASES = [
  [{ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "develop" }, "production"],
  [{ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" }, "production"],
  [{ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "develop" }, "production"],
  [{ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "anything" }, "production"],
  [{ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "develop", MEDUSA_BACKEND_ORIGIN: STAGING }, "production"],
  [{ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "develop_optical_storepos" }, "staging"],
  [{ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "frontend" }, "staging"],
  [{}, "staging"],
];
if (PROXY_PATHS.production !== "/medusa" || PROXY_PATHS.staging !== "/medusa-staging") fail("backend-target.mjs: PROXY_PATHS must be /medusa and /medusa-staging (the vercel.json rewrites)");
for (const [env, want] of CASES) {
  const got = resolveBackend(env);
  if (got.target !== want || got.proxy !== PROXY_PATHS[want]) fail(`${JSON.stringify(env)} → ${got.target} ${got.proxy}, expected ${want} ${PROXY_PATHS[want]}`);
}

// 3. The build script feeds the app from backend-target.mjs and guards live branches.
const build = read(join(STOREFRONT, "scripts", "vercel-build.sh"));
for (const [needle, why] of [
  ["node backend-target.mjs", "must ask backend-target.mjs for the target"],
  ["export VITE_BACKEND_TARGET VITE_BACKEND_PROXY", "must export both variables to the app build"],
  ['VITE_VISION_API_BASE="${VITE_BACKEND_PROXY:-/medusa}"', "must give the try-on the same prefix"],
  ['[ "$VITE_BACKEND_PROXY" != "/medusa" ]', "must refuse a live branch that does not use /medusa"],
]) if (!build.includes(needle)) fail(`scripts/vercel-build.sh ${why}`);

// 4. The app builds every backend URL from VITE_BACKEND_PROXY.
for (const [file, needle] of [
  ["src/data/medusa.js", "env.VITE_BACKEND_PROXY || env.VITE_MEDUSA_URL"],
  ["src/admin/adminApi.js", "env.VITE_BACKEND_PROXY"],
  ["src/data/visionMeasure.js", "VITE_BACKEND_PROXY"],
]) if (!read(join(STOREFRONT, file)).includes(needle)) fail(`apps/capri-storefront/${file} must take its backend prefix from VITE_BACKEND_PROXY`);

// 5. No hardcoded staging host anywhere it would ship, other than vercel.json's rule.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?|mjs|json|html|sh)$/.test(name)) out.push(p);
  }
  return out;
}
const scanned = [
  join(ROOT, "vercel.json"),
  join(STOREFRONT, "backend-target.mjs"),
  ...walk(join(STOREFRONT, "src")),
  ...walk(join(STOREFRONT, "scripts")),
  ...walk(join(ROOT, "apps", "vto-web", "src")),
  join(ROOT, "apps", "vto-web", "index.html"),
].filter(existsSync);
for (const file of scanned) {
  if (read(file).includes(STAGING_HOST)) fail(`${relative(ROOT, file)} hardcodes the staging backend`);
}

if (failures.length) {
  console.error(`check-vercel-config: ${failures.length} problem(s)\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`check-vercel-config: OK (${CASES.length} cases, ${scanned.length} files scanned)`);
