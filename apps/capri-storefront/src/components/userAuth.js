// Cuentas de cliente REALES (email + contraseña) contra el backend:
// POST /store/account/register | /store/account/login (credenciales en el
// módulo de auth de Medusa). Al validar, el backend emite el MISMO token de
// sesión del seguimiento de pedidos, así que "Mi cuenta" y /my-orders muestran
// todos los pedidos de ese correo — también los hechos como invitado.
//
// ¿Contraseña olvidada? El enlace mágico de /my-orders ES la recuperación.
import { useSyncExternalStore } from "react";
import { medusa, USE_MEDUSA } from "../data/medusa.js";
import { adoptSession, clearSession } from "../data/orderAccess.js";

const KEY = "oer_user";
const subs = new Set();
export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
function bump() { for (const f of subs) f(); }

export function getUser() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

function saveUser(user) {
  try { localStorage.setItem(KEY, JSON.stringify(user)); } catch { /* privado */ }
  bump();
}

async function callAccount(path, body) {
  // medusa.client.fetch añade la clave publicable y la base /medusa.
  return medusa.client.fetch(`/store/account/${path}`, { method: "POST", body });
}

/** Devuelve claves de diccionario en error — este módulo no tiene idioma. */
export async function login(email, password) {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: "auth.err.email" };
  if (!password) return { ok: false, error: "auth.err.pass" };
  if (!USE_MEDUSA) return { ok: false, error: "auth.err.offline" };
  try {
    const r = await callAccount("login", { email: e, password });
    adoptSession(r);
    saveUser({ email: e, since: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    const status = err && (err.status || err.statusCode);
    if (status === 429) return { ok: false, error: "auth.err.tooMany" };
    if (status === 401) return { ok: false, error: "auth.err.badCreds" };
    return { ok: false, error: "auth.err.generic" };
  }
}

export async function register(email, password, { firstName = "", lastName = "", phone = "" } = {}) {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: "auth.err.email" };
  if (String(password || "").length < 8) return { ok: false, error: "auth.err.passShort" };
  if (!USE_MEDUSA) return { ok: false, error: "auth.err.offline" };
  try {
    const r = await callAccount("register", {
      email: e, password, first_name: firstName, last_name: lastName, phone,
    });
    adoptSession(r);
    saveUser({ email: e, name: [firstName, lastName].filter(Boolean).join(" ") || null, phone: phone || null, since: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    const status = err && (err.status || err.statusCode);
    if (status === 429) return { ok: false, error: "auth.err.tooMany" };
    if (status === 409) return { ok: false, error: "auth.err.exists" };
    return { ok: false, error: "auth.err.generic" };
  }
}

// merge extra profile fields (e.g. name) into the stored user
export function setProfile(patch) {
  const u = getUser(); if (!u) return;
  saveUser({ ...u, ...patch });
}

export function logout() {
  try { localStorage.removeItem(KEY); } catch { /* nada */ }
  // La sesión de pedidos nace del mismo login: cerrar una sin la otra dejaría
  // los pedidos del cliente visibles en un equipo compartido.
  try { clearSession(); } catch { /* nada */ }
  bump();
}

export function useUser() {
  const snap = useSyncExternalStore(subscribe, () => localStorage.getItem(KEY) || "", () => "");
  try { return snap ? JSON.parse(snap) : null; } catch { return null; }
}
