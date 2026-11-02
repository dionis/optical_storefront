import type { Knex } from "@mikro-orm/knex";
import { applyStoreLensBreakdown, loadStoreLensPricesPg } from "./pricing-overview";

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
  selection: LensSelection,
  /** Quote for this store: its own cell prices and its % over the master apply. */
  establishmentId: string | null = null
): Promise<LensBreakdown> {
  if (!selection || selection.design_code === "frame-only") return { ...EMPTY };

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

  // The design, the base cell and the two treatment cells do not depend on one
  // another: one round trip instead of up to four in a row. Every POS quote and
  // every step of the web wizard goes through here, so the saved latency is
  // paid back on every keystroke of the funnel. The option tables (which DO
  // need the design's category, or only answer when the matrix has no cell)
  // are read after, and still in parallel.
  const [designRows, baseRows, photoTreat, arTreat] = await Promise.all([
    pg("lens_design").whereNull("deleted_at").where({ code: selection.design_code, is_active: true }),
    selection.material_code
      ? pg("lens_base_price").whereNull("deleted_at").where({ design_code: selection.design_code, material_code: selection.material_code })
      : Promise.resolve([] as unknown[]),
    selection.photo_code ? treatmentCell("photo") : Promise.resolve(null),
    selection.ar_code && (selection.ar_code === "ar-green" || selection.ar_code === "ar-blue") ? treatmentCell(selection.ar_code) : Promise.resolve(null),
  ]);

  const design = (designRows as unknown[])[0];
  if (!design) throw new Error(`Unknown lens design: ${selection.design_code}`);
  const category = String((design as { category: string }).category);
  const lens_base_cents = n(((baseRows as { price_cents?: number }[])[0] ?? {}).price_cents);

  const [photoRows, arRows] = await Promise.all([
    selection.photo_code && photoTreat == null
      ? pg("lens_photo_option").whereNull("deleted_at").where({ code: selection.photo_code, is_active: true })
      : Promise.resolve([] as unknown[]),
    selection.ar_code && arTreat == null
      ? pg("lens_ar_option").whereNull("deleted_at").where({ code: selection.ar_code, is_active: true })
      : Promise.resolve([] as unknown[]),
  ]);

  let photo_cents = 0;
  if (selection.photo_code) {
    if (photoTreat != null) {
      photo_cents = photoTreat;
    } else {
      const photo = (photoRows as unknown[])[0];
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
    ar_cents = arTreat != null ? arTreat : n(((arRows as { price_cents?: number }[])[0] ?? {}).price_cents);
  }

  return applyStoreLensBreakdown(
    { lens_base_cents, photo_cents, ar_cents, total_cents: lens_base_cents + photo_cents + ar_cents, category },
    await loadStoreLensPricesPg(pg, establishmentId),
    selection
  );
}

/** Convenience wrapper for callers that only need the summed add-on. */
export async function computeLensAddonCents(
  pg: Knex,
  selection: LensSelection,
  establishmentId: string | null = null
): Promise<number> {
  const { total_cents } = await computeLensBreakdown(pg, selection, establishmentId);
  return total_cents;
}
