import { MedusaService } from "@medusajs/framework/utils";
import { LensOption, CoatingOption } from "./models/index";
import type { LensConfig, LensIndex, CoatingType, UsageType } from "@eyewear/shared";

export interface ComputedLensPrice {
  frame_price_cents: number;
  lens_modifier_cents: number;
  coating_modifiers_cents: number;
  total_cents: number;
}

export default class LensConfigModuleService extends MedusaService({
  LensOption,
  CoatingOption,
}) {
  /**
   * Computes the total price for a frame + lens configuration.
   * All math happens server-side; never accept client totals.
   */
  async computePrice(
    frame_price_cents: number,
    config: LensConfig
  ): Promise<ComputedLensPrice> {
    const { index, usage_type, coatings } = config;

    const [lensOption] = await this.listLensOptions({
      filters: { index, usage_type, is_active: true },
    }).catch(() => [null]);

    const lens_modifier_cents = (lensOption as { price_modifier_cents?: number } | null)?.price_modifier_cents ?? 0;

    let coating_modifiers_cents = 0;
    for (const coatingType of coatings) {
      const [coating] = await this.listCoatingOptions({
        filters: { type: coatingType, is_active: true },
      }).catch(() => [null]);
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
    const filters: Record<string, unknown> = { is_active: true };
    if (usage_type) filters["usage_type"] = usage_type;
    return this.listLensOptions({ filters } as Parameters<typeof this.listLensOptions>[0]);
  }

  async listActiveCoatingOptions(usage_type?: UsageType) {
    const options = await this.listCoatingOptions({
      filters: { is_active: true },
    } as Parameters<typeof this.listCoatingOptions>[0]);
    if (!usage_type) return options;
    return options.filter(
      (c) =>
        (c as unknown as { compatible_usage_types: string[] }).compatible_usage_types.length === 0 ||
        (c as unknown as { compatible_usage_types: string[] }).compatible_usage_types.includes(usage_type)
    );
  }
}
