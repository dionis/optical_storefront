// Dónde se usa: «Precios y costos» → pestaña «Comisiones y costos».
// Las reglas de costo agrupadas (monturas, lentes, por pedido, porcentajes),
// cada una con su interruptor POR TIENDA — «cada tienda puede activar o
// desactivar costos» —, los costos fijos y variables de la tienda y el
// impuesto de las monturas sin receta. Los importes se editan en las fichas de
// costo; aquí se decide qué se cobra y cuánto impuesto se aplica.
//
// `part` parte el bloque en dos para que la pestaña los coloque en columnas
// distintas sin duplicar nada: "rules" es lo que cuesta CADA VENTA (las reglas
// con su interruptor) y "store" lo que cuesta EL MES más el impuesto. Sin
// `part` sale todo seguido, como antes.
import { useEffect, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import HelpTip from "../HelpTip.jsx";
import { savePricingCostToggle, savePricingTax } from "./api.js";

const GROUPS = ["frames", "lenses", "order", "percent"];

function Switch({ on, disabled, label, onChange }) {
  return (
    <label className={`pp-switch ${disabled ? "disabled" : ""}`} title={label}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export default function CostsSection({ costs, store, isStore, part = "all", onSaved, onError }) {
  const { t, lang } = useLang();
  const [tax, setTax] = useState(String(costs.taxes.rate_pct ?? 0));
  const [busy, setBusy] = useState("");

  useEffect(() => { setTax(String(costs.taxes.rate_pct ?? 0)); }, [costs.taxes.rate_pct]);

  const toggle = async (kind, refId, enabled) => {
    if (busy) return;
    setBusy(refId);
    try {
      onSaved(await savePricingCostToggle({ kind, refId, store, enabled }));
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  const saveTax = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy("tax");
    try {
      onSaved(await savePricingTax(tax));
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  const money2 = (v) => money(Number(v) || 0, "usd", lang);
  const amount = (r) => (r.unit === "percent" ? `${Number(r.value) || 0} %` : money2(r.value));

  const items = (list, title) => (
    <div className="pp-block">
      <h4>{title}</h4>
      <ul className="pp-list">
        {list.map((c) => (
          <li key={c.id} className={c.enabled === false ? "is-off" : ""}>
            <span className="pp-name">{c.description || t(`adm.costs2.cat.${c.category}`)}</span>
            <span className="pp-sub">{c.frequency}</span>
            {c.shared && <span className="pp-badge">{t("adm.price.costs.shared")}</span>}
            <span className="pp-unit">{money2(c.amount)}</span>
            <Switch
              on={c.enabled !== false}
              disabled={!isStore || busy === c.id}
              label={c.enabled === false ? t("adm.price.costs.off") : t("adm.price.costs.on")}
              onChange={(next) => toggle("cost", c.id, next)}
            />
          </li>
        ))}
        {!list.length && <li className="pp-empty">{t("adm.price.costs.empty")}</li>}
      </ul>
    </div>
  );

  const showRules = part === "all" || part === "rules";
  const showStore = part === "all" || part === "store";

  return (
    <>
      {showRules && !isStore && <p className="pp-hint">{t("adm.price.costs.toggleHint")}</p>}
      {showRules && GROUPS.map((g) => {
        const list = costs.rules.filter((r) => r.group === g);
        if (!list.length) return null;
        return (
          <div className="pp-block" key={g}>
            <h4>
              {t(`adm.price.costs.group.${g}`)}
              {g === "percent" && <HelpTip topic="price.costToggle" />}
            </h4>
            <ul className="pp-list">
              {list.map((r) => (
                <li key={r.id} className={r.enabled ? "" : "is-off"}>
                  <span className="pp-name">{r.label}</span>
                  <span className="pp-unit">{amount(r)}</span>
                  <Switch
                    on={r.enabled}
                    disabled={!isStore || busy === r.id}
                    label={r.enabled ? t("adm.price.costs.on") : t("adm.price.costs.off")}
                    onChange={(next) => toggle("rule", r.id, next)}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {showRules && <p className="pp-hint">{t("adm.price.costs.editIn")}</p>}

      {showStore && items(costs.fixed, t("adm.price.costs.fixed"))}
      {showStore && items(costs.variable, t("adm.price.costs.variable"))}

      {showStore && (
      <form className="pp-row" onSubmit={saveTax}>
        <label htmlFor="pp-tax">
          {t("adm.price.costs.tax")}
          <HelpTip topic="price.tax" />
        </label>
        <input
          id="pp-tax"
          className="pp-input pp-num"
          type="number"
          step="0.01"
          min="0"
          max="50"
          value={tax}
          onChange={(e) => setTax(e.target.value)}
        />
        <span className="pp-unit">%</span>
        <button className="btn-xs primary" disabled={busy === "tax"}>{t("adm.price.save")}</button>
        {costs.taxes.source !== "database" && <span className="pp-badge">{t("adm.price.costs.taxEnv")}</span>}
      </form>
      )}
      {showStore && <p className="pp-hint">{t("adm.price.costs.taxHint")}</p>}
      {showStore && costs.profit_target_pct != null && (
        <div className="pp-row">
          <label>{t("adm.price.costs.target")}</label>
          <span className="pp-now">{costs.profit_target_pct} %</span>
        </div>
      )}
    </>
  );
}
