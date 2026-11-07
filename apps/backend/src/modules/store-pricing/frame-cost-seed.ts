import { CAPRI_BY_KEY, CAPRI_PRICE_LIST, type CapriPrice } from "./capri-price-list-2026";
import { CAPRI_PREV_PRICE_LIST, type CapriPrevPrice } from "./capri-price-list-prev";

/**
 * SQL that puts the supplier's price list into `store_frame_cost`, written
 * here (and not inline in the migration) so the one rule that matters can be
 * tested without a database: **a row the owner edited by hand is never
 * overwritten.**
 *
 * Every statement is an UPSERT whose `DO UPDATE` carries
 * `WHERE store_frame_cost.source = 'supplier_list'`, so:
 *
 *   · a new key is inserted;
 *   · a key that still holds the supplier's figure is refreshed (a new list
 *     replaces the old one);
 *   · a key the owner edited (`source = 'owner_edit'`) is left exactly as the
 *     owner left it — Postgres applies no row and raises nothing.
 *
 * That makes the whole seed idempotent: the migration runs on every deploy
 * (docker-entrypoint.sh calls `medusa db:migrate`) and running it again writes
 * the same numbers over the supplier rows and skips the owner's.
 *
 * `id` is derived from the key (`frc_<key>`) instead of generated, so a second
 * run of the same list cannot create a twin row for a key whose unique index
 * was ever rebuilt.
 */

/** Postgres literal for a text value (NULL for null). */
export const sqlText = (s: string | null): string => (s == null ? "NULL" : `'${s.replace(/'/g, "''")}'`);

/** Postgres literal for an integer; anything not finite becomes 0. */
export const sqlInt = (n: number): string => String(Number.isFinite(n) ? Math.round(n) : 0);

/** Deterministic primary key of a row: the prefix of the model plus its key. */
export const frameCostId = (key: string): string => `frc_${key}`;

/** Rows per INSERT. Keeps the statement count (and each statement) reasonable. */
const CHUNK = 60;

/**
 * The seed as a list of statements, in order. `rows` defaults to the whole
 * supplier list; duplicate keys are dropped (the first wins) because one
 * `INSERT … ON CONFLICT DO UPDATE` cannot touch the same row twice.
 */
/** Which list a seeded row comes from: the 2026 list, or the previous one (v2). */
export type SeededFrameCostSource = "supplier_list" | "supplier_list_prev";

export function frameCostSeedStatements(rows: readonly CapriPrice[] = CAPRI_PRICE_LIST, source: SeededFrameCostSource = "supplier_list"): string[] {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = String(r.key ?? "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const out: string[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const values = unique
      .slice(i, i + CHUNK)
      .map(
        (r) =>
          `(${sqlText(frameCostId(r.key))}, ${sqlText(r.key)}, ${sqlText(r.model)}, ${sqlInt(r.book_cents)}, ${sqlInt(r.cost_cents)}, ${sqlText(source)})`
      )
      .join(",\n             ");
    out.push(`
      INSERT INTO store_frame_cost (id, sku, supplier_model, book_cents, cost_cents, source)
      VALUES ${values}
      ON CONFLICT (sku) WHERE deleted_at IS NULL DO UPDATE SET
        supplier_model = EXCLUDED.supplier_model,
        book_cents     = EXCLUDED.book_cents,
        cost_cents     = EXCLUDED.cost_cents,
        updated_at     = NOW()
      WHERE store_frame_cost.source = ${sqlText(source)};
    `);
  }
  return out;
}

/**
 * The PREVIOUS list's rows the seed adds (v2): only keys the 2026 list does
 * not carry (2026 → previous → none) and only with a real wholesale figure (a
 * model the old book only estimated stays «sin costo», never a guess). As
 * `CapriPrice` rows (`book_cents` 0: the old book has no catalogue price).
 *
 * Seeded with `source = 'supplier_list_prev'`, whose guard means:
 *   · a key the 2026 list already seeded (`supplier_list`) is NOT touched;
 *   · an owner's edit is NOT touched;
 *   · a previous-list row is refreshed by a later run.
 */
export function prevFrameCostSeedRows(
  prev: readonly CapriPrevPrice[] = CAPRI_PREV_PRICE_LIST,
  current: ReadonlyMap<string, unknown> = CAPRI_BY_KEY
): CapriPrice[] {
  return prev
    .filter((p) => p.wholesale_cents != null && p.wholesale_cents > 0 && !current.has(p.key))
    .map((p) => ({ model: p.model, key: p.key, book_cents: 0, cost_cents: p.wholesale_cents as number }));
}
