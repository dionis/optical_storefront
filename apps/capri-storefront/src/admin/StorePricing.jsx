// Dónde se usa: pestaña Tiendas de /admin → "Precios" de una tienda. Ajuste
// general (porcentaje o monto fijo por venta), precios exactos por modelo,
// vista previa con el mismo cálculo del servidor e historial de cambios.
// Backend: /admin/store-pricing/:id (lib/store-pricing.ts).
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { useCatalog } from "../data/catalogStore.js";
import { money, shortDate } from "./adminOrders.js";
import { fetchStorePricing, setStoreAdjustment, setStoreExactPrice, setStoreMinimum, previewStorePrices } from "./adminStores.js";
import Icon from "./icons.jsx";

/** Lentes de ejemplo para la vista previa: un monofocal típico. */
const SAMPLE_LENSES = 100;

/**
 * Las reglas y el cálculo viven en el servidor; esta pantalla solo los muestra
 * y los edita. Lo que se ve en "Vista previa" sale de la misma función que
 * usará el punto de venta, así el dueño ve exactamente lo que se cobrará.
 */
export default function StorePricing({ store, onClose }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const { products = [], cases = [] } = useCatalog();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [adj, setAdj] = useState({ mode: "none", value: "" });
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null); // { id, name, isCase }
  const [exactPrice, setExactPrice] = useState("");
  const [floor, setFloor] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [preview, setPreview] = useState(null);
  const fmt = (v) => (v == null ? "—" : money(v, "usd", lang));

  const load = () => {
    setState("loading");
    fetchStorePricing(store.id)
      .then((r) => {
        setData(r);
        setAdj(r.adjustment ? { mode: r.adjustment.mode, value: String(r.adjustment.value) } : { mode: "none", value: "" });
        setFloor(r.minimum_floor_pct == null ? "" : String(r.minimum_floor_pct));
        setState("ok");
      })
      .catch(() => setState("error"));
  };
  useEffect(load, [store.id]);

  // Modelos del catálogo (los precios son por modelo, no por color).
  const catalog = useMemo(() => [
    ...products.filter((p) => p.medusaId).map((p) => ({ id: p.medusaId, name: p.name, brand: p.brand, isCase: false })),
    ...cases.filter((c) => c.medusaId).map((c) => ({ id: c.medusaId, name: c.name, brand: "", isCase: true })),
  ], [products, cases]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return catalog.filter((p) => `${p.name} ${p.brand}`.toLowerCase().includes(s)).slice(0, 8);
  }, [catalog, q]);

  useEffect(() => {
    if (!picked) { setPreview(null); return undefined; }
    let on = true;
    previewStorePrices(store.id, [picked.id], SAMPLE_LENSES)
      .then((r) => { if (on) setPreview(r.items?.[0] ?? null); })
      .catch(() => { if (on) setPreview(null); });
    return () => { on = false; };
  }, [store.id, picked, data]);

  const run = async (fn, title) => {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      toast({ tone: "success", title });
      load();
      return true;
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
      return false;
    } finally { setBusy(false); }
  };

  const saveAdjustment = (e) => {
    e.preventDefault();
    run(() => setStoreAdjustment(store.id, adj.mode, adj.mode === "none" ? null : Number(adj.value)), t("adm.pricing.adjSaved", { code: store.code }));
  };

  const saveExact = async (e) => {
    e.preventDefault();
    if (!picked) return;
    const ok = await run(
      () => setStoreExactPrice(store.id, { scope: picked.isCase ? "case" : "frame", productId: picked.id, price: Number(exactPrice) }),
      t("adm.pricing.exactSaved", { name: picked.name })
    );
    if (ok) setExactPrice("");
  };

  const removeExact = (row) =>
    run(() => setStoreExactPrice(store.id, { scope: row.scope, productId: row.target, price: null }), t("adm.pricing.exactRemoved", { name: row.product_title || row.target }));

  const saveFloor = (e) => {
    e.preventDefault();
    run(() => setStoreMinimum(store.id, { scope: "all", value: floor === "" ? null : Number(floor) }), t("adm.pricing.minSaved"));
  };
  const saveMin = async () => {
    if (!picked) return;
    const ok = await run(() => setStoreMinimum(store.id, { scope: picked.isCase ? "case" : "frame", productId: picked.id, value: Number(minPrice) }), t("adm.pricing.minSaved"));
    if (ok) setMinPrice("");
  };
  const removeMin = (row) => run(() => setStoreMinimum(store.id, { scope: row.scope, productId: row.target, value: null }), t("adm.pricing.minRemoved"));

  const adjText = (a) => !a ? t("adm.pricing.mode.none")
    : a.mode === "percent" ? t("adm.pricing.adjPercent", { v: a.value })
    : t("adm.pricing.adjDelta", { v: fmt(a.value) });

  return (
    <div className="adm-card adm-pricing">
      <div className="adm-head-row">
        <h3><Icon name="dollar" size={16} />{t("adm.pricing.title", { code: store.code, name: store.name })}</h3>
        <button className="btn-xs" onClick={onClose}>{t("adm.pricing.close")}</button>
      </div>
      <p className="adm-sub">{t("adm.pricing.intro")}</p>
      {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.pricing.loadFailed")}</div>}

      {state === "ok" && data && (
        <>
          {/* Ajuste general */}
          <form className="adm-pricing-block" onSubmit={saveAdjustment}>
            <h4>{t("adm.pricing.adjTitle")}</h4>
            <p className="adm-sub">{t("adm.pricing.adjNow", { v: adjText(data.adjustment) })}</p>
            <div className="adm-pricing-row">
              <select className="adm-input" aria-label={t("adm.pricing.adjTitle")} value={adj.mode} onChange={(e) => setAdj({ ...adj, mode: e.target.value })}>
                <option value="none">{t("adm.pricing.mode.none")}</option>
                <option value="percent">{t("adm.pricing.mode.percent")}</option>
                <option value="delta">{t("adm.pricing.mode.delta")}</option>
              </select>
              {adj.mode !== "none" && (
                <input className="adm-input" type="number" step="0.01" required aria-label={t("adm.pricing.value")}
                  placeholder={adj.mode === "percent" ? "10" : "20"} value={adj.value} onChange={(e) => setAdj({ ...adj, value: e.target.value })} />
              )}
              <button className="btn-sm primary" disabled={busy}>{t("adm.pricing.save")}</button>
            </div>
            <small className="muted">{t(adj.mode === "delta" ? "adm.pricing.deltaHint" : "adm.pricing.percentHint")}</small>
          </form>

          {/* Precio exacto de un modelo */}
          <form className="adm-pricing-block" onSubmit={saveExact}>
            <h4>{t("adm.pricing.exactTitle")}</h4>
            <p className="adm-sub">{t("adm.pricing.exactSub")}</p>
            <label className="adm-find compact">
              <Icon name="search" size={15} />
              <input aria-label={t("adm.pricing.search")} placeholder={t("adm.pricing.search")} value={q} onChange={(e) => { setQ(e.target.value); setPicked(null); }} />
            </label>
            {matches.length > 0 && !picked && (
              <div className="adm-pricing-matches">
                {matches.map((p) => (
                  <button type="button" key={p.id} className="btn-xs" onClick={() => { setPicked(p); setQ(p.name); }}>
                    {p.name}{p.brand ? ` · ${p.brand}` : ""}
                  </button>
                ))}
              </div>
            )}
            {picked && (
              <>
                {preview && (
                  <div className="adm-pricing-preview">
                    <span>{t("adm.pricing.pvBase")} <b>{fmt(preview.base_price)}</b></span>
                    <span>{t("adm.pricing.pvStore", { code: store.code })} <b>{fmt(preview.frame_only?.total)}</b></span>
                    {preview.with_lenses && <span>{t("adm.pricing.pvWithLenses", { lenses: fmt(SAMPLE_LENSES) })} <b>{fmt(preview.with_lenses.total)}</b></span>}
                  </div>
                )}
                <div className="adm-pricing-row">
                  <input className="adm-input" type="number" step="0.01" min="0" required aria-label={t("adm.pricing.exactPrice")}
                    placeholder={t("adm.pricing.exactPrice")} value={exactPrice} onChange={(e) => setExactPrice(e.target.value)} />
                  <button className="btn-sm primary" disabled={busy}>{t("adm.pricing.save")}</button>
                </div>
                <div className="adm-pricing-row">
                  <input className="adm-input" type="number" step="0.01" min="0" aria-label={t("adm.pricing.minPrice")}
                    placeholder={t("adm.pricing.minPrice")} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
                  <button type="button" className="btn-sm" disabled={busy || minPrice === ""} onClick={saveMin}>{t("adm.pricing.minSave")}</button>
                </div>
              </>
            )}

            {data.exact.length > 0 && (
              <table className="adm-table responsive" style={{ marginTop: 12 }}>
                <thead><tr><th>{t("adm.pricing.colProduct")}</th><th>{t("adm.pricing.colBase")}</th><th>{t("adm.pricing.colStore", { code: store.code })}</th><th>{t("adm.pricing.colSince")}</th><th /></tr></thead>
                <tbody>
                  {data.exact.map((r) => (
                    <tr key={`${r.scope}:${r.target}`}>
                      <td data-label={t("adm.pricing.colProduct")}>{r.product_title || r.target}</td>
                      <td data-label={t("adm.pricing.colBase")}>{fmt(r.base_price)}</td>
                      <td data-label={t("adm.pricing.colStore", { code: store.code })}><b>{fmt(r.price)}</b></td>
                      <td data-label={t("adm.pricing.colSince")}>{shortDate(r.since, lang)}</td>
                      <td><button type="button" className="btn-xs warn" disabled={busy} onClick={() => removeExact(r)}>{t("adm.pricing.remove")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </form>

          {/* Precio mínimo (HU-16) */}
          <form className="adm-pricing-block" onSubmit={saveFloor}>
            <h4>{t("adm.pricing.minTitle")}</h4>
            <p className="adm-sub">{t("adm.pricing.minSub")}</p>
            <div className="adm-pricing-row">
              <input className="adm-input" type="number" step="1" min="0" max="100" aria-label={t("adm.pricing.floorPct")}
                placeholder={t("adm.pricing.floorPct")} value={floor} onChange={(e) => setFloor(e.target.value)} />
              <button className="btn-sm primary" disabled={busy}>{t("adm.pricing.save")}</button>
            </div>
            {data.minimums?.length > 0 && (
              <table className="adm-table responsive" style={{ marginTop: 12 }}>
                <thead><tr><th>{t("adm.pricing.colProduct")}</th><th>{t("adm.pricing.minPrice")}</th><th>{t("adm.pricing.colSince")}</th><th /></tr></thead>
                <tbody>
                  {data.minimums.map((r) => (
                    <tr key={`min:${r.scope}:${r.target}`}>
                      <td data-label={t("adm.pricing.colProduct")}>{r.product_title || r.target}</td>
                      <td data-label={t("adm.pricing.minPrice")}><b>{fmt(r.price)}</b></td>
                      <td data-label={t("adm.pricing.colSince")}>{shortDate(r.since, lang)}</td>
                      <td><button type="button" className="btn-xs warn" disabled={busy} onClick={() => removeMin(r)}>{t("adm.pricing.remove")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </form>

          {/* Historial */}
          <details className="adm-pricing-block">
            <summary><h4 style={{ display: "inline" }}>{t("adm.pricing.historyTitle", { n: data.history.length })}</h4></summary>
            <ul className="adm-pricing-history">
              {data.history.map((h) => (
                <li key={h.id} className={h.valid_to ? "closed" : ""}>
                  <span>{shortDate(h.valid_from, lang)}</span>
                  <span>{h.mode === "min" ? (h.scope === "all" ? t("adm.pricing.histFloor", { v: h.value }) : t("adm.pricing.histMin", { v: fmt(h.value) })) : h.scope === "all" ? adjText({ mode: h.mode, value: h.value }) : t("adm.pricing.histExact", { v: fmt(h.value) })}</span>
                  <span className="muted">{h.valid_to ? t("adm.pricing.histUntil", { d: shortDate(h.valid_to, lang) }) : t("adm.pricing.histCurrent")}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
