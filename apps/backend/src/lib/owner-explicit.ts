import type { IUserModuleService, MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { configuredOwnerEmail } from "./staff-roles";
import { storedOwnerUserId } from "./store-settings";

/**
 * Is the owner named on purpose? True when a transfer from the panel
 * (store_setting.owner_user_id, which wins) or the deploy (STORE_OWNER_EMAIL)
 * names a user that exists; false while the owner is only "the oldest user"
 * (lib/staff-scope.ts ownerUserId). Shared by the Security tab and "Primeros
 * pasos" so both say the same. Never returns the email.
 */
export async function ownerExplicitCheck(container: MedusaContainer): Promise<{ ok: boolean; detail: "" | "no_user" | "unset" }> {
  const want = configuredOwnerEmail();
  let ok = false;
  try {
    const users = container.resolve<IUserModuleService>(Modules.USER);
    const named = await storedOwnerUserId(container).catch(() => null);
    if (named) ok = (await users.listUsers({ id: [named] }, { take: 1, select: ["id"] })).length > 0;
    if (!ok && want) {
      const all = await users.listUsers({}, { take: 1000, select: ["id", "email"] });
      ok = all.some((u) => String(u.email ?? "").trim().toLowerCase() === want);
    }
  } catch {
    ok = false;
  }
  return { ok, detail: ok ? "" : want ? "no_user" : "unset" };
}
