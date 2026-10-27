#!/usr/bin/env node
// Copies the owner's configuration and the catalog from one database (production)
// into another (staging), so staging starts from the values the owner already set
// in the admin. Orders, carts, payments, customers, prescriptions, admin users and
// API keys are never read: the table set is an allowlist, and a denylist on top of
// it wins over any pattern that would otherwise match.
//
//   SOURCE_DATABASE_URL=<prod>  TARGET_DATABASE_URL=<staging> \
//     node apps/backend/scripts/copy-config-to-staging.mjs           # dry run
//   ... node apps/backend/scripts/copy-config-to-staging.mjs --apply  # writes
//
// Safety:
//  - the source is read inside a READ ONLY transaction; nothing is written there;
//  - source and target must be different databases;
//  - the target must have no orders (a target with orders is production, or
//    someone swapped the two URLs) unless --allow-target-orders is passed;
//  - every copied table is emptied in the target and refilled in one transaction,
//    so a failure leaves staging exactly as it was;
//  - staging's own publishable keys are kept and re-linked to the copied store's
//    default sales channel, so the preview storefront keeps working.
//
// Run it from your own machine: the production URL never has to reach Coolify,
// Vercel or anyone else.

import pg from "pg"

const APPLY = process.argv.includes("--apply")
const ALLOW_TARGET_ORDERS = process.argv.includes("--allow-target-orders")

// Our modules' configuration tables (owner settings, costs, sellers, lens matrix,
// OCR, generated frame media).
const CONFIG_TABLES = [
  "store_setting", "cost_rule", "seller", "ocr_setting",
  "lens_option", "coating_option", "lens_ar_option", "lens_base_price", "lens_design",
  "lens_material", "lens_photo_option", "lens_treatment_price",
  "frame_media_asset", "frame_media_budget",
]

// Medusa catalog: products and prices plus what a product needs to be sellable
// (store, region, sales channel, tax, stock location, shipping options).
const CATALOG_TABLES = [
  "product", "image", "price", "store", "region", "currency", "sales_channel",
  "stock_location", "fulfillment_set", "service_zone", "geo_zone", "shipping_profile",
  "fulfillment_provider", "payment_provider",
]
const CATALOG_PREFIXES = [
  "product_", "price_", "tax_", "stock_location_", "shipping_option", "region_", "store_",
  "sales_channel_", "inventory_", "location_fulfillment_",
]

// Never copied, whatever the patterns above say. Personal, health, payment and
// auth data stays in production.
const DENY_TABLES = new Set([
  "product_review", "reservation_item", "api_key", "publishable_api_key_sales_channel",
  "prescription", "user", "invite", "auth_identity", "provider_identity", "user_preference",
  "view_configuration", "notification", "workflow_execution", "mikro_orm_migrations",
  "link_module_migrations", "script_migrations",
])
const DENY_PREFIXES = [
  "order", "cart", "customer", "payment_collection", "payment_session", "return",
  "refund", "capture", "fulfillment_item", "fulfillment_label", "fulfillment_address",
  "credit_line", "notification", "auth_", "user_", "workflow",
]

function isDenied(t) {
  return DENY_TABLES.has(t) || DENY_PREFIXES.some((p) => t.startsWith(p))
}

function isWanted(t) {
  if (isDenied(t)) return false
  return CONFIG_TABLES.includes(t) || CATALOG_TABLES.includes(t) ||
    CATALOG_PREFIXES.some((p) => t.startsWith(p))
}

// libpq semantics for sslmode (encrypt without CA verification), the same thing
// psql does with Supabase's pooler; recent pg versions otherwise treat
// sslmode=require as verify-full and reject Supabase's certificate chain.
function connectionString(url) {
  if (/[?&]sslmode=/.test(url) && !/[?&]uselibpqcompat=/.test(url)) {
    return url + "&uselibpqcompat=true"
  }
  return url
}

function identity(url) {
  const u = new URL(url)
  return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`
}

const q = (name) => `"${name.replace(/"/g, '""')}"`

async function tables(client) {
  const { rows } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`
  )
  return new Set(rows.map((r) => r.table_name))
}

async function insertableColumns(client, table) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'
      order by ordinal_position`,
    [table]
  )
  return rows.map((r) => r.column_name)
}

async function count(client, table) {
  const { rows } = await client.query(`select count(*)::int as n from ${q(table)}`)
  return rows[0].n
}

// Foreign keys inside `public`: child table -> parent table.
async function foreignKeys(client) {
  const { rows } = await client.query(
    `select c.relname as child, p.relname as parent
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_class p on p.oid = k.confrelid
       join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'f' and n.nspname = 'public'`
  )
  return rows
}

// Parents before children, so foreign keys hold while refilling. Self-references
// are fine: each table is inserted in one statement and RI is checked at its end.
function insertOrder(set, fks) {
  const deps = new Map([...set].map((t) => [t, new Set()]))
  for (const { child, parent } of fks) {
    if (child !== parent && set.has(child) && set.has(parent)) deps.get(child).add(parent)
  }
  const ordered = []
  const done = new Set()
  const visit = (t, path = new Set()) => {
    if (done.has(t)) return
    if (path.has(t)) throw new Error(`foreign-key cycle through ${t}`)
    path.add(t)
    for (const p of deps.get(t)) visit(p, path)
    path.delete(t)
    done.add(t)
    ordered.push(t)
  }
  for (const t of [...set].sort()) visit(t)
  return ordered
}

// Tables outside the set that TRUNCATE ... CASCADE would also empty.
function cascadeVictims(set, fks) {
  const victims = new Set()
  let grew = true
  while (grew) {
    grew = false
    for (const { child, parent } of fks) {
      if ((set.has(parent) || victims.has(parent)) && !set.has(child) && !victims.has(child)) {
        victims.add(child)
        grew = true
      }
    }
  }
  return victims
}

function newLinkId() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let s = ""
  for (let i = 0; i < 26; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `pksc_${s}`
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL
  const targetUrl = process.env.TARGET_DATABASE_URL
  if (!sourceUrl || !targetUrl) {
    console.error("Set SOURCE_DATABASE_URL (production) and TARGET_DATABASE_URL (staging).")
    process.exit(2)
  }
  if (identity(sourceUrl) === identity(targetUrl)) {
    console.error("Source and target are the same database. Refusing.")
    process.exit(2)
  }

  const source = new pg.Client({ connectionString: connectionString(sourceUrl) })
  const target = new pg.Client({ connectionString: connectionString(targetUrl) })
  await source.connect()
  await target.connect()

  try {
    console.log(`source: ${identity(sourceUrl)}  (read only)`)
    console.log(`target: ${identity(targetUrl)}  (${APPLY ? "WILL BE WRITTEN" : "dry run"})\n`)

    const [srcTables, dstTables] = await Promise.all([tables(source), tables(target)])

    if (dstTables.has("order") && !ALLOW_TARGET_ORDERS) {
      const orders = await count(target, "order")
      if (orders > 0) {
        console.error(
          `The target has ${orders} order(s). A staging copy should have none: this is ` +
          "probably production, or the two URLs are swapped. Refusing " +
          "(--allow-target-orders overrides)."
        )
        process.exit(2)
      }
    }

    const wanted = [...srcTables].filter(isWanted)
    const set = new Set(wanted.filter((t) => dstTables.has(t)))
    const onlyInSource = wanted.filter((t) => !dstTables.has(t))
    const missingConfig = CONFIG_TABLES.filter((t) => !srcTables.has(t))

    const fks = await foreignKeys(target)
    const order = insertOrder(set, fks)
    const victims = cascadeVictims(set, fks)

    // Consistent snapshot of the source for every table.
    await source.query("begin transaction isolation level repeatable read read only")

    console.log("table".padEnd(42) + "source".padStart(8) + "target".padStart(8))
    for (const t of order) {
      const [s, d] = await Promise.all([count(source, t), count(target, t)])
      console.log(t.padEnd(42) + String(s).padStart(8) + String(d).padStart(8))
    }
    if (onlyInSource.length) console.log(`\nskipped (not in target schema): ${onlyInSource.join(", ")}`)
    if (missingConfig.length) console.log(`config tables absent in source: ${missingConfig.join(", ")}`)

    const nonEmptyVictims = []
    for (const t of victims) {
      const n = await count(target, t)
      if (n > 0) nonEmptyVictims.push(`${t} (${n})`)
    }
    if (victims.size) console.log(`\nalso emptied by cascade in target: ${[...victims].join(", ")}`)
    if (nonEmptyVictims.length) {
      console.error(`Refusing: the cascade would delete rows in ${nonEmptyVictims.join(", ")}.`)
      process.exit(2)
    }

    if (!APPLY) {
      console.log("\nDry run: nothing written. Re-run with --apply to copy.")
      await source.query("rollback")
      return
    }

    await target.query("begin")
    try {
      await target.query(`truncate ${order.map(q).join(", ")} cascade`)

      for (const t of order) {
        const [srcCols, dstCols] = await Promise.all([
          insertableColumns(source, t),
          insertableColumns(target, t),
        ])
        const cols = srcCols.filter((c) => dstCols.includes(c))
        if (!cols.length) continue
        const list = cols.map(q).join(", ")
        const { rows } = await source.query(
          `select coalesce(json_agg(r), '[]'::json)::text as data
             from (select ${list} from ${q(t)}) r`
        )
        const res = await target.query(
          `insert into ${q(t)} (${list}) overriding system value
           select ${list} from json_populate_recordset(null::${q(t)}, $1::json)`,
          [rows[0].data]
        )
        console.log(`copied ${String(res.rowCount).padStart(6)}  ${t}`)
      }

      // Keep staging's own publishable keys usable: point them at the copied
      // store's default sales channel (the old links pointed at staging's own
      // default channel, which the copy just replaced).
      if (dstTables.has("api_key") && dstTables.has("publishable_api_key_sales_channel")) {
        const { rows: stores } = await target.query(
          "select default_sales_channel_id from store where deleted_at is null and default_sales_channel_id is not null limit 1"
        )
        const channel = stores[0]?.default_sales_channel_id
        const { rows: keys } = await target.query(
          "select id, title from api_key where type = 'publishable' and revoked_at is null and deleted_at is null"
        )
        if (channel && keys.length) {
          await target.query("delete from publishable_api_key_sales_channel")
          for (const k of keys) {
            await target.query(
              `insert into publishable_api_key_sales_channel (id, publishable_key_id, sales_channel_id)
               values ($1, $2, $3)`,
              [newLinkId(), k.id, channel]
            )
            console.log(`relinked publishable key "${k.title}" -> ${channel}`)
          }
        }
      }

      await target.query("commit")
      console.log("\nDone. Restart the staging app in Coolify so cached settings are reloaded.")
    } catch (err) {
      await target.query("rollback")
      throw err
    } finally {
      await source.query("rollback")
    }
  } finally {
    await source.end()
    await target.end()
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
