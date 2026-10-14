// Dónde se usa: todas las páginas de la tienda, bajo el contenido. Columnas Shop/Help/Service + franja de confianza (TrustStrip).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import FooterInfo from "./FooterInfo.jsx";

export default function Footer() {
  const { t } = useLang();
  // Ventana emergente informativa del pie (fi.*): null = cerrada.
  const [info, setInfo] = useState(null);
  return (
    <footer className="footer">
      <div className="footer-cols">
        <div className="footer-brand">
          <img src="/logo-oficial.png" alt="RUBI LENS — Óptica y Salud Visual" className="footer-logo" />
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
          <button type="button" className="footer-link" onClick={() => setInfo("choose")}>{t("footer.chooseFrame")}</button>
          <button type="button" className="footer-link" onClick={() => setInfo("rx")}>{t("footer.rxGuide")}</button>
          <button type="button" className="footer-link" onClick={() => setInfo("ship")}>{t("footer.shipping")}</button>
        </div>
        <div>
          <h4>{t("footer.service")}</h4>
          <button type="button" className="footer-link" onClick={() => setInfo("gar")}>{t("footer.arSvc")}</button>
          <button type="button" className="footer-link" onClick={() => setInfo("upload")}>{t("footer.uploadRx")}</button>
          <button type="button" className="footer-link" onClick={() => setInfo("contact")}>{t("footer.contact")}</button>
        </div>
      </div>
      <div className="footer-bottom">
        © {new Date().getFullYear()} {t("footer.rights")}
        <Link to="/admin" className="footer-admin" title={t("adm.title")}>· {t("footer.admin")}</Link>
      </div>
      <FooterInfo topic={info} onClose={() => setInfo(null)} />
    </footer>
  );
}
