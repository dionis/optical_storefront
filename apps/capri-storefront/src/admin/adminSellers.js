// Dónde se usa: pestaña Vendedores de /admin — alta, edición, enlaces de
// referido y ventas por vendedor (backend: /admin/sellers*). Sin hook de idioma:
// devuelve datos o lanza AdminApiError con `reason` (el panel traduce).
import { adminFetch } from "./adminApi.js";

export const fetchSellers = () => adminFetch("/admin/sellers");
export const createSeller = (body) => adminFetch("/admin/sellers", { method: "POST", body });
export const updateSeller = (id, body) => adminFetch(`/admin/sellers/${encodeURIComponent(id)}`, { method: "PATCH", body });
export const deleteSeller = (id) => adminFetch(`/admin/sellers/${encodeURIComponent(id)}`, { method: "DELETE" });
export const rotateSellerLink = (id) => adminFetch(`/admin/sellers/${encodeURIComponent(id)}/rotate-link`, { method: "POST" });
export const fetchSellerStats = ({ from = "", to = "" } = {}) => adminFetch("/admin/sellers/stats", { query: { from, to } });

/** Enlaces para compartir el referido en cada red (el texto va en el idioma del panel). */
export function shareLinks(url, text) {
  const u = encodeURIComponent(url);
  const tx = encodeURIComponent(`${text} ${url}`);
  return {
    whatsapp: `https://wa.me/?text=${tx}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    telegram: `https://t.me/share/url?url=${u}&text=${encodeURIComponent(text)}`,
    x: `https://twitter.com/intent/tweet?text=${tx}`,
    mail: `mailto:?subject=${encodeURIComponent(text)}&body=${tx}`,
  };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
