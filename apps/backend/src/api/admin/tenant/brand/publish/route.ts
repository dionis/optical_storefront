import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../../lib/audit";
import { requireTenantAdmin } from "../../../../../lib/tenant-guard";

/**
 * POST /admin/tenant/brand/publish — «Publicar marca»: llama al deploy hook de
 * Vercel de esta óptica (VERCEL_DEPLOY_HOOK_URL, solo en Coolify) para recompilar
 * la tienda. Los colores ya se ven sin esto; lo que solo cambia al recompilar es
 * el color de la barra del navegador y el primer pintado de quien nunca ha
 * visitado la tienda (el build pide la marca a GET /store/tenant).
 * 409 `no_deploy_hook` si no está configurado.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const actorId = await requireTenantAdmin(req, res);
  if (!actorId) return;
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL?.trim();
  if (!hook) {
    res.status(409).json({ type: "not_allowed", reason: "no_deploy_hook", message: "VERCEL_DEPLOY_HOOK_URL is not set." });
    return;
  }
  try {
    const r = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await recordAudit(req.scope, { actorId, action: "tenant.brand", entity: "tenant_profile", entityId: "default", after: { published: true } });
    res.json({ ok: true });
  } catch (e) {
    // Never log the hook URL: it is a credential.
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[tenant-brand] deploy hook failed: ${(e as Error).message}`);
    res.status(502).json({ type: "unexpected_state", reason: "hook_failed", message: "The storefront rebuild could not be started." });
  }
}
