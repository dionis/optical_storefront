import type { Knex } from "@mikro-orm/knex";

/** Lens selection sent from the storefront wizard. */
export interface LensSelection {
  design_code: string; // "sv" | "bifocal" | "prog-mid" | "prog-high" | "frame-only"
  material_code?: string | null;
  photo_code?: string | null;
  ar_code?: string | null;
}

/** Per-component split of the lens add-on, in USD cents. */
export interface LensBreakdown {
  lens_base_cents: number;
  photo_cents: number;
  ar_cents: number;
  /** lens_base + photo + ar — the full add-on, excluding the frame. */
  total_cents: number;
  /** The design's category ("sv" | "bifocal" | "prog"), which prices photochromics. */
  category: string | null;
}

const n = (v: unknown): number => {
  const x = typeof v === "string" ? parseInt(v, 10) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

const EMPTY: LensBreakdown = {
  lens_base_cents: 0,
  photo_cents: 0,
  ar_cents: 0,
  total_cents: 0,
  category: null,
};

/**
 * Server-side price of the LENS ADD-ON only (excludes the frame), split per component.
 * Single source of truth for lens pricing — shared by /store/lens-config/quote, the
 * legacy /store/lens-config/price compatibility route and the cart's configured-line
 * route, so a client can never set the price. Reads the 2026 matrix via the shared
 * Postgres connection (independent of the module ORM).
 */
export async function computeLensBreakdown(
  pg: Knex,
  selection: LensSelection
): Promise<LensBreakdown> {
  if (!selection || selection.design_code === "frame-only") return { ...EMPTY };

  const [design] = await pg("lens_design")
    .whereNull("deleted_at")
    .where({ code: selection.design_code, is_active: true });
  if (!design) throw new Error(`Unknown lens design: ${selection.design_code}`);
  const category = String((design as { category: string }).category);

  let lens_base_cents = 0;
  if (selection.material_code) {
    const [cell] = await pg("lens_base_price")
      .whereNull("deleted_at")
      .where({ design_code: selection.design_code, material_code: selection.material_code });
    lens_base_cents = n((cell as { price_cents?: number } | undefined)?.price_cents);
  }

  // Precio del tratamiento por (diseño × material) desde lens_treatment_price.
  // Si esa tabla aún no existe o no tiene la celda, se cae al modelo antiguo.
  const treatmentCell = async (treatment_code: string): Promise<number | null> => {
    if (!selection.material_code) return null;
    const rows = await pg("lens_treatment_price")
      .whereNull("deleted_at")
      .where({
        design_code: selection.design_code,
        material_code: selection.material_code,
        treatment_code,
      })
      .catch(() => [] as unknown[]);
    const cell = (rows as { price_cents?: number }[])[0];
    return cell ? n(cell.price_cents) : null;
  };

  let photo_cents = 0;
  if (selection.photo_code) {
    const fromTreat = await treatmentCell("photo");
    if (fromTreat != null) {
      photo_cents = fromTreat;
    } else {
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
        photo_cents = v == null ? 0 : n(v); // null (N/A for this design) → not charged
      }
    }
  }

  let ar_cents = 0;
  if (selection.ar_code) {
    const fromTreat =
      selection.ar_code === "ar-green" || selection.ar_code === "ar-blue"
        ? await treatmentCell(selection.ar_code)
        : null;
    if (fromTreat != null) {
      ar_cents = fromTreat;
    } else {
      const [ar] = await pg("lens_ar_option")
        .whereNull("deleted_at")
        .where({ code: selection.ar_code, is_active: true });
      ar_cents = n((ar as { price_cents?: number } | undefined)?.price_cents);
    }
  }

  return {
    lens_base_cents,
    photo_cents,
    ar_cents,
    total_cents: lens_base_cents + photo_cents + ar_cents,
    category,
  };
}

/** Convenience wrapper for callers that only need the summed add-on. */
export async function computeLensAddonCents(
  pg: Knex,
  selection: LensSelection
): Promise<number> {
  const { total_cents } = await computeLensBreakdown(pg, selection);
  return total_cents;
}
