// Dónde se usa: Configuración del POS → «Recargos de laboratorio por graduación»
// (PosConfig.jsx, solo dueño y superadmin). Dueño, 18-nov-2026: «cuando la base
// positiva es por encima de +6 el costo de laboratorio aumenta en 30; debe poder
// configurarse en la app, según referencias internacionales».
//
// Cada fila es un recargo que el laboratorio cobra a la tienda fuera del rango
// estándar (esfera positiva/negativa alta, cilindro, adición, prisma). Escalones:
// en la misma potencia y dirección cuenta solo el más alto alcanzado. Sube el
// COSTO de los lentes en los libros y en el Ejecutivo; el precio al paciente no
// cambia. Backend: lib/lab-surcharge.ts, POST /admin/pos/settings { lab_surcharges }.
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { fetchPosSettings, savePosSettings } from "./posApi.js";
import "./lab-surcharges.css";

const SCOPES = ["sph", "cyl", "add", "prism"];
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "recargo";

export default function LabSurcharges() {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [rows, setRows] = useState(null);
  const [defaults, setDefaults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    fetchPosSettings().then((r) => { setRows(r.settings.lab_surcharges || []); setDefaults(r.defaults?.lab_surcharges || []); }).catch((e) => toast({ tone: "error", title: t(e.message) }));
  }, [t, toast]);
  if (!rows) return null;
  const set = (i, patch) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true); };
  const add = () => {
    const base = { label: t("adm.ls.newLabel"), scope: "sph", op: "gt", threshold: 4, cost: 10, active: true };
    let id = slug(`${base.scope}-${base.threshold}`); let n = 2;
    while (rows.some((r) => r.id === id)) id = `${slug(`${base.scope}-${base.threshold}`)}-${n++}`;
    setRows((rs) => [...rs, { ...base, id }]); setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    const clean = rows.map((r) => ({ ...r, threshold: Number(r.threshold), cost: Number(r.cost), op: r.scope === "sph" ? r.op : "gt" }));
    try { const r = await savePosSettings({ lab_surcharges: clean }); setRows(r.settings.lab_surcharges); setDirty(false); toast({ tone: "success", title: t("adm.pos.cfg.saved") }); }
    catch (e) { toast({ tone: "error", title: t(e.message) }); } finally { setBusy(false); }
  };
  const sign = (v) => (Number(v) > 0 ? `+${Number(v).toFixed(2)}` : Number(v).toFixed(2));
  const ruleText = (r) => (r.scope === "sph" ? t(r.op === "gt" ? "adm.ls.ruleSphGt" : "adm.ls.ruleSphLt", { v: sign(r.threshold) }) : t(`adm.ls.rule.${r.scope}`, { v: Number(r.threshold).toFixed(2) }));
  return (
    <div className="adm-card ls">
      <h3><Icon name="lens" size={16} /> {t("adm.ls.title")}</h3>
      <p className="adm-sub">{t("adm.ls.sub")}</p>
      <div className="ls-scroll">
        <table className="ls-table">
          <thead>
            <tr><th>{t("adm.ls.col.on")}</th><th>{t("adm.ls.col.label")}</th><th>{t("adm.ls.col.power")}</th><th>{t("adm.ls.col.when")}</th><th>{t("adm.ls.col.threshold")}</th><th>{t("adm.ls.col.cost")}</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={r.active ? "" : "off"}>
                <td data-label={t("adm.ls.col.on")}><input type="checkbox" role="switch" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} aria-label={`${t("adm.ls.col.on")} · ${r.label}`} /></td>
                <td data-label={t("adm.ls.col.label")}><input value={r.label} maxLength={80} onChange={(e) => set(i, { label: e.target.value })} aria-label={t("adm.ls.col.label")} /></td>
                <td data-label={t("adm.ls.col.power")}>
                  <select value={r.scope} onChange={(e) => set(i, { scope: e.target.value, op: e.target.value === "sph" ? r.op : "gt", threshold: e.target.value === "sph" ? r.threshold : Math.abs(Number(r.threshold) || 0) })} aria-label={t("adm.ls.col.power")}>
                    {SCOPES.map((s) => <option key={s} value={s}>{t(`adm.ls.scope.${s}`)}</option>)}
                  </select>
                </td>
                <td data-label={t("adm.ls.col.when")}>
                  {r.scope === "sph" ? (
                    <select value={r.op} onChange={(e) => set(i, { op: e.target.value })} aria-label={t("adm.ls.col.when")}>
                      <option value="gt">{t("adm.ls.op.gt")}</option>
                      <option value="lt">{t("adm.ls.op.lt")}</option>
                    </select>
                  ) : <span className="muted">{t("adm.ls.op.absGt")}</span>}
                </td>
                <td data-label={t("adm.ls.col.threshold")}><input type="number" step="0.25" value={r.threshold} onChange={(e) => set(i, { threshold: e.target.value })} aria-label={t("adm.ls.col.threshold")} /></td>
                <td data-label={t("adm.ls.col.cost")}><span className="ls-money">$<input type="number" min="0" step="0.5" value={r.cost} onChange={(e) => set(i, { cost: e.target.value })} aria-label={t("adm.ls.col.cost")} /></span></td>
                <td><button type="button" className="btn-xs warn" onClick={() => { setRows((rs) => rs.filter((_, j) => j !== i)); setDirty(true); }} aria-label={t("adm.ls.remove")} title={t("adm.ls.remove")}><Icon name="trash" size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="ls-preview">
        {rows.filter((r) => r.active && Number(r.cost) > 0).map((r) => <li key={r.id}>{ruleText(r)} → <b>+${Number(r.cost).toFixed(2)}</b> {t("adm.ls.perJob")}</li>)}
      </ul>
      <p className="adm-sub ls-note">{t("adm.ls.note")}</p>
      <div className="ls-actions">
        <button type="button" className="btn-sm" onClick={add} disabled={rows.length >= 20}><Icon name="plus" size={14} /> {t("adm.ls.add")}</button>
        <button type="button" className="btn-sm" onClick={() => { setRows(defaults.map((d) => ({ ...d }))); setDirty(true); }}><Icon name="undo" size={14} /> {t("adm.ls.defaults")}</button>
        <button type="button" className="btn-sm primary" disabled={busy || !dirty} onClick={save}><Icon name="save" size={14} /> {t("adm.pos.cfg.save")}</button>
      </div>
    </div>
  );
}
