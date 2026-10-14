import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { issueToken, normalizeEmail, ORDER_ACCESS_TTL_MS } from "../../../../lib/order-access";
import { accountRateLimit } from "../rate-limit";

/**
 * POST /store/account/login — valida email + contraseña (módulo de auth de
 * Medusa) y emite el mismo token de sesión del seguimiento de pedidos, con lo
 * que /my-orders (pedidos + espejuelos configurados + receta) queda abierto
 * para ese correo. Ver register/route.ts para el porqué del diseño.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!accountRateLimit(req, res)) return;
  const body = (req.body ?? {}) as { email?: string; password?: string };
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");

  if (!email || !password) {
    res.status(422).json({ type: "invalid_data", reason: "missing_credentials", message: "Email and password are required." });
    return;
  }

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const result = await auth.authenticate("emailpass", { body: { email, password } });
  if (!result.success) {
    // Mensaje único para "no existe" y "contraseña incorrecta".
    res.status(401).json({ type: "unauthorized", reason: "bad_credentials", message: "Invalid email or password." });
    return;
  }

  res.status(200).json({
    token: issueToken(email, "session"),
    email,
    expires_in: ORDER_ACCESS_TTL_MS.session,
  });
}
