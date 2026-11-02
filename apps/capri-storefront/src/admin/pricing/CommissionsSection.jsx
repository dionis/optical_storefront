// Dónde se usa: «Precios y costos» → acordeón «Comisiones».
// La comisión por defecto y la de cada persona que vende, aquí y no en otra
// pestaña: el dueño pidió «en el mismo sitio: comisiones, costos fijos, costos
// variables, impuestos, para saber dónde ir si quiere cambiar algo concreto».
import { useEffect, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import HelpTip from "../HelpTip.jsx";
import { savePricingCommissions } from "./api.js";

export default function CommissionsSection({ commissions, onSaved, onError }) {
  const { t } = useLang();
  const [defaultPct, setDefaultPct] = useState(commissions.default_pct == null ? "" : String(commissions.default_pct));
  const [pcts, setPcts] = useState(() => Object.fromEntries(commissions.sellers.map((s) => [s.id, String(s.pct)])));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDefaultPct(commissions.default_pct == null ? "" : String(commissions.default_pct));
    setPcts(Object.fromEntries(commissions.sellers.map((s) => [s.id, String(s.pct)])));
  }, [commissions]);

  const dirty = commissions.sellers.filter((s) => String(s.pct) !== String(pcts[s.id] ?? s.pct));
  const defaultDirty = String(commissions.default_pct ?? "") !== String(defaultPct);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || (!dirty.length && !defaultDirty)) return;
    setBusy(true);
    try {
      onSaved(
        await savePricingCommissions({
          ...(defaultDirty ? { defaultPct } : {}),
          ...(dirty.length ? { sellers: dirty.map((s) => ({ id: s.id, pct: pcts[s.id] })) } : {}),
        })
      );
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="pp-row">
        <label htmlFor="pp-comm-default">
          {t("adm.price.comm.default")}
          <HelpTip topic="price.commission" />
        </label>
        <input
          id="pp-comm-default"
          className="pp-input pp-num"
          type="number"
          step="0.01"
          min="0"
          max="100"
          value={defaultPct}
          onChange={(e) => setDefaultPct(e.target.value)}
        />
        <span className="pp-unit">%</span>
        <span className="pp-now">{t("adm.price.comm.defaultHint")}</span>
      </div>
      <ul className="pp-list">
        {commissions.sellers.map((s) => (
          <li key={s.id}>
            <span className="pp-name">{s.name}</span>
            <span className="pp-sub">{s.code}</span>
            {!s.active && <span className="pp-badge">{t("adm.price.comm.inactive")}</span>}
            <input
              className="pp-input pp-num"
              type="number"
              step="0.01"
              min="0"
              max="100"
              aria-label={`${t("adm.price.comm.pct")} · ${s.name}`}
              value={pcts[s.id] ?? ""}
              onChange={(e) => setPcts((p) => ({ ...p, [s.id]: e.target.value }))}
            />
            <span className="pp-unit">%</span>
          </li>
        ))}
        {!commissions.sellers.length && <li className="pp-empty">{t("adm.price.comm.empty")}</li>}
      </ul>
      <div className="pp-row">
        <button className="btn-xs primary" disabled={busy || (!dirty.length && !defaultDirty)}>
          {t("adm.price.comm.saveAll")}
        </button>
      </div>
    </form>
  );
}
