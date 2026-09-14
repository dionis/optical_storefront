import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useCart } from "./CartContext.jsx";

// Barra inferior tipo app — SOLO móvil (oculta en escritorio por CSS).
// Inicio · Marcas · Mis favoritos · Ofertas · Mi cuenta.
const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.3 10.8 12 3.5l8.7 7.3" /><path d="M5.6 9.7V20h12.8V9.7" /><path d="M10 20v-5a2 2 0 0 1 4 0v5" /></svg>
  ),
  brands: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="5.4" /><path d="M9.4 13.6 8.1 20.5 12 18.3 15.9 20.5 14.6 13.6" /><path d="M12 6.5 12.59 8.19 14.38 8.23 12.95 9.31 13.47 11.02 12 10 10.53 11.02 11.05 9.31 9.62 8.23 11.41 8.19Z" /></svg>
  ),
  fav: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20.3 4.4 12.8a4.7 4.7 0 0 1 6.7-6.6l.9.9.9-.9a4.7 4.7 0 0 1 6.7 6.6z" /></svg>
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
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { favCount } = useCart();

  // Marcas → sección de marcas en la portada.
  const goBrands = (e) => {
    e.preventDefault();
    const scroll = () => document.getElementById("marcas")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (pathname === "/") scroll();
    else { navigate("/"); setTimeout(scroll, 400); }
  };
  // Mis favoritos → abre el panel de favoritos (vive en el Header).
  const openFav = (e) => { e.preventDefault(); window.dispatchEvent(new Event("rubi:open-fav")); };

  return (
    <nav className="bottomnav" aria-label={t("bn.aria")}>
      <Link to="/" className={`bn-item ${pathname === "/" ? "on" : ""}`}>
        <span className="bn-ic">{ICONS.home}</span>
        <span className="bn-tx">{t("bn.home")}</span>
      </Link>
      <a href="/#marcas" onClick={goBrands} className="bn-item">
        <span className="bn-ic">{ICONS.brands}</span>
        <span className="bn-tx">{t("nav.brands")}</span>
      </a>
      <button type="button" onClick={openFav} className="bn-item">
        <span className="bn-ic">{ICONS.fav}{favCount > 0 && <span className="bn-badge">{favCount}</span>}</span>
        <span className="bn-tx">{t("bn.fav")}</span>
      </button>
      <Link to="/catalogo?oferta=1" className={`bn-item ${search.includes("oferta") ? "on" : ""}`}>
        <span className="bn-ic">{ICONS.offers}</span>
        <span className="bn-tx">{t("bn.offers")}</span>
      </Link>
      <Link to="/cuenta" className={`bn-item ${pathname.startsWith("/cuenta") || pathname.startsWith("/my-orders") ? "on" : ""}`}>
        <span className="bn-ic">{ICONS.account}</span>
        <span className="bn-tx">{t("bn.account")}</span>
      </Link>
    </nav>
  );
}
