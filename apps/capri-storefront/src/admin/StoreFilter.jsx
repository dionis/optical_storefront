// Dónde se usa: todas las pantallas con datos por tienda (Ejecutivo, Ventas de
// tienda, Caja, Estado de cuenta, Pedidos de tienda, Aprobaciones, Auditoría…).
// UN solo selector de tienda para todo el panel: el dueño elige «Todas las
// tiendas», «Tienda online» o una tienda, la elección se guarda
// (adm_active_store, la misma que colorea la barra) y cada pantalla la lee con
// `useStoreFilter(me)`. Quien no es administrador solo ve las suyas; si tiene
// una sola, el selector es una etiqueta.
//
//   const { storeId, store, stores, setStoreId, param } = useStoreFilter(me);
//   <StoreFilter me={me} />                 // en la barra de filtros
//   fetch(`/admin/…?${param("establishment_id")}`)  // "" | "establishment_id=<id>" | "establishment_id=web"
import { useCallback, useMemo } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { WEB_STORE, defaultColorForStore, setActiveStore, useStoreTheme } from "./useStoreTheme.js";

export const ALL_STORES = "all";

/** Lo que una pantalla necesita para filtrar por la tienda activa del panel. */
export function useStoreFilter(me) {
  const { store, stores } = useStoreTheme(me);
  const isAdmin = !me || me.is_admin !== false;
  const storeId = store ? store.id : ALL_STORES;
  const setStoreId = useCallback((id) => setActiveStore(!id || id === ALL_STORES ? null : id), []);
  // Nombre del parámetro según la ruta: `establishment_id` (caja, estado de cuenta), `store` (POS, auditoría), `stores` (analítica).
  const param = useCallback((name = "establishment_id") => (storeId === ALL_STORES ? "" : `${name}=${encodeURIComponent(storeId)}`), [storeId]);
  const options = useMemo(() => {
    const list = stores.map((s) => ({ id: s.id, code: s.code, name: s.name, color: s.color || defaultColorForStore(s.name) }));
    return isAdmin ? [{ id: ALL_STORES, code: "", name: "", color: null }, { id: WEB_STORE.id, code: WEB_STORE.code, name: "", color: WEB_STORE.color, online: true }, ...list] : list;
  }, [stores, isAdmin]);
  return { storeId, store, stores, options, setStoreId, param, isAdmin, isAll: storeId === ALL_STORES, isWeb: storeId === WEB_STORE.id };
}

export default function StoreFilter({ me, compact = false, className = "", allowAll = true }) {
  const { t } = useLang();
  const { storeId, options, setStoreId, isAdmin } = useStoreFilter(me);
  const visible = allowAll ? options : options.filter((o) => o.id !== ALL_STORES);
  const current = visible.find((o) => o.id === storeId) || visible[0];
  const label = (o) => (o.id === ALL_STORES ? t("adm.theme.allStores") : o.online ? t("adm.theme.online") : `${o.code ? `${o.code} · ` : ""}${o.name}`);
  if (!visible.length) return null;
  if (!isAdmin && visible.length === 1) {
    return <span className={`adm-store-filter static ${className}`} title={t("adm.theme.current")}><i className="dot" style={{ background: current?.color || "var(--adm-muted)" }} />{label(current)}</span>;
  }
  return (
    <label className={`adm-store-filter ${compact ? "compact" : ""} ${className}`} title={t("adm.theme.current")}>
      <i className="dot" style={{ background: current?.color || "var(--adm-muted)" }} />
      {!compact && <Icon name="store" size={14} />}
      <select value={current?.id || ALL_STORES} onChange={(e) => setStoreId(e.target.value)} aria-label={t("adm.theme.current")}>
        {visible.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
      </select>
    </label>
  );
}
