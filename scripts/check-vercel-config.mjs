// Guards the storefront's backend wiring (apps/capri-storefront/vercel.ts).
//
// On 2026-10-27 a staging-only /medusa rewrite was merged into develop and the
// live store sent cart, checkout, orders and the try-on's AI calls to the staging
// backend for hours. This check fails whenever any of that could happen again:
//   1. develop/main (and any Production deployment) must resolve to production,
//      whatever MEDUSA_BACKEND_ORIGIN says; other branches resolve to staging.
//   2. The rewrite and the STAGING banner (VITE_BACKEND_TARGET) come from the same
//      decision (apps/capri-storefront/backend-target.mjs), and nothing else in
//      vercel.ts varies by branch: Vercel fails builds with computed static props.
//   3. No hardcoded staging host in a vercel.json or in storefront/try-on code.
//   4. apps/capri-storefront has vercel.ts only — Vercel reads one config file.
//
// Run: node --experimental-strip-types scripts/check-vercel-config.mjs
// (part of `pnpm test` and CI).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STOREFRONT = join(ROOT, "apps", "capri-storefront");
const VERCEL_TS = join(STOREFRONT, "vercel.ts");
const PRODUCTION = "https://api.161-153-9-98.sslip.io";
const STAGING_HOST = "api-staging.";

const failures = [];
const fail = (msg) => failures.push(msg);

async function loadConfig(env) {
  const saved = { ...process.env };
  for (const k of ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "MEDUSA_BACKEND_ORIGIN"]) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await import(`${pathToFileURL(VERCEL_TS).href}?case=${Math.random()}`);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

// 1 + 2: every case, through the real config Vercel will read.
const CASES = [
  { env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "develop" }, want: "production" },
  { env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" }, want: "production" },
  { env: { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "develop" }, want: "production" },
  { env: { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "anything" }, want: "production" },
  { env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "develop", MEDUSA_BACKEND_ORIGIN: PRODUCTION }, want: "production" },
  { env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "develop_optical_storepos" }, want: "staging" },
  { env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "frontend" }, want: "staging" },
  { env: {}, want: "staging" },
  { env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature-x", MEDUSA_BACKEND_ORIGIN: "https://api.example.com" }, want: "custom" },
  // A production branch can never be redirected: the build must fail instead.
  { env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "develop", MEDUSA_BACKEND_ORIGIN: "https://api-staging.161-153-9-98.sslip.io" }, want: "error" },
  { env: { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", MEDUSA_BACKEND_ORIGIN: "https://api.example.com" }, want: "error" },
  { env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature-x", MEDUSA_BACKEND_ORIGIN: "http://bad/path" }, want: "error" },
];

// The build script asks this module for VITE_BACKEND_TARGET; vercel.ts imports it
// for the rewrite. Testing both against the same cases proves they agree.
const { resolveBackend } = await import(pathToFileURL(join(STOREFRONT, "backend-target.mjs")).href);
const STATIC_SHAPES = new Set();

if (!existsSync(VERCEL_TS)) {
  fail("apps/capri-storefront/vercel.ts is missing");
} else {
  for (const { env, want } of CASES) {
    const label = JSON.stringify(env);
    let mod;
    try {
      mod = await loadConfig(env);
    } catch (e) {
      if (want !== "error") fail(`${label}: config threw (${e.message}) but should resolve to ${want}`);
      continue;
    }
    if (want === "error") {
      fail(`${label}: config built but must fail the build`);
      continue;
    }
    let target;
    try {
      target = resolveBackend(env).target;
    } catch (e) {
      fail(`${label}: backend-target.mjs threw (${e.message}) but vercel.ts did not`);
      continue;
    }
    const { config } = mod;
    const rewrite = config.rewrites.find((r) => r.source === "/medusa/:path*");
    if (target !== want) fail(`${label}: build target (VITE_BACKEND_TARGET) = ${target}, expected ${want}`);
    if (!rewrite) fail(`${label}: no /medusa rewrite`);
    else if (want === "production" && rewrite.destination !== `${PRODUCTION}/:path*`) fail(`${label}: /medusa → ${rewrite.destination}, expected production`);
    else if (want === "staging" && !rewrite.destination.includes(STAGING_HOST)) fail(`${label}: /medusa → ${rewrite.destination}, expected staging`);
    if (config.buildCommand !== "bash scripts/vercel-build.sh") fail(`${label}: unexpected buildCommand "${config.buildCommand}"`);
    // Vercel rejects computed values in static properties ("Dynamic values found in
    // static properties: buildCommand"). Only the /medusa destination may vary.
    STATIC_SHAPES.add(JSON.stringify({ ...config, rewrites: config.rewrites.map((r) => (r === rewrite ? { ...r, destination: "<backend>" } : r)) }));
  }
  if (STATIC_SHAPES.size > 1) fail("vercel.ts varies by branch outside the /medusa rewrite destination — Vercel fails such builds");
}

// Vercel validates vercel.ts's static properties by reading the source, without
// running it: a variable, spread or ${} there reads as a missing or dynamic value
// ("headers[1] missing required property headers", "Dynamic values found in static
// properties: buildCommand"). Only the /medusa destination may be computed.
if (existsSync(VERCEL_TS)) {
  const src = readFileSync(VERCEL_TS, "utf8");
  const at = src.indexOf("export const config");
  const body = (at === -1 ? "" : src.slice(at))
    .replace(/\/\/[^\n]*/g, "")
    .replace("{ source: \"/medusa/:path*\", destination: `${backend.origin}/:path*` }", "{}");
  if (at === -1) fail("vercel.ts has no `export const config`");
  const computed = [
    ...[...body.matchAll(/:\s*([A-Za-z_$][\w$.]*)\s*[,}\]\n]/g)].map((m) => m[1]).filter((v) => !["true", "false", "null"].includes(v)),
    ...(body.match(/\.\.\.[A-Za-z_$]/g) ?? []),
    ...(body.match(/\$\{/g) ?? []),
  ];
  if (computed.length) fail(`vercel.ts config has non-literal values outside the /medusa destination: ${[...new Set(computed)].join(", ")}`);
}

// 4: Vercel reads exactly one config file per project.
if (existsSync(join(STOREFRONT, "vercel.json"))) {
  fail("apps/capri-storefront/vercel.json exists next to vercel.ts — delete it (vercel.ts replaces it)");
}

// 3: no hardcoded staging host where it would ship.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?|mjs|json|html|sh)$/.test(name)) out.push(p);
  }
  return out;
}
const scanned = [
  join(ROOT, "vercel.json"),
  ...walk(join(STOREFRONT, "src")),
  ...walk(join(STOREFRONT, "scripts")),
  ...walk(join(ROOT, "apps", "vto-web", "src")),
  join(ROOT, "apps", "vto-web", "index.html"),
].filter(existsSync);
for (const file of scanned) {
  if (readFileSync(file, "utf8").includes(STAGING_HOST)) fail(`${relative(ROOT, file)} hardcodes the staging backend`);
}

if (failures.length) {
  console.error(`check-vercel-config: ${failures.length} problem(s)\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`check-vercel-config: OK (${CASES.length} cases, ${scanned.length} files scanned)`);
