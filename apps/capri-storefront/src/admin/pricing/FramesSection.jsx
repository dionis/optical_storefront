// Dónde se usa: «Precios y costos» → acordeón «Monturas y estuches».
// Lo que pidió el dueño, tal cual: UNA regla para todas las monturas (y otra
// para los estuches) y, si quiere cambiar una montura a pesar de la regla, la
// busca y le pone el precio — y entonces la pantalla enseña solo la regla y los
// modelos que tocó. Con una tienda elegida arriba, la regla y las excepciones
// son las de esa tienda, con «Heredado» donde cae al maestro.
//
// Desde el 1-nov-2026 la vista lleva también el COSTO del proveedor, que es lo
// que hace que la contabilidad cuadre: sale de GET /admin/pricing/frames/costs
// (nunca más del navegador), se edita con POST /admin/pricing/frames/cost, y al
// lado del costo y del precio se enseña el margen que sale de los dos. Lo
// primero que se ve es cuántos modelos del catálogo tienen costo y cuántos NO,
// con un atajo para quedarse solo con los que faltan: un modelo sin costo no
// enseña «0 %» de margen, enseña que falta, porque es lo único honesto.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import { searchStoreCatalog } from "../adminStores.js";
import DataTable from "../DataTable.jsx";
import HelpTip from "../HelpTip.jsx";
import Icon from "../icons.jsx";
import {
  costOf, isOwnCost, loadFrameCosts, marginPct,
  savePricingOverride, savePricingRule, saveFrameCost, skuKey,
} from "./api.js";

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
 * El margen que sale del costo y del precio. Sin costo conocido NO pinta un
 * «0 %»: pinta que falta el costo, y se destaca, porque es el modelo que hace
 * que la contabilidad del mes no cuadre.
 */
function Margin({ price, cost }) {
  const { t } = useLang();
  if (cost == null) {
    return (
      <span className="pp-nocost" title={t("adm.price.frames.cost.missingHint")}>
        <Icon name="alert" size={11} /> {t("adm.price.frames.cost.missing")}
      </span>
    );
  }
  const pct = marginPct(price, cost);
  // Hay costo pero no se conoce el precio de venta de este modelo: el margen no
  // se puede saber desde aquí, y decir «0 %» sería peor que decir nada.
  if (pct == null) return <span className="pp-now" title={t("adm.price.frames.cost.noPriceHint")}>{t("adm.price.frames.cost.noMargin")}</span>;
  const tone = pct >= 50 ? "good" : pct >= 30 ? "warn" : "bad";
  return (
    <b className={`pp-mg ${tone}`} title={t("adm.price.frames.cost.marginHint")}>
      {t("adm.price.frames.cost.marginPct", { v: pct })}
    </b>
  );
}

/**
 * Costo de un modelo, editable: escribir, guardar, y un botón para devolverlo
 * al de la lista del proveedor — el MISMO gesto que el precio.
 *
 * Los dos botones son `type="button"` a propósito: este campo también vive
 * dentro del <form> del precio exacto y no debe enviarlo. La escritura va por
 * SKU (así la acepta el servidor), no por el id de Medusa.
 */
function CostField({ sku, name, cost, onSaved, onError }) {
  const { t, lang } = useLang();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const cents = cost?.cents ?? null;
  const own = Boolean(cost?.own);
  // Sin SKU no hay a qué escribirle; `editable: false` = el servidor no
  // contestó y lo que se ve es el respaldo del navegador (no se puede guardar).
  const can = Boolean(sku) && cost?.editable !== false && !busy;

  const write = async (value) => {
    setBusy(true);
    try {
      await saveFrameCost({ sku, costUsd: value });
      setDraft("");
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="pp-cost">
      {cents == null
        ? <span className="pp-now">{t("adm.price.none")}</span>
        : <b className={`pp-cost-v ${own ? "own" : ""}`} title={own ? t("adm.price.frames.cost.ownHint") : t("adm.price.frames.cost.listHint")}>{money(cents / 100, "usd", lang)}</b>}
      {own && <span className="pp-badge" title={t("adm.price.frames.cost.ownHint")}>{t("adm.price.frames.cost.ownBadge")}</span>}
      <input
        className="pp-input pp-num"
        inputMode="decimal"
        placeholder={t("adm.price.frames.cost.placeholder")}
        aria-label={t("adm.price.frames.cost.aria", { name })}
        title={t("adm.price.frames.cost.aria", { name })}
        disabled={!can}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
      />
      <button
        type="button"
        className="btn-xs primary"
        disabled={!can || !draft}
        title={t("adm.price.frames.cost.save", { name })}
        aria-label={t("adm.price.frames.cost.save", { name })}
        onClick={() => write(draft)}
      >
        <Icon name="save" size={12} />
      </button>
      {own && (
        <button
          type="button"
          className="btn-xs"
          disabled={!can}
          title={t("adm.price.frames.cost.clear", { name })}
          aria-label={t("adm.price.frames.cost.clear", { name })}
          onClick={() => write(null)}
        >
          <Icon name="undo" size={12} />
        </button>
      )}
    </span>
  );
}

/** Buscador del catálogo del SERVIDOR + costo y precio exactos del modelo elegido. */
function OverrideForm({ store, storeId, costs, onCostSaved, onSaved, onError, t }) {
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

  // El costo se guarda por SKU, pero esa respuesta del catálogo NO trae el SKU
  // (solo id, título y marca), así que se busca por SKU si viene y, si no, por
  // el nombre del modelo contra el `model` de la lista de costos. Queda pedido
  // en el informe: con `sku` en esa respuesta deja de ser una heurística.
  const pickedSku = picked ? picked.sku || picked.title : null;
  const pickedCost = picked && costs ? costOf(costs, { sku: picked.sku, name: picked.title }) : null;
  const pickedCostUsd = pickedCost?.cents != null ? pickedCost.cents / 100 : null;

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
          {/* Costo y precio del MISMO modelo, uno al lado del otro, y el margen
              que sale de los dos: el margen sigue al precio que se está
              escribiendo, no hay que guardar para verlo. */}
          {costs && (
            <>
              <label className="pp-lbl">{t("adm.price.frames.cost.col.cost")}</label>
              <CostField sku={pickedSku} name={picked.title} cost={pickedCost} onSaved={onCostSaved} onError={onError} />
            </>
          )}
          <label className="pp-lbl" htmlFor="pp-exact-price">{t("adm.price.frames.exactPrice")}</label>
          <input
            id="pp-exact-price"
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
          {costs && <Margin price={price} cost={pickedCostUsd} />}
          <button className="btn-xs primary" disabled={busy}>{t("adm.price.save")}</button>
          <button type="button" className="btn-xs" onClick={() => { setPicked(null); setQ(""); }}>{t("adm.price.remove")}</button>
        </div>
      )}
    </form>
  );
}

/**
 * El costo de proveedor de TODO el catálogo, con el aviso que el dueño pidió
 * arriba: cuántos modelos tienen costo y cuántos no, y un atajo para quedarse
 * solo con los que faltan — así los dos estuches sin costo se encuentran de un
 * clic en vez de mirándolos uno a uno.
 *
 * El precio de venta de cada fila se cruza por SKU (y por nombre de modelo) con
 * los modelos de precio propio: son los únicos cuyo precio conoce esta
 * pantalla. Para los que siguen la regla, el precio lo calcula el servidor y
 * aquí se dice que sigue la regla en vez de inventarlo (en el informe queda
 * pedido `price_cents` en las filas de costos, que lo resuelve de raíz).
 */
function CostsBlock({ costs, overrides, onCostSaved, onError }) {
  const { t, lang } = useLang();
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [q, setQ] = useState("");

  const priceOf = useMemo(() => {
    const m = new Map();
    for (const o of overrides || []) {
      const p = Number(o.price);
      if (!Number.isFinite(p)) continue;
      for (const k of [skuKey(o.sku), skuKey(o.title)]) if (k && !m.has(k)) m.set(k, p);
    }
    return m;
  }, [overrides]);

  const rows = useMemo(() => (costs?.rows || []).map((r) => {
    const cost = r.cost_cents == null ? null : r.cost_cents / 100;
    const price = priceOf.get(skuKey(r.sku)) ?? priceOf.get(skuKey(r.model)) ?? null;
    return {
      ...r,
      cost,
      book: r.book_cents == null ? null : r.book_cents / 100,
      price,
      margin: cost == null ? null : marginPct(price, cost),
    };
  }), [costs, priceOf]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => rows.filter((r) => {
    if (onlyMissing && r.cost != null) return false;
    if (!needle) return true;
    return `${r.model || ""} ${r.sku || ""}`.toLowerCase().includes(needle);
  }), [rows, onlyMissing, needle]);

  const withCost = costs?.summary?.with_cost ?? null;
  const without = costs?.summary?.without_cost ?? null;

  const cols = useMemo(() => [
    {
      key: "model",
      header: t("adm.price.frames.cost.col.model"),
      essential: true,
      minWidth: 170,
      text: (r) => r.model || r.sku,
      render: (r) => <><b>{r.model || r.sku}</b> <code className="pp-sku">{r.sku}</code></>,
      sortValue: (r) => String(r.model || r.sku || ""),
    },
    { key: "book", header: t("adm.price.frames.cost.col.book"), type: "money" },
    {
      key: "cost",
      header: t("adm.price.frames.cost.col.cost"),
      type: "money",
      essential: true,
      minWidth: 210,
      // Editable en la propia fila: es donde el dueño está mirando el agujero.
      render: (r) => (
        <CostField
          sku={r.sku}
          name={r.model || r.sku}
          cost={{ cents: r.cost_cents ?? null, own: !costs?.offline && isOwnCost(r.source), editable: !costs?.offline }}
          onSaved={onCostSaved}
          onError={onError}
        />
      ),
      // Los que faltan primero al ordenar por costo: son la tarea pendiente.
      sortValue: (r) => (r.cost == null ? -1 : r.cost),
    },
    {
      key: "price",
      header: t("adm.price.frames.cost.col.price"),
      type: "money",
      essential: true,
      render: (r) => (r.price == null
        ? <span className="pp-now" title={t("adm.price.frames.cost.noPriceHint")}>{t("adm.price.frames.cost.noPrice")}</span>
        : <b>{money(r.price, "usd", lang)}</b>),
      sortValue: (r) => (r.price == null ? -1 : r.price),
    },
    {
      key: "margin",
      header: t("adm.price.frames.cost.col.margin"),
      essential: true,
      align: "r",
      text: (r) => (r.cost == null ? t("adm.price.frames.cost.missing") : r.margin == null ? "" : `${r.margin} %`),
      render: (r) => <Margin price={r.price} cost={r.cost} />,
      sortValue: (r) => (r.cost == null ? -1000 : r.margin ?? -999),
    },
    { key: "updated_at", header: t("adm.price.frames.cost.col.since"), type: "date", hiddenByDefault: true },
  ], [t, lang, costs, onCostSaved, onError]);

  return (
    <div className="pp-block">
      <h4>
        {t("adm.price.frames.cost.title")}
        <small>{t("adm.price.frames.cost.sub")}</small>
      </h4>

      {/* El aviso que el dueño tiene que ver sin buscarlo. Mientras el servidor
          no conteste no se dice nada: no se sabe todavía. */}
      {!costs ? null : costs.offline
        ? <p className="pp-cover bad"><Icon name="alert" size={13} /> {t("adm.price.frames.cost.offline")}</p>
        : (
          <p className={`pp-cover ${without ? "bad" : "ok"}`}>
            <Icon name={without ? "alert" : "checkCircle"} size={13} />
            {without
              ? t("adm.price.frames.cost.coverage", { withCost, without })
              : t("adm.price.frames.cost.allCovered", { withCost })}
            {without > 0 && (
              <button
                type="button"
                className={`btn-xs ${onlyMissing ? "primary" : ""}`}
                aria-pressed={onlyMissing}
                title={t(onlyMissing ? "adm.price.frames.cost.showAll" : "adm.price.frames.cost.onlyMissing")}
                onClick={() => setOnlyMissing((v) => !v)}
              >
                {t(onlyMissing ? "adm.price.frames.cost.showAll" : "adm.price.frames.cost.onlyMissing")}
              </button>
            )}
          </p>
        )}

      <DataTable
        id="pricing-frame-costs"
        cols={cols}
        rows={shown}
        rowKey={(r) => r.sku}
        rowClass={(r) => (r.cost == null ? "pp-missing" : "")}
        dense
        maxHeight="46vh"
        emptyIcon="prices"
        emptyText={t(onlyMissing ? "adm.price.frames.cost.noneMissing" : "adm.price.frames.cost.empty")}
        defaultSort={{ key: "margin", dir: "asc" }}
      >
        <label className="pp-search compact">
          <Icon name="search" size={13} />
          <input
            aria-label={t("adm.price.frames.cost.filter")}
            placeholder={t("adm.price.frames.cost.filter")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </DataTable>
    </div>
  );
}

export default function FramesSection({ frames, store, storeId, onSaved, onError }) {
  const { t, lang } = useLang();
  const [busy, setBusy] = useState("");
  // Los costos no cuelgan de la tienda (lo que cuesta un modelo es lo mismo en
  // todos los mostradores) y cambian cuando llega lista nueva: una lectura
  // cacheada con TTL largo, la misma entrada que usa la pantalla «Productos».
  const [costs, setCosts] = useState(null);
  const reloadCosts = useCallback(() => loadFrameCosts({ force: true }).then(setCosts), []);
  useEffect(() => {
    let on = true;
    loadFrameCosts().then((d) => { if (on) setCosts(d); });
    return () => { on = false; };
  }, []);
  // Guardar un costo no cambia nada del `overview`, así que se avisa con un
  // `slice` vacío: el panel enseña su «Guardado.» y no fusiona datos ajenos.
  const onCostSaved = useCallback(() => { reloadCosts(); onSaved({}); }, [reloadCosts, onSaved]);

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
      <OverrideForm
        store={store}
        storeId={storeId}
        costs={costs}
        onCostSaved={onCostSaved}
        onSaved={onSaved}
        onError={onError}
        t={t}
      />
      <CostsBlock costs={costs} overrides={frames.overrides} onCostSaved={onCostSaved} onError={onError} />
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
