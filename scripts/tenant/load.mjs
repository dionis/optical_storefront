/**
 * Reads the tenant manifest for a build (docs/MULTI-TENANT-TECNICO.md §6).
 *
 * Shared by the storefront and try-on Vite configs and by `pnpm tenant`. Plain
 * Node with no dependencies: Vercel installs each app on its own with npm, and
 * this file has to load before anything is built. The full validation lives in
 * packages/shared (validateTenantManifest) and runs in CI, not here.
 *
 * Which manifest a build uses:
 *   1. `TENANT_FILE` (relative to the repo root), when set — always wins;
 *   2. otherwise the branch decides, the same way backend-target.mjs picks the
 *      backend: develop and main serve the live RUBI LENS store, every other
 *      line (develop_optical_storepos, the POS of Óptica El Rancho) and a local
 *      build without Vercel get Óptica El Rancho. A merge into develop can then
 *      never rename the live store.
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { brandVars } from "../../apps/capri-storefront/src/config/brandVars.js";
import { routedApi } from "./routing.mjs";

/** Same rule as PRODUCTION_BRANCHES in apps/capri-storefront/backend-target.mjs. */
const LIVE_BRANCHES = new Set(["develop", "main"]);
export const LIVE_TENANT_FILE = "tenants/rubi-lens/tenant.json";
export const DEFAULT_TENANT_FILE = "tenants/el-rancho/tenant.json";

/** The manifest path for this build, before resolving it against the repo root. */
export function tenantFileFor(env = process.env) {
  if (env.TENANT_FILE && String(env.TENANT_FILE).trim()) return String(env.TENANT_FILE).trim();
  const live = LIVE_BRANCHES.has(env.VERCEL_GIT_COMMIT_REF ?? "") || env.VERCEL_ENV === "production";
  return live ? LIVE_TENANT_FILE : DEFAULT_TENANT_FILE;
}

/** The palette index.css ships with. A manifest with this brand injects no CSS. */
export const DEFAULT_BRAND = Object.freeze({ primary: "#01326b", primaryDark: "#021f44", accent: "#d6123e" });

export function loadTenant(repoRoot, env = process.env) {
  const rel = tenantFileFor(env);
  const file = isAbsolute(rel) ? rel : join(repoRoot, rel);
  if (!existsSync(file)) throw new Error(`tenant: manifest not found at ${file} (TENANT_FILE=${env.TENANT_FILE ?? "unset"})`);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  return { manifest, file, dir: dirname(file) };
}

const def = (m) => m.locale?.default ?? "es";
/** Text in the store's default language (the static HTML is not translated). */
export const text = (m, v) => (v && (v[def(m)] ?? Object.values(v)[0])) || "";

function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

/** `VITE_TENANT_*` for src/config/tenant.js and the try-on. */
export function tenantViteEnv(m) {
  return {
    VITE_TENANT_SLUG: m.slug,
    VITE_TENANT_NAME: m.identity.name,
    VITE_TENANT_COMPACT_NAME: m.identity.compactName || m.identity.name.replace(/\s+/g, ""),
    VITE_TENANT_TAGLINE: text(m, m.identity.tagline),
    VITE_TENANT_SITE: hostOf(m.domains.storefront),
    VITE_TENANT_LOGO: m.brand.logo,
    VITE_TENANT_LOGO_MARK: m.brand.logoMark,
    VITE_TENANT_IMAGE_CREDIT: m.supplier.imageCredit ?? "",
  };
}

/**
 * Puts the manifest's values in process.env for Vite to expose. A variable that
 * is already set (Vercel project settings, .env) wins: the manifest only fills gaps.
 */
export function applyTenantEnv(m, env = process.env) {
  for (const [k, v] of Object.entries(tenantViteEnv(m))) {
    if (env[k] === undefined || env[k] === "") env[k] = v;
  }
}

export const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `%TENANT_*%` placeholders of index.html. */
export function htmlValues(m) {
  return {
    TENANT_LANG: def(m),
    TENANT_TITLE: text(m, m.seo.title),
    TENANT_DESCRIPTION: text(m, m.seo.description),
    TENANT_SOCIAL_TITLE: text(m, m.seo.socialTitle),
    TENANT_SOCIAL_DESCRIPTION: text(m, m.seo.socialDescription),
    TENANT_THEME_COLOR: m.brand.themeColor,
    TENANT_API_ORIGIN: m.domains.api || m.domains.storefront,
  };
}

/**
 * The inside of the Organization JSON-LD in index.html, one property per line
 * with the indentation the file uses. Values go through JSON.stringify and "</"
 * is escaped, so nothing in a manifest can close the <script>.
 */
export function orgJsonLd(m) {
  const site = String(m.domains.storefront).replace(/\/+$/, "");
  const logo = /^https?:\/\//.test(m.brand.logo) ? m.brand.logo : `${site}${m.brand.logo}`;
  const props = [
    ["@context", "https://schema.org"],
    ["@type", "Organization"],
    ["name", m.identity.name],
    ...(m.seo.alternateName ? [["alternateName", m.seo.alternateName]] : []),
    ["url", `${site}/`],
    ["logo", logo],
    ...(m.seo.sameAs?.length ? [["sameAs", m.seo.sameAs]] : []),
  ];
  const json = (v) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(v)).replace(/<\//g, "<\\/");
  return props.map(([k, v]) => `      ${JSON.stringify(k)}: ${json(v)}`).join(",\n");
}

export function fillHtml(html, values) {
  return html.replace(/%(TENANT_[A-Z_]+)%/g, (whole, key) => (key in values ? escapeHtml(values[key]) : whole));
}

/**
 * Overrides of index.css's palette for a brand that is not the default one.
 * `html:root` outranks the `:root` blocks of index.css, so it wins whatever the
 * order of the stylesheets. Empty for RUBI LENS.
 */
export function brandCss(m) {
  const b = m.brand;
  if (b.primary === DEFAULT_BRAND.primary && b.primaryDark === DEFAULT_BRAND.primaryDark && b.accent === DEFAULT_BRAND.accent) return "";
  const vars = brandVars(b);
  return `html:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

/** The installable-app manifest with the tenant's names, or null when nothing changes. */
export function patchWebmanifest(source, m) {
  const before = JSON.parse(source);
  const after = {
    ...before,
    name: text(m, m.seo.socialTitle),
    short_name: m.identity.name,
    description: text(m, m.seo.appDescription ?? m.seo.socialDescription),
    theme_color: m.brand.themeColor,
  };
  return JSON.stringify(after) === JSON.stringify(before) ? null : JSON.stringify(after, null, 2) + "\n";
}

/** Copies `tenants/<slug>/public/**` over the build output (logos, favicons, og image). */
export function copyTenantPublic(tenantDir, outDir) {
  const src = join(tenantDir, "public");
  if (!existsSync(src)) return [];
  const copied = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const from = join(dir, name);
      if (statSync(from).isDirectory()) walk(from);
      else {
        const to = join(outDir, relative(src, from));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        copied.push(relative(src, from));
      }
    }
  };
  walk(src);
  return copied;
}

/** Vite plugin: index.html placeholders, brand CSS, app manifest and public overrides. */
/**
 * The brand the owner saved in the panel (GET /store/tenant), baked into this
 * build instead of the manifest's: theme colour and the inline CSS, so a first
 * visit paints the right colours before any JS runs ("Publicar marca" rebuilds
 * through a deploy hook). Only for opticians with their own routed backend —
 * RUBI LENS and El Rancho keep the manifest at build time and get the saved
 * brand at runtime. Any failure keeps the manifest: a build never depends on
 * the backend being up.
 */
export async function withPublishedBrand(tenant, env = process.env, fetchImpl = globalThis.fetch) {
  const api = routedApi(tenant.manifest);
  const key = env.VITE_MEDUSA_PUBLISHABLE_KEY;
  if (!api || !key || typeof fetchImpl !== "function") return tenant;
  try {
    const r = await fetchImpl(`${api}/store/tenant`, { headers: { "x-publishable-api-key": key }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = (await r.json())?.tenant?.brand;
    if (!b || !/^#[0-9a-f]{6}$/i.test(b.primary ?? "") || !/^#[0-9a-f]{6}$/i.test(b.accent ?? "")) return tenant;
    const primaryDark = /^#[0-9a-f]{6}$/i.test(b.primary_dark ?? "") ? b.primary_dark : tenant.manifest.brand.primaryDark;
    console.log(`tenant: using the brand saved in the panel (${b.primary} / ${b.accent})`);
    return { ...tenant, manifest: { ...tenant.manifest, brand: { ...tenant.manifest.brand, primary: b.primary, primaryDark, accent: b.accent, themeColor: b.primary } } };
  } catch (e) {
    console.warn(`tenant: could not read the saved brand (${e.message}); building with the manifest's`);
    return tenant;
  }
}

export function tenantPlugin(tenant) {
  const m = tenant.manifest;
  let outDir = null;
  return {
    name: "tenant",
    configResolved(config) {
      outDir = config.build.outDir && isAbsolute(config.build.outDir) ? config.build.outDir : join(config.root, config.build.outDir || "dist");
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        let out = fillHtml(html.replace("%TENANT_ORG_JSONLD%", () => orgJsonLd(m)), htmlValues(m));
        const css = brandCss(m);
        if (css) out = out.replace("</head>", `  <style id="tenant-brand">${css}</style>\n  </head>`);
        return out;
      },
    },
    writeBundle() {
      const manifestFile = join(outDir, "site.webmanifest");
      if (existsSync(manifestFile)) {
        const patched = patchWebmanifest(readFileSync(manifestFile, "utf8"), m);
        if (patched) writeFileSync(manifestFile, patched);
      }
      copyTenantPublic(tenant.dir, outDir);
    },
  };
}
