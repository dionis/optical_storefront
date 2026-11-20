// Menú «⋯» de la matriz (cabecera de una marca, fila de un modelo o de un
// tratamiento): editar, borrar, añadir. Se pinta en un portal con posición fija
// junto al botón, porque la tabla corta lo que se sale de su caja (overflow) y
// tiene columnas pegadas con su propio apilado. Escape, un clic fuera o
// desplazar la tabla lo cierran; flechas arriba/abajo recorren las opciones.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../icons.jsx";

/**
 * @param items [{ key, icon, label, onSelect, tone?: "danger", disabled?, hint? }]
 * @param label aria-label / title of the trigger
 */
export default function MoreMenu({ items, label, className = "" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = 220;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const below = window.innerHeight - r.bottom;
    const h = Math.min(320, 12 + items.length * 44);
    setPos(below < h + 8 && r.top > h + 8 ? { left, bottom: window.innerHeight - r.top + 4, width: w } : { left, top: r.bottom + 4, width: w });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onDown = (e) => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) close(); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); btn.current?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = [...(menu.current?.querySelectorAll("button:not(:disabled)") || [])];
        const i = list.indexOf(document.activeElement);
        list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    // Scrolling the matrix (or the page) would leave the menu floating away from its row.
    const onScroll = (e) => { if (!menu.current?.contains(e.target)) close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    requestAnimationFrame(() => menu.current?.querySelector("button:not(:disabled)")?.focus());
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const host = typeof document !== "undefined" ? document.querySelector(".adm-shell") || document.body : null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`pm-more ${open ? "on" : ""} ${className}`.trim()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <Icon name="moreHorizontal" size={16} strokeWidth={2.4} />
      </button>
      {open && pos && host && createPortal(
        <div ref={menu} className="pm-menu" role="menu" style={pos}>
          {items.filter(Boolean).map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={it.tone === "danger" ? "danger" : ""}
              disabled={it.disabled}
              title={it.hint || undefined}
              onClick={() => { setOpen(false); it.onSelect?.(); }}
            >
              <Icon name={it.icon} size={15} />
              <span>{it.label}</span>
            </button>
          ))}
        </div>,
        host
      )}
    </>
  );
}
