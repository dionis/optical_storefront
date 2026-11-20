// Diálogo de la matriz de «Productos y precios»: tarjeta centrada sobre un
// velo, Escape o el velo la cierran, el foco entra al primer campo y vuelve a
// donde estaba al cerrar. Lo usan los altas (montura, estuche, tratamiento) y
// la vista previa de la importación.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import Icon from "../../icons.jsx";

export default function Modal({ title, sub, onClose, footer, wide = false, children, initialFocus }) {
  const { t } = useLang();
  const card = useRef(null);
  useEffect(() => {
    const back = document.activeElement;
    const el = (initialFocus && card.current?.querySelector(initialFocus)) || card.current?.querySelector("input, select, textarea, button:not(.pm-modal-x)");
    el?.focus();
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); back?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Portal into the shell (dark-mode tokens live on .adm-shell[data-mode]), not
  // inside the matrix card, which clips with overflow and has its own stacking.
  const host = (typeof document !== "undefined" && (document.querySelector(".adm-shell") || document.body)) || null;
  if (!host) return null;
  return createPortal(
    <div className="pm-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`pm-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={card}>
        <header className="pm-modal-h">
          <div>
            <h3>{title}</h3>
            {sub && <p>{sub}</p>}
          </div>
          <button type="button" className="pm-modal-x" onClick={onClose} aria-label={t("adm.pm.close")} title={t("adm.pm.close")}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="pm-modal-b">{children}</div>
        {footer && <footer className="pm-modal-f">{footer}</footer>}
      </div>
    </div>,
    host
  );
}
