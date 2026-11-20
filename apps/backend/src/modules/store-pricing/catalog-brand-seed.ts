import { CAPRI_BRAND_SEED, capriLogoOf } from "../../lib/catalog-brand";
import { sqlText } from "./frame-cost-seed";

/**
 * SQL that seeds `catalog_brand` with the Capri brands the shop sells
 * (lib/catalog-brand.ts `CAPRI_BRAND_SEED`), each with its logo on the panel's
 * origin (`/brands/logo-<file>.png`, explicit map `BRAND_LOGO_FILES`).
 *
 * `ON CONFLICT … DO NOTHING`: a brand the owner already edited (name, logo,
 * order) or that a read already registered is left exactly as it is, so the
 * statement is idempotent. Deterministic ids (`cbr_<slug>`) for the same
 * reason as `frc_<key>` in frame-cost-seed.ts.
 *
 * Brands of the catalogue that are NOT in this list (Eyeleos, Ago, Artistik…)
 * are registered the first time `GET /admin/catalog/brands` (or the matrix)
 * reads them — a migration cannot rely on Medusa's `product` table existing
 * yet on an empty database (modules migrate independently).
 */
export const catalogBrandId = (slug: string): string => `cbr_${slug.replace(/[^a-z0-9]/g, "_")}`;

export function catalogBrandSeedStatements(): string[] {
  const values = CAPRI_BRAND_SEED.map(
    (b, i) =>
      `(${sqlText(catalogBrandId(b.slug))}, ${sqlText(b.slug)}, ${sqlText(b.name)}, ${sqlText(capriLogoOf(b.slug))}, ${sqlText(b.kind)}, 'capri', TRUE, ${(i + 1) * 10})`
  ).join(",\n             ");
  return [
    `
      INSERT INTO catalog_brand (id, slug, name, logo_url, kind, source, active, sort)
      VALUES ${values}
      ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING;
    `,
  ];
}
