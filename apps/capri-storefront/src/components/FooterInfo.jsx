// Dónde se usa: Footer (columnas Ayuda y Servicio). Ventana emergente con el
// fondo distorsionado (backdrop blur, como el resto de diálogos de la app) que
// explica en detalle cada enlace del pie: elegir montura, guía de recetas,
// envíos y devoluciones, garantía de 30 días, subir la receta y contacto.
// Todo el copy va por el diccionario i18n (es/en), claves fi.*.
import { useEffect } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";

const SECTIONS = ["s1", "s2", "s3", "s4"];

export default function FooterInfo({ topic, onClose }) {
  const { t } = useLang();

  // Esc cierra; con el diálogo abierto no scrollea la página de fondo.
  useEffect(() => {
    if (!topic) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [topic, onClose]);

  if (!topic) return null;

  return (
    <div className="dlg-backdrop fi-backdrop" onClick={onClose}>
      <div className="dlg fi-card" role="dialog" aria-modal="true"
           aria-label={t(`fi.${topic}.title`)} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dlg-x" onClick={onClose} aria-label={t("fi.close")}>×</button>
        <h3 className="fi-title">{t(`fi.${topic}.title`)}</h3>
        <p className="fi-intro">{t(`fi.${topic}.intro`)}</p>
        {SECTIONS.map((s) => (
          <section key={s} className="fi-sec">
            <h4>{t(`fi.${topic}.${s}t`)}</h4>
            <p>{t(`fi.${topic}.${s}b`)}</p>
          </section>
        ))}
        <button type="button" className="btn btn-primary fi-ok" onClick={onClose}>{t("fi.close")}</button>
      </div>
    </div>
  );
}
