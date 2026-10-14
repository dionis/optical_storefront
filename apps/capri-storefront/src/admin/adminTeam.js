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

export async function createAdmin({ email, password, firstName = "", lastName = "" }) {
  try {
    return await adminFetch("/admin/team", {
      method: "POST",
      body: { email, password, first_name: firstName, last_name: lastName },
    });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.team.createFailed"));
  }
}

export async function deleteAdmin(id) {
  try {
    return await adminFetch(`/admin/team/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.team.deleteFailed"));
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
