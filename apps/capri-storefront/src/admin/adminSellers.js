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

/**
 * Los enlaces del vendedor (referido, redes, panel) apuntan a la tienda desde
 * la que se abre esta página, no al STOREFRONT_URL del backend: un backend sin
 * esa variable (staging) los devuelve con http://localhost:5198. Se conserva la
 * ruta y la consulta (?ref=, ?t=), que es lo que firma y atribuye el servidor.
 */
export function onThisOrigin(seller) {
  if (!seller || typeof window === "undefined") return seller;
  const fix = (url) => {
    try { const u = new URL(url); return `${window.location.origin}${u.pathname}${u.search}${u.hash}`; } catch { return url; }
  };
  const social = seller.social_links ? Object.fromEntries(Object.entries(seller.social_links).map(([k, v]) => [k, fix(v)])) : seller.social_links;
  return {
    ...seller,
    ...(seller.referral_url ? { referral_url: fix(seller.referral_url) } : {}),
    ...(seller.dashboard_url ? { dashboard_url: fix(seller.dashboard_url) } : {}),
    social_links: social,
  };
}

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
