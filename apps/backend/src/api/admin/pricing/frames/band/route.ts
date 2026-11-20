import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../../lib/audit";
import { frameCostsDenied } from "../../../../../lib/frame-cost-route";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import {
  priceBandDenied,
  priceBandImpact,
  resolvePriceBand,
  toPriceBand,
  type BandImpact,
  type PriceBand,
  type PriceBandOrigin,
} from "../../../../../lib/pricing";
import { convertedPriceBook } from "../../../../../lib/price-sync";
import { resolvePricingStore } from "../../../../../lib/pricing-overview";
import {
  indexPriceBands,
  loadChainPriceBand,
  loadStorePriceBands,
  ownerPricedKeys,
  priceBandAudit,
  setChainPriceBand,
  setStorePriceBand,
  type PriceBandRow,
} from "../../../../../lib/store-pricing-data";

/**
 * The FLOOR and the CEILING of a selling price — read and written here, one
 * route for both halves of the owner's sentence: «Esto se debe poder hacer,
 * por ejemplo el dueño lo hace una vez para todas las tiendas», and then
 * bent store by store.
 *
 *   GET  /admin/pricing/frames/band[?store=<id>]
 *   POST /admin/pricing/frames/band   { …the four numbers…, store?, clear?, dry_run? }
 *
 * `store` reads exactly like the rest of the pricing panel (see
 * lib/pricing-overview.ts): absent / "all" / "web" is THE CHAIN's band — the
 * one the owner sets once for every store — and a real establishment id is
 * that store's own variation of it, with the chain's alongside so the panel
 * can show both and badge the inherited one.
 *
 * Both answer the same object:
 *
 *   {
 *     store: <id> | null,
 *     band: { floor_below_cents, floor_to_cents, cap_above_cents, cap_to_cents,
 *             apply_to_cases, enabled, updated_at, updated_by } | null,
 *     origin: "store_variation" | "chain_master" | "none",
 *     inherited: boolean,
 *     master: <the chain's band, same shape> | null,
 *     impact: { total, raised, lowered, unchanged, owner_priced,
 *               cases_skipped, cases_would_raise,
 *               examples: { raised: [{ model, kind, from, to }], lowered: […] } },
 *     saved: boolean          // POST only; false on a dry run
 *   }
 *
 * `band` is the EFFECTIVE band of the scope asked about. `impact` is what that
 * band does to today's converted prices — on a POST with `dry_run` it is what
 * the band IN THE BODY would do, which is the number the panel puts in front
 * of the owner before he saves. He has just lived through a rule change that
 * moved 147 prices at once; nothing here is allowed to happen blind.
 *
 * `cost_cents`-style units: every figure is an INTEGER NUMBER OF CENTS, the
 * same unit the panel already speaks for every cost. The impact's `from` / `to`
 * are dollars, because they are prices read out loud ("READ 2: $8 → $60").
 *
 * Read with «Ver costos» or «Gestionar costos», write with «Gestionar costos»
 * (admins hold both implicitly) — the same guard as the cost routes. Every
 * change is audited as `price.change` on `price_band` with the band before and
 * after and, for a variation, the store on the event itself.
 *
 * Reasons: `bad_band` (a figure that is not a whole number of cents above 0),
 * `band_incomplete` (one side with a threshold and no target, or the reverse),
 * `floor_below_threshold`, `cap_above_threshold`, `band_crossed` (the floor
 * would push a price over the ceiling), `store_not_found`, `forbidden_role`,
 * `load_failed`, `save_failed`.
 */

/** The band as the panel reads it: the six fields plus who last moved it. */
function bandView(row: PriceBandRow | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    floor_below_cents: row.floor_below_cents,
    floor_to_cents: row.floor_to_cents,
    cap_above_cents: row.cap_above_cents,
    cap_to_cents: row.cap_to_cents,
    apply_to_cases: row.apply_to_cases,
    enabled: row.enabled,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
  };
}

/**
 * What a band would do to the catalogue: every model's converted price (the
 * same figures price-sync writes), minus the models the owner priced by hand.
 */
async function impactOf(
  req: AuthenticatedMedusaRequest,
  band: PriceBand | null
): Promise<BandImpact> {
  return priceBandImpact(convertedPriceBook(), band, await ownerPricedKeys(req.scope));
}

/** The effective band of a scope, plus the chain's, read from the tables. */
async function readScope(
  req: AuthenticatedMedusaRequest,
  storeId: string | null
): Promise<{
  master: PriceBandRow | null;
  effective: PriceBandRow | null;
  origin: PriceBandOrigin;
  inherited: boolean;
}> {
  const [master, variations] = await Promise.all([
    loadChainPriceBand(req.scope),
    storeId ? loadStorePriceBands(req.scope, storeId) : Promise.resolve([] as PriceBandRow[]),
  ]);
  const own = storeId ? variations.find((v) => v.establishment_id === storeId) ?? null : null;
  const { origin, inherited } = resolvePriceBand(
    master,
    indexPriceBands(own ? [own] : []),
    storeId
  );
  return { master, effective: own ?? master, origin, inherited };
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const denied = await frameCostsDenied(req, "read");
  if (denied) {
    res.status(403).json({ type: "not_allowed", reason: denied, message: "The price band is not visible for this user." });
    return;
  }
  try {
    const scope = await resolvePricingStore(req.scope, (req.query as Record<string, unknown>)["store"]);
    if ("reason" in scope) {
      res.status(422).json({ type: "invalid_data", reason: scope.reason, message: "Unknown store." });
      return;
    }
    const { master, effective, origin, inherited } = await readScope(req, scope.storeId);
    res.json({
      store: scope.storeId,
      band: bandView(effective),
      origin,
      inherited,
      master: bandView(master),
      impact: await impactOf(req, effective),
    });
  } catch (error) {
    logger.error(`[pricing] price band unavailable: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not read the price band." });
  }
}

interface Body {
  store?: unknown;
  floor_below_cents?: unknown;
  floor_to_cents?: unknown;
  cap_above_cents?: unknown;
  cap_to_cents?: unknown;
  apply_to_cases?: unknown;
  enabled?: unknown;
  /** true = remove it: the chain's band goes away, a store's goes back to inheriting. */
  clear?: unknown;
  /** true = answer the impact of this band and write NOTHING. */
  dry_run?: unknown;
}

/** An absent / empty figure is "this side is not set", not a zero. */
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const clear = body.clear === true;
  const dryRun = body.dry_run === true;

  // A dry run writes nothing, but it reads the whole catalogue and the owner's
  // prices, so it is guarded like the write it is previewing.
  const notAllowed = await frameCostsDenied(req, "write");
  if (notAllowed) {
    res.status(403).json({ type: "not_allowed", reason: notAllowed, message: "The price band cannot be changed by this user." });
    return;
  }

  const proposed: PriceBand | null = clear
    ? null
    : (toPriceBand({
        floor_below_cents: num(body.floor_below_cents),
        floor_to_cents: num(body.floor_to_cents),
        cap_above_cents: num(body.cap_above_cents),
        cap_to_cents: num(body.cap_to_cents),
        apply_to_cases: body.apply_to_cases === true,
        enabled: body.enabled !== false,
      }) as PriceBand);
  if (proposed) {
    const denied = priceBandDenied(proposed);
    if (denied) {
      res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid price band." });
      return;
    }
  }

  const scope = await resolvePricingStore(req.scope, body.store);
  if ("reason" in scope) {
    res.status(422).json({ type: "invalid_data", reason: scope.reason, message: "Unknown store." });
    return;
  }
  const storeId = scope.storeId;
  const actorId = req.auth_context?.actor_id ?? null;

  try {
    if (dryRun) {
      // What the owner is about to do, before he does it. The scope is read
      // only so the panel can keep showing where the current band comes from.
      const { master, effective, origin, inherited } = await readScope(req, storeId);
      res.json({
        store: storeId,
        band: bandView(effective),
        origin,
        inherited,
        master: bandView(master),
        impact: await impactOf(req, proposed),
        saved: false,
      });
      return;
    }

    const { row, before } = storeId
      ? await setStorePriceBand(req.scope, storeId, proposed, actorId)
      : await setChainPriceBand(req.scope, proposed, actorId);
    await recordAudit(req.scope, {
      actorId,
      // `price.change` and not an action of its own: the band IS a price
      // change, and the owner's audit search for "price" has to find it.
      action: "price.change",
      entity: "price_band",
      entityId: storeId ?? "chain",
      establishmentId: storeId,
      before: priceBandAudit(before),
      after: priceBandAudit(row),
    });
    logger.info(
      `[pricing] price band @ ${storeId ?? "chain"} -> ${
        row
          ? `floor ${row.floor_below_cents ?? "-"}/${row.floor_to_cents ?? "-"} cap ${row.cap_above_cents ?? "-"}/${row.cap_to_cents ?? "-"}${row.enabled ? "" : " (off)"}`
          : storeId
            ? "inherits the chain"
            : "no band"
      } by ${actorId ?? "?"}`
    );

    // Read the scope back the way the panel reads it, so after removing a
    // variation the answer is the chain's band rather than nothing at all.
    const { master, effective, origin, inherited } = await readScope(req, storeId);
    // The sheet is a mirror, never a dependency: refreshed after the response
    // is already decided and never able to fail the write.
    void mirrorPricesToSheet(req.scope);
    res.json({
      store: storeId,
      band: bandView(effective),
      origin,
      inherited,
      master: bandView(master),
      impact: await impactOf(req, effective),
      saved: true,
    });
  } catch (error) {
    logger.error(`[pricing] price band save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the price band." });
  }
}
