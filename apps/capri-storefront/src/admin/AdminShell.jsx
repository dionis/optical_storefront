// Dónde se usa: armazón del panel corporativo (/admin): barra lateral con iconos
// (contraíble en escritorio, cajón "hamburguesa" en móvil), barra superior con
// buscador global, idioma y sesión, y el área de trabajo. Las secciones son
// claves (`adm.tab.*`) y el diccionario pone las palabras.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { TENANT } from "../config/tenant.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { COLOR_MODES, themeVars, useColorMode, useStoreTheme } from "./useStoreTheme.js";
import "./admin-theme.css";

/**
 * Secciones del panel en grupos pequeños, por tarea: cada grupo es un submenú
 * plegable (acordeón, uno abierto a la vez) para que el menú quepa sin scroll.
 * `navHidden`: la pestaña existe (se llega por enlace o desde la cabecera) pero
 * no ocupa sitio en el menú.
 */
export const NAV_GROUPS = [
  { key: "overview", icon: "dashboard", items: [
    { key: "exec", icon: "dashboard" },
    { key: "storestatus", icon: "store" },
    { key: "salesboard", icon: "sales" },
  ] },
  { key: "stores", icon: "store", items: [
    { key: "stores", icon: "store" },
    { key: "storecosts", icon: "costs" },
    { key: "statement", icon: "clipboard" },
    { key: "posconfig", icon: "settings" },
    { key: "alerts", icon: "bell" },
  ] },
  { key: "commercial", icon: "orders", items: [
    { key: "orders", icon: "orders" },
    { key: "costs", icon: "percent" },
    { key: "sellers", icon: "sellers" },
  ] },
  { key: "catalog", icon: "products", items: [
    { key: "products", icon: "products" },
    { key: "catalogsync", icon: "refresh" },
  ] },
  { key: "admin", icon: "security", items: [
    { key: "team", icon: "team" },
    { key: "audit", icon: "history" },
    { key: "security", icon: "security" },
  ] },
];

/** Lo de cada persona, sea cual sea su rol. */
const WORK_GROUP = { key: "work", icon: "dollar", items: [
  { key: "pos", icon: "dollar" },
  { key: "possales", icon: "receipt" },
  { key: "cash", icon: "wallet" },
  { key: "mysales", icon: "trendUp" },
  { key: "profile", icon: "user" },
] };

/** Dueño y superadmin: el punto de venta con las aprobaciones; su perfil, desde la cabecera. */
const ADMIN_WORK_GROUP = { key: "work", icon: "dollar", items: [
  ...WORK_GROUP.items.map((i) => (i.key === "profile" ? { ...i, navHidden: true } : i)),
  { key: "approvals", icon: "hand" },
] };

/**
 * Pestañas según el rol (GET /admin/team/me). Dueño y superadmin ven todo; los
 * demás roles, solo su trabajo. Ocultar es comodidad: el servidor rechaza igual
 * cualquier ruta fuera de su alcance (lib/staff-guard.ts).
 */
export function navGroupsFor(me) {
  if (!me || me.is_admin !== false) return [NAV_GROUPS[0], ADMIN_WORK_GROUP, ...NAV_GROUPS.slice(1)];
  // Encargado (puntos de venta y seguros de su tienda) o quien gestiona formas de pago.
  const config = me.role === "manager" || (me.privileges || []).includes("payments.manage");
  const extra = [
    // El panel de ventas, cada cual sobre lo suyo: sus tiendas (HU-67) o, el vendedor, sus ventas.
    ...(me.role === "supervisor" || me.role === "manager" || me.role === "seller" ? [{ key: "salesboard", icon: "sales" }] : []),
    ...(config ? [{ key: "posconfig", icon: "settings" }] : []),
    // El supervisor configura sus propias alertas (matriz acordada: «Las suyas»).
    ...(me.role === "supervisor" ? [{ key: "alerts", icon: "bell" }] : []),
    // Costos y resultado: privilegio por persona, sea cual sea el rol.
    ...((me.privileges || []).some((p) => p === "costs.view" || p === "costs.manage") ? [{ key: "storecosts", icon: "costs" }] : []),
    // Estado de cuenta del período: supervisor y encargado, sobre sus tiendas.
    ...(me.role === "supervisor" || me.role === "manager" ? [{ key: "statement", icon: "clipboard" }] : []),
  ];
  // El vendedor arranca en su panel («Mi panel»): primero en su menú, y la
  // primera pestaña es la que abre el panel cuando el enlace no pide otra.
  // El supervisor y el encargado arrancan en «Estado de tienda» (sus tiendas).
  const lead = me.role === "supervisor" || me.role === "manager" ? [{ key: "storestatus", icon: "store" }] : [];
  const items = me.role === "seller"
    ? [...WORK_GROUP.items.filter((i) => i.key === "mysales"), ...WORK_GROUP.items.filter((i) => i.key !== "mysales")]
    : [...lead, ...WORK_GROUP.items];
  return [{ ...WORK_GROUP, items: [...items, ...extra] }];
}
export const tabsOf = (groups) => groups.flatMap((g) => g.items.map((i) => i.key));
export const TABS = tabsOf(navGroupsFor(null));

const NAV_KEY = "adm_nav_collapsed";
const readCollapsed = () => { try { return localStorage.getItem(NAV_KEY) === "1"; } catch { return false; } };

/**
 * El cajón móvil se cierra solo al elegir sección, al pulsar Escape o al tocar
 * el fondo; en escritorio la barra recuerda si estaba contraída.
 */
export default function AdminShell({ tab, onTab, user, onLogout, find, onFind, badges = {}, groups = navGroupsFor(null), me = null, children }) {
  const { t, lang, toggle } = useLang();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const findRef = useRef(null);
  const [showProfile, setShowProfile] = useState(false);
  // Grupo abierto del acordeón (uno a la vez); de entrada, el de la pestaña actual.
  const groupOf = (key) => groups.find((g) => g.items.some((i) => i.key === key))?.key ?? null;
  const [openGroup, setOpenGroup] = useState(() => groupOf(tab));
  useEffect(() => { setOpenGroup(groupOf(tab)); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // Barra contraída: submenú flotante del grupo pulsado, junto a su icono.
  const [fly, setFly] = useState(null); // { key, top }
  const flyRef = useRef(null);
  useEffect(() => {
    if (!fly) return undefined;
    const onDown = (e) => { if (flyRef.current && !flyRef.current.contains(e.target) && !e.target.closest?.(".adm-nav-gbtn")) setFly(null); };
    const onKey = (e) => { if (e.key === "Escape") setFly(null); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [fly]);
  useEffect(() => { if (!collapsed) setFly(null); }, [collapsed]);

  useEffect(() => { try { localStorage.setItem(NAV_KEY, collapsed ? "1" : "0"); } catch { /* noop */ } }, [collapsed]);
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [drawer]);
  // "/" enfoca el buscador global (atajo habitual en paneles).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !/input|textarea|select/i.test(e.target?.tagName || "")) { e.preventDefault(); findRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!showProfile) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setShowProfile(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showProfile]);

  const go = (key) => { onTab(key); setDrawer(false); setFly(null); };
  const displayName = me?.display_name || me?.name || String(user || "?").split("@")[0];
  const userRole = me?.role || (me?.is_admin !== false ? "admin" : "staff");
  // Tema por tienda: color de la tienda activa en el cromo (useStoreTheme.js),
  // y su nombre siempre a la vista en la barra superior, también en el móvil.
  const { theme, store, stores, multi } = useStoreTheme(me);
  // Claro / oscuro / sistema: `data-mode` en el armazón; admin.css redefine los tokens.
  const { mode, resolved: colorMode, cycle: cycleMode } = useColorMode();
  const storeName = store ? (store.online ? t("adm.theme.online") : store.name) : "";
  const userStore = store ? `${store.code} · ${storeName}` : me?.store_name || me?.store_code || "";
  const storeLabel = store ? storeName : multi ? stores.map((s) => s.code).join(" · ") : t("adm.theme.allStores");
  const initials = displayName.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";

  const item = (it, sub = false) => {
    const on = tab === it.key;
    const badge = badges[it.key];
    return (
      <button
        key={it.key}
        type="button"
        className={`adm-nav-item ${sub ? "sub" : ""} ${on ? "on" : ""}`}
        onClick={() => go(it.key)}
        aria-current={on ? "page" : undefined}
        title={collapsed && !sub ? t(`adm.tab.${it.key}`) : undefined}
      >
        <span className="adm-nav-ico"><Icon name={it.icon} size={sub ? 17 : 19} /></span>
        <span className="adm-nav-txt">{t(`adm.tab.${it.key}`)}</span>
        {badge ? <span className="adm-nav-badge">{badge}</span> : null}
      </button>
    );
  };
  const visible = (g) => g.items.filter((i) => !i.navHidden);
  // Con un solo grupo (vendedor, encargado…) el menú es corto: lista simple, sin plegar.
  const flat = groups.filter((g) => visible(g).length).length <= 1;

  const nav = (
    <nav className={`adm-nav ${flat ? "flat" : "accordion"}`} aria-label={t("adm.nav.aria")}>
      {groups.map((g) => {
        const items = visible(g);
        if (!items.length) return null;
        if (flat) {
          return (
            <div className="adm-nav-group" key={g.key}>
              <div className="adm-nav-gh">{t(`adm.nav.g.${g.key}`)}</div>
              {items.map((it) => item(it))}
            </div>
          );
        }
        // Un grupo de una sola sección no necesita submenú.
        if (items.length === 1) return <div className="adm-nav-group single" key={g.key}>{item(items[0])}</div>;
        const open = openGroup === g.key;
        const active = items.some((i) => i.key === tab);
        const total = items.reduce((a, i) => a + (Number(badges[i.key]) || 0), 0);
        const id = `adm-nav-sub-${g.key}`;
        return (
          <div className={`adm-nav-group fold ${open ? "open" : ""} ${active ? "has-on" : ""}`} key={g.key}>
            <button
              type="button"
              className="adm-nav-item adm-nav-gbtn"
              aria-expanded={collapsed ? fly?.key === g.key : open}
              aria-controls={collapsed ? undefined : id}
              title={collapsed ? t(`adm.nav.g.${g.key}`) : undefined}
              onClick={(e) => {
                if (collapsed) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setFly((f) => (f?.key === g.key ? null : { key: g.key, top: Math.min(r.top, window.innerHeight - 56 - items.length * 42) }));
                } else setOpenGroup((k) => (k === g.key ? null : g.key));
              }}
            >
              <span className="adm-nav-ico"><Icon name={g.icon || "layers"} size={19} /></span>
              <span className="adm-nav-txt">{t(`adm.nav.g.${g.key}`)}</span>
              {total && !open ? <span className="adm-nav-badge">{total}</span> : null}
              <span className="adm-nav-chev" aria-hidden="true"><Icon name="chevronDown" size={15} /></span>
            </button>
            {!collapsed && (
              <div className="adm-nav-sub" id={id} hidden={!open}>
                {items.map((it) => item(it, true))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  const flyGroup = fly && groups.find((g) => g.key === fly.key);
  const flyout = collapsed && flyGroup ? (
    <div className="adm-nav-fly" ref={flyRef} style={{ top: Math.max(8, fly.top) }} role="menu" aria-label={t(`adm.nav.g.${flyGroup.key}`)}>
      <div className="adm-nav-fly-h">{t(`adm.nav.g.${flyGroup.key}`)}</div>
      {visible(flyGroup).map((it) => item(it, true))}
    </div>
  ) : null;

  return (
    <div className={`adm-shell ${collapsed ? "is-collapsed" : ""} ${drawer ? "drawer-open" : ""}`} data-store-theme={theme.key} data-mode={colorMode} style={themeVars(theme, { dark: colorMode === "dark" })}>
      <aside className="adm-side" aria-hidden={undefined}>
        <div className="adm-side-head">
          <div className="adm-side-title" style={{ paddingLeft: 4 }}>
            <b>{TENANT.name}</b>
            <small>{t("adm.title")}</small>
          </div>
          <button type="button" className="adm-side-close" onClick={() => setDrawer(false)} aria-label={t("adm.nav.close")}>
            <Icon name="close" />
          </button>
        </div>
        {nav}
        {flyout}
        <div className="adm-side-foot">
          <Link to="/" className="adm-nav-item ghost" title={collapsed ? t("adm.viewStore") : undefined}>
            <span className="adm-nav-ico"><Icon name="store" size={19} /></span>
            <span className="adm-nav-txt">{t("adm.viewStore")}</span>
          </Link>
          <button type="button" className="adm-nav-item ghost adm-collapse" onClick={() => setCollapsed((c) => !c)} title={t(collapsed ? "adm.nav.expand" : "adm.nav.collapse")}>
            <span className="adm-nav-ico"><Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={19} /></span>
            <span className="adm-nav-txt">{t("adm.nav.collapse")}</span>
          </button>
        </div>
      </aside>
      <div className="adm-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />

      <div className="adm-main">
        <header className="adm-top">
          <button type="button" className="adm-burger" onClick={() => setDrawer(true)} aria-label={t("adm.nav.open")}>
            <Icon name="menu" size={22} />
          </button>
          <div className="adm-top-crumb">
            <span className="adm-top-sec">{t(`adm.tab.${tab}`)}</span>
            {/* Solo dueño y superadmin: un vendedor o un encargado no administran el panel. */}
            {me?.is_admin !== false && <em className="adm-badge">ADMIN</em>}
            {/* Dónde estoy: punto del color de la tienda + su nombre, siempre visible. */}
            <span className="adm-store-pill" title={`${t("adm.theme.current")}: ${storeLabel}`} aria-label={`${t("adm.theme.current")}: ${storeLabel}`}>
              <i className="adm-store-dot" aria-hidden="true" />
              <span className="adm-store-pill-txt">{storeLabel}</span>
            </span>
          </div>
          {find !== null && <label className="adm-find" title={t("adm.findPriceTitle")}>
            <Icon name="search" size={16} />
            <input ref={findRef} placeholder={t("adm.findPrice")} value={find} onChange={(e) => onFind(e.target.value)} />
            {find ? <button type="button" className="adm-find-x" onClick={() => onFind("")} aria-label={t("adm.ord.clear")}><Icon name="close" size={13} /></button> : <kbd>/</kbd>}
          </label>}
          <div className="adm-top-right">
            <button type="button" className="adm-icobtn" onClick={toggle} title={t("lang.switch")}>
              <Icon name="globe" size={17} /><span>{lang === "es" ? "EN" : "ES"}</span>
            </button>
            {/* Tres estados en ciclo: claro → oscuro → sistema. El icono dice el estado actual. */}
            <button type="button" className="adm-icobtn adm-mode-btn" onClick={cycleMode} title={`${t(`adm.mode.${mode}`)} · ${t("adm.mode.next", { mode: t(`adm.mode.${COLOR_MODES[(COLOR_MODES.indexOf(mode) + 1) % 3]}`) })}`} aria-label={t(`adm.mode.${mode}`)}>
              <Icon name={mode === "dark" ? "moon" : mode === "light" ? "sun" : "auto"} size={17} />
            </button>
            <button type="button" className="adm-user-chip" title={user} onClick={() => setShowProfile(p => !p)} style={{ cursor: "pointer", position: "relative" }}>
              {me?.photo_url
                ? <img className="adm-avatar adm-avatar-img" src={me.photo_url} alt={displayName} />
                : <span className="adm-avatar">{initials}</span>}
              <span className="adm-user-mail">{displayName}{userRole ? ` · ${t(`adm.role.${userRole}`, userRole)}` : ""}{userStore ? ` — ${userStore}` : ""}</span>
            </button>
            <button type="button" className="adm-icobtn danger" onClick={onLogout} title={t("adm.logout")}>
              <Icon name="logout" size={17} /><span>{t("adm.logout")}</span>
            </button>
          </div>
        </header>
        <main className="adm-body" key={tab}>{children}</main>
      </div>

      {showProfile && (
        <div className="adm-profile-popup-overlay" onClick={() => setShowProfile(false)}>
          <div className="adm-profile-popup" onClick={(e) => e.stopPropagation()}>
            <div className="adm-profile-popup-head">
              {me?.photo_url
                ? <img className="adm-profile-popup-avatar adm-avatar-img" src={me.photo_url} alt={displayName} />
                : <div className="adm-profile-popup-avatar">{initials}</div>}
              <div className="adm-profile-popup-info">
                <b>{displayName}</b>
                <small>{user}</small>
              </div>
            </div>
            <dl className="adm-profile-popup-fields">
              <div className="adm-profile-popup-field">
                <dt>{t("adm.profile.role")}</dt>
                <dd>{t(`adm.role.${userRole}`, userRole)}</dd>
              </div>
              {userStore && <div className="adm-profile-popup-field">
                <dt>{t("adm.profile.store")}</dt>
                <dd>{userStore}</dd>
              </div>}
              <div className="adm-profile-popup-field">
                <dt>{t("adm.profile.email")}</dt>
                <dd>{user}</dd>
              </div>
              {me?.phone_mobile && <div className="adm-profile-popup-field">
                <dt>{t("adm.profile.phone")}</dt>
                <dd>{me.phone_mobile}</dd>
              </div>}
              {me?.seller_code && <div className="adm-profile-popup-field">
                <dt>{t("adm.profile.code")}</dt>
                <dd>{me.seller_code}</dd>
              </div>}
            </dl>
            <div className="adm-profile-popup-foot">
              <button type="button" className="btn-sm" onClick={() => { onTab("profile"); setShowProfile(false); }}>
                <Icon name="user" size={15} /> {t("adm.profile.viewFull")}
              </button>
              <button type="button" className="btn-sm danger" onClick={onLogout}>
                <Icon name="logout" size={15} /> {t("adm.logout")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
