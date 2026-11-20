// Dónde se usa: Nueva venta → Receta nueva (PosSale.jsx, debajo de la agudeza
// visual), corregir la receta de una venta (SaleDetailPanel.jsx) y, solo
// lectura, la receta en la ficha de la venta y la historia clínica del paciente
// (Patients.jsx). Dueño, 19-nov-2026: «un campo de notas para que el doctor
// escriba que el paciente es diabético, tiene glaucoma… y la historia por
// paciente, según estándares ópticos».
//
// Anamnesis del examen visual completo (AOA 2023 / AAO PPP): salud general con
// repercusión ocular, antecedentes oculares, antecedentes familiares (casillas
// que se tocan, sin escribir), medicamentos y alergias (texto corto) y las notas
// del doctor. Es dato de salud: nunca sale en recibos, correos, laboratorio ni
// en la hoja. Debajo, los recordatorios clínicos que tocan (p. ej. diabetes →
// fondo de ojo dilatado cada año).
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { FAMILY_CONDITIONS, HISTORY_TEXT_MAX, historyAlerts, isEmptyHistory, OCULAR_CONDITIONS, SYSTEMIC_CONDITIONS } from "./clinicalHistory.js";
import "./clinical-history.css";

const GROUPS = [
  ["conditions", "systemic", SYSTEMIC_CONDITIONS],
  ["conditions", "ocular", OCULAR_CONDITIONS],
  ["family", "family", FAMILY_CONDITIONS],
];

const label = (t, key, code) => t(key === "family" ? `adm.ch.fam.${code}` : `adm.ch.c.${code}`);

export function HistoryAlerts({ history }) {
  const { t } = useLang();
  const alerts = historyAlerts(history);
  if (!alerts.length) return null;
  return (
    <ul className="ch-alerts" aria-label={t("adm.ch.alerts")}>
      {alerts.map((k) => <li key={k}><Icon name="alert" size={12} /> {t(k)}</li>)}
    </ul>
  );
}

export default function ClinicalHistoryCard({ value, onChange, disabled = false, idp = "ch", previous = null, onUsePrevious = null }) {
  const { t } = useLang();
  const h = value;
  const set = (patch) => onChange({ ...h, ...patch });
  const toggle = (key, code) => {
    const list = h[key] || [];
    set({ [key]: list.includes(code) ? list.filter((c) => c !== code) : [...list, code] });
  };
  const len = (k) => (h[k] || "").length;
  return (
    <fieldset className="ch-card">
      <legend><Icon name="clipboard" size={13} /> {t("adm.ch.title")}</legend>
      <p className="ch-sub">{t("adm.ch.sub")}</p>
      {previous && onUsePrevious && isEmptyHistory(h) && (
        <button type="button" className="btn-xs ch-prev" disabled={disabled} onClick={onUsePrevious}>
          <Icon name="undo" size={12} /> {t("adm.ch.usePrevious", { date: previous.date })}
        </button>
      )}
      {GROUPS.map(([key, group, codes]) => (
        <div key={group} className="ch-group" role="group" aria-labelledby={`${idp}-g-${group}`}>
          <span id={`${idp}-g-${group}`} className="ch-group-title">{t(`adm.ch.group.${group}`)}</span>
          <div className="ch-chips">
            {codes.map((code) => {
              const on = (h[key] || []).includes(code);
              return (
                <button key={code} type="button" className={`ch-chip ${on ? "on" : ""}`} aria-pressed={on} disabled={disabled} onClick={() => toggle(key, code)}>
                  {on && <Icon name="check" size={12} />} {label(t, key, code)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="ch-texts">
        <label htmlFor={`${idp}-med`}>{t("adm.ch.medications")}
          <input id={`${idp}-med`} type="text" value={h.medications} maxLength={HISTORY_TEXT_MAX.medications} disabled={disabled} placeholder={t("adm.ch.medicationsPh")} onChange={(e) => set({ medications: e.target.value })} />
        </label>
        <label htmlFor={`${idp}-all`}>{t("adm.ch.allergies")}
          <input id={`${idp}-all`} type="text" value={h.allergies} maxLength={HISTORY_TEXT_MAX.allergies} disabled={disabled} placeholder={t("adm.ch.allergiesPh")} onChange={(e) => set({ allergies: e.target.value })} />
        </label>
        <label htmlFor={`${idp}-notes`} className="ch-notes">{t("adm.ch.notes")}
          <textarea id={`${idp}-notes`} rows={3} value={h.notes} maxLength={HISTORY_TEXT_MAX.notes} disabled={disabled} placeholder={t("adm.ch.notesPh")} onChange={(e) => set({ notes: e.target.value })} />
          <small className="ch-count">{len("notes")}/{HISTORY_TEXT_MAX.notes}</small>
        </label>
      </div>
      <HistoryAlerts history={h} />
      <small className="ch-privacy"><Icon name="lock" size={11} /> {t("adm.ch.privacy")}</small>
    </fieldset>
  );
}

/** Solo lectura de la historia de una receta. Nada si no se anotó nada. */
export function ClinicalHistoryView({ history }) {
  const { t } = useLang();
  if (!history || isEmptyHistory(history)) return null;
  return (
    <div className="ch-view">
      {history.conditions?.length > 0 && <p><b>{t("adm.ch.view.conditions")}:</b> {history.conditions.map((c) => t(`adm.ch.c.${c}`)).join(" · ")}</p>}
      {history.family?.length > 0 && <p><b>{t("adm.ch.group.family")}:</b> {history.family.map((c) => t(`adm.ch.fam.${c}`)).join(" · ")}</p>}
      {history.medications && <p><b>{t("adm.ch.medications")}:</b> {history.medications}</p>}
      {history.allergies && <p><b>{t("adm.ch.allergies")}:</b> {history.allergies}</p>}
      {history.notes && <p className="ch-view-notes"><b>{t("adm.ch.notes")}:</b> {history.notes}</p>}
    </div>
  );
}

/** La historia clínica del paciente a lo largo de sus visitas (GET …/patients/:id → clinical_summary). */
export function PatientClinicalSummary({ summary, fmtDate }) {
  const { t } = useLang();
  if (!summary || !summary.visits) return <p className="pt-empty">{t("adm.ch.none")}</p>;
  return (
    <div className="ch-summary">
      {summary.conditions.length > 0 && (
        <div className="ch-sum-block">
          <span className="ch-group-title">{t("adm.ch.view.conditions")}</span>
          <ul className="ch-sum-list">
            {summary.conditions.map((c) => (
              <li key={c.code} className={c.current ? "current" : "past"}>
                <b>{t(`adm.ch.c.${c.code}`)}</b>
                <small>{c.first === c.last ? t("adm.ch.notedOn", { date: fmtDate(c.first) }) : t("adm.ch.notedFromTo", { from: fmtDate(c.first), to: fmtDate(c.last) })}{c.current ? "" : ` · ${t("adm.ch.notNow")}`}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.family.length > 0 && (
        <p className="ch-sum-line"><b>{t("adm.ch.group.family")}:</b> {summary.family.map((f) => t(`adm.ch.fam.${f.code}`)).join(" · ")}</p>
      )}
      {summary.medications && <p className="ch-sum-line"><b>{t("adm.ch.medications")}:</b> {summary.medications.text} <small>({fmtDate(summary.medications.date)})</small></p>}
      {summary.allergies && <p className="ch-sum-line"><b>{t("adm.ch.allergies")}:</b> {summary.allergies.text} <small>({fmtDate(summary.allergies.date)})</small></p>}
      <HistoryAlerts history={summary.latest ? { conditions: summary.conditions.filter((c) => c.current).map((c) => c.code), family: summary.family.map((f) => f.code) } : null} />
      {summary.notes.length > 0 && (
        <div className="ch-sum-block">
          <span className="ch-group-title">{t("adm.ch.notesHistory")}</span>
          <ol className="ch-timeline">
            {summary.notes.map((n, i) => (
              <li key={`${n.date}-${i}`}>
                <span className="ch-tl-when">{fmtDate(n.date)}{n.rx_number ? ` · ${n.rx_number}` : ""}</span>
                <span className="ch-tl-text">{n.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
