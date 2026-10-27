import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { planOwnerPriceImport, type OwnerPriceList } from "../../../../lib/price-import";
import { recordAudit } from "../../../../lib/audit";
import { applyImportPlan, loadImportContext } from "../../../../lib/price-import-data";

/**
 * POST /admin/store-pricing/import { prices: <JSON de la pestaña Precios>, apply?: boolean }
 *
 * Convierte la lista de precios del dueño (que hasta ahora solo vivía en su
 * navegador) en precio base de la web y de todas las tiendas — decisión del
 * dueño. Sin `apply` solo devuelve el plan: qué modelos y celdas de lentes
 * cambiarían y qué claves no se pudieron emparejar, para revisarlo antes. Con
 * `apply: true` lo aplica (lib/price-import-data.ts).
 *
 * Solo dueño y superadmin (guardia de /admin). Errores con `reason`.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<{ prices?: unknown; apply?: boolean }>,
  res: MedusaResponse
): Promise<void> {
  const body = (req.body ?? {}) as { prices?: unknown; apply?: boolean };
  const prices = body.prices;
  if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
    res.status(422).json({ type: "invalid_data", reason: "bad_price_list", message: "prices must be the exported price-list object." });
    return;
  }

  const { catalog, known } = await loadImportContext(req.scope);
  const plan = planOwnerPriceImport(prices as OwnerPriceList, catalog, known);

  if (body.apply !== true) {
    res.json({ applied: false, plan });
    return;
  }

  const actorId = req.auth_context?.actor_id ?? null;
  const result = await applyImportPlan(req.scope, plan, actorId);
  await recordAudit(req.scope, {
    actorId,
    action: "price.import",
    entity: "price_list",
    after: { products: result.products, variants: result.variants, lens_cells: result.lens_cells },
  });
  req.scope
    .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
    .info(
      `[price-import] by ${actorId ?? "?"}: ${result.products} model prices (${result.variants} variants), ` +
        `${result.lens_cells} lens cells; ${plan.skipped.length} keys skipped`
    );
  res.json({ applied: true, plan, result });
}
