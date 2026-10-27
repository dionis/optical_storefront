import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../../lib/establishments";
import { minimumDenied } from "../../../../../lib/store-pricing";
import { productPrices, replaceRule } from "../../../../../lib/store-pricing-data";

/**
 * POST /admin/store-pricing/:id/minimum { scope: "all"|"frame"|"case", target?, value | null }
 *
 * Precio mínimo (HU-16), en una tienda o, con `:id = global`, en todas:
 *  - scope "all": ningún renglón de una venta baja de ese % de su precio de lista;
 *  - scope "frame"/"case" + producto: la montura de ese modelo no baja de ese importe.
 * Un descuento que lo rompa necesita la aprobación del dueño o un superadmin.
 * `value: null` lo quita. Solo dueño y superadmin (guardia de /admin).
 */
interface Body {
  scope?: string;
  target?: unknown;
  value?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  const establishmentId = id === "global" ? null : id;
  if (establishmentId && !(await listEstablishments(req.scope)).some((e) => e.id === establishmentId)) {
    res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
    return;
  }
  const body = (req.body ?? {}) as Body;
  const scope = String(body.scope ?? "");
  const value = body.value === null || body.value === undefined || body.value === "" ? null : body.value;
  const denied = minimumDenied(scope, body.target, value);
  if (denied) {
    res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid minimum price." });
    return;
  }
  const target = scope === "all" ? null : String(body.target).trim();
  if (target && value !== null && !(await productPrices(req.scope, [target])).length) {
    res.status(422).json({ type: "invalid_data", reason: "unknown_product", message: `No catalog product ${target}.` });
    return;
  }
  await replaceRule(
    req.scope,
    { establishmentId, scope: scope as "all" | "frame" | "case", target, family: "minimum" },
    value === null ? null : { mode: "min", value: Math.round(Number(value) * 100) / 100, source: "panel" },
    req.auth_context?.actor_id ?? null
  );
  res.json({ ok: true });
}
