// Campo de contraseña con «ojito» para ver lo que se escribe (decisión del
// dueño, 9-nov-2026: evitar errores al poner una contraseña). Se usa en todos
// los campos de contraseña de la tienda y del panel. Recibe las mismas props
// que un <input>; el botón alterna entre type="password" y type="text" y
// vuelve a ocultarla al enviar el formulario o al salir de la página.
import { forwardRef, useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import "./password-input.css";

const Eye = ({ open }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {!open && <path d="M3 3l18 18" />}
  </svg>
);

const PasswordInput = forwardRef(function PasswordInput({ className = "", wrapClassName = "", ...props }, ref) {
  const { t } = useLang();
  const [show, setShow] = useState(false);
  // Al enviar el formulario la contraseña vuelve a quedar oculta.
  useEffect(() => {
    if (!show) return undefined;
    const hide = () => setShow(false);
    window.addEventListener("submit", hide, true);
    window.addEventListener("pagehide", hide);
    return () => { window.removeEventListener("submit", hide, true); window.removeEventListener("pagehide", hide); };
  }, [show]);
  const label = t(show ? "pw.hide" : "pw.show");
  return (
    <span className={`pw-field ${wrapClassName}`.trim()}>
      <input
        ref={ref}
        {...props}
        className={className}
        type={show ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="pw-eye"
        onClick={() => setShow((v) => !v)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={label}
        aria-pressed={show}
        title={label}
        disabled={props.disabled}
      >
        <Eye open={show} />
      </button>
    </span>
  );
});

export default PasswordInput;
