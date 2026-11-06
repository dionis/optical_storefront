// Dónde se usa: «Precios y costos» → acordeón «Monturas y estuches».
// Lo que pidió el dueño, tal cual: UNA regla para todas las monturas (y otra
// para los estuches) y, si quiere cambiar una montura a pesar de la regla, la
// busca y le pone el precio — y entonces la pantalla enseña solo la regla y los
// modelos que tocó. Con una tienda elegida arriba, la regla y las excepciones
// son las de esa tienda, con «Heredado» donde cae al maestro.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import { searchStoreCatalog } from "../adminStores.js";
import DataTable from "../DataTable.jsx";
import HelpTip from "../HelpTip.jsx";
import Icon from "../icons.jsx";
import { savePricingBrandRule, savePricingOverride, savePricingRule } from "./api.js";

/** La regla en UNA fila editable: modo, valor y guardar. */
function RuleRow({ scope, rule, store, onSaved, onError, t, lang }) {
  const [mode, setMode] = useState(rule ? rule.mode : "none");
  const [value, setValue] = useState(rule ? String(rule.value) : "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMode(rule ? rule.mode : "none");
    setValue(rule ? String(rule.value) : "");
  }, [rule?.mode, rule?.value, scope, store]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = !rule
    ? t("adm.price.frames.ruleNone")
    : rule.mode === "percent"
      ? t("adm.price.frames.rulePercent", { v: rule.value > 0 ? `+${rule.value}` : rule.value })
      : t("adm.price.frames.ruleDelta", { v: money(rule.value, "usd", lang) });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = await savePricingRule({ scope, mode, value, store });
      onSaved(data);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pp-row" onSubmit={submit}>
      <label htmlFor={`pp-rule-${scope}`}>
        {t(scope === "case" ? "adm.price.frames.ruleCases" : "adm.price.frames.ruleFrames")}
        <HelpTip topic="price.rule" />
      </label>
      <span className="pp-now">{now}</span>
      {rule?.inherited && <span className="pp-badge inherit" title={t("adm.price.inheritedHint")}>{t("adm.price.inherited")}</span>}
      <select id={`pp-rule-${scope}`} className="pp-input" value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="none">{t("adm.price.frames.mode.none")}</option>
        <option value="percent">{t("adm.price.frames.mode.percent")}</option>
        <option value="delta">{t("adm.price.frames.mode.delta")}</option>
      </select>
      {mode !== "none" && (
        <>
          <input
            className="pp-input pp-num"
            type="number"
            step="0.01"
            required
            aria-label={t("adm.price.frames.value")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <span className="pp-unit">{mode === "percent" ? "%" : "USD"}</span>
        </>
      )}
      <button className="btn-xs primary" disabled={busy}>{t("adm.price.save")}</button>
    </form>
  );
}


/**
 * Reglas POR MARCA (petición del dueño): «Peachtree a $45, Di Caprio a $90…».
 * Cada marca puede tener su precio fijo, o el mismo ajuste de la regla general
 * aplicado solo a ella, y todo esto es POR TIENDA: con una tienda elegida
 * arriba se edita la suya y las que caen al maestro salen marcadas «Heredado».
 * Lo más específico manda: precio del modelo > regla de su marca > regla general.
 */
function BrandRuleRow({ rule, store, onSaved, onError, t, lang }) {
  const [mode, setMode] = useState(rule.since ? rule.mode : "none");
  const [value, setValue] = useState(rule.since ? String(rule.value) : "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMode(rule.since ? rule.mode : "none");
    setValue(rule.since ? String(rule.value) : "");
  }, [rule.brand, rule.mode, rule.value, rule.since, store]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      onSaved(await savePricingBrandRule({ brand: rule.brand, mode, value, store }));
    } catch (err) {
      onError(err.message);
    } finally { setBusy(false); }
  };

  const current = !rule.since
    ? t("adm.price.frames.ruleNone")
    : rule.mode === "override"
      ? t("adm.price.brand.fixed", { v: money(rule.value, "usd", lang) })
      : rule.mode === "percent"
        ? t("adm.price.frames.rulePercent", { v: rule.value > 0 ? `+${rule.value}` : rule.value })
        : t("adm.price.frames.ruleDelta", { v: money(rule.value, "usd", lang) });

  return (
    <form className="pp-rule pp-brand-rule" onSubmit={submit}>
      <span className="pp-brand-name">
        {rule.label}
        {rule.models > 0 && <small className="muted"> · {t("adm.price.brand.models", { n: rule.models })}</small>}
      </span>
      <span className="pp-rule-now">{current}</span>
      {rule.inherited && <span className="pp-badge inherit" title={t("adm.price.inheritedHint")}>{t("adm.price.inherited")}</span>}
      <select className="pp-input" value={mode} aria-label={t("adm.price.brand.ruleFor", { b: rule.label })} onChange={(e) => setMode(e.target.value)}>
        <option value="none">{t("adm.price.frames.mode.none")}</option>
        <option value="override">{t("adm.price.brand.mode.fixed")}</option>
        <option value="percent">{t("adm.price.frames.mode.percent")}</option>
        <option value="delta">{t("adm.price.frames.mode.delta")}</option>
      </select>
      {mode !== "none" && (
        <>
          <input className="pp-input pp-num" type="number" step="0.01" required value={value}
                 aria-label={t("adm.price.frames.value")} onChange={(e) => setValue(e.target.value)} />
          <span className="pp-unit">{mode === "percent" ? "%" : "USD"}</span>
        </>
      )}
      <button className="btn-xs primary" disabled={busy}>{t("adm.price.save")}</button>
    </form>
  );
}

/** Buscador del catálogo del SERVIDOR + precio exacto del modelo elegido. */
function OverrideForm({ store, storeId, onSaved, onError, t }) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState([]);
  const [picked, setPicked] = useState(null);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  // El buscador de productos cuelga de una tienda (GET
  // /admin/store-assortment/:id/products). Con «Todas las tiendas» el panel
  // pasa la primera tienda solo para LEER el catálogo: los modelos son los
  // mismos; lo que cambia es dónde se guarda el precio (`store`).
  const searchIn = storeId;

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2 || picked || !searchIn) { setMatches([]); return undefined; }
    let on = true;
    const timer = setTimeout(() => {
      searchStoreCatalog(searchIn, { q: s, limit: 8 })
        .then((r) => { if (on) setMatches(r.products || []); })
        .catch(() => { if (on) setMatches([]); });
    }, 250);
    return () => { on = false; clearTimeout(timer); };
  }, [searchIn, q, picked]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !picked) return;
    setBusy(true);
    try {
      const data = await savePricingOverride({
        productId: picked.id,
        price,
        kind: picked.is_case ? "case" : "frame",
        store,
      });
      setPicked(null);
      setQ("");
      setPrice("");
      onSaved(data);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pp-block" onSubmit={submit}>
      <h4>
        {t("adm.price.frames.exactPrice")}
        <HelpTip topic="price.override" />
        <small>{t("adm.price.frames.searchHint")}</small>
      </h4>
      <label className="pp-search">
        <Icon name="search" size={14} />
        <input
          aria-label={t("adm.price.frames.search")}
          placeholder={t("adm.price.frames.search")}
          value={q}
          onChange={(e) => { setQ(e.target.value); setPicked(null); }}
        />
      </label>
      {!picked && q.trim().length >= 2 && (
        <ul className="pp-matches">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="btn-xs" onClick={() => { setPicked(p); setQ(p.title); }}>
                {p.title}{p.brand ? ` · ${p.brand}` : ""}
              </button>
            </li>
          ))}
          {!matches.length && <li className="pp-empty">{t("adm.price.frames.searchEmpty")}</li>}
        </ul>
      )}
      {picked && (
        <div className="pp-row">
          <span className="pp-now">{t("adm.price.frames.picked", { name: picked.title })}</span>
          <input
            className="pp-input pp-num wide"
            type="number"
            step="0.01"
            min="0"
            required
            aria-label={t("adm.price.frames.exactPrice")}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <span className="pp-unit">USD</span>
          <button className="btn-xs primary" disabled={busy}>{t("adm.price.save")}</button>
          <button type="button" className="btn-xs" onClick={() => { setPicked(null); setQ(""); }}>{t("adm.price.remove")}</button>
        </div>
      )}
    </form>
  );
}

export default function FramesSection({ frames, store, storeId, onSaved, onError }) {
  const { t, lang } = useLang();
  const [busy, setBusy] = useState("");

  const remove = async (row) => {
    if (busy) return;
    setBusy(row.product_id);
    try {
      onSaved(await savePricingOverride({ productId: row.product_id, price: null, kind: row.kind, store }));
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  const cols = useMemo(() => [
    { key: "title", header: t("adm.price.frames.col.title"), essential: true, minWidth: 180 },
    { key: "kind", header: t("adm.price.frames.col.kind"), type: "chip", essential: true, text: (r) => t(`adm.price.frames.kind.${r.kind}`), render: (r) => <span className="adm-chip">{t(`adm.price.frames.kind.${r.kind}`)}</span> },
    { key: "brand", header: t("adm.price.frames.col.brand"), hiddenByDefault: true },
    { key: "sku", header: t("adm.price.frames.col.sku"), hiddenByDefault: true },
    { key: "base", header: t("adm.price.frames.col.base"), type: "money" },
    {
      key: "price",
      header: t("adm.price.frames.col.price"),
      type: "money",
      essential: true,
      render: (r) => (
        <>
          <b>{money(r.price, "usd", lang)}</b>
          {r.inherited && <span className="pp-badge inherit" title={t("adm.price.inheritedHint")}> {t("adm.price.inherited")}</span>}
        </>
      ),
    },
    { key: "since", header: t("adm.price.frames.col.since"), type: "date", essential: true },
    { key: "by", header: t("adm.price.frames.col.by"), hiddenByDefault: true },
    {
      key: "act",
      header: "",
      type: "action",
      always: true,
      export: false,
      render: (r) => (
        <button type="button" className="btn-xs warn" disabled={busy === r.product_id || r.inherited} onClick={() => remove(r)}>
          {t("adm.price.remove")}
        </button>
      ),
    },
  ], [t, lang, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <RuleRow scope="frame" rule={frames.rule} store={store} onSaved={onSaved} onError={onError} t={t} lang={lang} />
      <RuleRow scope="case" rule={frames.case_rule} store={store} onSaved={onSaved} onError={onError} t={t} lang={lang} />
      {(frames.brand_rules || []).length > 0 && (
        <div className="pp-block pp-brands">
          <h4>
            {t("adm.price.brand.title")}
            <small>{t("adm.price.brand.sub")}</small>
          </h4>
          {frames.brand_rules.map((b) => (
            <BrandRuleRow key={b.brand} rule={b} store={store} onSaved={onSaved} onError={onError} t={t} lang={lang} />
          ))}
        </div>
      )}
      <OverrideForm store={store} storeId={storeId} onSaved={onSaved} onError={onError} t={t} />
      <div className="pp-block">
        <h4>
          {t("adm.price.frames.modified")}
          <small>{t("adm.price.frames.modifiedSub")}</small>
        </h4>
        <DataTable
          id="pricing-overrides"
          cols={cols}
          rows={frames.overrides}
          rowKey={(r) => `${r.kind}:${r.product_id}`}
          dense
          maxHeight="46vh"
          emptyIcon="prices"
          emptyText={t("adm.price.frames.empty")}
          bar={frames.overrides.length > 0}
        />
      </div>
    </>
  );
}
