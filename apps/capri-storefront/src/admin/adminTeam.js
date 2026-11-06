// Equipo de administradores del panel (API real /admin/team). Módulo sin hook
// de idioma: los errores viajan como CLAVES adm.err.team.* y traduce quien pinta.
import { adminFetch } from "./adminApi.js";

const reasonKey = (e, fallback) => {
  const r = (e && e.reason) || (e && e.payload && e.payload.reason);
  return r ? `adm.err.team.${r}` : fallback;
};

export async function fetchTeam() {
  return adminFetch("/admin/team");
}

export async function fetchMe() {
  return adminFetch("/admin/team/me");
}

// Roles que se pueden asignar desde el panel, de más a menos permisos. "owner"
// no está: el dueño lo decide el backend (el nombrado en un traspaso o, si no
// hay ninguno, el usuario más antiguo) y solo cambia con transferOwnership.
export const ASSIGNABLE_ROLES = ["superadmin", "supervisor", "manager", "seller"];

/** Clave de traducción del rol; null = sin acceso. */
export const roleKey = (role) => `adm.team.role.${role || "none"}`;

/** `seller`: obligatorio con rol vendedor — { seller_id } o { create: { establishment_id, terminal_id, commission_pct, code } }. */
export async function createAdmin({ email, password, firstName = "", lastName = "", role = "superadmin", seller }) {
  try {
    return await adminFetch("/admin/team", {
      method: "POST",
      body: { email, password, first_name: firstName, last_name: lastName, role, ...(seller ? { seller } : {}) },
    });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.team.createFailed"));
  }
}

/** Tiendas de una persona; [] = todas. Solo para roles que no son admin. */
export async function setStores(id, establishmentIds) {
  try {
    return await adminFetch(`/admin/team/${encodeURIComponent(id)}/stores`, {
      method: "POST",
      body: { establishment_ids: establishmentIds },
    });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.team.storesFailed"));
  }
}

/** Pasar a vendedor (o cambiar de ficha) lleva `seller`, igual que createAdmin. */
export async function setRole(id, role, seller) {
  try {
    return await adminFetch(`/admin/team/${encodeURIComponent(id)}/role`, {
      method: "POST",
      body: { role, ...(seller ? { seller } : {}) },
    });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.team.roleFailed"));
  }
}

export async function deleteAdmin(id) {
  try {
    return await adminFetch(`/admin/team/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.team.deleteFailed"));
  }
}

/**
 * Desactivar (active=false) o reactivar a una persona sin borrarla: conserva
 * usuario, rol e historial; sus sesiones abiertas dejan de servir en la siguiente
 * petición. Mismos vetos y códigos que deleteAdmin (super_admin, self, owner_only).
 */
export async function setActive(id, active) {
  try {
    return await adminFetch(`/admin/team/${encodeURIComponent(id)}/status`, {
      method: "POST",
      body: { active: Boolean(active) },
    });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.team.statusFailed"));
  }
}

/** Solo el dueño: entrega la propiedad del panel a `userId`, confirmando con su contraseña. */
export async function transferOwnership(userId, password) {
  try {
    return await adminFetch("/admin/tenant/transfer-owner", { method: "POST", body: { user_id: userId, password } });
  } catch (e) {
    const r = (e && e.reason) || (e && e.payload && e.payload.reason);
    throw new Error(r ? `adm.err.owner.${r}` : "adm.err.owner.transfer_failed");
  }
}

export async function changeOwnPassword({ currentPassword, newPassword }) {
  try {
    return await adminFetch("/admin/team/password", {
      method: "POST",
      body: { current_password: currentPassword, new_password: newPassword },
    });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.team.passwordFailed"));
  }
}

/** Dueño o superadmin: contraseña temporal para otra persona, que deberá cambiarla al entrar. */
export async function resetPassword(id, newPassword) {
  try {
    return await adminFetch(`/admin/team/${encodeURIComponent(id)}/password`, {
      method: "POST",
      body: { new_password: newPassword },
    });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.team.passwordFailed"));
  }
}

// ── Perfil del vendedor ─────────────────────────────────────────────────────
// Errores como claves adm.err.profile.<reason>; el campo culpable viaja aparte.
const profileErr = (e, fallback) => {
  const r = (e && e.reason) || (e && e.payload && e.payload.reason);
  const err = new Error(r ? `adm.err.profile.${r}` : fallback);
  err.field = (e && e.payload && e.payload.field) || null;
  err.reason = r || null;
  err.other = (e && e.payload && e.payload.other) ?? null;
  return err;
};

/** Privilegios que el dueño concede persona a persona (aprobar descuentos no se delega). */
export const PRIVILEGES = ["costs.manage", "costs.view", "payments.manage", "sale.void", "catalog.edit"];

export async function fetchProfile(id) {
  return adminFetch(`/admin/team/${encodeURIComponent(id)}/profile`);
}

export async function saveProfile(id, patch) {
  try {
    return await adminFetch(`/admin/team/${encodeURIComponent(id)}/profile`, { method: "POST", body: patch });
  } catch (e) {
    throw profileErr(e, "adm.err.profile.saveFailed");
  }
}

export async function fetchMyProfile() {
  return adminFetch("/admin/team/me/profile");
}

export async function saveMyProfile(patch) {
  try {
    return await adminFetch("/admin/team/me/profile", { method: "POST", body: patch });
  } catch (e) {
    throw profileErr(e, "adm.err.profile.saveFailed");
  }
}
