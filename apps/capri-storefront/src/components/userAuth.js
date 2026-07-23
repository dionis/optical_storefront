// Customer authentication for the storefront (the "Acceso" button in the header).
// Demo-open gate: accepts ANY valid email + any password and remembers the session
// in localStorage. For production/SaaS, point this at a real auth endpoint (backend).
import { useSyncExternalStore } from "react";

const KEY = "oer_user";
const subs = new Set();
export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
function bump() { for (const f of subs) f(); }

export function getUser() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

// login and register behave the same here (any email + any password works)
export function login(email, pass) {
  const e = String(email || "").trim();
  if (!/\S+@\S+\.\S+/.test(e)) return { ok: false, error: "Introduce un correo válido" };
  if (String(pass || "").length < 1) return { ok: false, error: "Introduce una contraseña" };
  try { localStorage.setItem(KEY, JSON.stringify({ email: e, since: new Date().toISOString() })); } catch {}
  bump();
  return { ok: true };
}
export const register = login;

export function logout() { try { localStorage.removeItem(KEY); } catch {} bump(); }

export function useUser() {
  const snap = useSyncExternalStore(subscribe, () => localStorage.getItem(KEY) || "", () => "");
  try { return snap ? JSON.parse(snap) : null; } catch { return null; }
}
