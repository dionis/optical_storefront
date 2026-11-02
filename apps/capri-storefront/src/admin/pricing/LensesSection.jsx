// Dónde se usa: «Precios y costos» → acordeón «Lentes».
// La matriz del dueño (diseño × material) editable en la propia celda, con el
// nombre de cada progresivo digital y su gama; debajo, los fotocromáticos por
// categoría de diseño y los antirreflejos en sus dos grupos. Con una tienda
// elegida arriba aparece el «% sobre el maestro» de esa tienda y cada celda
// puede llevar un precio propio, que manda sobre el porcentaje.
import { useEffect, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import HelpTip from "../HelpTip.jsx";
import { savePricingLens } from "./api.js";

const CATS = ["sv", "bifocal", "prog"];
const dollars = (cents) => (cents == null ? "" : (Math.round(Number(cents)) / 100).toFixed(2));

/**
 * Una celda de precio: se escribe el número y se guarda al salir del campo (o
 * con Enter). Guardar al salir del campo y no con un botón por celda es lo que
 * hace que la matriz se pueda repasar de corrido, que es como el dueño la lee.
 */
function Cell({ cents, masterCents, own, title, disabled, onSave }) {
  const { lang } = useLang();
  const [value, setValue] = useState(dollars(cents));
  const [busy, setBusy] = useState(false);
  // Tras guardar, el panel vuelve a leer el payload: la celda se pone al día
  // con lo que contestó el servidor (y no con lo que se tecleó).
  useEffect(() => { setValue(dollars(cents)); }, [cents]);
  const commit = async () => {
    const next = value.trim();
    if (busy || next === dollars(cents)) return;
    if (next === "") { setValue(dollars(cents)); return; }
    setBusy(true);
    try {
      await onSave(Number(next));
    } finally {
      setBusy(false);
    }
  };
  return (
    <input
      className={`pp-cell ${own ? "own" : ""}`}
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

export default function LensesSection({ lenses, store, onSaved, onError }) {
  const { t, lang } = useLang();
  const isStore = Boolean(lenses.store);
  const [adjust, setAdjust] = useState(lenses.store?.adjust_pct == null ? "" : String(lenses.store.adjust_pct));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAdjust(lenses.store?.adjust_pct == null ? "" : String(lenses.store.adjust_pct));
  }, [lenses.store?.adjust_pct]);

  const save = async (payload) => {
    try {
      onSaved(await savePricingLens({ ...payload, store }));
    } catch (err) {
      onError(err.message);
    }
  };

  const cellOf = (kind, key) => (lenses.store?.cells || []).find((c) => c.kind === kind && c.key === key) ?? null;
  const baseCell = (design, material) => lenses.base.find((b) => b.design_code === design && b.material_code === material) ?? null;

  const saveAdjust = async (e) => {
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

  const label = (row) => String((lang === "en" ? row.label_en : row.label_es) || row.code);

  return (
    <>
      {isStore && (
        <form className="pp-row" onSubmit={saveAdjust}>
          <label htmlFor="pp-lens-adjust">
            {t("adm.price.lenses.adjust")}
            <HelpTip topic="price.storeVariation" />
          </label>
          <span className="pp-now">
            {lenses.store.adjust_pct == null
              ? t("adm.price.lenses.adjustNone")
              : t("adm.price.lenses.adjustNow", { v: lenses.store.adjust_pct })}
          </span>
          <input
            id="pp-lens-adjust"
            className="pp-input pp-num"
            type="number"
            step="0.01"
            value={adjust}
            onChange={(e) => setAdjust(e.target.value)}
          />
          <span className="pp-unit">%</span>
          <button className="btn-xs primary" disabled={busy}>{t("adm.price.save")}</button>
          {Boolean(lenses.store.cells.length) && (
            <span className="pp-badge">{t("adm.price.lenses.cellsChanged", { n: lenses.store.cells.length })}</span>
          )}
        </form>
      )}
      {isStore && <p className="pp-hint">{t("adm.price.lenses.adjustHint")}</p>}

      <div className="pp-block">
        <h4>
          {t("adm.price.lenses.matrix")}
          <HelpTip topic="price.lensMatrix" />
          <HelpTip topic="price.progressive" />
        </h4>
        <div className="pp-grid-wrap">
          <table className="pp-grid">
            <thead>
              <tr>
                <th>{t("adm.price.lenses.design")}</th>
                {lenses.materials.map((m) => <th key={m.code}>{label(m)}</th>)}
              </tr>
            </thead>
            <tbody>
              {lenses.designs.map((d) => (
                <tr key={d.code}>
                  <th scope="row">
                    {label(d)}
                    {d.tier && <span className="pp-tier">{d.tier}</span>}
                    {(lang === "en" ? d.use_en : d.use_es) && <span className="pp-use">{lang === "en" ? d.use_en : d.use_es}</span>}
                  </th>
                  {lenses.materials.map((m) => {
                    const cell = baseCell(d.code, m.code);
                    const key = `${d.code}:${m.code}`;
                    const own = isStore && Boolean(cellOf("base", key));
                    const shown = isStore ? (cell?.store_cents ?? cell?.cents ?? 0) : (cell?.cents ?? 0);
                    return (
                      <td key={m.code}>
                        <Cell
                          cents={shown}
                          masterCents={cell?.cents ?? null}
                          own={own}
                          title={t("adm.price.lenses.editCell", { design: label(d), material: label(m) })}
                          onSave={(v) => save({ kind: "base", key, value: v })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pp-block">
        <h4>
          {t("adm.price.lenses.photo")}
          <HelpTip topic="price.photo" />
        </h4>
        <div className="pp-grid-wrap">
          <table className="pp-grid">
            <thead>
              <tr>
                <th>{t("adm.price.lenses.photo")}</th>
                {CATS.map((c) => <th key={c}>{t(`adm.price.lenses.cat.${c}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {lenses.photo.map((p) => (
                <tr key={p.code}>
                  <th scope="row">{label(p)}</th>
                  {CATS.map((cat) => {
                    const master = p[cat];
                    if (master == null) return <td key={cat}><span className="pp-cell na">{t("adm.price.lenses.na")}</span></td>;
                    const key = `${p.code}:${cat}`;
                    const shown = isStore ? (p.store?.[cat] ?? master) : master;
                    return (
                      <td key={cat}>
                        <Cell
                          cents={shown}
                          masterCents={master}
                          own={isStore && Boolean(cellOf("photo", key))}
                          title={`${label(p)} · ${t(`adm.price.lenses.cat.${cat}`)}`}
                          onSave={(v) => save({ kind: "photo", key, value: v })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pp-block">
        <h4>
          {t("adm.price.lenses.ar")}
          <HelpTip topic="price.ar" />
        </h4>
        <ul className="pp-list">
          {lenses.ar.map((a) => (
            <li key={a.code}>
              <span className="pp-name">{label(a)}</span>
              <span className="pp-sub">{t(`adm.price.lenses.arGroup.${a.ar_group === "sv" || a.ar_group === "bifprog" ? a.ar_group : "all"}`)}</span>
              {isStore && a.store_cents !== a.cents && (
                <span className="pp-badge">{t("adm.price.lenses.masterIs", { v: money(a.cents / 100, "usd", lang) })}</span>
              )}
              <Cell
                cents={isStore ? (a.store_cents ?? a.cents) : a.cents}
                masterCents={a.cents}
                own={isStore && Boolean(cellOf("ar", a.code))}
                title={label(a)}
                onSave={(v) => save({ kind: "ar", key: a.code, value: v })}
              />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
