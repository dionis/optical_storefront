// Dónde se usa: App (bajo el header, en toda la tienda). Si el cliente dejó
// algo a medias — el asistente de lentes, el probador o el checkout — y
// cerró, recibió una llamada o navegó atrás, esta franja le ofrece RETOMAR
// exactamente donde estaba (pedido del dueño). El punto de retorno se guarda
// en la caché de la app (rl_resume) desde LensProcess, TryOnStudio y
// MedusaCheckout, y caduca a las 48 h. La × lo descarta.
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { loadCache, clearCache } from "../lib/appCache.js";

const MAX_AGE_MS = 48 * 3600 * 1000;

export default function ResumeBanner() {
  const { t } = useLang();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(false);

  const r = loadCache("rl_resume", null);
  if (hidden || !r || !r.url || !r.at || Date.now() - r.at > MAX_AGE_MS) return null;
  const targetPath = String(r.url).split("?")[0];
  // No se ofrece sobre la propia pantalla a retomar ni dentro del admin.
  if (pathname === targetPath || pathname.startsWith("/admin")) return null;

  return (
    <div className="resume-bar" role="region" aria-label={t("resume.title")}>
      <span className="resume-tx">
        <b>{t("resume.title")}</b>
        {r.name ? <span className="resume-name"> · {r.name}</span> : null}
      </span>
      <button type="button" className="resume-go" onClick={() => nav(r.url)}>{t("resume.cta")} →</button>
      <button type="button" className="resume-x" aria-label={t("fi.close")}
              onClick={() => { clearCache("rl_resume"); setHidden(true); }}>×</button>
    </div>
  );
}
