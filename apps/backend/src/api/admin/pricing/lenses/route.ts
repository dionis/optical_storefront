import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../lib/audit";
import { mirrorPricesToSheet } from "../../../../lib/gsheet-sync";
import {
  LENS_ADJUST_KEY,
  lensPriceDenied,
  loadPricingOverview,
  resolvePricingStore,
  upsertStoreLensPrice,
  type LensStoreKind,
} from "../../../../lib/pricing-overview";
import { LENS_CONFIG_MODULE } from "../../../../modules/lens-config/index";
import type LensConfigModuleService from "../../../../modules/lens-config/service";

/**
 * POST /admin/pricing/lenses
 *   { kind: "base" | "photo" | "ar" | "adjust", key, value | null, store? }
 *
 * The lens half of the panel. Without `store` the write edits THE MASTER (the
 * lens-config tables the whole chain quotes from); with a `store` it upserts
 * that store's variation in `lens_store_price`, which is what the point of sale
 * then applies (lib/pricing-overview.ts `applyStoreLensPrice`).
 *
 * Keys, so every writer spells them the same:
 *   base   "<design_code>:<material_code>"   value = price of the cell
 *   photo  "<photo_code>:<sv|bifocal|prog>"  value = price in that category
 *   ar     "<ar_code>"                       value = price of the treatment
 *   adjust "all"                             value = % over the master (store only)
 *
 * `value` is in DOLLARS for a price and a percentage for "adjust"; null removes
 * a store's variation (back to inheriting) — the master's own cells are never
 * removed, only set.
 */
interface Body {
  kind?: unknown;
  key?: unknown;
  value?: unknown;
  store?: unknown;
}

const cents = (dollars: number) => Math.max(0, Math.round(dollars * 100));

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const kind = String(body.kind ?? "");
  const key = String(body.key ?? "");
  const value = body.value === null || body.value === undefined || body.value === "" ? null : Number(body.value);

  const denied = lensPriceDenied(kind, key, value);
  if (denied) {
    res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid lens price." });
    return;
  }
  const store = await resolvePricingStore(req.scope, body.store);
  if ("reason" in store) {
    res.status(404).json({ type: "not_found", reason: store.reason, message: "Store not found." });
    return;
  }
  if (!store.storeId && kind === "adjust") {
    res.status(422).json({ type: "invalid_data", reason: "store_required", message: "A percentage over the master needs a store." });
    return;
  }
  if (!store.storeId && value === null) {
    res.status(422).json({ type: "invalid_data", reason: "bad_value", message: "The master's own price cannot be removed." });
    return;
  }

  const actorId = req.auth_context?.actor_id ?? null;
  try {
    if (store.storeId) {
      await upsertStoreLensPrice(
        req.scope,
        {
          establishmentId: store.storeId,
          kind: kind as LensStoreKind,
          key: kind === "adjust" ? LENS_ADJUST_KEY : key,
          value: value === null ? null : kind === "adjust" ? value : cents(value),
        },
        actorId
      );
    } else {
      const failed = await writeMaster(req.scope, kind, key, cents(value as number));
      if (failed) {
        res.status(422).json({ type: "invalid_data", reason: failed, message: "Unknown lens item." });
        return;
      }
    }
    await recordAudit(req.scope, {
      actorId,
      action: "price.change",
      entity: "lens_price",
      entityId: `${kind}:${key}`,
      establishmentId: store.storeId,
      after: { kind, key, value },
    });
    const overview = await loadPricingOverview(req.scope, store.storeId);
    logger.info(`[pricing] lens ${kind} ${key} -> ${value ?? "removed"} on ${store.storeId ?? "master"} by ${actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json({ lenses: overview.lenses });
  } catch (error) {
    logger.error(`[pricing] lens save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the lens price." });
  }
}

/** Writes one cell of the owner's master list; a `reason` code when the item does not exist. */
async function writeMaster(
  container: AuthenticatedMedusaRequest["scope"],
  kind: string,
  key: string,
  priceCents: number
): Promise<string | null> {
  const svc = container.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);
  if (kind === "base") {
    const [design_code, material_code] = key.split(":");
    if (!design_code || !material_code) return "bad_key";
    const rows = (await svc.listLensBasePrices({ design_code, material_code })) as unknown as Record<string, unknown>[];
    const cell = rows.find((r) => !r["deleted_at"]);
    if (cell) await svc.updateLensBasePrices([{ id: cell["id"], price_cents: priceCents }] as never);
    else await svc.createLensBasePrices({ design_code, material_code, price_cents: priceCents } as never);
    return null;
  }
  if (kind === "photo") {
    const [code, category] = key.split(":");
    const column =
      category === "sv" ? "price_sv_cents" : category === "bifocal" ? "price_bifocal_cents" : category === "prog" ? "price_prog_cents" : null;
    if (!code || !column) return "bad_key";
    const rows = (await svc.listLensPhotoOptions({ code })) as unknown as Record<string, unknown>[];
    const row = rows.find((r) => !r["deleted_at"]);
    if (!row) return "unknown_item";
    await svc.updateLensPhotoOptions([{ id: row["id"], [column]: priceCents }] as never);
    return null;
  }
  if (kind === "ar") {
    const rows = (await svc.listLensArOptions({ code: key })) as unknown as Record<string, unknown>[];
    const row = rows.find((r) => !r["deleted_at"]);
    if (!row) return "unknown_item";
    await svc.updateLensArOptions([{ id: row["id"], price_cents: priceCents }] as never);
    return null;
  }
  return "bad_kind";
}
