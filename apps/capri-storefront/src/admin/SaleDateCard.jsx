// Dónde se usa: Nueva venta → paso Pago (PosSale.jsx). Dueño, 18-nov-2026:
// «cuando se registre una venta se debe poder poner fecha retroactiva».
//
// Por defecto la venta es de hoy. «Otra fecha» abre el día (atajos Ayer /
// Anteayer), la hora opcional y una nota (por qué: «sistema caído», «venta en
// papel»). Explica lo que cambia y lo que no: la venta cuenta ese día en
// informes, recibo y tableros; el cobro de hoy entra en la caja de hoy; precios
// y promociones son los de hoy. El servidor vuelve a comprobar todo
// (lib/sale-date.ts: nunca futuro; vendedor 7 días, encargado y supervisor 31,
// dueño y superadmin 366).
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { localClock } from "./storeHours.js";
import "./sale-date.css";

export const EMPTY_SOLD_ON = { open: false, date: "", time: "", note: "" };
export const SOLD_ON_NOTE_MAX = 200;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const todayIn = (timeZone, now = new Date()) => localClock(now, timeZone).ymd;

/** Lo que impide registrar con esa fecha (clave del diccionario), o null. Misma regla que el servidor. */
export function soldOnProblem(v, today, maxDays) {
  if (!v?.open || !v.date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return "adm.sdt.err.invalid";
  if (v.date > today) return "adm.sdt.err.future";
  if (v.date < addDays(today, -maxDays)) return "adm.sdt.err.tooOld";
  if (v.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)) return "adm.sdt.err.invalid";
  if ((v.note || "").length > SOLD_ON_NOTE_MAX) return "adm.sdt.err.invalid";
  return null;
}

/** Lo que se manda al servidor: null = hoy. */
export const soldOnBody = (v, today) => (v?.open && v.date && v.date !== today ? { date: v.date, time: v.time || null, note: v.note.trim() || null } : null);

export default function SaleDateCard({ value, onChange, timeZone, maxDays = 7, disabled = false }) {
  const { t, lang } = useLang();
  const today = todayIn(timeZone);
  const min = addDays(today, -maxDays);
  const set = (patch) => onChange({ ...value, ...patch });
  const fmt = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(lang === "en" ? "en-US" : "es-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const back = value.open && value.date && value.date !== today;
  const problem = soldOnProblem(value, today, maxDays);
  return (
    <fieldset className={`sdt-card ${back ? "is-back" : ""}`}>
      <legend><Icon name="calendar" size={13} /> {t("adm.sdt.title")}</legend>
      {!value.open ? (
        <div className="sdt-row">
          <span className="sdt-today"><b>{t("adm.sdt.today")}</b> · {fmt(today)}</span>
          <button type="button" className="btn-xs" disabled={disabled} onClick={() => set({ open: true, date: addDays(today, -1) })}><Icon name="edit" size={12} /> {t("adm.sdt.other")}</button>
        </div>
      ) : (
        <>
          <div className="sdt-quick" role="group" aria-label={t("adm.sdt.title")}>
            {[0, 1, 2].map((n) => {
              const d = addDays(today, -n);
              return <button key={n} type="button" className={value.date === d ? "on" : ""} disabled={disabled} onClick={() => set({ date: d })}>{t(`adm.sdt.q${n}`)}</button>;
            })}
          </div>
          <div className="sdt-fields">
            <label>{t("adm.sdt.date")}
              <input type="date" value={value.date} min={min} max={today} disabled={disabled} onChange={(e) => set({ date: e.target.value })} aria-invalid={problem ? true : undefined} />
            </label>
            <label>{t("adm.sdt.time")} <small>{t("adm.sdt.optional")}</small>
              <input type="time" value={value.time} disabled={disabled} onChange={(e) => set({ time: e.target.value })} />
            </label>
            <label className="sdt-note">{t("adm.sdt.note")} <small>{t("adm.sdt.optional")}</small>
              <input type="text" value={value.note} maxLength={SOLD_ON_NOTE_MAX} disabled={disabled} placeholder={t("adm.sdt.notePh")} onChange={(e) => set({ note: e.target.value })} />
            </label>
          </div>
          {problem ? (
            <p className="sdt-msg bad" role="alert"><Icon name="alert" size={13} /> {t(problem, { max: maxDays, min: fmt(min) })}</p>
          ) : back ? (
            <div className="sdt-msg warn" role="status">
              <b><Icon name="clock" size={13} /> {t("adm.sdt.willBe", { date: fmt(value.date), time: value.time || "12:00" })}</b>
              <ul>
                <li>{t("adm.sdt.what1")}</li>
                <li>{t("adm.sdt.what2")}</li>
                <li>{t("adm.sdt.what3")}</li>
              </ul>
            </div>
          ) : (
            <p className="sdt-msg">{t("adm.sdt.isToday")}</p>
          )}
          <div className="sdt-row end">
            <small className="muted">{t("adm.sdt.limit", { n: maxDays })}</small>
            <button type="button" className="btn-xs" disabled={disabled} onClick={() => onChange(EMPTY_SOLD_ON)}><Icon name="undo" size={12} /> {t("adm.sdt.backToday")}</button>
          </div>
        </>
      )}
    </fieldset>
  );
}
