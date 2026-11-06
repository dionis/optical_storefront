import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { loadPricingOverview, resolvePricingStore } from "../../../../../lib/pricing-overview";
import { adjustmentDenied, brandRuleDenied } from "../../../../../lib/store-pricing";
import { replaceRule } from "../../../../../lib/store-pricing-data";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";

/**
 * POST /admin/pricing/frames/rule
 *   { scope: "frame" | "case" | "all" | "brand", brand?, mode: "none"|"percent"|"delta", value, store? }
 *
 * THE rule the owner asked for: "I set a RULE that applies to ALL frames".
 * `scope` "frame" covers every frame, "case" every case (estuche), "all" both
 * (and, for compatibility, the lens add-on too — that is the older general
 * adjustment), and "brand" only the frames of ONE brand (`brand` = the slug the
 * scraper writes, so models added later inherit it). `mode: "none"` removes it.
 * No `store` = the master every store inherits; a `store` = that store's own
 * rule, which is what makes "una regla por marca y por establecimiento".
 *
 * Reuses `replaceRule`, so the change closes the open rule and opens a new one:
 * the table is the history and the audit log has the before and after.
 * Answers the updated `frames` slice so the panel never re-reads the whole
 * payload after a write.
 */
interface Body {
  scope?: string;
  /** Only with scope "brand": the brand slug the rule applies to. */
  brand?: unknown;
  mode?: string;
  value?: unknown;
  store?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const scope = String(body.scope ?? "frame");
  const mode = String(body.mode ?? "");

  if (scope !== "frame" && scope !== "case" && scope !== "all" && scope !== "brand") {
    res.status(422).json({ type: "invalid_data", reason: "bad_scope", message: "Scope must be frame, case, all or brand." });
    return;
  }
  // Slug de la marca, normalizado como lo escribe el scraper (minúsculas).
  const brand = scope === "brand" ? String(body.brand ?? "").trim().toLowerCase().slice(0, 120) : null;
  if (scope === "brand" && !brand) {
    res.status(422).json({ type: "invalid_data", reason: "bad_brand", message: "A brand rule needs the brand." });
    return;
  }
  const denied = scope === "brand" ? brandRuleDenied(mode, body.value) : adjustmentDenied(mode, body.value);
  if (denied) {
    res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid rule." });
    return;
  }
  const store = await resolvePricingStore(req.scope, body.store);
  if ("reason" in store) {
    res.status(404).json({ type: "not_found", reason: store.reason, message: "Store not found." });
    return;
  }

  const actorId = req.auth_context?.actor_id ?? null;
  try {
    await replaceRule(
      req.scope,
      { establishmentId: store.storeId, scope, target: brand, family: scope === "brand" ? "brand" : "adjustment" },
      mode === "none" ? null : { mode: mode as "percent" | "delta" | "override", value: Number(body.value), source: "pricing-panel" },
      actorId
    );
    const overview = await loadPricingOverview(req.scope, store.storeId);
    logger.info(`[pricing] rule ${scope}${brand ? `:${brand}` : ""} ${mode} on ${store.storeId ?? "master"} by ${actorId ?? "?"}`);
    // The sheet is a mirror, never a dependency: it is refreshed after the
    // response is already decided and can never fail the write.
    void mirrorPricesToSheet(req.scope);
    res.json({ frames: overview.frames });
  } catch (error) {
    logger.error(`[pricing] rule save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the rule." });
  }
}
