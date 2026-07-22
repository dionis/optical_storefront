import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useCart } from "./CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

export default function Header() {
  const { count } = useCart();
  const { t, lang, toggle } = useLang();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();

  const submit = (e) => {
    e.preventDefault();
    navigate(`/catalogo?q=${encodeURIComponent(q)}`);
    setMenu(false);
  };

  const links = (
    <>
      <NavLink to="/catalogo" onClick={() => setMenu(false)}>{t("nav.glasses")}</NavLink>
      <NavLink to="/catalogo?age=Niños" onClick={() => setMenu(false)}>{t("nav.kids")}</NavLink>
      <NavLink to="/marca/case" onClick={() => setMenu(false)}>{t("nav.cases")}</NavLink>
      <NavLink to="/#marcas" onClick={() => setMenu(false)}>{t("nav.brands")}</NavLink>
    </>
  );

  return (
    <header className="header">
      <div className="header-top">{t("top.bar")}</div>
      <div className="header-main">
        <button className="hamburger" aria-label={t("a11y.menu")} onClick={() => setMenu((m) => !m)}>
          <span /><span /><span />
        </button>

        <Link to="/" className="logo" onClick={() => setMenu(false)}>
          <img src="/logo.png" alt="Óptica El Rancho" className="logo-img" />
        </Link>

        <nav className="nav desktop-only">{links}</nav>

        <form className="search desktop-only" onSubmit={submit}>
          <input type="text" placeholder={t("search.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" aria-label={t("a11y.search")}>⌕</button>
        </form>

        <div className="header-actions">
          <button className="lang-btn" onClick={toggle} title="Language / Idioma">
            <span className={lang === "es" ? "on" : ""}>ES</span>
            <span className="sep">/</span>
            <span className={lang === "en" ? "on" : ""}>EN</span>
          </button>
          <button className="icon-btn desktop-only" title={t("a11y.fav")}>♡</button>
          <button className="icon-btn cart" title={t("a11y.cart")}>
            🛒{count > 0 && <span className="badge">{count}</span>}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <div className={`drawer ${menu ? "open" : ""}`}>
        <form className="search mobile-search" onSubmit={submit}>
          <input type="text" placeholder={t("search.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" aria-label={t("a11y.search")}>⌕</button>
        </form>
        <nav className="drawer-nav">{links}</nav>
      </div>
      {menu && <div className="drawer-backdrop" onClick={() => setMenu(false)} />}
    </header>
  );
}
