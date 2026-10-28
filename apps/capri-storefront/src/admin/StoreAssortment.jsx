// Dónde se usa: pestaña Tiendas de /admin → "Catálogo" de una tienda. Qué marcas
// y modelos expone a la venta. Una tienda nueva expone todo; el dueño o un
// superadmin quita lo que no quiere vender. Backend: /admin/store-assortment/:id
// (lib/store-assortment.ts). El punto de venta solo busca y cobra lo expuesto.
import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { fetchStoreAssortment, searchStoreCatalog, setAssortmentRule } from "./adminStores.js";
import Icon from "./icons.jsx";

/**
 * Reglas: un modelo manda sobre su marca, y una marca oculta también oculta los
 * modelos que entren después. El servidor calcula los conteos; esta pantalla
 * solo los muestra y escribe reglas.
 */
export default function StoreAssortment({ store, onClose }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [results, setResults] = useState([]);
  const [search, setSearch] = useState("idle"); // idle | loading | ok | error
  const modelsRef = useRef(null);
  const [reload, setReload] = useState(0);

  const load = () => {
    fetchStoreAssortment(store.id)
      .then((r) => { setData(r); setState("ok"); })
      .catch(() => setState("error"));
  };
  useEffect(load, [store.id]);

  // Modelos de una marca o que contienen el texto, con su estado en la tienda.
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2 && !brand) { setResults([]); setSearch("idle"); return undefined; }
    let on = true;
    setSearch("loading");
    const timer = setTimeout(() => {
      searchStoreCatalog(store.id, { q: s, brand, limit: 100 })
        .then((r) => { if (on) { setResults(r.products || []); setSearch("ok"); } })
        .catch(() => { if (on) { setResults([]); setSearch("error"); } });
    }, 250);
    return () => { on = false; clearTimeout(timer); };
  }, [store.id, q, brand, reload]);

  const write = async (rule, title) => {
    if (busy) return;
    setBusy(true);
    try {
      await setAssortmentRule(store.id, rule);
      toast({ tone: "success", title });
      load();
      setReload((n) => n + 1);
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const toggleBrand = (b) => {
    const hide = b.exposed_products > 0;
    write({ scope: "brand", target: b.slug, exposed: hide ? false : true }, t(hide ? "adm.assort.brandHidden" : "adm.assort.brandShown", { name: b.name }));
  };
  const toggleModel = (p) =>
    write({ scope: "product", target: p.id, exposed: !p.exposed }, t(p.exposed ? "adm.assort.modelHidden" : "adm.assort.modelShown", { name: p.title }));
  const resetModel = (x) =>
    write({ scope: "product", target: x.product_id, exposed: null }, t("adm.assort.modelReset", { name: x.title || x.product_id }));

  // La lista de modelos está debajo de la tabla de marcas: sin bajar hasta ella,
  // "Ver modelos" parecía no hacer nada.
  const seeModels = (slug) => {
    setBrand(slug);
    setQ("");
    modelsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const brandName = (slug) => data?.brands.find((b) => b.slug === slug)?.name || slug;

  return (
    <div className="adm-card adm-pricing">
      <div className="adm-head-row">
        <h3><Icon name="glasses" size={16} />{t("adm.assort.title", { code: store.code, name: store.name })}</h3>
        <button className="btn-xs" onClick={onClose}>{t("adm.pricing.close")}</button>
      </div>
      <p className="adm-sub">{t("adm.assort.intro")}</p>
      {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.assortment.loadFailed")}</div>}

      {state === "ok" && data && (
        <>
          <p className="adm-sub"><b>{t("adm.assort.summary", { n: data.exposed_products, total: data.total_products })}</b></p>

          {/* Marcas */}
          <div className="adm-pricing-block">
            <h4>{t("adm.assort.brandsTitle")}</h4>
            <p className="adm-sub">{t("adm.assort.brandsSub")}</p>
            <table className="adm-table responsive">
              <thead><tr><th>{t("adm.assort.colBrand")}</th><th>{t("adm.assort.colExposed")}</th><th /></tr></thead>
              <tbody>
                {data.brands.map((b) => (
                  <tr key={b.slug || "-"}>
                    <td data-label={t("adm.assort.colBrand")}>
                      {b.slug ? b.name : t("adm.assort.noBrand")}
                      {b.rule === false && <span className="adm-chip bad" style={{ marginLeft: 6 }}>{t("adm.assort.hiddenShort")}</span>}
                    </td>
                    <td data-label={t("adm.assort.colExposed")}>{t("adm.assort.count", { n: b.exposed_products, total: b.products })}</td>
                    <td>
                      <button type="button" className="btn-xs" disabled={busy || !b.slug} onClick={() => seeModels(b.slug)}>{t("adm.assort.seeModels")}</button>{" "}
                      {b.slug && (
                        <button type="button" className={`btn-xs ${b.exposed_products > 0 ? "warn" : "primary"}`} disabled={busy} onClick={() => toggleBrand(b)}>
                          {t(b.exposed_products > 0 ? "adm.assort.hideBrand" : "adm.assort.showBrand")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Modelos */}
          <div className="adm-pricing-block" ref={modelsRef}>
            <h4>{t("adm.assort.modelsTitle")}{brand ? ` · ${brandName(brand)}` : ""}</h4>
            <p className="adm-sub">{t("adm.assort.modelsSub")}</p>
            <div className="adm-pricing-row">
              <label className="adm-find compact">
                <Icon name="search" size={15} />
                <input aria-label={t("adm.assort.search")} placeholder={t("adm.assort.search")} value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <select className="adm-input" aria-label={t("adm.assort.colBrand")} value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value="">{t("adm.assort.allBrands")}</option>
                {data.brands.filter((b) => b.slug).map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
              </select>
            </div>
            {search === "ok" && results.length > 0 && (
              <table className="adm-table responsive" style={{ marginTop: 12 }}>
                <thead><tr><th>{t("adm.assort.colModel")}</th><th>{t("adm.assort.colBrand")}</th><th>{t("adm.assort.colState")}</th><th /></tr></thead>
                <tbody>
                  {results.map((p) => (
                    <tr key={p.id}>
                      <td data-label={t("adm.assort.colModel")}>{p.title}</td>
                      <td data-label={t("adm.assort.colBrand")}>{brandName(p.brand)}</td>
                      <td data-label={t("adm.assort.colState")}>
                        <span className={`adm-chip ${p.exposed ? "ok" : "bad"}`}>{t(p.exposed ? "adm.assort.exposed" : "adm.assort.hidden")}</span>
                      </td>
                      <td>
                        <button type="button" className={`btn-xs ${p.exposed ? "warn" : "primary"}`} disabled={busy} onClick={() => toggleModel(p)}>
                          {t(p.exposed ? "adm.assort.hide" : "adm.assort.show")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {search === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
            {search === "error" && <div className="adm-demo-banner">{t("adm.err.assortment.searchFailed")}</div>}
            {search === "ok" && results.length === 0 && <div className="adm-nodata">{t("adm.assort.noResults")}</div>}
          </div>

          {/* Excepciones por modelo */}
          {data.exceptions.length > 0 && (
            <div className="adm-pricing-block">
              <h4>{t("adm.assort.exceptionsTitle", { n: data.exceptions.length })}</h4>
              <p className="adm-sub">{t("adm.assort.exceptionsSub")}</p>
              <table className="adm-table responsive">
                <thead><tr><th>{t("adm.assort.colModel")}</th><th>{t("adm.assort.colBrand")}</th><th>{t("adm.assort.colState")}</th><th /></tr></thead>
                <tbody>
                  {data.exceptions.map((x) => (
                    <tr key={x.product_id}>
                      <td data-label={t("adm.assort.colModel")}>{x.title || x.product_id}</td>
                      <td data-label={t("adm.assort.colBrand")}>{x.brand ? brandName(x.brand) : "—"}</td>
                      <td data-label={t("adm.assort.colState")}>
                        <span className={`adm-chip ${x.exposed ? "ok" : "bad"}`}>{t(x.exposed ? "adm.assort.exposed" : "adm.assort.hidden")}</span>
                      </td>
                      <td><button type="button" className="btn-xs" disabled={busy} onClick={() => resetModel(x)}>{t("adm.assort.reset")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
