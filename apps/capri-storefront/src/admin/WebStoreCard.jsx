// Dónde se usa: Tiendas → encima de la lista de tiendas.
// La tienda online se lleva en este mismo panel (docs/TIENDA-ONLINE-UNIFICADA.md):
// sus pedidos, costos, etapas y resultado. Cuando una tienda de la lista es de
// tipo «Tienda online» (`stores`), la web ES esa tienda: la tarjeta lleva su
// código y su color, y dice que sus precios y costos son los de su columna.
// Sin ninguna, la web vende a los precios del maestro y la tarjeta lo avisa. La tarjeta
// dice en qué dominios vende, con qué marca, cuándo llegó su último pedido y
// lleva a sus pedidos, sus ventas y la comprobación de la conexión.
// Datos: GET /admin/web-channel (solo dueño y superadmin; sin dinero ni pacientes).
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminGet } from "./adminApi.js";
import { ONLINE_STORE_COLOR, storeInk } from "./adminStores.js";
import { onlineStoreOf, setActiveStore, WEB_STORE } from "./useStoreTheme.js";
import { shortDate } from "./adminOrders.js";

export default function WebStoreCard({ go = null, demo = false, stores = [] }) {
  const { t, lang } = useLang();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    // Sin permiso o con un backend anterior no hay tarjeta: la pantalla sigue igual.
    adminGet("/admin/web-channel").then((r) => on && setData(r)).catch(() => on && setData(null));
    return () => { on = false; };
  }, [demo]);
  if (!data) return null;

  const brands = [...new Set(data.storefronts.map((s) => s.name).filter(Boolean))];
  const open = (tab) => { setActiveStore(WEB_STORE.id); go?.(tab); };
  const last = data.last_order;
  // La tienda con la que el dueño maneja la web (tipo «Tienda online»), si la hay.
  const online = onlineStoreOf(stores);
  const color = online?.color || ONLINE_STORE_COLOR;
  return (
    <div className="adm-card web-store">
      <h3><Icon name="globe" size={16} />{t("adm.web.title")}</h3>
      <div className="adm-team-row web-store-row">
        <span className="adm-team-avatar adm-store-code" style={{ background: color, color: storeInk(color) }}>{online?.code || WEB_STORE.code}</span>
        <span className="adm-team-main adm-store-info">
          <b>{[online ? online.name : t("adm.theme.online"), ...brands.filter((b) => !online || b !== online.name)].join(" · ")}</b>
          <span className="adm-store-facts">
            {data.storefronts.map((s) => (
              <a key={s.url} className="adm-store-fact web-store-link" href={s.url} target="_blank" rel="noreferrer" title={s.name || t("adm.web.sameBrand")}>
                <Icon name="globe" size={12} />{s.host}
              </a>
            ))}
            <span className="adm-store-fact" title={t("adm.web.orders30dTitle")}><Icon name="orders" size={12} />{data.orders_30d === null ? "—" : t("adm.web.orders30d", { n: data.orders_30d })}</span>
            <span className="adm-store-fact" title={t("adm.web.lastTitle")}>
              <Icon name="calendar" size={12} />
              {last ? t("adm.web.last", { order: `#${last.display_id}`, date: shortDate(last.created_at, lang) }) : t("adm.web.lastNone")}
            </span>
          </span>
        </span>
        {go && (
          <span className="web-store-actions">
            <button type="button" className="btn-sm" onClick={() => open("orders")}><Icon name="orders" size={14} />{t("adm.web.seeOrders")}</button>
            <button type="button" className="btn-sm" onClick={() => open("exec")}><Icon name="sales" size={14} />{t("adm.web.seeSales")}</button>
            {online && <button type="button" className="btn-sm" onClick={() => open("products")}><Icon name="prices" size={14} />{t("adm.web.seePrices")}</button>}
            <button type="button" className="btn-sm" onClick={() => go("security")}><Icon name="security" size={14} />{t("adm.web.check")}</button>
          </span>
        )}
      </div>
      <p className="adm-sub web-store-note">{online ? t("adm.web.noteStore", { code: online.code, name: online.name }) : t("adm.web.note")}</p>
      {!online && <p className="adm-sub web-store-note web-store-hint"><Icon name="info" size={13} />{t("adm.web.noStore")}</p>}
    </div>
  );
}
