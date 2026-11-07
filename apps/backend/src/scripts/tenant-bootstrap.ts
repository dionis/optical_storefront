/**
 * Entrega de la tienda a su dueño (terminal de Coolify, tras el primer despliegue).
 *
 *   TENANT_OWNER_EMAIL=dueno@optica.com npx medusa exec ./src/scripts/tenant-bootstrap.js
 *       → solo informa (dry run)
 *   TENANT_OWNER_EMAIL=… TENANT_BOOTSTRAP_CONFIRM=yes npx medusa exec ./src/scripts/tenant-bootstrap.js
 *       → crea el usuario si no existe, lo nombra dueño y le manda el enlace de activación
 *
 * Opcionales: TENANT_OWNER_FIRST_NAME, TENANT_OWNER_LAST_NAME.
 * `pnpm tenant bootstrap <slug>` imprime esta línea con el correo de la ficha.
 * La lógica vive en src/lib/tenant-bootstrap.ts.
 */
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { bootstrapTenant, TenantBootstrapError } from "../lib/tenant-bootstrap";

export default async function run({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const email = process.env.TENANT_OWNER_EMAIL ?? "";
  try {
    const r = await bootstrapTenant(container, {
      email,
      firstName: process.env.TENANT_OWNER_FIRST_NAME,
      lastName: process.env.TENANT_OWNER_LAST_NAME,
      confirm: process.env.TENANT_BOOTSTRAP_CONFIRM === "yes",
    });
    logger.info(`[tenant-bootstrap] ${JSON.stringify(r)}`);
    if (r.dry_run) {
      logger.warn("[tenant-bootstrap] Dry run. Para ejecutar: TENANT_BOOTSTRAP_CONFIRM=yes con el mismo TENANT_OWNER_EMAIL.");
    } else {
      logger.info(`[tenant-bootstrap] Enlace de activación (correo: ${r.mail}): ${r.activation_link}`);
    }
  } catch (e) {
    if (e instanceof TenantBootstrapError) {
      const why: Record<TenantBootstrapError["reason"], string> = {
        bad_email: "TENANT_OWNER_EMAIL falta o no es un correo válido.",
        owner_already_set: "La tienda ya tiene otro dueño: solo ese dueño puede transferirla (Equipo → Propiedad del panel).",
        identity_exists: "Ese correo ya tiene una credencial sin usuario del panel; revísalo antes de repetir.",
      };
      logger.error(`[tenant-bootstrap] ${why[e.reason]}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}
