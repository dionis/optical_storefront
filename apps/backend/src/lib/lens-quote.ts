import type { Knex } from "@mikro-orm/knex";

/** Lens selection sent from the storefront wizard. */
export interface LensSelection {
  design_code: string; // "sv" | "bifocal" | "prog-mid" | "prog-high" | "frame-only"
  material_code?: string | null;
  photo_code?: string | null;
  ar_code?: string | null;
}

const n = (v: unknown): number => {
  const x = typeof v === "string" ? parseInt(v, 10) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Server-side price of the LENS ADD-ON only (excludes the frame), in USD cents.
 * Single source of truth for lens pricing — shared by /store/lens-config/quote and
 * the cart's configured-line route so a client can never set the price. Reads the
 * 2026 matrix via the shared Postgres connection (independent of the module ORM).
 */
export async function computeLensAddonCents(
  pg: Knex,
  selection: LensSelection
): Promise<number> {
  if (!selection || selection.design_code === "frame-only") return 0;

  const [design] = await pg("lens_design")
    .whereNull("deleted_at")
    .where({ code: selection.design_code, is_active: true });
  if (!design) throw new Error(`Unknown lens design: ${selection.design_code}`);
  const category = String((design as { category: string }).category);

  let cents = 0;

  if (selection.material_code) {
    const [cell] = await pg("lens_base_price")
      .whereNull("deleted_at")
      .where({ design_code: selection.design_code, material_code: selection.material_code });
    cents += n((cell as { price_cents?: number } | undefined)?.price_cents);
  }

  if (selection.photo_code) {
    const [photo] = await pg("lens_photo_option")
      .whereNull("deleted_at")
      .where({ code: selection.photo_code, is_active: true });
    if (photo) {
      const p = photo as {
        price_sv_cents: number | null;
        price_bifocal_cents: number | null;
        price_prog_cents: number | null;
      };
      const byCat: Record<string, number | null | undefined> = {
        sv: p.price_sv_cents,
        bifocal: p.price_bifocal_cents,
        prog: p.price_prog_cents,
      };
      const v = byCat[category];
      cents += v == null ? 0 : n(v);
    }
  }

  if (selection.ar_code) {
    const [ar] = await pg("lens_ar_option")
      .whereNull("deleted_at")
      .where({ code: selection.ar_code, is_active: true });
    cents += n((ar as { price_cents?: number } | undefined)?.price_cents);
  }

  return cents;
}
