import { MedusaService } from "@medusajs/framework/utils";
import {
  LensOption,
  CoatingOption,
  LensDesign,
  LensMaterial,
  LensBasePrice,
  LensPhotoOption,
  LensArOption,
} from "./models/index";
import type { LensConfig, UsageType } from "@eyewear/shared";

export interface ComputedLensPrice {
  frame_price_cents: number;
  lens_modifier_cents: number;
  coating_modifiers_cents: number;
  total_cents: number;
}

/** Selection sent from the storefront wizard (all optional except design). */
export interface LensQuoteSelection {
  design_code: string;            // "sv" | "bifocal" | "prog-mid" | "prog-high" | "frame-only"
  material_code?: string | null;  // required unless frame-only
  photo_code?: string | null;
  ar_code?: string | null;
}

/** Server-computed breakdown for a frame + lens configuration (all cents). */
export interface LensQuote {
  frame_price_cents: number;
  lens_base_cents: number;
  photo_cents: number;
  ar_cents: number;
  total_cents: number;
  frame_only: boolean;
}

export default class LensConfigModuleService extends MedusaService({
  LensOption,
  CoatingOption,
  LensDesign,
  LensMaterial,
  LensBasePrice,
  LensPhotoOption,
  LensArOption,
}) {
  /** The full editable 2026 price list ("matriz") for the wizard. Active rows only. */
  async getMatrix(): Promise<{
    designs: unknown[];
    materials: unknown[];
    base_prices: unknown[];
    photos: unknown[];
    ars: unknown[];
  }> {
    const [designs, materials, base_prices, photos, ars] = await Promise.all([
      this.listLensDesigns({ is_active: true }, { order: { sort: "ASC" } }),
      this.listLensMaterials({ is_active: true }, { order: { sort: "ASC" } }),
      this.listLensBasePrices({}),
      this.listLensPhotoOptions({ is_active: true }, { order: { sort: "ASC" } }),
      this.listLensArOptions({ is_active: true }, { order: { sort: "ASC" } }),
    ]);
    return { designs, materials, base_prices, photos, ars };
  }

  /**
   * Compute the price for a frame + lens selection. ALL math is server-side; the
   * storefront never sends a total. Amounts in cents.
   */
  async computeQuote(
    frame_price_cents: number,
    selection: LensQuoteSelection
  ): Promise<LensQuote> {
    const frame = Math.max(0, Math.round(frame_price_cents) || 0);
    const frame_only = selection.design_code === "frame-only";

    if (frame_only) {
      return {
        frame_price_cents: frame,
        lens_base_cents: 0,
        photo_cents: 0,
        ar_cents: 0,
        total_cents: frame,
        frame_only: true,
      };
    }

    const [design] = await this.listLensDesigns({
      code: selection.design_code,
      is_active: true,
    });
    if (!design) {
      throw new Error(`Unknown lens design: ${selection.design_code}`);
    }
    const category = (design as { category: string }).category;

    // Base lens price for the (design, material) cell.
    let lens_base_cents = 0;
    if (selection.material_code) {
      const [cell] = await this.listLensBasePrices({
        design_code: selection.design_code,
        material_code: selection.material_code,
      });
      lens_base_cents = (cell as { price_cents?: number } | undefined)?.price_cents ?? 0;
    }

    // Photochromic add-on, priced by the design's category.
    let photo_cents = 0;
    if (selection.photo_code) {
      const [photo] = await this.listLensPhotoOptions({
        code: selection.photo_code,
        is_active: true,
      });
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
        photo_cents = byCat[category] ?? 0; // null (N/A) → not charged
      }
    }

    // Anti-reflective add-on (any active AR is selectable; group is informational).
    let ar_cents = 0;
    if (selection.ar_code) {
      const [ar] = await this.listLensArOptions({
        code: selection.ar_code,
        is_active: true,
      });
      ar_cents = (ar as { price_cents?: number } | undefined)?.price_cents ?? 0;
    }

    const total_cents = frame + lens_base_cents + photo_cents + ar_cents;
    return {
      frame_price_cents: frame,
      lens_base_cents,
      photo_cents,
      ar_cents,
      total_cents,
      frame_only: false,
    };
  }

  /**
   * Computes the total price for a frame + lens configuration.
   * All math happens server-side; never accept client totals.
   */
  async computePrice(
    frame_price_cents: number,
    config: LensConfig
  ): Promise<ComputedLensPrice> {
    const { index, usage_type } = config;
    const coatings = config.coatings ?? [];

    const [lensOption] = await this.listLensOptions({
      index,
      usage_type,
      is_active: true,
    });

    const lens_modifier_cents = (lensOption as { price_modifier_cents?: number } | null)?.price_modifier_cents ?? 0;

    let coating_modifiers_cents = 0;
    for (const coatingType of coatings) {
      const [coating] = await this.listCoatingOptions({
        type: coatingType,
        is_active: true,
      });
      if (coating) {
        coating_modifiers_cents += (coating as { price_modifier_cents: number }).price_modifier_cents;
      }
    }

    const total_cents =
      frame_price_cents + lens_modifier_cents + coating_modifiers_cents;

    return {
      frame_price_cents,
      lens_modifier_cents,
      coating_modifiers_cents,
      total_cents,
    };
  }

  async listActiveLensOptions(usage_type?: UsageType) {
    // MedusaService generates `list<Plural>(filters, config, context)` — the filters
    // go in as the first argument, NOT wrapped in a `{ filters }` object. Wrapping
    // them makes MikroORM look for a `filters` column and fail the query.
    const filters: Record<string, unknown> = { is_active: true };
    if (usage_type) filters["usage_type"] = usage_type;
    return this.listLensOptions(filters);
  }

  async listActiveCoatingOptions(usage_type?: UsageType) {
    const options = await this.listCoatingOptions({ is_active: true });
    if (!usage_type) return options;
    return options.filter(
      (c) =>
        (c as unknown as { compatible_usage_types: string[] }).compatible_usage_types.length === 0 ||
        (c as unknown as { compatible_usage_types: string[] }).compatible_usage_types.includes(usage_type)
    );
  }
}
