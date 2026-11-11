// Dónde se usa: todas las pantallas con datos por tienda (Ejecutivo, Ventas de
// tienda, Caja, Estado de cuenta, Pedidos de tienda, Aprobaciones, Auditoría…).
// UN solo selector de tienda para todo el panel: el dueño elige «Todas las
// tiendas», «Tienda online» o una tienda, la elección se guarda
// (adm_active_store, la misma que colorea la barra) y cada pantalla la lee con
// `useStoreFilter(me)`. Quien no es administrador solo ve las suyas; si tiene
// una sola, el selector es una etiqueta.
//
// El selector es un listbox propio (no un <select> nativo: sus opciones salían
// blancas sobre blanco en modo oscuro y no admiten el punto de color): píldora
// con punto + nombre + chevrón, lista flotante con buscador a partir de siete
// opciones, flechas / Enter / Escape, cierre al pulsar fuera y marca en la
// elegida. Elegir llama a `setActiveStore` → evento `adm:active-store`, y todo
// `useStoreFilter` del panel se vuelve a renderizar con el nuevo `storeId`.
//
//   const { storeId, store, stores, setStoreId, param } = useStoreFilter(me);
//   <StoreFilter me={me} />                 // en la barra de filtros
//   fetch(`/admin/…?${param("establishment_id")}`)  // "" | "establishment_id=<id>" | "establishment_id=web"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { WEB_STORE, defaultColorForStore, onlineStoreOf, setActiveStore, useStoreTheme, webStoreOf } from "./useStoreTheme.js";

export const ALL_STORES = "all";
/** A partir de tantas opciones la lista lleva buscador. */
const SEARCH_FROM = 7;

/** Lo que una pantalla necesita para filtrar por la tienda activa del panel. */
export function useStoreFilter(me) {
  const { store, stores } = useStoreTheme(me);
  const isAdmin = !me || me.is_admin !== false;
  const storeId = store ? store.id : ALL_STORES;
  const setStoreId = useCallback((id) => setActiveStore(!id || id === ALL_STORES ? null : id), []);
  // Nombre del parámetro según la ruta: `establishment_id` (caja, estado de cuenta), `store` (POS, auditoría), `stores` (analítica).
  const param = useCallback((name = "establishment_id") => (storeId === ALL_STORES ? "" : `${name}=${encodeURIComponent(storeId)}`), [storeId]);
  // La tienda online llevada como una tienda del panel (tipo «Tienda online»):
  // UNA sola opción en el selector — la de la web, con el código, el nombre y
  // el color de esa tienda — en vez de «Tienda online» y, aparte, la tienda.
  const online = useMemo(() => (isAdmin ? onlineStoreOf(stores) : null), [stores, isAdmin]);
  const options = useMemo(() => {
    // `name` es el nombre guardado en Tiendas, tal cual (nunca un slug ni el correo de nadie).
    const list = stores.filter((s) => !online || s.id !== online.id).map((s) => ({ id: s.id, code: s.code, name: String(s.name || ""), color: s.color || defaultColorForStore(s.name) }));
    const web = webStoreOf(isAdmin ? stores : []);
    return isAdmin ? [{ id: ALL_STORES, code: "", name: "", color: null }, { id: WEB_STORE.id, code: web.code, name: web.name, color: web.color, online: true, named: Boolean(online) }, ...list] : list;
  }, [stores, isAdmin, online]);
  const isWeb = storeId === WEB_STORE.id;
  // El establecimiento detrás de la elección: la tienda física, o la tienda
  // online cuando el dueño la lleva como tienda («» = ninguna: «Todas», o la
  // web sin tienda propia). Para las pantallas de precios y costos, que son
  // por establecimiento.
  const establishmentId = storeId === ALL_STORES ? "" : isWeb ? online?.id || "" : storeId;
  return { storeId, store, stores, options, setStoreId, param, isAdmin, isAll: storeId === ALL_STORES, isWeb, online, establishmentId };
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function StoreFilter({ me, compact = false, className = "", allowAll = true }) {
  const { t } = useLang();
  const { storeId, options, setStoreId, isAdmin } = useStoreFilter(me);
  const visible = allowAll ? options : options.filter((o) => o.id !== ALL_STORES);
  const current = visible.find((o) => o.id === storeId) || visible[0];
  const label = (o) => (o.id === ALL_STORES ? t("adm.theme.allStores") : o.online && !o.named ? t("adm.theme.online") : [o.code, o.name].filter(Boolean).join(" · "));
  const dotOf = (o) => (o?.id === ALL_STORES ? "var(--adm-muted)" : o?.color || "var(--adm-muted)");

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const uid = useId();
  const searchable = visible.length >= SEARCH_FROM;
  const filtered = useMemo(() => {
    const k = norm(q.trim());
    return k ? visible.filter((o) => norm(`${o.code} ${o.name} ${label(o)}`).includes(k)) : visible;
  }, [visible, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback((focus = true) => { setOpen(false); setQ(""); if (focus) btnRef.current?.focus(); }, []);
  const openList = () => {
    setQ("");
    setActive(Math.max(0, visible.findIndex((o) => o.id === current?.id)));
    setOpen(true);
  };
  const choose = (o) => { if (o) setStoreId(o.id); close(); };

  // Fuera de la lista (clic o toque) se cierra sin elegir.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); };
  }, [open, close]);
  // Con buscador, el foco entra en él; sin buscador, se queda en el botón y las flechas mandan igual.
  useEffect(() => {
    if (!open) return;
    const el = searchable ? rootRef.current?.querySelector(".adm-sf-search input") : null;
    el?.focus();
  }, [open, searchable]);
  useEffect(() => { setActive((i) => Math.min(i, Math.max(0, filtered.length - 1))); }, [filtered.length]);
  // La opción activa se mantiene a la vista cuando la lista hace scroll.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const onKey = (e) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openList(); }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); break;
      case "ArrowUp": e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(filtered.length - 1); break;
      case "Enter": e.preventDefault(); choose(filtered[active]); break;
      case "Escape": e.preventDefault(); e.stopPropagation(); close(); break;
      case "Tab": close(false); break;
      default: break;
    }
  };

  if (!visible.length) return null;
  if (!isAdmin && visible.length === 1) {
    return <span className={`adm-store-filter static ${className}`} title={t("adm.theme.current")}><i className="dot" style={{ background: dotOf(current) }} />{label(current)}</span>;
  }
  const listId = `${uid}-list`;
  return (
    <div className={`adm-store-filter adm-sf ${compact ? "compact" : ""} ${open ? "open" : ""} ${className}`} ref={rootRef} onKeyDown={onKey}>
      <button
        type="button"
        ref={btnRef}
        className="adm-sf-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${t("adm.theme.current")}: ${label(current)}`}
        title={t("adm.theme.pick")}
        onClick={() => (open ? close() : openList())}
      >
        <i className="dot" style={{ background: dotOf(current) }} aria-hidden="true" />
        {!compact && <Icon name="store" size={14} />}
        <span className="adm-sf-txt">{label(current)}</span>
        <Icon name="chevronDown" size={14} className="adm-sf-chev" />
      </button>
      {open && (
        <div className="adm-sf-pop">
          {searchable && (
            <label className="adm-sf-search">
              <Icon name="search" size={14} />
              <input value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder={t("adm.theme.search")} aria-label={t("adm.theme.search")} autoComplete="off" />
            </label>
          )}
          <ul id={listId} ref={listRef} role="listbox" aria-label={t("adm.theme.pick")} aria-activedescendant={filtered[active] ? `${uid}-${filtered[active].id}` : undefined}>
            {filtered.map((o, i) => {
              const sel = o.id === current?.id;
              return (
                <li
                  key={o.id}
                  id={`${uid}-${o.id}`}
                  data-i={i}
                  role="option"
                  aria-selected={sel}
                  className={`adm-sf-opt ${i === active ? "active" : ""} ${sel ? "sel" : ""} ${o.id === ALL_STORES || o.online ? "scope" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                >
                  <i className="dot" style={{ background: dotOf(o) }} aria-hidden="true" />
                  <span className="adm-sf-opt-txt">{label(o)}</span>
                  {sel && <Icon name="check" size={14} className="adm-sf-check" />}
                </li>
              );
            })}
            {!filtered.length && <li className="adm-sf-empty" aria-disabled="true">{t("adm.theme.noMatch")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
