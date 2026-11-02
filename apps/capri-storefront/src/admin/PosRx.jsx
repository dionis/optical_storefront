// Dónde se usa: punto de venta (PosSale.jsx), paso Receta y «Graduación que usa
// hoy» del paso Cliente. Una sola cuadrícula compacta OD/OI calcada de la hoja de
// laboratorio de la tienda (ESF · CIL · EJE · ADD · PRISMA · BASE · DNP · ALT), con
// el tipo de receta delante y las reglas optométricas de rxRules.js. Lo que se
// escribe se ajusta al paso y al formato de la hoja al salir de la casilla.
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { LIMITS, typedDecimal, typedSigned } from "../data/fieldRules.js";
import { PRISM_BASES, RX_TYPES, binocularPd, inferType, normalizeField, setEyeField, setPd, validateRx, withType } from "./rxRules.js";
import HelpTip from "./HelpTip.jsx";
import "./pos-rx.css";

const COLS = { sv: ["sph", "cyl", "axis", "prism", "base", "pd"], multifocal: ["sph", "cyl", "axis", "add", "prism", "base", "pd", "seg"] };
const typedAxis = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 3);
const TYPED = { sph: typedSigned, cyl: typedSigned, add: typedSigned, axis: typedAxis, prism: typedDecimal, pd: typedDecimal, seg: typedDecimal };
const WORN_SOURCES = ["previous_rx", "lensometer", "prior_sale"];
const FRAME_FIELDS = ["lens_width", "bridge", "temple", "lens_height", "total_width"];
const FRAME_LABEL = { lens_width: "lensWidth", bridge: "bridge", temple: "temple", lens_height: "lensHeight", total_width: "totalWidth" };
const FRAME_PH = { lens_width: "50", bridge: "18", temple: "140", lens_height: "35", total_width: "136" };
// Tema de ayuda (HelpTip) de cada columna de la cuadrícula.
const HELP = { sph: "pos.rx.sph", cyl: "pos.rx.cyl", axis: "pos.rx.axis", add: "pos.rx.add", prism: "pos.rx.prism", base: "pos.rx.base", pd: "pos.rx.pd", seg: "pos.rx.seg" };

/**
 * Cuadrícula de una receta.
 * - `value`/`onChange`: el formulario (ver EMPTY_RX en rxRules.js); `type` manda sobre `value.type`.
 * - `mode`: "new" (receta nueva: fecha y origen) o "worn" (lo que usa hoy: origen,
 *   fecha exacta o aproximada, medidas del armazón e historial).
 * - `errors`/`warnings`: resultado de validateRx; si no vienen se calcula aquí.
 * - `showErrors`: enseña también lo que falta (no solo lo que está mal) — al intentar avanzar.
 */
export default function RxForm({
  value, onChange, type, onTypeChange, mode = "new", disabled = false, errors, warnings, showErrors = false, idp = "rx",
  source = "manual", worn, onWornChange, wornFrame, onWornFrameChange, history = [],
}) {
  const { t } = useLang();
  const [touched, setTouched] = useState({});
  const rxType = type || value.type || inferType(value);
  const v = { ...validateRx(value, rxType, { mode }), ...(errors ? { errors } : {}), ...(warnings ? { warnings } : {}) };
  const cols = COLS[rxType] || COLS.sv;
  const touch = (id) => setTouched((x) => (x[id] ? x : { ...x, [id]: true }));
  const changeType = (next) => { onChange(withType(value, next)); onTypeChange?.(next); };

  // Un error de rango se enseña en cuanto existe; lo que falta, al salir de la casilla o al intentar avanzar.
  const visible = (id, err, filled) => (err && (filled || showErrors || touched[id]) ? err : null);
  const eyeErr = (eye, k) => visible(`${eye}-${k}`, v.errors[eye]?.[k], value[eye][k] !== "");
  const eyeCell = (eye, k) => {
    const err = eyeErr(eye, k);
    const id = `${idp}-${eye}-${k}`;
    const label = `${t(`adm.pos.rx.${eye}`)} ${t(`adm.pos.rx.${k}`)}`;
    if (k === "base") {
      const off = disabled || !(Number(value[eye].prism) > 0);
      return (
        <td key={k} className={err ? "err" : ""}>
          <select id={id} value={value[eye].base} disabled={off} aria-label={label} aria-invalid={err ? true : undefined} title={err ? t(err) : t("adm.pos.rx.base")}
            onChange={(e) => onChange(setEyeField(value, eye, "base", e.target.value))} onBlur={() => touch(`${eye}-base`)}>
            <option value="">—</option>
            {PRISM_BASES.map((b) => <option key={b} value={b}>{t(`adm.pos.rx.base.${b}`)}</option>)}
          </select>
        </td>
      );
    }
    const off = disabled || (k === "axis" && (Number(value[eye].cyl) || 0) === 0);
    return (
      <td key={k} className={err ? "err" : ""}>
        <input id={id} inputMode={k === "axis" ? "numeric" : "decimal"} maxLength={LIMITS.measure} disabled={off} value={value[eye][k]} aria-label={label} aria-invalid={err ? true : undefined} title={err ? t(err) : undefined}
          onChange={(e) => onChange(setEyeField(value, eye, k, TYPED[k](e.target.value)))}
          onBlur={() => { touch(`${eye}-${k}`); const n = normalizeField(k, value[eye][k]); if (n !== value[eye][k]) onChange(setEyeField(value, eye, k, n)); }} />
      </td>
    );
  };
  const pdCell = (eye) => {
    const k = eye === "od" ? "pd_od" : "pd_os";
    const err = visible(k, v.errors[k], value[k] !== "");
    return (
      <td key="pd" className={err ? "err" : ""}>
        <input id={`${idp}-${k}`} inputMode="decimal" maxLength={LIMITS.measure} disabled={disabled} value={value[k]} aria-label={`${t(`adm.pos.rx.${eye}`)} ${t("adm.pos.rx.dnp")}`} aria-invalid={err ? true : undefined} title={err ? t(err) : t("adm.pos.rx.dnp")}
          onChange={(e) => onChange(setPd(value, eye, typedDecimal(e.target.value)))}
          onBlur={() => { touch(k); const n = normalizeField(k, value[k]); if (n !== value[k]) onChange(setPd(value, eye, n)); }} />
      </td>
    );
  };
  const segCell = (eye) => {
    const err = visible("seg", v.errors.seg_height, value.seg_height !== "");
    const warn = v.warnings.seg_height;
    if (eye === "os") return <td key="seg" className="mirror"><input value={value.seg_height} disabled readOnly tabIndex={-1} aria-hidden="true" title={t("adm.pos.rx.altMirror")} /></td>;
    return (
      <td key="seg" className={err ? "err" : warn ? "warn" : ""}>
        <input id={`${idp}-seg`} inputMode="decimal" maxLength={LIMITS.measure} disabled={disabled} value={value.seg_height} aria-label={t("adm.pos.rx.alt")} aria-invalid={err ? true : undefined} title={err ? t(err) : warn ? t(warn) : t("adm.pos.rx.alt")}
          onChange={(e) => onChange({ ...value, seg_height: typedDecimal(e.target.value) })}
          onBlur={() => { touch("seg"); const n = normalizeField("seg_height", value.seg_height); if (n !== value.seg_height) onChange({ ...value, seg_height: n }); }} />
      </td>
    );
  };
  const cell = (eye, k) => (k === "pd" ? pdCell(eye) : k === "seg" ? segCell(eye) : eyeCell(eye, k));

  // Lista de lo que hay que corregir, bajo la cuadrícula (la casilla solo se marca en rojo).
  const problems = [];
  for (const eye of ["od", "os"]) for (const k of cols) if (k !== "pd" && k !== "seg") { const e = eyeErr(eye, k); if (e) problems.push({ id: `${eye}-${k}`, where: `${t(`adm.pos.rx.${eye}`)} · ${t(`adm.pos.rx.h.${k}`)}`, key: e }); }
  for (const [k, eye] of [["pd_od", "od"], ["pd_os", "os"]]) { const e = visible(k, v.errors[k], value[k] !== ""); if (e) problems.push({ id: k, where: `${t(`adm.pos.rx.${eye}`)} · ${t("adm.pos.rx.h.pd")}`, key: e }); }
  if (cols.includes("seg")) { const e = visible("seg", v.errors.seg_height, value.seg_height !== ""); if (e) problems.push({ id: "seg", where: t("adm.pos.rx.h.seg"), key: e }); }
  const notes = [v.warnings.seg_height && cols.includes("seg") && { id: "w-seg", key: v.warnings.seg_height }, v.warnings.pd && { id: "w-pd", key: v.warnings.pd }].filter(Boolean);
  const bin = binocularPd(value);

  return (
    <div className={`pos-rx pos-rx--${mode}`}>
      <div className="adm-help-row">
        <div className="pos-rx-type" role="radiogroup" aria-label={t("adm.pos.rx.type")}>
          {RX_TYPES.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={rxType === k} className={rxType === k ? "on" : ""} disabled={disabled} onClick={() => rxType !== k && changeType(k)}>{t(`adm.pos.rx.type.${k}`)}</button>
          ))}
        </div>
        <HelpTip topic="pos.rx.type" />
      </div>
      <div className="pos-rx-scroll">
        <table className={`pos-rx-grid cols-${cols.length}`}>
          <thead>
            <tr><th><HelpTip topic="pos.rx.howToRead" size={13} /></th>{cols.map((k) => <th key={k} title={t(k === "pd" ? "adm.pos.rx.dnp" : k === "seg" ? "adm.pos.rx.alt" : k === "base" ? "adm.pos.rx.base" : `adm.pos.rx.${k}`)}>{t(`adm.pos.rx.h.${k}`)}<HelpTip topic={HELP[k]} size={12} /></th>)}</tr>
          </thead>
          <tbody>
            {["od", "os"].map((eye) => <tr key={eye}><th scope="row">{t(`adm.pos.rx.${eye}`)}</th>{cols.map((k) => cell(eye, k))}</tr>)}
          </tbody>
        </table>
      </div>
      <div className="pos-rx-meta">
        {mode === "new" ? (
          <>
            <label>{t("adm.pos.rx.date")}<input type="date" max={new Date().toISOString().slice(0, 10)} value={value.rx_date || ""} disabled={disabled} onChange={(e) => onChange({ ...value, rx_date: e.target.value })} /></label>
            <span className="pos-rx-tag" title={t("adm.pos.rx.origin")}>{t("adm.pos.rx.origin")}: <b>{t(`adm.pos.rx.origin.${source === "ocr" ? "ocr" : "manual"}`)}</b></span>
          </>
        ) : (
          <>
            <label>{t("adm.pos.rx.source")}
              <select value={worn?.source || "previous_rx"} disabled={disabled} onChange={(e) => onWornChange?.({ ...worn, source: e.target.value })}>
                {WORN_SOURCES.map((s) => <option key={s} value={s}>{t(`adm.pos.rx.src.${s}`)}</option>)}
              </select>
            </label>
            <label>{t("adm.pos.worn.when")}
              <select value={worn?.dateMode || "exact"} disabled={disabled} onChange={(e) => onWornChange?.({ ...worn, dateMode: e.target.value })} title={t("adm.pos.rx.when")}>
                <option value="exact">{t("adm.pos.rx.exact")}</option>
                <option value="approx">{t("adm.pos.rx.approx")}</option>
              </select>
            </label>
            {worn?.dateMode === "approx"
              ? <label>{t("adm.pos.rx.monthsAgo")}<input inputMode="numeric" maxLength={3} value={worn?.months || ""} disabled={disabled} onChange={(e) => onWornChange?.({ ...worn, months: e.target.value.replace(/\D/g, "") })} /></label>
              : <label>{t("adm.pos.rx.date")}<input type="date" max={new Date().toISOString().slice(0, 10)} value={worn?.date || ""} disabled={disabled} onChange={(e) => onWornChange?.({ ...worn, date: e.target.value })} /></label>}
          </>
        )}
        <span className="pos-rx-tag pd">{bin == null ? t("adm.pos.rx.pdBinMissing") : t("adm.pos.rx.pdBin", { v: bin.toFixed(1) })}</span>
      </div>
      {problems.length > 0 && (
        <ul className="pos-rx-errs" role="alert">
          {problems.map((p) => <li key={p.id}><b>{p.where}</b> {t(p.key)}</li>)}
        </ul>
      )}
      {notes.length > 0 && <ul className="pos-rx-warns">{notes.map((n) => <li key={n.id}>{t(n.key)}</li>)}</ul>}

      {mode === "worn" && (
        <>
          {history.length > 1 && (
            <details className="pos-history">
              <summary>{t("adm.pos.rx.history", { n: history.length })}</summary>
              <ul>
                {history.map((h) => (
                  <li key={h.id}>
                    <b>{h.rx_number || h.kind || "—"}</b> · {h.rx_date || h.created_at?.slice(0, 10)}
                    {h.change && <> · {t("adm.pos.change.se")} {h.change.max_se == null ? "—" : h.change.max_se.toFixed(2)} {h.change.significant ? "⚠" : ""}</>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {wornFrame && (
            <fieldset className="pos-rx-frame">
              <legend title={t("adm.pos.worn.frameHint")}>{t("adm.pos.worn.frame")} <small>mm</small></legend>
              {FRAME_FIELDS.map((k) => (
                <label key={k} title={t(`adm.pos.worn.${FRAME_LABEL[k]}`)}>
                  {t(`adm.pos.worn.s.${FRAME_LABEL[k]}`)}
                  <input inputMode="decimal" maxLength={LIMITS.measure} value={wornFrame[k]} disabled={disabled} placeholder={FRAME_PH[k]} aria-label={t(`adm.pos.worn.${FRAME_LABEL[k]}`)}
                    onChange={(e) => onWornFrameChange?.({ ...wornFrame, [k]: typedDecimal(e.target.value) })} />
                </label>
              ))}
              <label title={t("adm.pos.worn.condition")}>
                {t("adm.pos.worn.s.condition")}
                <select value={wornFrame.condition} disabled={disabled} aria-label={t("adm.pos.worn.condition")} onChange={(e) => onWornFrameChange?.({ ...wornFrame, condition: e.target.value })}>
                  {["good", "fair", "poor"].map((c) => <option key={c} value={c}>{t(`adm.pos.worn.cond.${c}`)}</option>)}
                </select>
              </label>
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}
