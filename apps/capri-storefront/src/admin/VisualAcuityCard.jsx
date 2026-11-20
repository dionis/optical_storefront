// Dónde se usa: Nueva venta → Receta nueva (PosSale.jsx), corregir la receta de
// una venta (SaleDetailPanel.jsx → SaleEditForm) y, solo lectura, la receta en
// la ficha de la venta y del paciente (VisualAcuityView). Dueño, 18-nov-2026:
// «la receta debe tener la agudeza visual con cristales y sin cristales, por
// ojos … y el ojo dominante, fácil de insertar».
//
// Rejilla OD / OI / AO × «Sin lentes (sc)» / «Con lentes (cc)». Se escribe como
// en la hoja de papel: «20», «40», «100-2», «cd», «pl»… y al salir del campo
// queda en notación estándar (20/20, 20/100-2, CF…) con su sugerencia de líneas
// (datalist). Debajo, «Mejora con lentes: OD +7 líneas». Ojo dominante: dos
// botones (OD / OI), pulsar el marcado lo quita.
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { linesGained, normalizeVa, VA_SUGGEST } from "./visualAcuity.js";
import "./visual-acuity.css";

const EYES = ["od", "os", "ou"];
const KINDS = ["sc", "cc"];

/** Texto de una agudeza para leer: los códigos de baja visión en el idioma del panel. */
export function vaText(v, t) {
  if (!v) return "—";
  return ["CF", "HM", "LP", "NLP"].includes(v) ? t(`adm.va.code.${v}`) : v;
}

export default function VisualAcuityCard({ value, onChange, disabled = false, idp = "va" }) {
  const { t } = useLang();
  const set = (k, e, v) => onChange({ ...value, va: { ...value.va, [k]: { ...value.va[k], [e]: v } } });
  const gained = linesGained({ va: { sc: mapNorm(value.va.sc), cc: mapNorm(value.va.cc) } });
  const listId = `${idp}-list`;
  return (
    <fieldset className="va-card">
      <legend><Icon name="eye" size={13} /> {t("adm.va.title")}</legend>
      <datalist id={listId}>{VA_SUGGEST.map((v) => <option key={v} value={v} label={vaText(v, t)} />)}</datalist>
      <table className="va-grid">
        <thead>
          <tr><th /><th scope="col">{t("adm.va.sc")}</th><th scope="col">{t("adm.va.cc")}</th></tr>
        </thead>
        <tbody>
          {EYES.map((e) => (
            <tr key={e}>
              <th scope="row">{t(`adm.va.eye.${e}`)}</th>
              {KINDS.map((k) => {
                const raw = value.va[k][e];
                const bad = normalizeVa(raw) === null;
                return (
                  <td key={k}>
                    <input
                      id={`${idp}-${k}-${e}`}
                      list={listId}
                      value={raw}
                      disabled={disabled}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={12}
                      placeholder="20/__"
                      aria-label={`${t(`adm.va.eye.${e}`)} · ${t(`adm.va.${k}`)}`}
                      aria-invalid={bad || undefined}
                      title={bad ? t("adm.va.bad") : undefined}
                      onChange={(ev) => set(k, e, ev.target.value)}
                      onBlur={() => { const n = normalizeVa(raw); if (n !== null && n !== raw) set(k, e, n); }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {EYES.some((e) => normalizeVa(value.va.sc[e]) === null || normalizeVa(value.va.cc[e]) === null) && <small className="va-err" role="alert">{t("adm.va.bad")}</small>}
      {EYES.some((e) => gained[e] !== null) && (
        <p className="va-gain">
          <Icon name="trendUp" size={13} /> {t("adm.va.gain")}{" "}
          {EYES.filter((e) => gained[e] !== null).map((e) => (
            <span key={e} className={gained[e] > 0 ? "up" : gained[e] < 0 ? "down" : ""}>{t(`adm.va.eye.${e}`)} {gained[e] > 0 ? "+" : ""}{t("adm.va.lines", { n: gained[e] })}</span>
          ))}
        </p>
      )}
      <div className="va-dom" role="group" aria-label={t("adm.va.dominant")}>
        <span>{t("adm.va.dominant")}</span>
        {["od", "os"].map((e) => (
          <button key={e} type="button" disabled={disabled} className={value.dominant_eye === e ? "on" : ""} aria-pressed={value.dominant_eye === e}
            onClick={() => onChange({ ...value, dominant_eye: value.dominant_eye === e ? null : e })}>
            {t(`adm.va.eye.${e}`)}
          </button>
        ))}
        <small className="muted">{t("adm.va.dominantHint")}</small>
      </div>
    </fieldset>
  );
}

function mapNorm(set) {
  const out = {};
  for (const e of EYES) out[e] = normalizeVa(set?.[e]) || "";
  return out;
}

/** Solo lectura (ficha de la venta, ficha del paciente). Nada si no se anotó nada. */
export function VisualAcuityView({ clinical }) {
  const { t } = useLang();
  if (!clinical) return null;
  const any = KINDS.some((k) => EYES.some((e) => clinical.va?.[k]?.[e]));
  if (!any && !clinical.dominant_eye) return null;
  const gained = linesGained(clinical);
  return (
    <div className="va-view">
      {any && (
        <table className="va-grid ro">
          <thead><tr><th /><th scope="col">{t("adm.va.sc")}</th><th scope="col">{t("adm.va.cc")}</th><th scope="col">{t("adm.va.gainShort")}</th></tr></thead>
          <tbody>
            {EYES.map((e) => (
              <tr key={e}>
                <th scope="row">{t(`adm.va.eye.${e}`)}</th>
                <td>{vaText(clinical.va?.sc?.[e], t)}</td>
                <td>{vaText(clinical.va?.cc?.[e], t)}</td>
                <td className={gained[e] > 0 ? "up" : ""}>{gained[e] === null ? "—" : `${gained[e] > 0 ? "+" : ""}${gained[e]}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {clinical.dominant_eye && <p className="va-dom-ro"><b>{t("adm.va.dominant")}:</b> {t(`adm.va.eye.${clinical.dominant_eye}`)}</p>}
    </div>
  );
}
