import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../lib/audit";
import { mirrorPricesToSheet } from "../../../../lib/gsheet-sync";
import { clearLensCellCostCache } from "../../../../lib/lens-cost";
import { cellMatchesFinish, type LensFinish } from "../../../../lib/lens-finish";
import {
  LENS_ADJUST_KEY,
  lensBaseKey,
  lensPriceDenied,
  loadPricingOverview,
  parseLensBaseKey,
  redactLensCosts,
  resolvePricingStore,
  upsertStoreLensPrice,
  type LensStoreKind,
} from "../../../../lib/pricing-overview";
import { hasPrivilege } from "../../../../lib/staff-profile";
import { getStaffScope } from "../../../../lib/staff-scope";
import { LENS_CONFIG_MODULE } from "../../../../modules/lens-config/index";
import type LensConfigModuleService from "../../../../modules/lens-config/service";

/**
 * POST /admin/pricing/lenses
 *   { kind: "base" | "photo" | "ar" | "adjust", key, value | null, store?, field? }
 *
 * The lens half of the panel. Without `store` the write edits THE MASTER (the
 * lens-config tables the whole chain quotes from); with a `store` it upserts
 * that store's variation in `lens_store_price`, which is what the point of sale
 * then applies (lib/pricing-overview.ts `applyStoreLensPrice`).
 *
 * Keys, so every writer spells them the same:
 *   base   "<design_code>:<material_code>[:<finish>]"  value = price of the cell;
 *          no finish = stock (lib/lens-finish.ts); a progressive's only cell is
 *          digital and keeps the short key (`lensBaseKey`)
 *   photo  "<photo_code>:<sv|bifocal|prog>"  value = price in that category
 *   ar     "<ar_code>"                       value = price of the treatment
 *   adjust "all"                             value = % over the master (store only)
 *
 * `field` (base only): "price" (default) or "cost". The cost is the lab's price
 * of that cell and is written to the MASTER only — a per-store cost variation
 * is out of scope (the lab charges the chain one price) — by a reader holding
 * «Gestionar costos» (costs.manage; admins implicitly). `value` null on a cost
 * clears it (back to "unknown", the cost rules answer).
 *
 * `value` is in DOLLARS for a price and a percentage for "adjust"; null removes
 * a store's variation (back to inheriting) — the master's own prices are never
 * removed, only set. The response's `lenses` carries `cost_cents` only when
 * the caller may see costs.
 */
interface Body {
  kind?: unknown;
  key?: unknown;
  value?: unknown;
  store?: unknown;
  field?: unknown;
}

const cents = (dollars: number) => Math.max(0, Math.round(dollars * 100));

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const kind = String(body.kind ?? "");
  const key = String(body.key ?? "");
  const field = body.field === "cost" ? "cost" : "price";
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
  if (field === "cost" && (kind !== "base" || store.storeId)) {
    res.status(422).json({ type: "invalid_data", reason: "bad_field", message: "A cost belongs to a master base cell." });
    return;
  }
  if (!store.storeId && value === null && field === "price") {
    res.status(422).json({ type: "invalid_data", reason: "bad_value", message: "The master's own price cannot be removed." });
    return;
  }

  const actorId = req.auth_context?.actor_id ?? null;
  const scope = actorId ? await getStaffScope(req.scope, actorId) : null;
  const canSeeCosts = Boolean(scope && (hasPrivilege(scope, "costs.view") || hasPrivilege(scope, "costs.manage")));
  if (field === "cost" && !(scope && hasPrivilege(scope, "costs.manage"))) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Costs need the costs.manage privilege." });
    return;
  }

  try {
    if (store.storeId) {
      await upsertStoreLensPrice(
        req.scope,
        {
          establishmentId: store.storeId,
          kind: kind as LensStoreKind,
          key: kind === "adjust" ? LENS_ADJUST_KEY : kind === "base" ? await canonicalBaseKey(req.scope, key) : key,
          value: value === null ? null : kind === "adjust" ? value : cents(value),
        },
        actorId
      );
    } else {
      const failed = await writeMaster(req.scope, kind, key, field, value === null ? null : cents(value));
      if (failed) {
        res.status(422).json({ type: "invalid_data", reason: failed, message: "Unknown lens item." });
        return;
      }
    }
    await recordAudit(req.scope, {
      actorId,
      action: field === "cost" ? "cost.change" : "price.change",
      entity: "lens_price",
      entityId: `${kind}:${key}`,
      establishmentId: store.storeId,
      after: { kind, key, field, value },
    });
    const overview = await loadPricingOverview(req.scope, store.storeId);
    logger.info(`[pricing] lens ${kind} ${key} ${field} -> ${value ?? "removed"} on ${store.storeId ?? "master"} by ${actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json({ lenses: redactLensCosts(overview.lenses, canSeeCosts) });
  } catch (error) {
    logger.error(`[pricing] lens save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the lens price." });
  }
}

/** The category of a design, for the key and finish rules; null when unknown. */
async function designCategory(svc: LensConfigModuleService, design_code: string): Promise<string | null> {
  const rows = (await svc.listLensDesigns({ code: design_code })) as unknown as Record<string, unknown>[];
  const design = rows.find((r) => !r["deleted_at"]);
  return design ? String(design["category"] ?? "") : null;
}

/**
 * A store cell's key as `lensBaseKey` spells it, whatever the panel sent
 * ("prog-mid:cr39:digital" → "prog-mid:cr39"), so the quote finds it.
 */
async function canonicalBaseKey(container: AuthenticatedMedusaRequest["scope"], key: string): Promise<string> {
  const parts = parseLensBaseKey(key);
  if (!parts) return key;
  const svc = container.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);
  const category = await designCategory(svc, parts.design_code);
  return lensBaseKey(parts.design_code, parts.material_code, parts.finish, category);
}

/** Writes one cell of the owner's master list; a `reason` code when the item does not exist. */
async function writeMaster(
  container: AuthenticatedMedusaRequest["scope"],
  kind: string,
  key: string,
  field: "price" | "cost",
  amountCents: number | null
): Promise<string | null> {
  const svc = container.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);
  if (kind === "base") {
    const parts = parseLensBaseKey(key);
    if (!parts) return "bad_key";
    const { design_code, material_code } = parts;
    const category = await designCategory(svc, design_code);
    if (category === null) return "unknown_item";
    // A progressive has one cell and it is digital: a "stock" write on it
    // would create a second cell the quote never reads.
    const finish: LensFinish = category === "prog" ? "digital" : parts.finish;
    if (finish !== parts.finish) return "finish_unavailable";
    const rows = (await svc.listLensBasePrices({ design_code, material_code })) as unknown as Record<string, unknown>[];
    const cell = rows.find((r) => !r["deleted_at"] && cellMatchesFinish(r as { finish?: unknown }, finish));
    if (field === "cost") {
      // Cost on a cell that is not priced yet: nothing to attach it to.
      if (!cell) return "unknown_item";
      await svc.updateLensBasePrices([{ id: cell["id"], cost_cents: amountCents }] as never);
    } else if (cell) {
      await svc.updateLensBasePrices([{ id: cell["id"], price_cents: amountCents ?? 0 }] as never);
    } else {
      await svc.createLensBasePrices({ design_code, material_code, finish, price_cents: amountCents ?? 0 } as never);
    }
    // Margins read the cell's cost through a process cache (lib/lens-cost.ts).
    clearLensCellCostCache();
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
    await svc.updateLensPhotoOptions([{ id: row["id"], [column]: amountCents ?? 0 }] as never);
    return null;
  }
  if (kind === "ar") {
    const rows = (await svc.listLensArOptions({ code: key })) as unknown as Record<string, unknown>[];
    const row = rows.find((r) => !r["deleted_at"]);
    if (!row) return "unknown_item";
    await svc.updateLensArOptions([{ id: row["id"], price_cents: amountCents ?? 0 }] as never);
    return null;
  }
  return "bad_kind";
}
