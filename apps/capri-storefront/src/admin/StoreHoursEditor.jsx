// Dónde se usa: Tiendas → botón «Horario» de cada tienda. El horario de
// apertura y cierre de la semana y los días especiales (feriados, días
// cortos). Se guarda en la tienda (POST /admin/establishments/:id { hours });
// lo usan el directorio («Abierta · cierra 18:00»), los recibos (la semana en
// una línea) y la caja, que avisa si se vende fuera de horario.
// Lógica compartida con el servidor: storeHours.js ↔ backend lib/store-hours.ts.
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { updateStore } from "./adminStores.js";
import { DEFAULT_HOURS, WEEKDAYS, problemOf, weekLine } from "./storeHours.js";

const clone = (h) => JSON.parse(JSON.stringify(h));

export default function StoreHoursEditor({ store, onSaved, onClose, disabled }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [hours, setHours] = useState(() => clone(store.hours || DEFAULT_HOURS));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const names = WEEKDAYS.map((d) => t(`adm.hours.short.${d}`));

  const setDay = (d, patch) => setHours((h) => ({ ...h, week: { ...h.week, [d]: { ...h.week[d], ...patch } } }));
  const toggleDay = (d) => setHours((h) => {
    const cur = h.week[d];
    return { ...h, week: { ...h.week, [d]: cur.closed ? { open: "09:00", close: "18:00" } : { closed: true } } };
  });
  const copyMonday = () => setHours((h) => ({ ...h, week: { ...h.week, ...Object.fromEntries(["tue", "wed", "thu", "fri"].map((d) => [d, { ...h.week.mon }])) } }));
  const setSpecial = (i, patch) => setHours((h) => ({ ...h, special: h.special.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const addSpecial = () => setHours((h) => ({ ...h, special: [...(h.special || []), { date: "", label: "", closed: true, open: null, close: null }] }));
  const removeSpecial = (i) => setHours((h) => ({ ...h, special: h.special.filter((_, j) => j !== i) }));

  const save = async (value) => {
    const p = problemOf(value);
    if (p) {
      setErr(p.day ? t("adm.hours.err.day", { day: t(`adm.hours.day.${p.day}`) }) : t("adm.hours.err.date", { date: p.date }));
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const body = value && {
        week: value.week,
        special: (value.special || []).map((s) => (s.closed ? { date: s.date, label: s.label || null, closed: true } : { date: s.date, label: s.label || null, open: s.open, close: s.close })),
      };
      const r = await updateStore(store.id, { hours: body });
      toast({ tone: "success", title: t(value ? "adm.hours.saved" : "adm.hours.cleared") });
      onSaved?.(r.establishments || null);
    } catch (e) {
      setErr(t(e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-card sh-card">
      <div className="sh-head">
        <h3><Icon name="clock" size={16} />{t("adm.hours.title", { store: `${store.code} · ${store.name}` })}</h3>
        <button type="button" className="btn-xs" onClick={onClose}><Icon name="close" size={12} />{t("adm.hours.close")}</button>
      </div>
      <p className="adm-sub">{t("adm.hours.sub")}</p>
      <p className="sh-preview"><Icon name="receipt" size={13} /> {weekLine(hours, names, t("adm.hours.closedWord"))}</p>

      <div className="sh-week">
        {WEEKDAYS.map((d) => {
          const day = hours.week[d];
          return (
            <div key={d} className={`sh-row ${day.closed ? "closed" : ""}`}>
              <b className="sh-day">{t(`adm.hours.day.${d}`)}</b>
              <button type="button" role="switch" aria-checked={!day.closed} className={`sh-switch ${day.closed ? "" : "on"}`} disabled={disabled || busy} onClick={() => toggleDay(d)}>
                <span aria-hidden="true" />{t(day.closed ? "adm.hours.closed" : "adm.hours.open")}
              </button>
              {!day.closed && (
                <span className="sh-times">
                  <input type="time" aria-label={t("adm.hours.opens")} value={day.open || ""} disabled={disabled || busy} onChange={(e) => setDay(d, { open: e.target.value })} />
                  <span aria-hidden="true">–</span>
                  <input type="time" aria-label={t("adm.hours.closes")} value={day.close || ""} disabled={disabled || busy} onChange={(e) => setDay(d, { close: e.target.value })} />
                </span>
              )}
              {d === "mon" && !day.closed && <button type="button" className="btn-xs sh-copy" disabled={disabled || busy} onClick={copyMonday}><Icon name="copy" size={12} />{t("adm.hours.copyMonday")}</button>}
            </div>
          );
        })}
      </div>

      <h4 className="sh-sub">{t("adm.hours.special")}</h4>
      <p className="adm-sub">{t("adm.hours.specialSub")}</p>
      {(hours.special || []).map((s, i) => (
        <div key={i} className="sh-special">
          <input type="date" aria-label={t("adm.hours.date")} value={s.date} disabled={disabled || busy} onChange={(e) => setSpecial(i, { date: e.target.value })} />
          <input className="adm-input" maxLength={60} placeholder={t("adm.hours.labelPh")} aria-label={t("adm.hours.label")} value={s.label || ""} disabled={disabled || busy} onChange={(e) => setSpecial(i, { label: e.target.value })} />
          <button type="button" role="switch" aria-checked={!s.closed} className={`sh-switch ${s.closed ? "" : "on"}`} disabled={disabled || busy} onClick={() => setSpecial(i, s.closed ? { closed: false, open: "09:00", close: "13:00" } : { closed: true, open: null, close: null })}>
            <span aria-hidden="true" />{t(s.closed ? "adm.hours.closed" : "adm.hours.open")}
          </button>
          {!s.closed && (
            <span className="sh-times">
              <input type="time" aria-label={t("adm.hours.opens")} value={s.open || ""} disabled={disabled || busy} onChange={(e) => setSpecial(i, { open: e.target.value })} />
              <span aria-hidden="true">–</span>
              <input type="time" aria-label={t("adm.hours.closes")} value={s.close || ""} disabled={disabled || busy} onChange={(e) => setSpecial(i, { close: e.target.value })} />
            </span>
          )}
          <button type="button" className="btn-xs" aria-label={t("adm.hours.remove")} title={t("adm.hours.remove")} disabled={disabled || busy} onClick={() => removeSpecial(i)}><Icon name="trash" size={12} /></button>
        </div>
      ))}
      <button type="button" className="btn-xs" disabled={disabled || busy || (hours.special || []).length >= 60} onClick={addSpecial}><Icon name="plus" size={12} />{t("adm.hours.addSpecial")}</button>

      {err && <div className="adm-demo-banner sh-err" role="alert">{err}</div>}
      <div className="adm-actions sh-actions">
        <button type="button" className="btn-sm primary" disabled={disabled || busy} onClick={() => save(hours)}><Icon name="save" size={14} />{busy ? "…" : t("adm.hours.save")}</button>
        {store.hours && <button type="button" className="btn-sm" disabled={disabled || busy} onClick={() => save(null)}><Icon name="close" size={14} />{t("adm.hours.clear")}</button>}
      </div>
    </div>
  );
}
