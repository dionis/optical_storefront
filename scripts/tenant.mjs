/**
 * `pnpm tenant <command>` — the operator's tool for tenant manifests
 * (docs/MULTI-TENANT-TECNICO.md §10). Phase 1 commands:
 *
 *   list                                   manifests in tenants/ and whether they are valid
 *   validate [slug]                        full validation (all manifests without a slug)
 *   env <slug> --target backend|storefront [--with-secrets]
 *                                          variables to paste into Coolify / Vercel
 *
 * The rules live in packages/shared (validateTenantManifest); `pnpm tenant`
 * builds that package first. Secrets are printed, never written to disk.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { text } from "./tenant/load.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TENANTS = join(ROOT, "tenants");
const { validateTenantManifest } = await import(pathToFileURL(join(ROOT, "packages", "shared", "dist", "tenant.js")).href);

const slugs = () => readdirSync(TENANTS).filter((d) => existsSync(join(TENANTS, d, "tenant.json"))).sort();
const load = (slug) => {
  const file = join(TENANTS, slug, "tenant.json");
  if (!existsSync(file)) fail(`no manifest at tenants/${slug}/tenant.json (known: ${slugs().join(", ")})`);
  return JSON.parse(readFileSync(file, "utf8"));
};
function fail(msg) {
  console.error(`tenant: ${msg}`);
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--with-secrets"));

switch (command) {
  case "list": {
    for (const slug of slugs()) {
      const m = load(slug);
      const errors = validateTenantManifest(m);
      console.log(`${errors.length ? "✗" : "✓"} ${slug.padEnd(16)} ${m.identity?.name ?? "?"}  ${m.domains?.storefront ?? ""}`);
    }
    break;
  }
  case "validate": {
    const targets = positional[0] ? [positional[0]] : slugs();
    let bad = 0;
    for (const slug of targets) {
      const m = load(slug);
      const errors = validateTenantManifest(m);
      if (m.slug !== slug) errors.push(`slug: "${m.slug}" does not match the folder "${slug}"`);
      if (errors.length) {
        bad += 1;
        console.error(`✗ ${slug}\n${errors.map((e) => `    ${e}`).join("\n")}`);
      } else console.log(`✓ ${slug}`);
    }
    if (bad) process.exit(1);
    break;
  }
  case "env": {
    const slug = positional[0] ?? fail("usage: pnpm tenant env <slug> --target backend|storefront [--with-secrets]");
    const target = flag("target");
    const m = load(slug);
    const errors = validateTenantManifest(m);
    if (errors.length) fail(`tenants/${slug} is not valid — run \`pnpm tenant validate ${slug}\``);
    const lines = [];
    if (target === "storefront") {
      lines.push(`TENANT_FILE=tenants/${slug}/tenant.json`);
    } else if (target === "backend") {
      lines.push(
        `STORE_NAME=${m.identity.name}`,
        `TENANT_LEGAL_NAME=${m.identity.legalName ?? m.identity.name}`,
        `STOREFRONT_URL=${m.domains.storefront}`,
        `STORE_NOTIFICATION_LOCALE=${m.locale.default}`,
        `GSHEET_TIMEZONE=${m.locale.timezone}`,
        `TENANT_CURRENCY=${m.locale.currency}`,
        `TENANT_COUNTRY=${m.locale.country}`,
        `TENANT_BRAND_PRIMARY=${m.brand.emailPrimary}`,
        `TENANT_BRAND_ACCENT=${m.brand.emailAccent}`
      );
      if (m.domains.emailFrom) lines.push(`RESEND_FROM_EMAIL=${m.domains.emailFrom}`);
      if (flag("with-secrets")) {
        for (const key of ["JWT_SECRET", "COOKIE_SECRET", "ORDER_ACCESS_SECRET", "SELLER_LINK_SECRET", "VISION_INTERNAL_SECRET"]) {
          lines.push(`${key}=${randomBytes(32).toString("hex")}`);
        }
      }
    } else fail("--target must be backend or storefront");
    console.log(`# ${text(m, m.seo.socialTitle)} — ${target}`);
    console.log(lines.join("\n"));
    break;
  }
  default:
    console.log("usage: pnpm tenant list | validate [slug] | env <slug> --target backend|storefront [--with-secrets]");
    if (command) process.exit(1);
}
