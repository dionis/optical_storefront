import { Link, useLocation } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";

// Barra inferior tipo app — SOLO móvil (oculta en escritorio por CSS).
// Azul de marca, 5 accesos con icono. El estado activo resalta el actual.
const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" /></svg>
  ),
  frames: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="13" r="3.3" /><circle cx="18" cy="13" r="3.3" /><path d="M9.3 13h5.4" /><path d="M2.4 12C3 10 3.9 9 6 9" /><path d="M21.6 12C21 10 20.1 9 18 9" /></svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.6" y="9.5" width="7.4" height="5.2" rx="2.6" fill="currentColor" stroke="none" /><rect x="14" y="9.5" width="7.4" height="5.2" rx="2.6" fill="currentColor" stroke="none" /><path d="M10 10.6h4" /><path d="M2.6 9.5 1.3 7.6" /><path d="M21.4 9.5l1.3-1.9" /></svg>
  ),
  offers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.6 13.4 12.4 21.6a1.8 1.8 0 0 1-2.5 0l-7.5-7.5V3.6H10l10.6 7.3a1.8 1.8 0 0 1 0 2.5z" /><circle cx="7.4" cy="7.4" r="1.3" /></svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></svg>
  ),
};

export default function BottomNav() {
  const { t } = useLang();
  const { pathname } = useLocation();
  const items = [
    { key: "home", to: "/", label: t("bn.home"), match: (p) => p === "/" },
    { key: "frames", to: "/catalogo", label: t("bn.frames"), match: (p) => p.startsWith("/catalogo") || p.startsWith("/recetas") || p.startsWith("/producto") || p.startsWith("/marca") },
    { key: "sun", to: "/catalogo?q=sol", label: t("bn.sun"), match: () => false },
    { key: "offers", to: "/catalogo", label: t("bn.offers"), match: () => false },
    { key: "account", to: "/cuenta", label: t("bn.account"), match: (p) => p.startsWith("/cuenta") || p.startsWith("/my-orders") },
  ];
  return (
    <nav className="bottomnav" aria-label={t("bn.aria")}>
      {items.map((it) => (
        <Link key={it.key} to={it.to} className={`bn-item ${it.match(pathname) ? "on" : ""}`}>
          <span className="bn-ic">{ICONS[it.key]}</span>
          <span className="bn-tx">{it.label}</span>
        </Link>
      ))}
    </nav>
  );
}
