import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import {
  LensCompatError,
  resolveLegacySelection,
  type ResolvedSelection,
} from "../../../../lib/lens-compat";
import { computeLensBreakdown, type LensSelection } from "../../../../lib/lens-quote";

/**
 * POST /store/lens-config/price
 *
 * Legacy pricing contract, computed from the 2026 matrix — the same math as
 * /store/lens-config/quote and the cart, so both routes always agree.
 *
 * Body (legacy):
 *   { frame_price_cents, lens_config: { usage_type, index?, coatings?: string[] } }
 * Body (matrix, preferred — skips the legacy resolution entirely):
 *   { frame_price_cents, lens_config: { design_code, material_code?, photo_code?, ar_code? } }
 *
 * `coatings` accepts legacy types ("anti_reflective", "photochromic", …) and concrete
 * matrix codes ("ar-green-plus", "photo-grey") interchangeably. The response echoes
 * what was actually selected in `resolved`, so an ambiguous legacy request is never
 * priced silently.
 */

interface LegacyLensConfig {
  usage_type?: unknown;
  index?: unknown;
  coatings?: unknown;
  design_code?: unknown;
  material_code?: unknown;
  photo_code?: unknown;
  ar_code?: unknown;
}

const asCode = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const pgOf = (req: MedusaRequest): Knex =>
  req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const body = (req.body ?? {}) as {
    frame_price_cents?: unknown;
    lens_config?: LegacyLensConfig;
    /** Accepted as an alias so /price and /quote take the same body. */
    selection?: LegacyLensConfig;
  };

  const config = body.lens_config ?? body.selection;

  if (typeof body.frame_price_cents !== "number" || !Number.isFinite(body.frame_price_cents)) {
    res
      .status(400)
      .json({ error: "Se requiere 'frame_price_cents' (número, en centavos)." });
    return;
  }
  if (!config || typeof config !== "object") {
    res.status(400).json({ error: "Se requiere 'lens_config'." });
    return;
  }

  const frame_price_cents = Math.max(0, Math.round(body.frame_price_cents) || 0);

  // A frame with no lenses: nothing to look up, and the legacy resolution would
  // reject "frame-only" since it is not a usage_type.
  if (config.design_code === "frame-only" || config.usage_type === "frame-only") {
    res.json({
      frame_price_cents,
      lens_modifier_cents: 0,
      coating_modifiers_cents: 0,
      total_cents: frame_price_cents,
      breakdown: { lens_base_cents: 0, photo_cents: 0, ar_cents: 0 },
      resolved: {
        design_code: "frame-only",
        material_code: null,
        photo_code: null,
        ar_code: null,
        unsupported_coatings: [],
        ignored_coatings: [],
      },
      frame_only: true,
    });
    return;
  }

  let resolved: ResolvedSelection;
  try {
    if (asCode(config.design_code)) {
      // Matrix contract — take the codes as given.
      resolved = {
        design_code: asCode(config.design_code) as string,
        material_code: asCode(config.material_code),
        photo_code: asCode(config.photo_code),
        ar_code: asCode(config.ar_code),
        unsupported_coatings: [],
        ignored_coatings: [],
      };
    } else {
      resolved = await resolveLegacySelection(pgOf(req), config);
    }
  } catch (e) {
    if (e instanceof LensCompatError) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }

  const selection: LensSelection = {
    design_code: resolved.design_code,
    material_code: resolved.material_code,
    photo_code: resolved.photo_code,
    ar_code: resolved.ar_code,
  };

  let breakdown;
  try {
    breakdown = await computeLensBreakdown(pgOf(req), selection);
  } catch (e) {
    // The only thrown case is an unknown/inactive design code from the matrix body.
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const coating_modifiers_cents = breakdown.photo_cents + breakdown.ar_cents;

  res.json({
    // Legacy fields, unchanged.
    frame_price_cents,
    lens_modifier_cents: breakdown.lens_base_cents,
    coating_modifiers_cents,
    total_cents: frame_price_cents + breakdown.lens_base_cents + coating_modifiers_cents,
    // Additive: what the server actually priced.
    breakdown: {
      lens_base_cents: breakdown.lens_base_cents,
      photo_cents: breakdown.photo_cents,
      ar_cents: breakdown.ar_cents,
    },
    resolved,
    frame_only: false,
  });
}
