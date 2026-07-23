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

// Customer identity = email + cell phone (needed to track orders, comment, etc.).
// Demo-open: any valid email + phone works. login/register behave the same.
export function login(email, phone) {
  const e = String(email || "").trim();
  const p = String(phone || "").trim();
  if (!/\S+@\S+\.\S+/.test(e)) return { ok: false, error: "Correo inválido" };
  if (p.replace(/\D/g, "").length < 7) return { ok: false, error: "Celular inválido" };
  try { localStorage.setItem(KEY, JSON.stringify({ email: e, phone: p, since: new Date().toISOString() })); } catch {}
  bump();
  return { ok: true };
}
export const register = login;

// merge extra profile fields (e.g. name) into the stored user
export function setProfile(patch) {
  const u = getUser(); if (!u) return;
  try { localStorage.setItem(KEY, JSON.stringify({ ...u, ...patch })); } catch {}
  bump();
}

export function logout() { try { localStorage.removeItem(KEY); } catch {} bump(); }

export function useUser() {
  const snap = useSyncExternalStore(subscribe, () => localStorage.getItem(KEY) || "", () => "");
  try { return snap ? JSON.parse(snap) : null; } catch { return null; }
}
