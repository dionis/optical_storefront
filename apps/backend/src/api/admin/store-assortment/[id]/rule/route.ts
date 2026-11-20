import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments } from "../../../../../lib/establishments";
import { loadProductMetadata } from "../../../../../lib/frame-specs";
import { assortmentRuleDenied, brandOf, type AssortmentScope } from "../../../../../lib/store-assortment";
import { setAssortmentRule } from "../../../../../lib/store-assortment-data";

/**
 * POST /admin/store-assortment/:id/rule { scope: "brand"|"product", target, exposed: true|false|null }
 *
 * Expone u oculta una marca entera (incluidos los modelos que entren después) o
 * un modelo suelto, que manda sobre su marca. `exposed: null` quita la regla y
 * vuelve a lo heredado. El modelo tiene que existir (reason `unknown_product`).
 */
interface Body {
  scope?: unknown;
  target?: unknown;
  exposed?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as Body;
  if (!(await listEstablishments(req.scope)).some((e) => e.id === id)) {
    res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
    return;
  }
  const exposed = body.exposed === undefined ? null : body.exposed;
  const denied = assortmentRuleDenied(body.scope, body.target, exposed);
  if (denied) {
    res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid assortment rule." });
    return;
  }
  const scope = body.scope as AssortmentScope;
  const target = scope === "brand" ? String(body.target).trim().toLowerCase() : String(body.target).trim();

  let brand: string | undefined;
  if (scope === "product") {
    const md = await loadProductMetadata(req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION), [target]);
    if (!md.has(target) && exposed !== null) {
      res.status(422).json({ type: "invalid_data", reason: "unknown_product", message: `No catalog product ${target}.` });
      return;
    }
    brand = brandOf(md.get(target));
  }

  const actorId = req.auth_context?.actor_id ?? null;
  await setAssortmentRule(req.scope, { establishmentId: id, scope, target, brand }, exposed as boolean | null, actorId);
  req.scope
    .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
    .info(`[store-assortment] ${id}: ${scope} ${target} -> ${exposed ?? "inherit"} by ${actorId ?? "?"}`);
  res.json({ ok: true });
}
