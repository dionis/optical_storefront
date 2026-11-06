#!/usr/bin/env node
// Read-only comparison of the production and staging databases, ahead of the
// migration that turns the staging database into production.
//
// What it guarantees:
//   - Every query runs inside ONE `BEGIN READ ONLY` transaction that ends in
//     ROLLBACK, and the query helper refuses anything that is not a read.
//     Use it with the `db_compare_ro` role (readonly-role.sql) for a second lock.
//   - No personal data leaves the database: emails and seller codes are hashed
//     with md5() inside Postgres and only overlap COUNTS reach the report; no
//     names, phones, addresses or prescriptions are selected.
//   - Connection strings are never printed; the report shows host + database.
//
// Usage:
//   1. Copy scripts/db-compare/env.example to .env.db-compare (repo root,
//      ignored by git) and fill PROD_DATABASE_URL / STAGING_DATABASE_URL.
//   2. node scripts/db-compare/compare.mjs [--env .env.db-compare] [--out .db-compare]
//   3. Report: .db-compare/report-<timestamp>.md (+ .json with the raw numbers).

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(ROOT, "apps", "backend", "package.json"));
const { Client } = require("pg");

// ── args / env ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const ENV_FILE = resolve(ROOT, arg("--env", ".env.db-compare"));
const OUT_DIR = resolve(ROOT, arg("--out", ".db-compare"));

function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
const fileEnv = loadEnv(ENV_FILE);
const env = (k) => process.env[k] || fileEnv[k] || "";

const SIDES = [
  { key: "prod", label: "Producción", url: env("PROD_DATABASE_URL"), appUser: env("PROD_APP_DB_USER") },
  { key: "staging", label: "Staging", url: env("STAGING_DATABASE_URL"), appUser: env("STAGING_APP_DB_USER") },
];
for (const s of SIDES) {
  if (!s.url) {
    console.error(`Falta ${s.key === "prod" ? "PROD" : "STAGING"}_DATABASE_URL (en ${ENV_FILE} o en el entorno).`);
    process.exit(2);
  }
}

// Same fingerprint as apps/backend/src/lib/demo-seed.ts
function fingerprint(url, userOverride) {
  const u = new URL(url);
  const user = userOverride || decodeURIComponent(u.username);
  return createHash("sha256").update(`${user}@${u.hostname}/${u.pathname.slice(1)}`).digest("hex");
}
function seedLists() {
  try {
    const src = readFileSync(join(ROOT, "apps/backend/src/lib/demo-seed.ts"), "utf8");
    const list = (name) => [...(src.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"([0-9a-f]{64})"/g)].map((m) => m[1]);
    return { staging: list("STAGING_DATABASES"), forbidden: list("FORBIDDEN_DATABASES") };
  } catch {
    return { staging: [], forbidden: [] };
  }
}
const SEED = seedLists();

// ── connection ───────────────────────────────────────────────────────────────
const READ_ONLY_SQL = /^\s*(select|with|show|savepoint|release|rollback|begin|set\s+local|set\s+transaction)\b/i;

async function connect(side) {
  const u = new URL(side.url);
  u.searchParams.delete("sslmode"); // pg would turn it into verify-full and reject Supabase's chain
  const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  const client = new Client({
    connectionString: u.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    application_name: "db-compare-readonly",
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '30s'");
  const ro = (await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only;
  if (ro !== "on") throw new Error("la transacción no quedó en solo lectura; se aborta");
  let sp = 0;
  const q = async (sql, params = []) => {
    if (!READ_ONLY_SQL.test(sql)) throw new Error(`consulta rechazada (no es de lectura): ${sql.slice(0, 40)}`);
    const name = `s${++sp}`;
    await client.query(`SAVEPOINT ${name}`);
    try {
      const r = await client.query(sql, params);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return r.rows;
    } catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw e;
    }
  };
  return { client, q, host: u.hostname, db: u.pathname.slice(1), user: decodeURIComponent(u.username) };
}

const qi = (name) => `"${String(name).replace(/"/g, '""')}"`;

// ── collection (one side) ────────────────────────────────────────────────────
async function collect(side) {
  const conn = await connect(side);
  const { q } = conn;
  const errors = [];
  const tryq = async (label, fn) => {
    try {
      return await fn();
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
      return null;
    }
  };

  const out = { errors };
  out.meta = await tryq("meta", async () => {
    const [r] = await q(`select version() v, current_database() db, current_user u, pg_database_size(current_database()) size`);
    const fp = fingerprint(side.url, side.appUser);
    return {
      host: conn.host,
      db: r.db,
      connected_as: r.u,
      postgres: String(r.v).split(" ").slice(0, 2).join(" "),
      size_mb: Math.round(Number(r.size) / 1048576),
      fingerprint: fp,
      fingerprint_user: side.appUser || conn.user,
      seed_list: SEED.staging.includes(fp) ? "STAGING_DATABASES" : SEED.forbidden.includes(fp) ? "FORBIDDEN_DATABASES" : "ninguna",
    };
  });

  // schema
  const tables = (await tryq("tables", () => q(
    `select c.relname t, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') order by 1`))) ?? [];
  const colRows = (await tryq("columns", () => q(
    `select table_name t, column_name c, data_type d from information_schema.columns where table_schema = 'public'`))) ?? [];
  const cols = new Map();
  for (const r of colRows) {
    if (!cols.has(r.t)) cols.set(r.t, new Map());
    cols.get(r.t).set(r.c, r.d);
  }
  const has = (t, c) => cols.has(t) && (!c || cols.get(t).has(c));
  out.tables = tables.map((r) => r.t);
  out.rls_tables = tables.filter((r) => r.rls).map((r) => r.t);

  // migrations
  out.migrations = has("mikro_orm_migrations")
    ? ((await tryq("migrations", () => q(`select name from mikro_orm_migrations order by name`))) ?? []).map((r) => r.name)
    : [];
  out.link_migrations = has("link_module_migrations", "table_name")
    ? ((await tryq("link_migrations", () => q(`select table_name from link_module_migrations order by 1`))) ?? []).map((r) => r.table_name)
    : [];
  out.script_migrations = has("script_migrations", "script_name")
    ? ((await tryq("script_migrations", () => q(`select script_name from script_migrations order by 1`))) ?? []).map((r) => r.script_name)
    : [];

  // row counts + content hash (timestamps excluded) per table
  out.counts = {};
  out.content_hash = {};
  for (const t of out.tables) {
    const n = await tryq(`count ${t}`, async () => Number((await q(`select count(*)::bigint n from ${qi(t)}`))[0].n));
    out.counts[t] = n;
    if (n != null && n <= 50000) {
      out.content_hash[t] = await tryq(`hash ${t}`, async () => (await q(
        `select md5(coalesce(string_agg(x, '|' order by x), '')) h from
           (select (to_jsonb(r) - 'created_at' - 'updated_at' - 'deleted_at')::text x from ${qi(t)} r) s`))[0].h);
    }
  }

  // demo-seed marker in any metadata column
  out.demo_rows = {};
  for (const [t, m] of cols) {
    if (m.get("metadata") === "jsonb") {
      const n = await tryq(`demo ${t}`, async () => Number((await q(
        `select count(*)::bigint n from ${qi(t)} where metadata->>'demo_seed' = 'true'`))[0].n));
      if (n) out.demo_rows[t] = n;
    }
  }

  // orders
  if (has("order")) {
    out.orders = await tryq("orders", async () => (await q(
      `select count(*)::int total, count(*) filter (where deleted_at is null)::int live,
              min(display_id) min_display, max(display_id) max_display,
              min(created_at) first_at, max(created_at) last_at,
              count(*) filter (where metadata ? 'gsheet_mirror')::int with_gsheet_mirror,
              count(*) filter (where metadata ? 'seller_code')::int with_seller_code,
              count(*) filter (where metadata ? 'cost_sheet')::int with_cost_sheet,
              count(*) filter (where metadata ? 'lab_stage')::int with_lab_stage
       from "order"`))[0]);
    out.orders_by_status = await tryq("orders status", () => q(`select status, count(*)::int n from "order" group by 1 order by 2 desc`));
    if (has("sales_channel")) {
      out.orders_by_channel = await tryq("orders channel", () => q(
        `select coalesce(sc.name, o.sales_channel_id, '(sin canal)') channel, count(*)::int n
         from "order" o left join sales_channel sc on sc.id = o.sales_channel_id group by 1 order by 2 desc`));
    }
    const posLinked = has("pos_sale", "order_id");
    out.order_ids = await tryq("order ids", async () => (await q(
      `select o.id, o.display_id, ${posLinked ? "exists (select 1 from pos_sale ps where ps.order_id = o.id)" : "false"} pos
       from "order" o`)));
  }

  // line items of orders → catalog references
  if (has("order_line_item", "variant_id")) {
    out.line_refs = await tryq("line refs", () => q(
      `select distinct variant_id, variant_sku, product_id from order_line_item where variant_id is not null or variant_sku is not null`));
  }

  // payments
  if (has("payment", "provider_id")) {
    out.payments_by_provider = await tryq("payments", () => q(
      `select provider_id, count(*)::int n,
              count(*) filter (where data->>'livemode' = 'true')::int live,
              count(*) filter (where data->>'livemode' = 'false')::int test
       from payment group by 1 order by 2 desc`));
  }
  if (has("region_payment_provider") && has("region")) {
    out.region_providers = await tryq("region providers", () => q(
      `select r.name region, rpp.payment_provider_id provider from region_payment_provider rpp
       join region r on r.id = rpp.region_id where rpp.deleted_at is null order by 1, 2`));
  }
  if (has("cart")) {
    out.carts = await tryq("carts", async () => (await q(
      `select count(*)::int total, count(*) filter (where completed_at is null and deleted_at is null)::int open from cart`))[0]);
  }

  // catalog
  if (has("product")) {
    out.products = await tryq("products", () => q(`select id, handle from product where deleted_at is null`));
  }
  if (has("product_variant")) {
    out.variants = await tryq("variants", () => q(`select id, sku, product_id from product_variant where deleted_at is null`));
  }
  if (has("image", "url")) {
    out.image_hosts = await tryq("image hosts", () => q(
      `select split_part(regexp_replace(url, '^https?://', ''), '/', 1) host, count(*)::int n from image group by 1 order by 2 desc limit 10`));
  }
  if (has("product_review", "product_id")) {
    out.review_products = ((await tryq("reviews", () => q(`select distinct product_id from product_review`))) ?? []).map((r) => r.product_id);
  }

  // people (hashed inside Postgres)
  if (has("customer", "email")) {
    out.customers = await tryq("customers", () => q(
      `select md5(lower(trim(email))) h, has_account from customer where deleted_at is null and email is not null`));
  }
  if (has("user", "email")) {
    out.admin_users = ((await tryq("users", () => q(
      `select md5(lower(trim(email))) h from "user" where deleted_at is null`))) ?? []).map((r) => r.h);
  }
  if (has("provider_identity", "provider")) {
    out.identities = await tryq("identities", () => q(`select provider, count(*)::int n from provider_identity group by 1`));
  }
  if (has("seller", "code")) {
    out.seller_codes = ((await tryq("sellers", () => q(
      `select md5(upper(trim(code))) h from seller ${has("seller", "deleted_at") ? "where deleted_at is null" : ""}`))) ?? []).map((r) => r.h);
  }

  // store configuration
  if (has("api_key")) {
    out.api_keys = await tryq("api keys", () => q(
      `select type, title, case when type = 'publishable' then left(token, 6) || '…' || right(token, 4) else '(secreta)' end token_hint,
              revoked_at is not null revoked
       from api_key where deleted_at is null order by type, title`));
  }
  for (const [t, col] of [["sales_channel", "name"], ["region", "name"], ["stock_location", "name"], ["shipping_option", "name"], ["store", "name"]]) {
    if (has(t, col)) {
      out[`names_${t}`] = ((await tryq(t, () => q(
        `select ${qi(col)} v from ${qi(t)} ${has(t, "deleted_at") ? "where deleted_at is null" : ""} order by 1`))) ?? []).map((r) => r.v);
    }
  }
  if (has("tax_region", "country_code")) {
    out.tax_regions = ((await tryq("tax regions", () => q(
      `select country_code || coalesce('/' || province_code, '') v from tax_region where deleted_at is null order by 1`))) ?? []).map((r) => r.v);
  }
  if (has("store_setting")) {
    const fields = [...cols.get("store_setting").keys()].filter((c) => !["id", "created_at", "updated_at", "deleted_at"].includes(c));
    const plain = new Set(["active_payment_provider", "frame_tax_rate"]);
    const sel = fields.map((f) => plain.has(f) ? `${qi(f)}::text ${qi(f)}` : `md5(${qi(f)}::text) ${qi(f)}`).join(", ");
    out.store_setting = await tryq("store_setting", () => q(`select ${sel} from store_setting`));
    out.store_setting_plain = [...plain];
  }

  // prescriptions (only where the files live, never their content)
  if (has("prescription")) {
    out.prescriptions = await tryq("prescriptions", async () => (await q(
      `select count(*)::int total,
              count(*) filter (where file_url is not null)::int with_file,
              count(*) filter (where tryon_image_url is not null)::int with_tryon
       from prescription`))[0]);
    out.prescription_file_prefix = await tryq("rx prefix", () => q(
      `select split_part(regexp_replace(file_url, '^https?://', ''), '/', 1) prefix, count(*)::int n
       from prescription where file_url is not null group by 1 order by 2 desc limit 10`));
  }

  // counters (non-personal)
  for (const t of ["pos_sale_counter", "rx_sequence"]) {
    if (has(t)) out[t] = await tryq(t, () => q(`select * from ${qi(t)}`));
  }
  if (has("establishment")) {
    out.establishments = await tryq("establishments", () => q(
      `select ${has("establishment", "code") ? "code" : "id"} code, ${has("establishment", "kind") ? "kind" : "null kind"},
              ${has("establishment", "name") ? "name" : "null name"} from establishment
       ${has("establishment", "deleted_at") ? "where deleted_at is null" : ""} order by 1`));
  }
  if (has("sale_fact")) {
    const ch = ["channel", "source", "sale_channel"].find((c) => has("sale_fact", c));
    out.sale_fact = await tryq("sale_fact", () => ch
      ? q(`select ${qi(ch)}::text k, count(*)::int n from sale_fact group by 1 order by 2 desc`)
      : q(`select 'total' k, count(*)::int n from sale_fact`));
  }

  await conn.client.query("ROLLBACK").catch(() => {});
  await conn.client.end().catch(() => {});
  return out;
}

// ── comparison / report ──────────────────────────────────────────────────────
const setOf = (a) => new Set(a ?? []);
const inter = (a, b) => [...a].filter((x) => b.has(x));
const minus = (a, b) => [...a].filter((x) => !b.has(x));
const fmt = (v) => (v == null ? "—" : v instanceof Date ? v.toISOString().slice(0, 16).replace("T", " ") : String(v));
const table = (head, rows) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(fmt).join(" | ")} |`)].join("\n");

function report(P, S) {
  const L = [];
  const h = (t) => L.push("", `## ${t}`, "");
  const p = (t) => L.push(t);
  const now = new Date().toISOString();
  p(`# Comparación de bases (solo lectura) — ${now}`);
  p("");
  p("Sin datos personales: correos y códigos se comparan como md5 dentro de Postgres; aquí solo hay conteos.");

  h("1. Identidad");
  p(table(["", "Producción", "Staging"], [
    ["Host", P.meta?.host, S.meta?.host],
    ["Base", P.meta?.db, S.meta?.db],
    ["Conectado como", P.meta?.connected_as, S.meta?.connected_as],
    ["Postgres", P.meta?.postgres, S.meta?.postgres],
    ["Tamaño (MB)", P.meta?.size_mb, S.meta?.size_mb],
    ["Huella (usuario)", `${P.meta?.fingerprint?.slice(0, 12)}… (${P.meta?.fingerprint_user})`, `${S.meta?.fingerprint?.slice(0, 12)}… (${S.meta?.fingerprint_user})`],
    ["Lista en demo-seed.ts", P.meta?.seed_list, S.meta?.seed_list],
  ]));
  p("");
  p("La huella incluye el usuario: con el rol de solo lectura no coincidirá con demo-seed.ts. Pon `*_APP_DB_USER` con el usuario de la app para comprobarla.");

  h("2. Migraciones");
  for (const [k, label] of [["migrations", "Módulos (mikro_orm_migrations)"], ["link_migrations", "Enlaces (link_module_migrations)"], ["script_migrations", "Scripts"]]) {
    const a = setOf(P[k]), b = setOf(S[k]);
    p(`**${label}:** prod ${a.size} · staging ${b.size} · solo en prod ${minus(a, b).length} · solo en staging ${minus(b, a).length}`);
    const onlyP = minus(a, b);
    if (onlyP.length) p(`- Solo en producción: ${onlyP.join(", ")}`);
    const onlyS = minus(b, a);
    if (onlyS.length && onlyS.length <= 80) p(`- Solo en staging: ${onlyS.join(", ")}`);
    p("");
  }

  h("3. Tablas");
  const tp = setOf(P.tables), ts = setOf(S.tables);
  p(`Solo en producción: ${minus(tp, ts).join(", ") || "ninguna"}`);
  p("");
  p(`Solo en staging (${minus(ts, tp).length}): ${minus(ts, tp).join(", ") || "ninguna"}`);
  p("");
  const rls = [...new Set([...(P.rls_tables ?? []), ...(S.rls_tables ?? [])])];
  if (rls.length) p(`⚠ Tablas con RLS (el conteo puede salir 0 para el rol de solo lectura): ${rls.join(", ")}`);
  p("");
  const rows = inter(tp, ts)
    .filter((t) => (P.counts[t] ?? 0) + (S.counts[t] ?? 0) > 0)
    .map((t) => [t, P.counts[t], S.counts[t],
      P.content_hash[t] && S.content_hash[t] ? (P.content_hash[t] === S.content_hash[t] ? "idéntico" : "distinto") : "—"]);
  p(table(["Tabla", "Prod", "Staging", "Contenido"], rows));

  h("4. Datos sembrados (metadata.demo_seed)");
  const demo = [...new Set([...Object.keys(P.demo_rows), ...Object.keys(S.demo_rows)])];
  p(demo.length ? table(["Tabla", "Prod", "Staging"], demo.map((t) => [t, P.demo_rows[t] ?? 0, S.demo_rows[t] ?? 0])) : "Ninguna fila marcada en ninguna base.");

  h("5. Pedidos");
  p(table(["", "Producción", "Staging"], [
    ["Total / vivos", `${P.orders?.total} / ${P.orders?.live}`, `${S.orders?.total} / ${S.orders?.live}`],
    ["display_id min–max", `${P.orders?.min_display}–${P.orders?.max_display}`, `${S.orders?.min_display}–${S.orders?.max_display}`],
    ["Primero", P.orders?.first_at, S.orders?.first_at],
    ["Último", P.orders?.last_at, S.orders?.last_at],
    ["Con gsheet_mirror", P.orders?.with_gsheet_mirror, S.orders?.with_gsheet_mirror],
    ["Con seller_code", P.orders?.with_seller_code, S.orders?.with_seller_code],
    ["Con lab_stage / cost_sheet", `${P.orders?.with_lab_stage} / ${P.orders?.with_cost_sheet}`, `${S.orders?.with_lab_stage} / ${S.orders?.with_cost_sheet}`],
    ["Ligados a una venta POS", (P.order_ids ?? []).filter((o) => o.pos).length, (S.order_ids ?? []).filter((o) => o.pos).length],
    ["No POS (web o pruebas)", (P.order_ids ?? []).filter((o) => !o.pos).length, (S.order_ids ?? []).filter((o) => !o.pos).length],
  ]));
  const dP = setOf((P.order_ids ?? []).map((o) => o.display_id)), dS = setOf((S.order_ids ?? []).map((o) => o.display_id));
  const iP = setOf((P.order_ids ?? []).map((o) => o.id)), iS = setOf((S.order_ids ?? []).map((o) => o.id));
  p("");
  p(`**Colisiones:** ${inter(dP, dS).length} números de pedido (display_id) existen en las dos bases · ${inter(iP, iS).length} ids de pedido idénticos.`);
  p("");
  p("Por estado:");
  p(table(["Estado", "Prod", "Staging"], [...new Set([...(P.orders_by_status ?? []), ...(S.orders_by_status ?? [])].map((r) => r.status))]
    .map((s) => [s, P.orders_by_status?.find((r) => r.status === s)?.n ?? 0, S.orders_by_status?.find((r) => r.status === s)?.n ?? 0])));
  p("");
  p("Por canal de venta:");
  p(table(["Canal", "Prod", "Staging"], [...new Set([...(P.orders_by_channel ?? []), ...(S.orders_by_channel ?? [])].map((r) => r.channel))]
    .map((c) => [c, P.orders_by_channel?.find((r) => r.channel === c)?.n ?? 0, S.orders_by_channel?.find((r) => r.channel === c)?.n ?? 0])));

  h("6. Catálogo");
  const pid = setOf((P.products ?? []).map((r) => r.id)), sid = setOf((S.products ?? []).map((r) => r.id));
  const ph = setOf((P.products ?? []).map((r) => r.handle)), sh = setOf((S.products ?? []).map((r) => r.handle));
  const pv = setOf((P.variants ?? []).map((r) => r.id)), sv = setOf((S.variants ?? []).map((r) => r.id));
  const psku = setOf((P.variants ?? []).map((r) => r.sku).filter(Boolean)), ssku = setOf((S.variants ?? []).map((r) => r.sku).filter(Boolean));
  p(table(["", "Producción", "Staging", "En las dos"], [
    ["Productos (id)", pid.size, sid.size, inter(pid, sid).length],
    ["Handles", ph.size, sh.size, inter(ph, sh).length],
    ["Variantes (id)", pv.size, sv.size, inter(pv, sv).length],
    ["SKUs", psku.size, ssku.size, inter(psku, ssku).length],
  ]));
  const refs = P.line_refs ?? [];
  const okId = refs.filter((r) => r.variant_id && sv.has(r.variant_id)).length;
  const bySku = refs.filter((r) => !(r.variant_id && sv.has(r.variant_id)) && r.variant_sku && ssku.has(r.variant_sku)).length;
  p("");
  p(`**Líneas de pedidos de producción** (${refs.length} referencias distintas): ${okId} encuentran su variante por id en staging · ${bySku} solo por SKU · ${refs.length - okId - bySku} sin correspondencia.`);
  const rv = P.review_products ?? [];
  p(`**Reseñas de producción:** ${rv.length} productos con reseña · ${rv.filter((x) => sid.has(x)).length} existen con el mismo id en staging.`);
  p("");
  p("Hosts de imágenes:");
  p(table(["Host", "Prod", "Staging"], [...new Set([...(P.image_hosts ?? []), ...(S.image_hosts ?? [])].map((r) => r.host))]
    .map((x) => [x, P.image_hosts?.find((r) => r.host === x)?.n ?? 0, S.image_hosts?.find((r) => r.host === x)?.n ?? 0])));

  h("7. Personas (solo conteos)");
  const cP = setOf((P.customers ?? []).map((r) => r.h)), cS = setOf((S.customers ?? []).map((r) => r.h));
  const regP = setOf((P.customers ?? []).filter((r) => r.has_account).map((r) => r.h)), regS = setOf((S.customers ?? []).filter((r) => r.has_account).map((r) => r.h));
  const uP = setOf(P.admin_users), uS = setOf(S.admin_users);
  const sP = setOf(P.seller_codes), sS = setOf(S.seller_codes);
  p(table(["", "Producción", "Staging", "En las dos"], [
    ["Clientes (correo)", cP.size, cS.size, inter(cP, cS).length],
    ["Clientes con cuenta", regP.size, regS.size, inter(regP, regS).length],
    ["Usuarios del panel", uP.size, uS.size, inter(uP, uS).length],
    ["Vendedores (código)", sP.size, sS.size, inter(sP, sS).length],
  ]));
  p("");
  p("Identidades de acceso por proveedor:");
  p(table(["Proveedor", "Prod", "Staging"], [...new Set([...(P.identities ?? []), ...(S.identities ?? [])].map((r) => r.provider))]
    .map((x) => [x, P.identities?.find((r) => r.provider === x)?.n ?? 0, S.identities?.find((r) => r.provider === x)?.n ?? 0])));

  h("8. Pagos");
  p(table(["Proveedor", "Prod (live/test)", "Staging (live/test)"], [...new Set([...(P.payments_by_provider ?? []), ...(S.payments_by_provider ?? [])].map((r) => r.provider_id))]
    .map((x) => {
      const a = P.payments_by_provider?.find((r) => r.provider_id === x), b = S.payments_by_provider?.find((r) => r.provider_id === x);
      return [x, a ? `${a.n} (${a.live}/${a.test})` : 0, b ? `${b.n} (${b.live}/${b.test})` : 0];
    })));
  p("");
  p(`Proveedores por región — prod: ${(P.region_providers ?? []).map((r) => `${r.region}:${r.provider}`).join(", ") || "—"}`);
  p("");
  p(`Proveedores por región — staging: ${(S.region_providers ?? []).map((r) => `${r.region}:${r.provider}`).join(", ") || "—"}`);
  p("");
  p(`Carritos abiertos: prod ${P.carts?.open ?? "—"} de ${P.carts?.total ?? "—"} · staging ${S.carts?.open ?? "—"} de ${S.carts?.total ?? "—"}`);

  h("9. Configuración de la tienda");
  p("Claves API:");
  p(table(["Base", "Tipo", "Título", "Token", "Revocada"], [
    ...(P.api_keys ?? []).map((r) => ["prod", r.type, r.title, r.token_hint, r.revoked]),
    ...(S.api_keys ?? []).map((r) => ["staging", r.type, r.title, r.token_hint, r.revoked]),
  ]));
  p("");
  const pkP = setOf((P.api_keys ?? []).filter((r) => r.type === "publishable" && !r.revoked).map((r) => r.token_hint));
  const pkS = setOf((S.api_keys ?? []).filter((r) => r.type === "publishable" && !r.revoked).map((r) => r.token_hint));
  p(`Claves publicables de producción que NO existen en staging: ${minus(pkP, pkS).join(", ") || "ninguna"} (la de rubilens.com en Vercel debe estar en la base final).`);
  for (const t of ["store", "sales_channel", "region", "stock_location", "shipping_option"]) {
    p("");
    p(`**${t}** — prod: ${(P[`names_${t}`] ?? []).join(", ") || "—"} · staging: ${(S[`names_${t}`] ?? []).join(", ") || "—"}`);
  }
  p("");
  p(`**tax_region** — prod: ${(P.tax_regions ?? []).join(", ") || "—"} · staging: ${(S.tax_regions ?? []).join(", ") || "—"}`);
  if (P.store_setting || S.store_setting) {
    p("");
    p("store_setting (los campos sensibles solo como «igual/distinto»):");
    const a = P.store_setting?.[0] ?? {}, b = S.store_setting?.[0] ?? {};
    const plain = new Set(P.store_setting_plain ?? S.store_setting_plain ?? []);
    p(table(["Campo", "Prod", "Staging", "Igual"], [...new Set([...Object.keys(a), ...Object.keys(b)])].map((f) => [
      f,
      plain.has(f) ? a[f] : a[f] ? "con valor" : "vacío",
      plain.has(f) ? b[f] : b[f] ? "con valor" : "vacío",
      a[f] === b[f] ? "sí" : "no",
    ])));
    p(`Filas: prod ${P.store_setting?.length ?? 0} · staging ${S.store_setting?.length ?? 0}`);
  }

  h("10. Recetas y archivos");
  p(table(["", "Producción", "Staging"], [
    ["Recetas", P.prescriptions?.total, S.prescriptions?.total],
    ["Con archivo", P.prescriptions?.with_file, S.prescriptions?.with_file],
    ["Con render del probador", P.prescriptions?.with_tryon, S.prescriptions?.with_tryon],
  ]));
  p("");
  p(`Prefijo de archivo (bucket/host) — prod: ${(P.prescription_file_prefix ?? []).map((r) => `${r.prefix} (${r.n})`).join(", ") || "—"} · staging: ${(S.prescription_file_prefix ?? []).map((r) => `${r.prefix} (${r.n})`).join(", ") || "—"}`);

  h("11. Mostrador");
  p(table(["Código", "Tipo", "Nombre"], (S.establishments ?? []).map((r) => [r.code, r.kind, r.name])));
  p("");
  p(`pos_sale_counter (staging): ${JSON.stringify(S.pos_sale_counter ?? "—")}`);
  p("");
  p(`rx_sequence — prod: ${JSON.stringify(P.rx_sequence ?? "—")} · staging: ${JSON.stringify(S.rx_sequence ?? "—")}`);
  p("");
  p(`sale_fact — prod: ${(P.sale_fact ?? []).map((r) => `${r.k}:${r.n}`).join(", ") || "—"} · staging: ${(S.sale_fact ?? []).map((r) => `${r.k}:${r.n}`).join(", ") || "—"}`);

  const errs = [...P.errors.map((e) => `prod · ${e}`), ...S.errors.map((e) => `staging · ${e}`)];
  if (errs.length) {
    h("Consultas que fallaron");
    for (const e of errs) p(`- ${e}`);
  }
  return L.join("\n") + "\n";
}

// ── main ─────────────────────────────────────────────────────────────────────
const results = {};
for (const side of SIDES) {
  process.stdout.write(`Leyendo ${side.label}… `);
  try {
    results[side.key] = await collect(side);
    console.log(`ok (${results[side.key].tables.length} tablas, ${results[side.key].errors.length} consultas con error)`);
  } catch (e) {
    console.log("FALLÓ");
    console.error(`  ${e.message}`);
    process.exit(1);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const md = join(OUT_DIR, `report-${stamp}.md`);
const json = join(OUT_DIR, `report-${stamp}.json`);
writeFileSync(md, report(results.prod, results.staging));
// The JSON keeps aggregates only; drop the per-row lists that exist just to compute overlaps.
const strip = (r) => {
  const { customers, admin_users, seller_codes, order_ids, products, variants, line_refs, review_products, content_hash, ...rest } = r;
  return rest;
};
writeFileSync(json, JSON.stringify({ prod: strip(results.prod), staging: strip(results.staging) }, null, 2));
console.log(`\nInforme: ${md}\nDatos:   ${json}`);
