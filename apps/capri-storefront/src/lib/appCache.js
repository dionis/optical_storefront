// Caché de la app (pedido del dueño): todo lo que el cliente va haciendo —
// selecciones del asistente de lentes, datos del checkout, "¿para quién son?" —
// queda guardado en localStorage y se recupera al volver. Complementa lo que
// ya persistía por su cuenta: favoritos y carrito (CartContext), idioma,
// resultados de medición por producto (tryOnState), sesión de pedidos y mute.
// Nunca se guardan datos de pago. try/catch siempre: localStorage puede faltar.
export function loadCache(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
export function saveCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* lleno/privado */ }
}
export function clearCache(key) {
  try { localStorage.removeItem(key); } catch { /* nada */ }
}
