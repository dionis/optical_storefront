import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { resolveStoreSettings } from "../../../lib/store-settings";
import { publicTenantProfile, readTenantProfile } from "../../../lib/tenant-profile";

/**
 * GET /store/tenant — la identidad pública de la óptica para la tienda:
 * nombre, contacto, redes y recogida en tienda (si está activa). Nunca dice
 * quién es el dueño ni nada del panel. Cacheable cinco minutos.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const [profile, settings] = await Promise.all([readTenantProfile(req.scope), resolveStoreSettings(req.scope)]);
  const body = publicTenantProfile(profile);
  res.setHeader("Cache-Control", "public, max-age=300");
  // El correo de soporte lo edita el dueño en Ajustes (store_setting); manda sobre la variable.
  res.json({ tenant: { ...body, support_email: settings.support_email ?? body.support_email } });
}
