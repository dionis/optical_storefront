import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../lib/audit";
import { tenant } from "../../../../lib/tenant";
import { cleanBrandInput, publicBrand } from "../../../../lib/tenant-brand";
import { requireTenantAdmin } from "../../../../lib/tenant-guard";
import { readTenantProfile, saveTenantProfile } from "../../../../lib/tenant-profile";

/**
 * Marca de la óptica desde el panel (docs/MULTI-TENANT-TECNICO.md §7.5).
 *
 *   GET  /admin/tenant/brand — la guardada, la anterior y los colores de correo
 *        del despliegue.
 *   POST /admin/tenant/brand — { primary, accent, logo_url?, logo_mark_url? };
 *        la actual pasa a ser la anterior. 409 `low_contrast` con `ratio` si el
 *        texto blanco no alcanza 4.5:1; 422 con `reason` y `field` para el resto.
 *        `{ reset: true }` vuelve a la marca del despliegue.
 *
 * Errores: adm.err.brand.<reason> en el panel.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await requireTenantAdmin(req, res))) return;
  const profile = await readTenantProfile(req.scope, { fresh: true });
  res.setHeader("Cache-Control", "no-store");
  res.json({
    brand: publicBrand(profile.brand),
    previous: profile.brand_previous,
    deployment: { email_primary: tenant().brand.emailPrimary, email_accent: tenant().brand.emailAccent },
    can_publish: Boolean(process.env.VERCEL_DEPLOY_HOOK_URL?.trim()),
  });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const actorId = await requireTenantAdmin(req, res);
  if (!actorId) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const before = await readTenantProfile(req.scope, { fresh: true });

  let next = null;
  if (body.reset !== true) {
    const cleaned = cleanBrandInput(body);
    if (!cleaned.ok) {
      const status = cleaned.reason === "low_contrast" ? 409 : 422;
      res.status(status).json({
        type: "invalid_data",
        reason: cleaned.reason,
        field: cleaned.field,
        ratio: cleaned.ratio ?? null,
        message: `Invalid brand ${cleaned.field}: ${cleaned.reason}`,
      });
      return;
    }
    next = { ...cleaned.brand, updated_at: new Date().toISOString() };
  }

  try {
    const profile = await saveTenantProfile(req.scope, { brand: next, brand_previous: before.brand }, actorId);
    await recordAudit(req.scope, {
      actorId,
      action: "tenant.brand",
      entity: "tenant_profile",
      entityId: "default",
      before: { brand: before.brand },
      after: { brand: next },
    });
    res.json({ brand: publicBrand(profile.brand), previous: profile.brand_previous });
  } catch (e) {
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[tenant-brand] save failed: ${(e as Error).stack ?? e}`);
    res.status(500).json({ type: "unexpected_state", reason: "save_failed", message: "The brand could not be saved." });
  }
}
