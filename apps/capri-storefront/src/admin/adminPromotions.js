// Promociones por tienda (/admin/store-promotions). Los errores viajan como claves
// adm.err.promo.<reason>; traduce quien pinta. Backend: lib/promotions.ts.
import { adminFetch } from "./adminApi.js";

const keyOf = (e, fallback) => {
  const r = (e && e.reason) || (e && e.payload && e.payload.reason);
  return r ? `adm.err.promo.${r}` : fallback;
};
const call = async (path, options) => {
  try {
    return await adminFetch(path, options);
  } catch (e) {
    throw new Error(keyOf(e, "adm.err.promo.saveFailed"));
  }
};

export const fetchPromotions = () => adminFetch("/admin/store-promotions");
export const createPromotion = (body) => call("/admin/store-promotions", { method: "POST", body });
export const updatePromotion = (id, body) => call(`/admin/store-promotions/${encodeURIComponent(id)}`, { method: "POST", body });
export const togglePromotion = (id, is_active) => call(`/admin/store-promotions/${encodeURIComponent(id)}`, { method: "POST", body: { is_active } });
export const deletePromotion = (id) => call(`/admin/store-promotions/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Lo que hace una promoción, en una línea (lista del panel, caja, recibo). `money(n)` formatea dólares. */
export function promoEffect(p, t, money) {
  if (p.kind === "percent") return t("adm.promo.eff.percent", { pct: p.pct });
  if (p.kind === "bogo") return p.pct >= 100 ? t("adm.promo.eff.bogoFree", { buy: p.buy_qty, get: p.get_qty }) : t("adm.promo.eff.bogoPct", { buy: p.buy_qty, get: p.get_qty, pct: p.pct });
  const v = p.value_cents != null ? p.value_cents / 100 : p.value;
  if (p.kind === "free_service") return v ? t("adm.promo.eff.serviceValue", { value: money(v) }) : t("adm.promo.eff.service");
  return v ? t("adm.promo.eff.giftValue", { value: money(v) }) : t("adm.promo.eff.gift");
}
