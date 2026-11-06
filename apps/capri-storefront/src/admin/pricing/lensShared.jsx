// Dónde se usa: las pestañas «Lentes» (LensesSection.jsx) y «Tratamientos»
// (TreatmentsSection.jsx) de «Precios y costos».
//
// Las dos pestañas editan precios de LENTE con la misma llamada
// (`savePricingLens`) y el mismo gesto (escribir en la casilla y salir del
// campo), y las dos cuelgan del mismo «% sobre el maestro» de la tienda. Esto
// vive aquí para que partir la pantalla en pestañas no duplique la celda ni el
// formulario del porcentaje: si cambia la forma de guardar, cambia en un sitio.
import { useEffect, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import HelpTip from "../HelpTip.jsx";
import { savePricingLens } from "./api.js";

export const dollars = (cents) => (cents == null ? "" : (Math.round(Number(cents)) / 100).toFixed(2));

/** Etiqueta de una fila del servidor en el idioma elegido (nunca el código). */
export const labelOf = (row, lang) => String((lang === "en" ? row.label_en : row.label_es) || row.code);

/**
 * Una casilla de precio: se escribe el número y se guarda al salir del campo (o
 * con Enter). Guardar al salir del campo y no con un botón por celda es lo que
 * hace que la matriz se pueda repasar de corrido, que es como el dueño la lee.
 */
export function Cell({ cents, masterCents, own, title, disabled, onSave, allowEmpty = false, className = "", placeholder }) {
  const { lang } = useLang();
  const [value, setValue] = useState(dollars(cents));
  const [busy, setBusy] = useState(false);
  // Tras guardar, el panel vuelve a leer el payload: la celda se pone al día
  // con lo que contestó el servidor (y no con lo que se tecleó).
  useEffect(() => { setValue(dollars(cents)); }, [cents]);
  const commit = async () => {
    const next = value.trim();
    if (busy || next === dollars(cents)) return;
    // Vaciar una casilla solo significa algo donde «sin valor» existe (el costo
    // de una celda); un precio en blanco vuelve a lo que había.
    if (next === "" && !allowEmpty) { setValue(dollars(cents)); return; }
    setBusy(true);
    try {
      await onSave(next === "" ? null : Number(next));
    } finally {
      setBusy(false);
    }
  };
  return (
    <input
      className={`pp-cell ${own ? "own" : ""} ${className}`.trim()}
      placeholder={placeholder}
      type="number"
      step="0.01"
      min="0"
      inputMode="decimal"
      disabled={disabled || busy}
      aria-label={title}
      title={masterCents != null && masterCents !== cents ? `${title} · ${money(Number(masterCents) / 100, "usd", lang)}` : title}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
    />
  );
}

/**
 * El «% sobre el maestro» de la tienda: un solo porcentaje para TODOS los
 * lentes, tratamientos incluidos. Se pinta en las dos pestañas a propósito —
 * es el mismo ámbito y el mismo formulario, y mandar al dueño a otra pestaña
 * para mover un número que afecta a lo que está mirando sería un viaje de ida
 * y vuelta por nada. Solo aparece con una tienda elegida arriba.
 */
export function AdjustRow({ lenses, store, onSaved, onError, id = "pp-lens-adjust" }) {
  const { t } = useLang();
  const [adjust, setAdjust] = useState(lenses.store?.adjust_pct == null ? "" : String(lenses.store.adjust_pct));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAdjust(lenses.store?.adjust_pct == null ? "" : String(lenses.store.adjust_pct));
  }, [lenses.store?.adjust_pct]);

  if (!lenses.store) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      onSaved(await savePricingLens({ kind: "adjust", key: "all", value: adjust === "" ? null : Number(adjust), store }));
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pp-row tight" onSubmit={submit}>
      <label htmlFor={id}>
        {t("adm.price.lenses.adjust")}
        <HelpTip topic="price.storeVariation" />
      </label>
      <span className="pp-now">
        {lenses.store.adjust_pct == null
          ? t("adm.price.lenses.adjustNone")
          : t("adm.price.lenses.adjustNow", { v: lenses.store.adjust_pct })}
      </span>
      <input
        id={id}
        className="pp-input pp-num"
        type="number"
        step="0.01"
        value={adjust}
        onChange={(e) => setAdjust(e.target.value)}
      />
      <span className="pp-unit">%</span>
      <button className="btn-xs primary" disabled={busy}>{t("adm.price.save")}</button>
      {Boolean(lenses.store.cells.length) && (
        <span className="pp-badge" title={t("adm.price.lenses.adjustHint")}>
          {t("adm.price.lenses.cellsChanged", { n: lenses.store.cells.length })}
        </span>
      )}
    </form>
  );
}

/**
 * Guardar una casilla y buscar la variación propia de la tienda: lo que las dos
 * pestañas necesitan del payload, resuelto una vez.
 */
export function useLensWriter({ lenses, store, onSaved, onError }) {
  const save = async (payload) => {
    try {
      onSaved(await savePricingLens({ ...payload, store }));
    } catch (err) {
      onError(err.message);
    }
  };
  /** ¿Esta casilla tiene precio PROPIO de la tienda (no el % ni el maestro)? */
  const isOwn = (kind, key) => (lenses.store?.cells || []).some((c) => c.kind === kind && c.key === key);
  return { save, isOwn, isStore: Boolean(lenses.store) };
}
