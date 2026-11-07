// Dónde se usa: armazón del panel corporativo (/admin): barra lateral con iconos
// (contraíble en escritorio, cajón "hamburguesa" en móvil), barra superior con
// buscador global, idioma y sesión, y el área de trabajo. Las secciones son
// claves (`adm.tab.*`) y el diccionario pone las palabras.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { TENANT } from "../config/tenant.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import AdminErrorBoundary from "./AdminErrorBoundary.jsx";
import { COLOR_MODES, themeVars, useColorMode, useStoreTheme } from "./useStoreTheme.js";
import GlobalFilterBar, { ExportRegistry } from "./GlobalFilterBar.jsx";
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
  ] },
  // Regla del dueño: «en Comercial va todo lo que tenga que ver con manejo de
  // precios, costos, etc.». Desde el 6-nov-2026 «Productos» y «Precios y
  // costos» son UNA pestaña, «Productos y precios» (`products`, PricingPanel +
  // la matriz de docs/PRICE-MATRIX.md); `?tab=pricing` sigue abriéndola
  // (LEGACY_TABS en AdminDashboard).
  { key: "commercial", icon: "orders", items: [
    { key: "orders", icon: "orders" },
    { key: "products", icon: "prices" },
    { key: "costs", icon: "percent" },
    { key: "sellers", icon: "sellers" },
  ] },
  { key: "admin", icon: "security", items: [
    { key: "team", icon: "team" },
    // Sincronizar el catálogo es mantenimiento, no manejo de precios ni de
    // costos: por eso no está en Comercial, donde el dueño quiso que viviera
    // todo lo de precios. Productos sí está allí.
    { key: "catalogsync", icon: "refresh" },
    // Las alertas se configuran desde Administración (decisión del dueño), no
    // dentro de Tiendas: son reglas del negocio, no de una tienda. El
    // supervisor sigue configurando LAS SUYAS (navGroupsFor, más abajo).
    { key: "alerts", icon: "bell" },
    { key: "audit", icon: "history" },
    { key: "security", icon: "security" },
    // Créditos y consumo de los proveedores de IA: solo dueño y superadmin.
    { key: "aiusage", icon: "sparkles" },
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
  { key: "pendingbalances", icon: "hand" },
  { key: "approvals", icon: "hand" },
] };

/**
 * Pestañas según el rol (GET /admin/team/me). Dueño y superadmin ven todo; los
 * demás roles, solo su trabajo. Ocultar es comodidad: el servidor rechaza igual
 * cualquier ruta fuera de su alcance (lib/staff-guard.ts).
 */
export function navGroupsFor(me) {
  if (!me || me.is_admin !== false) return [NAV_GROUPS[0], ADMIN_WORK_GROUP, ...NAV_GROUPS.slice(1)];
  // Regla del dueño: el vendedor no ve el estado general de nada, ni de su
  // tienda. Solo sus ventas, lo que va a cobrar y su comisión («Mi panel»,
  // primero y por defecto), vender, los cobros pendientes de su tienda (los de
  // sus compañeros incluidos: cobrar un saldo atrasado), su caja y su perfil.
  if (me.role === "seller") {
    return [{ ...WORK_GROUP, items: [
      { key: "mysales", icon: "trendUp" },
      { key: "pos", icon: "dollar" },
      { key: "pendingbalances", icon: "hand" },
      { key: "cash", icon: "wallet" },
      { key: "profile", icon: "user" },
    ] }];
  }
  // Encargado (puntos de venta y seguros de su tienda) o quien gestiona formas de pago.
  const config = me.role === "manager" || (me.privileges || []).includes("payments.manage");
  const extra = [
    // El panel de ventas, cada cual sobre sus tiendas (HU-67).
    ...(me.role === "supervisor" || me.role === "manager" ? [{ key: "salesboard", icon: "sales" }] : []),
    ...(config ? [{ key: "posconfig", icon: "settings" }] : []),
    // El supervisor configura sus propias alertas (matriz acordada: «Las suyas»).
    ...(me.role === "supervisor" ? [{ key: "alerts", icon: "bell" }] : []),
    // Costos y resultado: privilegio por persona, sea cual sea el rol.
    ...((me.privileges || []).some((p) => p === "costs.view" || p === "costs.manage") ? [{ key: "storecosts", icon: "costs" }] : []),
    // Estado de cuenta del período: supervisor y encargado, sobre sus tiendas.
    ...(me.role === "supervisor" || me.role === "manager" ? [{ key: "statement", icon: "clipboard" }] : []),
  ];
  // El supervisor y el encargado arrancan en «Estado de tienda» (sus tiendas),
  // con el ejecutivo y los pedidos de sus tiendas, y cobran saldos pendientes.
  const lead = me.role === "supervisor" || me.role === "manager"
    ? [{ key: "storestatus", icon: "store" }, { key: "exec", icon: "dashboard" }]
    : [];
  const items = [...lead, ...WORK_GROUP.items, { key: "pendingbalances", icon: "hand" }];
  if (me.role === "supervisor" || me.role === "manager") items.push({ key: "storeorders", icon: "orders" });
  return [{ ...WORK_GROUP, items: [...items, ...extra] }];
}
export const tabsOf = (groups) => groups.flatMap((g) => g.items.map((i) => i.key));
export const TABS = tabsOf(navGroupsFor(null));

const NAV_KEY = "adm_nav_collapsed";
const RAIL_QUERY = "(min-width: 900px) and (max-width: 1199.98px) and (orientation: portrait)";
const DRAWER_QUERY = "(max-width: 899.98px)";
// Tablet apaisada (iPad 1080×810, Galaxy Tab 1280×800): arranca en iconos para
// dar el ancho a las dos columnas del POS; el botón «Expandir» sigue funcionando
// y se recuerda aparte de la preferencia del escritorio.
const TABLET_LANDSCAPE_QUERY = "(pointer: coarse) and (min-width: 900px) and (max-width: 1366px) and (orientation: landscape)";
const TABLET_NAV_KEY = "adm_nav_tablet_collapsed";
const readTabletCollapsed = () => { try { return localStorage.getItem(TABLET_NAV_KEY) !== "0"; } catch { return true; } };

/** `true` mientras la consulta de medios se cumpla (se actualiza al girar o redimensionar). */
function useMediaQuery(query) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const fn = () => setOn(mq.matches);
    fn();
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, [query]);
  return on;
}
const readCollapsed = () => { try { return localStorage.getItem(NAV_KEY) === "1"; } catch { return false; } };

/**
 * El cajón móvil se cierra solo al elegir sección, al pulsar Escape o al tocar
 * el fondo; en escritorio la barra recuerda si estaba contraída.
 */
export default function AdminShell({ tab, onTab, user, onLogout, goTo = null, find, onFind, badges = {}, groups = navGroupsFor(null), me = null, children }) {
  const { t, lang, toggle } = useLang();
  const [collapsedPref, setCollapsedPref] = useState(readCollapsed);
  const [tabletPref, setTabletPref] = useState(readTabletCollapsed);
  const tabletLandscape = useMediaQuery(TABLET_LANDSCAPE_QUERY);
  const [drawer, setDrawer] = useState(false);
  // Tablet vertical de 900–1199 px: la barra queda en iconos sola (más ancho
  // para el contenido) sin tocar la preferencia guardada del escritorio. Por
  // debajo de 900 px manda el cajón hamburguesa (admin.css).
  const rail = useMediaQuery(RAIL_QUERY);
  const collapsed = rail || (tabletLandscape ? tabletPref : collapsedPref);
  const setCollapsed = (fn) => (tabletLandscape ? setTabletPref : setCollapsedPref)(fn);
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

  useEffect(() => { try { localStorage.setItem(NAV_KEY, collapsedPref ? "1" : "0"); } catch { /* noop */ } }, [collapsedPref]);
  useEffect(() => { try { localStorage.setItem(TABLET_NAV_KEY, tabletPref ? "1" : "0"); } catch { /* noop */ } }, [tabletPref]);
  // Al pasar a ancho de escritorio (girar la tablet), el cajón no se queda abierto con el fondo bloqueado.
  const drawerMode = useMediaQuery(DRAWER_QUERY);
  useEffect(() => { if (!drawerMode) setDrawer(false); }, [drawerMode]);
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

  // La barra de filtros global va pegada justo bajo la cabecera, mida lo que
  // mida (en el móvil la cabecera crece): se miden las dos y se publican como
  // --adm-top-real / --adm-bar-h en el armazón, para la barra y para lo que
  // deba restar su alto (fit.css).
  const shellRef = useRef(null);
  const topRef = useRef(null);
  const barRef = useRef(null);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const apply = () => {
      shell.style.setProperty("--adm-top-real", `${topRef.current?.offsetHeight || 0}px`);
      shell.style.setProperty("--adm-bar-h", `${barRef.current?.offsetHeight || 0}px`);
    };
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    if (topRef.current) ro?.observe(topRef.current);
    if (barRef.current) ro?.observe(barRef.current);
    return () => ro?.disconnect();
  }, [tab]);

  const go = (key) => { onTab(key); setDrawer(false); setFly(null); };
  const displayName = me?.display_name || me?.name || String(user || "?").split("@")[0];
  const userRole = me?.role || (me?.is_admin !== false ? "admin" : "staff");
  // Tema por tienda: color de la tienda activa en el cromo (useStoreTheme.js)
  // solo donde se opera (OPERATIONAL_TABS; el administrador ve neutro en las
  // pestañas informativas), y su nombre siempre a la vista en la barra
  // superior, también en el móvil, con el punto de SU color aunque el cromo
  // vaya en neutro (`storeTheme`).
  const { theme, storeTheme, store, stores, multi } = useStoreTheme(me, { tab });
  // Claro / oscuro / sistema: `data-mode` en el armazón; admin.css redefine los tokens.
  const { mode, resolved: colorMode, cycle: cycleMode } = useColorMode();
  // El nombre es el guardado en Tiendas (`name`), tal cual; el código delante.
  const storeName = store ? (store.online ? t("adm.theme.online") : String(store.name || store.code || "")) : "";
  const userStore = store ? [store.code, storeName].filter(Boolean).join(" · ") : me?.store_name || me?.store_code || "";
  const storeLabel = store ? storeName : multi ? stores.map((s) => s.code).join(" · ") : t("adm.theme.allStores");
  const dotStyle = store && !storeTheme.neutral ? { background: storeTheme.accent } : undefined;
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
    <div ref={shellRef} className={`adm-shell ${collapsed ? "is-collapsed" : ""} ${rail ? "is-rail" : ""} ${drawer ? "drawer-open" : ""}`} data-store-theme={theme.key} data-mode={colorMode} style={themeVars(theme, { dark: colorMode === "dark" })}>
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
        <header className="adm-top" ref={topRef}>
          <button type="button" className="adm-burger" onClick={() => setDrawer(true)} aria-label={t("adm.nav.open")} aria-expanded={drawer}>
            <Icon name="menu" size={22} />
          </button>
          <div className="adm-top-crumb">
            <span className="adm-top-sec">{t(`adm.tab.${tab}`)}</span>
            {/* Solo dueño y superadmin: un vendedor o un encargado no administran el panel. */}
            {me?.is_admin !== false && <em className="adm-badge">ADMIN</em>}
            {/* Dónde estoy: punto del color de la tienda + su nombre, siempre visible. */}
            <span className="adm-store-pill" title={`${t("adm.theme.current")}: ${storeLabel}`} aria-label={`${t("adm.theme.current")}: ${storeLabel}`}>
              <i className="adm-store-dot" aria-hidden="true" style={dotStyle} />
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
        {/* Filtros globales (tienda · período · rango · exportar), pegados bajo la
            cabecera en todas las pestañas que los usan (BAR_TABS). Exportar manda
            a la pantalla abierta: ExportRegistry guarda lo que registra con
            useRegisterExport. */}
        <ExportRegistry>
          {/* `go` baja hasta el buscador global de la barra: sin él navegaría
              cambiando la URL, que recarga la página entera. */}
          <GlobalFilterBar tab={tab} me={me} barRef={barRef} go={goTo} />
          {/* Una pestaña que revienta al pintarse no puede llevarse el panel
              entero por delante: la barrera la acota y `key={tab}` hace que
              cambiar de pestaña reintente sin recargar. */}
          <main className="adm-body" key={tab}><AdminErrorBoundary>{children}</AdminErrorBoundary></main>
        </ExportRegistry>
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
