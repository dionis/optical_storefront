// Dónde se usa: armazón del panel corporativo (/admin): barra lateral con iconos
// (contraíble en escritorio, cajón "hamburguesa" en móvil), barra superior con
// buscador global, idioma y sesión, y el área de trabajo. Las secciones son
// claves (`adm.tab.*`) y el diccionario pone las palabras.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { TENANT } from "../config/tenant.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";

/** Secciones del panel agrupadas como en un panel de operaciones (Coolify-like). */
export const NAV_GROUPS = [
  { key: "business", items: [
    { key: "exec", icon: "dashboard" },
    { key: "stores", icon: "store" },
    { key: "orders", icon: "orders" },
    { key: "costs", icon: "costs" },
    { key: "sellers", icon: "sellers" },
  ] },
  { key: "catalog", items: [
    { key: "products", icon: "products" },
  ] },
  { key: "admin", items: [
    { key: "team", icon: "team" },
    { key: "audit", icon: "history" },
    { key: "security", icon: "security" },
  ] },
];

/** Lo de cada persona, sea cual sea su rol. */
const WORK_GROUP = { key: "work", items: [
  { key: "profile", icon: "user" },
] };

/**
 * Pestañas según el rol (GET /admin/team/me). Dueño y superadmin ven todo; los
 * demás roles, solo su trabajo. Ocultar es comodidad: el servidor rechaza igual
 * cualquier ruta fuera de su alcance (lib/staff-guard.ts).
 */
export function navGroupsFor(me) {
  if (!me || me.is_admin !== false) return [...NAV_GROUPS, WORK_GROUP];
  return [WORK_GROUP];
}
export const tabsOf = (groups) => groups.flatMap((g) => g.items.map((i) => i.key));
export const TABS = tabsOf(navGroupsFor(null));

const NAV_KEY = "adm_nav_collapsed";
const readCollapsed = () => { try { return localStorage.getItem(NAV_KEY) === "1"; } catch { return false; } };

/**
 * El cajón móvil se cierra solo al elegir sección, al pulsar Escape o al tocar
 * el fondo; en escritorio la barra recuerda si estaba contraída.
 */
export default function AdminShell({ tab, onTab, user, onLogout, find, onFind, badges = {}, groups = navGroupsFor(null), children }) {
  const { t, lang, toggle } = useLang();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const findRef = useRef(null);

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

  const go = (key) => { onTab(key); setDrawer(false); };
  const initials = String(user || "?").split("@")[0].slice(0, 2).toUpperCase();

  const nav = (
    <nav className="adm-nav" aria-label={t("adm.nav.aria")}>
      {groups.map((g) => (
        <div className="adm-nav-group" key={g.key}>
          <div className="adm-nav-gh">{t(`adm.nav.g.${g.key}`)}</div>
          {g.items.map((it) => {
            const on = tab === it.key;
            const badge = badges[it.key];
            return (
              <button
                key={it.key}
                type="button"
                className={`adm-nav-item ${on ? "on" : ""}`}
                onClick={() => go(it.key)}
                aria-current={on ? "page" : undefined}
                title={collapsed ? t(`adm.tab.${it.key}`) : undefined}
              >
                <span className="adm-nav-ico"><Icon name={it.icon} size={19} /></span>
                <span className="adm-nav-txt">{t(`adm.tab.${it.key}`)}</span>
                {badge ? <span className="adm-nav-badge">{badge}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className={`adm-shell ${collapsed ? "is-collapsed" : ""} ${drawer ? "drawer-open" : ""}`}>
      <aside className="adm-side" aria-hidden={undefined}>
        <div className="adm-side-head">
          <Link to="/" className="adm-side-logo" title={t("adm.viewStore")}>
            <img src={TENANT.logoMark || TENANT.logo} alt={TENANT.name} />
          </Link>
          <div className="adm-side-title">
            <b>{TENANT.name}</b>
            <small>{t("adm.title")}</small>
          </div>
          <button type="button" className="adm-side-close" onClick={() => setDrawer(false)} aria-label={t("adm.nav.close")}>
            <Icon name="close" />
          </button>
        </div>
        {nav}
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
            <em className="adm-badge">ADMIN</em>
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
            <div className="adm-user-chip" title={user}>
              <span className="adm-avatar">{initials}</span>
              <span className="adm-user-mail">{user}</span>
            </div>
            <button type="button" className="adm-icobtn danger" onClick={onLogout} title={t("adm.logout")}>
              <Icon name="logout" size={17} /><span>{t("adm.logout")}</span>
            </button>
          </div>
        </header>
        <main className="adm-body" key={tab}>{children}</main>
      </div>
    </div>
  );
}
