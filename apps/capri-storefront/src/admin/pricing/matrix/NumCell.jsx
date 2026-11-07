// Una casilla numérica de la matriz de «Productos y precios»: compacta, alineada
// a la derecha y sin flechitas (text + inputMode decimal, no type=number).
// Guarda al salir o con Enter; Esc devuelve lo que había. Optimista: enseña lo
// tecleado mientras guarda (estado «guardando» discreto), parpadea un ✓ al
// confirmar y, si el servidor lo rechaza, vuelve a la cifra anterior y deja el
// motivo traducido pegado a la casilla unos segundos.
import { useEffect, useRef, useState } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import Icon from "../../icons.jsx";
import { cellProblem, inputText, parseInput } from "./model.js";

const ERR_MS = 5000;
const OK_MS = 900;

/**
 * @param field    "cost" | "price" | "discount"
 * @param value    the current value (dollars or percent), null = empty
 * @param onCommit async (next: number|null) => void — throws Error(i18nKey)
 * @param col      column id: Enter / Shift+Enter jump to the same column one row down / up
 * @param onNav    (input, col, dir) => void — provided by the table
 */
export default function NumCell({ field, value, onCommit, col, onNav, disabled = false, label, placeholder = "", className = "", title, children, sub }) {
  const { t } = useLang();
  const [draft, setDraft] = useState(null); // text while focused, null otherwise
  const [pending, setPending] = useState(undefined); // optimistic value while saving
  const [status, setStatus] = useState("idle"); // idle | saving | ok | err
  const [err, setErr] = useState(null);
  const ref = useRef(null);
  const timer = useRef(0);
  const cancelled = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);
  // Focused but not typed in yet (Enter just moved here) and the value changed
  // underneath (a sibling row's answer, a silent reload): follow it. Keeping the
  // stale text would write it back on blur, undoing the change just saved.
  const typed = useRef(false);
  useEffect(() => {
    if (draft !== null && !typed.current && pending === undefined) setDraft(inputText(field, value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = pending !== undefined ? pending : value;
  const flash = (s, ms, e = null) => {
    clearTimeout(timer.current);
    setStatus(s);
    setErr(e);
    timer.current = setTimeout(() => { setStatus("idle"); setErr(null); }, ms);
  };

  const commit = async () => {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (cancelled.current) { cancelled.current = false; return; }
    const next = parseInput(text);
    const same = next === value || (next != null && value != null && Math.abs(Number(next) - Number(value)) < 0.005);
    if (same) return;
    const problem = cellProblem(field, next);
    if (problem) { flash("err", ERR_MS, `adm.err.pricing.${problem}`); return; }
    setPending(next);
    setStatus("saving");
    try {
      await onCommit(next);
      setPending(undefined);
      flash("ok", OK_MS);
    } catch (e) {
      setPending(undefined);
      flash("err", ERR_MS, e?.message && String(e.message).startsWith("adm.") ? e.message : "adm.err.pricing.save_failed");
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const el = ref.current;
      el?.blur();
      onNav?.(el, col, e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled.current = true;
      ref.current?.blur();
    }
  };

  const text = draft !== null ? draft : inputText(field, shown);
  return (
    <div className={`pm-cell ${className} ${status !== "idle" ? `is-${status}` : ""}`} title={err ? t(err) : title}>
      {children}
      <input
        ref={ref}
        className="pm-in"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        data-col={col}
        disabled={disabled || status === "saving"}
        aria-label={label}
        aria-invalid={status === "err" || undefined}
        placeholder={placeholder}
        value={text}
        onFocus={(e) => {
          cancelled.current = false;
          typed.current = false;
          setDraft(inputText(field, shown));
          // Select now (the text does not change, so the selection survives the
          // render) and once more next frame ONLY if this cell still has the
          // focus and nothing was typed: `select()` focuses the input, so an
          // unguarded deferred call stole the focus back after a fast Tab/Enter
          // and two cells bounced it between them every frame, committing on
          // each blur; and a deferred select after the first digit swallowed it.
          const el = e.target;
          el.select();
          requestAnimationFrame(() => { if (document.activeElement === el && !typed.current) el.select(); });
        }}
        onChange={(e) => { typed.current = true; setDraft(e.target.value); }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {field === "discount" && shown > 0 && draft === null && <span className="pm-pct" aria-hidden="true">%</span>}
      {status === "ok" && <span className="pm-ok" aria-hidden="true"><Icon name="check" size={11} strokeWidth={3} /></span>}
      {sub && draft === null && status !== "err" && <span className="pm-subv">{sub}</span>}
      {status === "err" && err && <span className="pm-err" role="alert">{t(err)}</span>}
    </div>
  );
}
