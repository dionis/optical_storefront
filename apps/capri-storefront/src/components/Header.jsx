import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useCart } from "./CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";
import { CartPanel, FavPanel, AuthPanel } from "./StorePanels.jsx";
import { useUser } from "./userAuth.js";

export default function Header() {
  const { count, favCount } = useCart();
  const { t, lang, setLang } = useLang();
  const user = useUser();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(null); // 'cart' | 'fav' | 'account' | null
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
          <img src="/logo.svg" alt="Óptica El Rancho — RUBI_LENS" className="logo-img" />
        </Link>

        <nav className="nav desktop-only">{links}</nav>

        <form className="search desktop-only" onSubmit={submit}>
          <input type="text" placeholder={t("search.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" aria-label={t("a11y.search")}>⌕</button>
        </form>

        <div className="header-actions">
          <div className="lang-flags" role="group" aria-label="Language / Idioma">
            <button className={`flag-btn ${lang === "es" ? "on" : ""}`} onClick={() => setLang("es")}
                    title="Español" aria-label="Español" aria-pressed={lang === "es"}>
              <svg viewBox="0 0 3 2" className="flag"><rect width="3" height="2" fill="#c60b1e"/><rect y="0.5" width="3" height="1" fill="#ffc400"/></svg>
            </button>
            <button className={`flag-btn ${lang === "en" ? "on" : ""}`} onClick={() => setLang("en")}
                    title="English" aria-label="English" aria-pressed={lang === "en"}>
              <svg viewBox="0 0 19 10" className="flag">
                <rect width="19" height="10" fill="#b22234"/>
                <g fill="#fff"><rect y="0.77" width="19" height="0.77"/><rect y="2.31" width="19" height="0.77"/><rect y="3.85" width="19" height="0.77"/><rect y="5.38" width="19" height="0.77"/><rect y="6.92" width="19" height="0.77"/><rect y="8.46" width="19" height="0.77"/></g>
                <rect width="7.6" height="5.38" fill="#3c3b6e"/>
              </svg>
            </button>
          </div>
          <button className={`icon-btn acct ${user ? "on" : ""}`} title={user ? user.email : t("auth.login")}
                  onClick={() => (user ? navigate("/cuenta") : setPanel("account"))}>
            {user ? <span className="acct-badge">{(user.email[0] || "?").toUpperCase()}</span> : "👤"}
          </button>
          <button className="icon-btn" title={t("a11y.fav")} onClick={() => setPanel("fav")}>
            ♡{favCount > 0 && <span className="badge">{favCount}</span>}
          </button>
          <button className="icon-btn cart" title={t("a11y.cart")} onClick={() => setPanel("cart")}>
            🛒{count > 0 && <span className="badge">{count}</span>}
          </button>
        </div>
      </div>

      <div className={`drawer ${menu ? "open" : ""}`}>
        <form className="search mobile-search" onSubmit={submit}>
          <input type="text" placeholder={t("search.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" aria-label={t("a11y.search")}>⌕</button>
        </form>
        <nav className="drawer-nav">{links}</nav>
      </div>
      {menu && <div className="drawer-backdrop" onClick={() => setMenu(false)} />}

      <CartPanel open={panel === "cart"} onClose={() => setPanel(null)} />
      <FavPanel open={panel === "fav"} onClose={() => setPanel(null)} />
      <AuthPanel open={panel === "account"} onClose={() => setPanel(null)} />
    </header>
  );
}
