/**
 * `pnpm tenant <command>` — the operator's tool for tenant manifests
 * (docs/MULTI-TENANT-TECNICO.md §10–11).
 *
 *   list                                   manifests in tenants/ and whether they are valid
 *   validate [slug]                        full validation (all manifests without a slug)
 *   new <slug> --name "…" --domain example.com --owner email [--timezone …] [--languages es,en]
 *                                          writes tenants/<slug>/tenant.json to complete by hand
 *   env <slug> --target backend|storefront [--with-secrets]
 *                                          variables to paste into Coolify / Vercel
 *   vercel [--check]                       writes the /medusa-t-<slug> rewrites into
 *                                          apps/capri-storefront/vercel.json (--check: only report)
 *   checklist <slug>                       the whole onboarding, step by step, with this store's values
 *   bootstrap <slug>                       the command that hands the store to its owner
 *
 * The rules live in packages/shared (validateTenantManifest); `pnpm tenant`
 * builds that package first. Secrets are printed, never written to disk.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { text } from "./tenant/load.mjs";
import { applyTenantRules, LEGACY_TENANTS, readManifests, routedApi, tenantProxyPath } from "./tenant/routing.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TENANTS = join(ROOT, "tenants");
const VERCEL_JSON = join(ROOT, "apps", "capri-storefront", "vercel.json");
const { validateTenantManifest } = await import(pathToFileURL(join(ROOT, "packages", "shared", "dist", "tenant.js")).href);

const slugs = () =>
  readdirSync(TENANTS)
    .filter((d) => !d.startsWith("_") && existsSync(join(TENANTS, d, "tenant.json")))
    .sort();
const load = (slug) => {
  const file = join(TENANTS, slug, "tenant.json");
  if (!existsSync(file)) fail(`no manifest at tenants/${slug}/tenant.json (known: ${slugs().join(", ")})`);
  return JSON.parse(readFileSync(file, "utf8"));
};
const loadValid = (slug) => {
  const m = load(slug);
  if (validateTenantManifest(m).length) fail(`tenants/${slug} is not valid — run \`pnpm tenant validate ${slug}\``);
  return m;
};
function fail(msg) {
  console.error(`tenant: ${msg}`);
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
const BOOLEAN_FLAGS = new Set(["--with-secrets", "--check"]);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  if (BOOLEAN_FLAGS.has(`--${name}`)) return true;
  return args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !BOOLEAN_FLAGS.has(args[i - 1])));

const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
};
/** example.com from https://www.example.com */
const apexOf = (origin) => hostOf(origin).replace(/^www\./, "");

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function newManifest({ slug, name, domain, owner, timezone, languages }) {
  const apex = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const langs = languages.split(",").map((l) => l.trim()).filter(Boolean);
  const both = (es, en) => Object.fromEntries(langs.map((l) => [l, l === "en" ? en : es]));
  return {
    slug,
    identity: {
      name,
      compactName: name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 16),
      legalName: name,
      tagline: both("Óptica y Salud Visual", "Optics & Vision Care"),
    },
    seo: {
      title: both(`${name} — Espejuelos con receta online`, `${name} — Prescription eyeglasses online`),
      description: both(
        `${name}: espejuelos con receta online, con probador virtual y lectura automática de la receta.`,
        `${name}: prescription eyeglasses online, with a virtual try-on and automatic prescription reading.`
      ),
      socialTitle: both(name, name),
      socialDescription: both("Espejuelos con receta online con probador virtual.", "Prescription eyeglasses online with a virtual try-on."),
    },
    domains: { storefront: `https://www.${apex}`, api: `https://api.${apex}`, emailFrom: `pedidos@${apex}` },
    locale: { default: langs[0], languages: langs, timezone, currency: "usd", country: "us" },
    brand: {
      primary: "#01326b",
      primaryDark: "#021f44",
      accent: "#d6123e",
      themeColor: "#01326b",
      emailPrimary: "#0b2f66",
      emailAccent: "#b8921e",
      logo: "/logo-oficial.png",
      logoMark: "/logo-oficial-mark.png",
    },
    supplier: { id: "capri", imageCredit: "caprioptics.com" },
    owner: { email: owner },
  };
}

function backendEnv(m, withSecrets) {
  const api = m.domains.api ?? "";
  const store = m.domains.storefront;
  const origins = [store, `https://${apexOf(store)}`].filter((v, i, a) => a.indexOf(v) === i).join(",");
  const lines = [
    `# Identity (from tenants/${m.slug}/tenant.json)`,
    `STORE_NAME=${m.identity.name}`,
    `TENANT_LEGAL_NAME=${m.identity.legalName ?? m.identity.name}`,
    `STOREFRONT_URL=${store}`,
    `STORE_NOTIFICATION_LOCALE=${m.locale.default}`,
    `GSHEET_TIMEZONE=${m.locale.timezone}`,
    `TENANT_CURRENCY=${m.locale.currency}`,
    `TENANT_COUNTRY=${m.locale.country}`,
    `TENANT_BRAND_PRIMARY=${m.brand.emailPrimary}`,
    `TENANT_BRAND_ACCENT=${m.brand.emailAccent}`,
    "",
    "# Origins",
    ...(api ? [`BACKEND_URL=${api}`] : []),
    `STORE_CORS=${origins}`,
    `ADMIN_CORS=${origins}`,
    `AUTH_CORS=${origins}`,
    "",
    "# Storage (Cloudflare R2: create both buckets; the rx one stays private)",
    `R2_BUCKET=${m.slug}-assets`,
    `R2_PRESCRIPTION_BUCKET=${m.slug}-rx`,
    "",
    "# Notices",
    ...(m.domains.emailFrom ? [`RESEND_FROM_EMAIL=${m.domains.emailFrom}`] : []),
    ...(m.owner?.email ? [`STORE_ORDER_NOTIFICATION_EMAIL=${m.owner.email}`, `STORE_SUPPORT_EMAIL=${m.owner.email}`] : []),
    "",
    "# The owner's own accounts (docs/MULTI-TENANT-TECNICO.md §17) — fill in by hand:",
    "# DATABASE_URL= REDIS_URL= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= R2_ENDPOINT= R2_PUBLIC_URL=",
    "# STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= RESEND_API_KEY= ANTHROPIC_API_KEY=",
    "# GSHEET_SPREADSHEET_ID= GSHEET_SERVICE_ACCOUNT_EMAIL= GSHEET_SERVICE_ACCOUNT_KEY=",
    "# TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= TWILIO_FROM_NUMBER=   (optional)",
  ];
  if (withSecrets) {
    lines.push("", "# Generated now — paste once, never commit");
    for (const key of ["JWT_SECRET", "COOKIE_SECRET", "ORDER_ACCESS_SECRET", "SELLER_LINK_SECRET", "VISION_INTERNAL_SECRET"]) {
      lines.push(`${key}=${randomBytes(32).toString("hex")}`);
    }
  } else {
    lines.push("", "# JWT_SECRET, COOKIE_SECRET, ORDER_ACCESS_SECRET, SELLER_LINK_SECRET, VISION_INTERNAL_SECRET: add --with-secrets");
  }
  return lines;
}

function storefrontEnv(m) {
  const lines = [`TENANT_FILE=tenants/${m.slug}/tenant.json`];
  lines.push(
    "# From the new backend (Settings → Publishable API keys) and the owner's Stripe:",
    "# VITE_MEDUSA_PUBLISHABLE_KEY=   VITE_STRIPE_PUBLISHABLE_KEY=",
    "# Optional: VITE_GOOGLE_MAPS_KEY= (docs/GOOGLE-MAPS.md)"
  );
  return lines;
}

function bootstrapLine(m) {
  const owner = m.owner?.email ?? "<owner email>";
  const [first, ...rest] = String(m.owner?.name ?? "").split(" ");
  const names = m.owner?.name ? ` TENANT_OWNER_FIRST_NAME="${first}"${rest.length ? ` TENANT_OWNER_LAST_NAME="${rest.join(" ")}"` : ""}` : "";
  return {
    dry: `TENANT_OWNER_EMAIL=${owner}${names} npx medusa exec ./src/scripts/tenant-bootstrap.js`,
    run: `TENANT_OWNER_EMAIL=${owner}${names} TENANT_BOOTSTRAP_CONFIRM=yes npx medusa exec ./src/scripts/tenant-bootstrap.js`,
  };
}

function checklist(m) {
  const api = m.domains.api ?? `https://api.${apexOf(m.domains.storefront)}`;
  const legacy = LEGACY_TENANTS.has(m.slug);
  const routed = routedApi(m);
  const b = bootstrapLine(m);
  return [
    `Alta de ${m.identity.name} (${m.slug}) — docs/MULTI-TENANT-TECNICO.md §11`,
    "",
    "1. Ficha",
    `   [ ] Revisar tenants/${m.slug}/tenant.json (textos, colores, proveedor) y poner el logo en tenants/${m.slug}/public/`,
    `   [ ] pnpm tenant validate ${m.slug}`,
    "2. Cuentas del dueño (claves propias, §17)",
    "   [ ] Stripe en modo live · dominio · Google (hoja) · Resend · Twilio (opcional) · Anthropic (lector de recetas)",
    "3. Backend (Coolify, desde main)",
    "   [ ] App nueva + Postgres + Redis",
    `   [ ] Variables: pnpm tenant env ${m.slug} --target backend --with-secrets`,
    `   [ ] Dominio de la API: ${api}`,
    "4. Almacenamiento y correo",
    `   [ ] R2: ${m.slug}-assets (público) y ${m.slug}-rx (privado, solo URLs firmadas)`,
    `   [ ] Resend: verificar ${m.domains.emailFrom ? m.domains.emailFrom.split("@")[1] : apexOf(m.domains.storefront)}`,
    "5. Stripe",
    `   [ ] Webhook: ${api}/hooks/payment/stripe_stripe → STRIPE_WEBHOOK_SECRET`,
    "6. Hoja de Google",
    "   [ ] Crear la hoja, compartirla con la cuenta de servicio → GSHEET_*",
    "7. Datos iniciales (terminal de Coolify)",
    "   [ ] npx medusa exec ./src/scripts/seed.js   (región, canal de venta, clave publicable)",
    "   [ ] npx medusa user -e <correo técnico> -p <contraseña>   (usuario técnico para montar la tienda)",
    "8. Storefront (Vercel)",
    "   [ ] Proyecto nuevo, Root Directory = apps/capri-storefront, rama main",
    `   [ ] Variables: pnpm tenant env ${m.slug} --target storefront`,
    `   [ ] Dominios: ${m.domains.storefront} y https://${apexOf(m.domains.storefront)}`,
    legacy
      ? "   [ ] (tienda original: usa /medusa o /medusa-staging según la rama)"
      : routed
        ? `   [ ] pnpm tenant vercel → reescritura ${tenantProxyPath(m.slug)} → ${routed}; commit y PR`
        : "   [!] domains.api falta o no es https: el build fallará hasta corregirlo",
    "9. Catálogo",
    "   [ ] Proveedor ya en uso: importar el catálogo base compartido (§8.1); nuevo: python -m scraper sync --full",
    "   [ ] pnpm reindex",
    "10. Entrega al dueño",
    `   [ ] Simulacro: ${b.dry}`,
    `   [ ] Entrega:   ${b.run}`,
    "   [ ] El dueño activa su cuenta desde el correo y completa «Primeros pasos» en el panel",
    "11. Verificación",
    "   [ ] Seguridad en verde · compra real + reembolso · correo y SMS recibidos · fila en la hoja · cambio de estado desde la hoja",
  ];
}

switch (command) {
  case "list": {
    for (const slug of slugs()) {
      const m = load(slug);
      const errors = validateTenantManifest(m);
      const route = LEGACY_TENANTS.has(slug) ? "(rama)" : routedApi(m) ? tenantProxyPath(slug) : "sin ruta";
      console.log(`${errors.length ? "✗" : "✓"} ${slug.padEnd(16)} ${(m.identity?.name ?? "?").padEnd(22)} ${(m.domains?.storefront ?? "").padEnd(34)} ${route}`);
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
  case "new": {
    const usage = 'usage: pnpm tenant new <slug> --name "Óptica X" --domain opticax.com --owner dueno@opticax.com [--timezone America/Chicago] [--languages es,en]';
    const slug = positional[0] ?? fail(usage);
    if (!SLUG_RE.test(slug)) fail(`slug "${slug}": lowercase letters, digits and single dashes only`);
    if (existsSync(join(TENANTS, slug))) fail(`tenants/${slug} already exists`);
    const name = flag("name");
    const domain = flag("domain");
    const owner = flag("owner");
    if (typeof name !== "string" || typeof domain !== "string" || typeof owner !== "string") fail(usage);
    const timezone = typeof flag("timezone") === "string" ? flag("timezone") : "America/Chicago";
    const languages = typeof flag("languages") === "string" ? flag("languages") : "es,en";
    const m = newManifest({ slug, name, domain, owner, timezone, languages });
    const errors = validateTenantManifest(m);
    if (errors.length) fail(`the manifest would not be valid:\n    ${errors.join("\n    ")}`);
    mkdirSync(join(TENANTS, slug, "public"), { recursive: true });
    writeFileSync(join(TENANTS, slug, "tenant.json"), `${JSON.stringify(m, null, 2)}\n`);
    writeFileSync(
      join(TENANTS, slug, "public", "README.md"),
      `Files here are copied over the storefront's public/ when building ${name}.\nPut logo-oficial.png, logo-oficial-mark.png, favicon.svg and the icons with the same names as in apps/capri-storefront/public/.\n`
    );
    console.log(`✓ tenants/${slug}/tenant.json\n`);
    console.log("Next: review texts and colours, add the logo, then:");
    console.log(`  pnpm tenant validate ${slug}\n  pnpm tenant vercel\n  pnpm tenant checklist ${slug}`);
    break;
  }
  case "env": {
    const slug = positional[0] ?? fail("usage: pnpm tenant env <slug> --target backend|storefront [--with-secrets]");
    const target = flag("target");
    const m = loadValid(slug);
    let lines;
    if (target === "storefront") lines = storefrontEnv(m);
    else if (target === "backend") lines = backendEnv(m, Boolean(flag("with-secrets")));
    else fail("--target must be backend or storefront");
    console.log(`# ${text(m, m.seo.socialTitle)} — ${target}`);
    console.log(lines.join("\n"));
    break;
  }
  case "vercel": {
    for (const slug of slugs()) {
      const errors = validateTenantManifest(load(slug));
      if (errors.length) fail(`tenants/${slug} is not valid — fix it before routing it`);
    }
    const current = JSON.parse(readFileSync(VERCEL_JSON, "utf8"));
    const next = applyTenantRules(current, readManifests(ROOT));
    const before = JSON.stringify(current);
    const after = JSON.stringify(next);
    const routes = next.rewrites.filter((r) => r.source.startsWith("/medusa-t-"));
    if (before === after) {
      console.log(`✓ apps/capri-storefront/vercel.json is up to date (${routes.length} optician rewrite(s))`);
      break;
    }
    if (flag("check")) fail("apps/capri-storefront/vercel.json is out of date — run `pnpm tenant vercel`");
    writeFileSync(VERCEL_JSON, `${JSON.stringify(next, null, 2)}\n`);
    console.log("✓ apps/capri-storefront/vercel.json updated:");
    for (const r of routes) console.log(`    ${r.source} → ${r.destination}`);
    console.log("  The root vercel.json is reference only (Vercel reads the app's); copy the change there by hand if you keep it in sync.");
    break;
  }
  case "checklist": {
    const slug = positional[0] ?? fail("usage: pnpm tenant checklist <slug>");
    console.log(checklist(loadValid(slug)).join("\n"));
    break;
  }
  case "bootstrap": {
    const slug = positional[0] ?? fail("usage: pnpm tenant bootstrap <slug>");
    const m = loadValid(slug);
    if (!m.owner?.email) fail(`tenants/${slug} has no owner.email`);
    const b = bootstrapLine(m);
    console.log(`# In the Coolify terminal of ${m.identity.name}'s backend (apps/backend):`);
    console.log("# 1) dry run — shows what would change");
    console.log(b.dry);
    console.log("# 2) hand the store over — creates the owner if needed and mails the activation link");
    console.log(b.run);
    break;
  }
  default:
    console.log(
      "usage: pnpm tenant list | validate [slug] | new <slug> --name … --domain … --owner … | env <slug> --target backend|storefront [--with-secrets] | vercel [--check] | checklist <slug> | bootstrap <slug>"
    );
    if (command) process.exit(1);
}
