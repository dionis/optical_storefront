import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";

// Loading indicator: the default lightweight spinner (capri-spinner), kept
// simple and non-distracting, plus the three Cuban-flag colour dots (bolitas)
// and a rotating, language-sensitive message so the wait feels informative.
// Reusable for every "please wait" moment (catalog, OCR, 3D render): pass
// `messages` (array of i18n keys) to tailor the copy.

const DEFAULT_MSGS = [
  "loader.catalog",   // Cargando el catálogo
  "loader.frames",    // Preparando tus monturas
  "loader.prices",    // Calculando precios
  "loader.almost",    // Casi listo
];

export default function GlassesLoader({ messages = DEFAULT_MSGS, compact = false }) {
  const { t } = useLang();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!messages || messages.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % messages.length), 1800);
    return () => clearInterval(id);
  }, [messages]);

  const msgKey = messages && messages.length ? messages[i % messages.length] : null;

  return (
    <div className={`capri-loading gll-basic ${compact ? "gll-compact" : ""}`} role="status" aria-live="polite">
      <span className="capri-spinner" aria-hidden="true" />
      {msgKey && (
        <p className="gll-msg">
          {t(msgKey)}
          <span className="gll-dots" />
        </p>
      )}
      <div className="gll-pips" aria-hidden="true">
        <span className="gll-pip b" />
        <span className="gll-pip w" />
        <span className="gll-pip r" />
      </div>
    </div>
  );
}
