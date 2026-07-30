import { Link } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";

export default function Footer() {
  const { t } = useLang();
  return (
    <footer className="footer">
      <div className="footer-cols">
        <div className="footer-brand">
          <img src="/logo.svg" alt="Óptica El Rancho" className="footer-logo" />
          <p>{t("footer.about")}</p>
        </div>
        <div>
          <h4>{t("footer.shop")}</h4>
          <Link to="/catalogo">{t("footer.all")}</Link>
          <Link to="/catalogo?age=Niños">{t("footer.kids")}</Link>
          <Link to="/#marcas">{t("nav.brands")}</Link>
        </div>
        <div>
          <h4>{t("footer.help")}</h4>
          <Link to="/catalogo">{t("footer.chooseFrame")}</Link>
          <Link to="/catalogo">{t("footer.rxGuide")}</Link>
          <Link to="/catalogo">{t("footer.shipping")}</Link>
        </div>
        <div>
          <h4>{t("footer.service")}</h4>
          <Link to="/catalogo">{t("footer.arSvc")}</Link>
          <Link to="/catalogo">{t("footer.uploadRx")}</Link>
          <Link to="/cuenta">{t("footer.contact")}</Link>
        </div>
      </div>
      <div className="footer-bottom">
        © {new Date().getFullYear()} {t("footer.rights")}
        <Link to="/admin" className="footer-admin" title={t("footer.adminTitle")}>· {t("footer.admin")}</Link>
      </div>
    </footer>
  );
}
