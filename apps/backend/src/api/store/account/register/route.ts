import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService, ICustomerModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { issueToken, normalizeEmail, ORDER_ACCESS_TTL_MS } from "../../../../lib/order-access";
import { accountRateLimit } from "../rate-limit";

/**
 * POST /store/account/register — cuenta de cliente con email + CONTRASEÑA.
 *
 * La identidad del seguimiento de pedidos sigue siendo "control probado del
 * correo" (ver lib/order-access.ts). Una cuenta con contraseña es OTRA forma
 * de probar ese control: las credenciales viven en el módulo de auth de
 * Medusa (provider emailpass, hash scrypt) y, al validarlas, se emite el
 * MISMO token de sesión que canjea el enlace mágico. Así /my-orders muestra
 * TODOS los pedidos de ese correo — también los hechos como invitado antes de
 * crear la cuenta — sin migraciones ni un segundo sistema de sesión.
 *
 * ¿Contraseña olvidada? El enlace mágico de siempre ES la recuperación: entra
 * por correo y listo. (Cambio de contraseña autogestionado: pendiente, ver
 * auditoría/plan.)
 */
interface Body {
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!accountRateLimit(req, res)) return;
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(422).json({ type: "invalid_data", reason: "bad_email", message: "A valid email is required." });
    return;
  }
  if (password.length < 8) {
    res.status(422).json({ type: "invalid_data", reason: "weak_password", message: "Password must be at least 8 characters." });
    return;
  }

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const registered = await auth.register("emailpass", { body: { email, password } });
  if (!registered.success || !registered.authIdentity) {
    // Correo ya registrado (u otro rechazo del provider). Mensaje único: no
    // confirmamos a terceros qué correos tienen cuenta.
    res.status(409).json({ type: "not_allowed", reason: "cannot_register", message: "Could not create the account with that email." });
    return;
  }

  // Ficha de cliente en Medusa (si no existía) y vínculo con la identidad.
  try {
    const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
    const existing = await customers.listCustomers({ email }, { take: 1 });
    const customer = existing[0] ?? (await customers.createCustomers({
      email,
      first_name: String(body.first_name ?? "").trim().slice(0, 80) || undefined,
      last_name: String(body.last_name ?? "").trim().slice(0, 80) || undefined,
      phone: String(body.phone ?? "").trim().slice(0, 32) || undefined,
      has_account: true,
    }));
    await auth.updateAuthIdentities([
      { id: registered.authIdentity.id, app_metadata: { customer_id: customer.id } },
    ]);
  } catch (error) {
    // La cuenta de acceso ya existe y funciona; la ficha es enriquecimiento.
    logger.warn(`[account] customer record for ${email} failed: ${(error as Error).message}`);
  }

  res.status(200).json({
    token: issueToken(email, "session"),
    email,
    expires_in: ORDER_ACCESS_TTL_MS.session,
  });
}
