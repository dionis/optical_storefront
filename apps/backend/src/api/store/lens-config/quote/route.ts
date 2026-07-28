import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";

interface LensQuoteSelection {
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
 * POST /store/lens-config/quote
 * Body: { frame_price_cents: number, selection: { design_code, material_code?, photo_code?, ar_code? } }
 * Returns the server-computed price breakdown (cents). The storefront NEVER sends a
 * total — this is the single source of truth for lens pricing. Reads the price list
 * via the shared Postgres connection so it's independent of the module ORM lifecycle.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const body = req.body as {
    frame_price_cents?: number;
    selection?: LensQuoteSelection;
  };

  if (
    typeof body.frame_price_cents !== "number" ||
    !body.selection ||
    typeof body.selection.design_code !== "string"
  ) {
    res.status(400).json({
      error: "Se requieren 'frame_price_cents' (número) y 'selection.design_code'.",
    });
    return;
  }

  const { frame_price_cents, selection } = body;
  const frame = Math.max(0, Math.round(frame_price_cents) || 0);
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

  if (selection.design_code === "frame-only") {
    res.json({
      quote: {
        frame_price_cents: frame,
        lens_base_cents: 0,
        photo_cents: 0,
        ar_cents: 0,
        total_cents: frame,
        frame_only: true,
      },
    });
    return;
  }

  const [design] = await pg("lens_design")
    .whereNull("deleted_at")
    .where({ code: selection.design_code, is_active: true });
  if (!design) {
    res.status(400).json({ error: `Unknown lens design: ${selection.design_code}` });
    return;
  }
  const category = String((design as { category: string }).category);

  let lens_base_cents = 0;
  if (selection.material_code) {
    const [cell] = await pg("lens_base_price")
      .whereNull("deleted_at")
      .where({ design_code: selection.design_code, material_code: selection.material_code });
    lens_base_cents = n((cell as { price_cents?: number } | undefined)?.price_cents);
  }

  let photo_cents = 0;
  if (selection.photo_code) {
    const [photo] = await pg("lens_photo_option")
      .whereNull("deleted_at")
      .where({ code: selection.photo_code, is_active: true });
    if (photo) {
      const p = photo as Record<string, number | null>;
      const byCat: Record<string, number | null | undefined> = {
        sv: p.price_sv_cents,
        bifocal: p.price_bifocal_cents,
        prog: p.price_prog_cents,
      };
      photo_cents = byCat[category] == null ? 0 : n(byCat[category]); // null (N/A) → not charged
    }
  }

  let ar_cents = 0;
  if (selection.ar_code) {
    const [ar] = await pg("lens_ar_option")
      .whereNull("deleted_at")
      .where({ code: selection.ar_code, is_active: true });
    ar_cents = n((ar as { price_cents?: number } | undefined)?.price_cents);
  }

  const total_cents = frame + lens_base_cents + photo_cents + ar_cents;
  res.json({
    quote: {
      frame_price_cents: frame,
      lens_base_cents,
      photo_cents,
      ar_cents,
      total_cents,
      frame_only: false,
    },
  });
}
