// Dónde se usa: Nueva venta → paso Pago (PosSale.jsx). Dueño, 18-nov-2026:
// «cuando se registre una venta se debe poder poner fecha retroactiva».
//
// Por defecto la venta es de hoy. «Otra fecha» abre el día (atajos Ayer /
// Anteayer / Hace una semana / Hace un mes), la hora opcional y una nota (por
// qué: «sistema caído», «venta en papel»). Dueño, 19-nov-2026: hasta un año
// atrás y que la contabilidad cuadre. Por eso se elige además:
//  - «El dinero se cobró»: ESE DÍA (por defecto: los cobros llevan la fecha de
//    la venta y no entran en ninguna caja: esa caja ya se contó) u HOY (entra
//    en la caja abierta de hoy, como cualquier cobro);
//  - «El paciente ya se llevó los lentes»: se entrega con esa fecha, sin
//    bandeja y sin mensaje al paciente (solo con la venta pagada). Se enciende
//    sola cuando la fecha es de hace más de 30 días.
// Precios y promociones son los de hoy. La venta guarda cuándo se registró de
// verdad y quién. El servidor vuelve a comprobar todo (lib/sale-date.ts: nunca
// futuro; hasta 366 días o lo que el dueño fije por rol).
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { localClock } from "./storeHours.js";
import "./sale-date.css";

export const EMPTY_SOLD_ON = { open: false, date: "", time: "", note: "", moneyOn: "sale", delivered: false, deliveredTouched: false };
/** Más atrás que esto, se da por entregada (se puede quitar). */
export const DELIVERED_AFTER_DAYS = 30;
const daysBack = (ymd, today) => Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${ymd}T12:00:00Z`)) / 86400000);
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

/** «Ya se entregó» con saldo pendiente: no se puede (el servidor responde sold_on_delivered_balance). */
export const soldOnDeliveredProblem = (v, today, balance) => (soldOnBody(v, today)?.delivered && balance > 0.004 ? "adm.err.pos.sold_on_delivered_balance" : null);

/** Lo que se manda al servidor: null = hoy. */
export const soldOnBody = (v, today) =>
  v?.open && v.date && v.date !== today
    ? { date: v.date, time: v.time || null, note: (v.note || "").trim() || null, money_on: v.moneyOn === "today" ? "today" : "sale", delivered: v.delivered === true }
    : null;

export default function SaleDateCard({ value, onChange, timeZone, maxDays = 366, disabled = false, balance = 0 }) {
  const { t, lang } = useLang();
  const today = todayIn(timeZone);
  const min = addDays(today, -maxDays);
  const set = (patch) => {
    const next = { ...value, ...patch };
    // Una venta vieja ya se entregó, salvo que la persona diga otra cosa.
    if (patch.date && !next.deliveredTouched) next.delivered = daysBack(patch.date, today) > DELIVERED_AFTER_DAYS;
    onChange(next);
  };
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
            {[0, 1, 2, 7, 30].filter((n) => n <= maxDays).map((n) => {
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
          {back && (
            <div className="sdt-opts">
              <div className="sdt-money" role="radiogroup" aria-label={t("adm.sdt.money")}>
                <span>{t("adm.sdt.money")}</span>
                {["sale", "today"].map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={value.moneyOn === k} className={value.moneyOn === k ? "on" : ""} disabled={disabled} onClick={() => set({ moneyOn: k })}>{t(`adm.sdt.money.${k}`)}</button>
                ))}
              </div>
              <label className="sdt-check">
                <input type="checkbox" checked={value.delivered} disabled={disabled} onChange={(e) => set({ delivered: e.target.checked, deliveredTouched: true })} />
                <span>{t("adm.sdt.delivered")}<small>{t("adm.sdt.deliveredHint")}</small></span>
              </label>
              {value.delivered && balance > 0.004 && <p className="sdt-msg bad" role="alert"><Icon name="alert" size={13} /> {t("adm.err.pos.sold_on_delivered_balance")}</p>}
            </div>
          )}
          {problem ? (
            <p className="sdt-msg bad" role="alert"><Icon name="alert" size={13} /> {t(problem, { max: maxDays, min: fmt(min) })}</p>
          ) : back ? (
            <div className="sdt-msg warn" role="status">
              <b><Icon name="clock" size={13} /> {t("adm.sdt.willBe", { date: fmt(value.date), time: value.time || "12:00" })}</b>
              <ul>
                <li>{t("adm.sdt.what1")}</li>
                <li>{t(value.moneyOn === "today" ? "adm.sdt.what2today" : "adm.sdt.what2sale")}</li>
                {value.delivered && <li>{t("adm.sdt.what4")}</li>}
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
