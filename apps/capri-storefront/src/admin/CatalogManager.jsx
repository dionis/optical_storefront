// Dónde se usa: pestaña «Productos» del grupo COMERCIAL de /admin (clave
// `products`). Regla del dueño: «en Comercial va todo lo que tenga que ver con
// manejo de precios, costos, etc.», y el catálogo es precisamente eso.
//
// La pantalla, tal como la pidió:
//   · arriba, las tarjetas que ya le gustaban (monturas, estuches, nuevos y
//     retirados del rango) con los chips de período y los dos paneles de altas
//     y bajas — se conservan tal cual;
//   · el cuerpo es UN ACORDEÓN POR MARCA (BrandAccordion.jsx) que ya se lee
//     cerrado: logo, modelos, colores, rango de precio, costo medio, margen
//     medio y el interruptor de la marca. La vieja lista «Catálogo por marca»
//     desaparece: esa información ES ahora la cabecera de cada acordeón.
//   · dentro de cada marca, una fila por modelo con SKU, muestras de color,
//     medidas, costo de proveedor, precio de venta y su precio propio.
//
// De dónde sale cada dato (nada se calcula aquí que ya exista en el servidor):
//   · precio de venta → el catálogo (catalogStore), que bajo Medusa ya viene
//     con la regla aplicada por el backend;
//   · regla y precio propio del modelo → /admin/pricing/overview y
//     /admin/pricing/frames/override, las MISMAS llamadas del panel de precios
//     (src/admin/pricing/api.js). Aquí no se recalcula ningún precio;
//   · habilitar/deshabilitar → surtido por tienda, /admin/store-assortment/:id
//     y …/rule, con la precedencia del backend (modelo > marca > expuesto);
//   · costo de proveedor → /admin/pricing/frames/costs, por la caché de
//     lecturas del panel (TTL largo: un costo cambia cuando llega lista nueva).
//     Ya NO sale del navegador: el costo es lo que hace fiable la contabilidad y
//     tiene que ser el mismo para el dueño, la caja y el informe. Se edita con
//     POST /admin/pricing/frames/cost (pricing/api.js), igual que el precio;
//   · «Descontinuar» → Admin API de Medusa (catalogAdmin.js). NO es lo mismo
//     que el interruptor: uno saca el modelo del catálogo entero, el otro solo
//     lo oculta en una tienda. Lo explica el HelpTip «catalog.assortVsOff».
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCatalog, loadLive } from "../data/catalogStore.js";
import { BRANDS, BRAND_BY_SLUG } from "../data/brands.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import HelpTip from "./HelpTip.jsx";
import { KpiCard } from "./charts.jsx";
import { AccordionGroup } from "./Accordion.jsx";
import BrandAccordion from "./BrandAccordion.jsx";
import AdminFrameCard from "./AdminFrameCard.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { money, shortDate } from "./adminOrders.js";
import { rangeFor } from "./analytics.js";
import { useStoreFilter } from "./StoreFilter.jsx";
import { fetchStoreAssortment, setAssortmentRule } from "./adminStores.js";
import {
  costOf, fetchPricingOverview, loadFrameCosts, marginPct, savePricingOverride, saveFrameCost,
} from "./pricing/api.js";
import {
  setProductStatus, fetchDiscontinued, exportCatalogCsv, exportCatalogExcel,
} from "./catalogAdmin.js";
import "./catalog-manager.css";

const int = (n) => (Number(n) || 0).toLocaleString("en-US");
const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Los chips de período son CLAVES: las palabras las pone el diccionario al
// pintar, así el selector sigue el cambio de idioma en vez de congelarse.
const RANGES = ["today", "7d", "30d", "90d", "ytd", "all"];

function RangePicker({ value, onChange }) {
  const { t } = useLang();
  return (
    <div className="adm-range">
      {RANGES.map((k) => (
        <button key={k} type="button" className={value === k ? "on" : ""} onClick={() => onChange(k)}>{t(`adm.range.${k}`)}</button>
      ))}
    </div>
  );
}

/** La regla de precios en una frase corta para el subtítulo del acordeón. */
function ruleText(rule, t, lang) {
  if (!rule) return t("adm.cm.rule", { rule: t("adm.cm.ruleNone") });
  const v = rule.mode === "percent"
    ? t("adm.cm.rulePercent", { v: rule.value > 0 ? `+${rule.value}` : rule.value })
    : t("adm.cm.ruleDelta", { v: money(rule.value, "usd", lang) });
  return t("adm.cm.rule", { rule: v });
}

// `params.q`: el buscador global abre esta pantalla ya filtrada por el modelo
// elegido (OmniSearch → go("products", { q })). Sin él, el catálogo entero.
export default function CatalogManager({ me = null, params = null }) {
  const { t, lang } = useLang();
  const usd = (n) => money(n, "usd", lang);
  const { toast, confirm } = useFeedback();
  const { products, cases, meta } = useCatalog();
  const demo = isDemoLogin();

  // El selector de tienda es el GLOBAL de la barra de filtros. «Todas las
  // tiendas» (y «Tienda online», que no es un establecimiento) son el maestro
  // de precios; para el SURTIDO no hay maestro, así que sin una tienda real
  // elegida los interruptores quedan deshabilitados y lo dicen.
  const { store, isAll, isWeb } = useStoreFilter(me);
  const realStore = !isAll && !isWeb ? store : null;
  const priceScope = realStore ? realStore.id : "all";
  const storeInfo = useMemo(() => ({
    id: realStore?.id || null,
    isAll: !realStore,
    label: realStore ? [realStore.code, realStore.name].filter(Boolean).join(" · ") : "",
  }), [realStore]);

  const [preset, setPreset] = useState("30d");
  const [q, setQ] = useState(() => String(params?.q || ""));
  // Un salto nuevo desde el buscador global (mismo tab, otro modelo) cambia
  // la búsqueda; escribir a mano después manda, hasta el siguiente salto.
  const jumpQ = params?.q ?? null;
  useEffect(() => { if (jumpQ) setQ(String(jumpQ)); }, [jumpQ]);
  const [busy, setBusy] = useState(null);         // slug | "brand:<slug>" | "export"
  const [off, setOff] = useState([]);             // descontinuadas (draft en Medusa)
  const [pricing, setPricing] = useState(null);   // /admin/pricing/overview
  const [costs, setCosts] = useState(null);       // /admin/pricing/frames/costs
  const [assort, setAssort] = useState(null);     // /admin/store-assortment/:id
  const [history, setHistory] = useState(null);
  const [cardProduct, setCardProduct] = useState(null);

  /* ── Lecturas ──────────────────────────────────────────────────────── */

  const refreshOff = useCallback(() => {
    if (demo) return;
    fetchDiscontinued().then(setOff).catch(() => {});
  }, [demo]);
  useEffect(refreshOff, [refreshOff]);

  useEffect(() => {
    fetch("/catalog-history.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then(setHistory).catch(() => setHistory(null));
  }, []);

  // Precios: UNA lectura para toda la pantalla, la misma del panel de precios.
  useEffect(() => {
    if (demo) return;
    let on = true;
    fetchPricingOverview(priceScope).then((d) => { if (on) setPricing(d); }).catch(() => { if (on) setPricing(null); });
    return () => { on = false; };
  }, [demo, priceScope]);

  // Costos del proveedor: una lectura para TODAS las marcas (no cuelga de la
  // tienda — lo que cuesta un modelo es lo mismo en todos los mostradores) y
  // cacheada con TTL largo, así que abrir y cerrar acordeones no pide nada.
  const loadCosts = useCallback(async (force = false) => {
    if (demo) return null;
    const index = await loadFrameCosts({ force });
    setCosts(index);
    return index;
  }, [demo]);
  useEffect(() => { loadCosts(); }, [loadCosts]);

  // Surtido: solo existe por tienda. Una sola lectura trae la regla de cada
  // marca y las excepciones por modelo; la precedencia se resuelve al pintar.
  const loadAssort = useCallback(() => {
    if (demo || !storeInfo.id) { setAssort(null); return; }
    fetchStoreAssortment(storeInfo.id).then(setAssort).catch(() => {
      setAssort(null);
      toast({ tone: "error", title: t("adm.cm.assortFailed") });
    });
  }, [demo, storeInfo.id, toast, t]);
  useEffect(loadAssort, [loadAssort]);

  /* ── Altas y bajas del período (las tarjetas que el dueño quiere tal cual) ── */

  const { added, removed } = useMemo(() => {
    const { from, to } = rangeFor(preset);
    const inRange = (d) => { const ms = new Date(d).getTime(); return ms >= from.getTime() && ms <= to.getTime(); };
    const a = [], r = [];
    if (Array.isArray(history)) {
      for (const h of history) if (inRange(h.date)) {
        for (const s of (h.added || [])) a.push({ sku: s, date: h.date });
        for (const s of (h.removed || [])) r.push({ sku: s, date: h.date });
      }
    } else if (meta) {
      for (const s of (meta.added || [])) a.push({ sku: s, date: meta.lastSync });
      for (const s of (meta.removed || [])) r.push({ sku: s, date: meta.lastSync });
    }
    return { added: a, removed: r };
  }, [history, meta, preset]);

  const prodByKey = useMemo(() => {
    const m = {};
    for (const p of products) m[normKey(p.sku)] = p;
    return m;
  }, [products]);

  /* ── Índices de precio y surtido ───────────────────────────────────── */

  const overrideById = useMemo(() => {
    const m = new Map();
    for (const o of pricing?.frames?.overrides || []) m.set(o.product_id, o);
    return m;
  }, [pricing]);

  const brandRuleBySlug = useMemo(() => {
    const m = new Map();
    for (const b of assort?.brands || []) m.set(b.slug, b.rule);
    return m;
  }, [assort]);

  const modelRuleById = useMemo(() => {
    const m = new Map();
    for (const x of assort?.exceptions || []) m.set(x.product_id, x.exposed);
    return m;
  }, [assort]);

  const overrideOf = useCallback((p) => (p.medusaId ? overrideById.get(p.medusaId) || null : null), [overrideById]);
  const ownRuleOf = useCallback((p) => (p.medusaId && modelRuleById.has(p.medusaId) ? modelRuleById.get(p.medusaId) : null), [modelRuleById]);

  /* ── Agrupación por marca ──────────────────────────────────────────── */

  const needle = q.trim().toLowerCase();
  const matches = useCallback(
    (p) => !needle || `${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(needle),
    [needle]
  );

  // Descatalogados por marca: la Store API no los lista, así que se atribuyen
  // por el `handle` de Medusa, que termina en el slug de la marca. Lo que no
  // se puede atribuir sigue en la lista global de reactivación, abajo.
  const offCountBySlug = useMemo(() => {
    const m = new Map();
    for (const o of off) {
      const h = String(o.slug || "");
      const b = BRANDS.find((x) => h.endsWith(`-${x.slug}`) || h === x.slug);
      if (b) m.set(b.slug, (m.get(b.slug) || 0) + 1);
    }
    return m;
  }, [off]);

  const groups = useMemo(() => {
    const byBrand = new Map();
    for (const p of products) {
      const slug = p.brand_slug || "";
      if (!byBrand.has(slug)) byBrand.set(slug, []);
      byBrand.get(slug).push(p);
    }
    // Orden de la portada (BRANDS) primero; cualquier marca que el scraper
    // traiga de más, detrás y por nombre.
    const order = new Map(BRANDS.map((b, i) => [b.slug, i]));
    const list = [...byBrand.entries()]
      .map(([slug, all]) => {
        const known = BRAND_BY_SLUG[slug];
        return {
          slug,
          name: known?.name || all[0]?.brand || slug,
          // `logoWide` es el logo PLANO individual; el medallón redondo queda
          // de respaldo (brands.js documenta la diferencia).
          logo: known?.logoWide || known?.logo || null,
          all,
        };
      })
      .sort((a, b) => {
        const ia = order.has(a.slug) ? order.get(a.slug) : 99;
        const ib = order.has(b.slug) ? order.get(b.slug) : 99;
        return ia - ib || a.name.localeCompare(b.name);
      });
    return list.map((g) => ({ ...g, models: g.all.filter(matches) }));
  }, [products, matches]);

  const caseGroup = useMemo(() => {
    const known = BRAND_BY_SLUG.case;
    return {
      slug: "case",
      name: t("adm.cm.cases"),
      logo: known?.logoWide || known?.logo || null,
      all: cases,
      models: cases.filter(matches),
    };
  }, [cases, matches, t]);

  /** El costo del servidor de un modelo (descriptor, `cents: null` = falta). */
  const costOfProduct = useCallback((p) => costOf(costs, p), [costs]);

  /**
   * Resumen de una marca para su cabecera cerrada. El costo medio y el margen
   * medio salen SOLO de los modelos con costo real; los que no lo tienen se
   * cuentan aparte (`noCost`) en vez de entrar como cero, que es lo que haría
   * que la cabecera presumiera de un margen que no existe.
   */
  const statsOf = useCallback((list) => {
    let colors = 0, min = null, max = null, costSum = 0, costN = 0, marginSum = 0, marginN = 0, noCost = 0;
    for (const p of list) {
      colors += (p.colors || []).length;
      const price = overrideOf(p)?.price ?? p.price;
      if (typeof price === "number" && price > 0) {
        min = min == null ? price : Math.min(min, price);
        max = max == null ? price : Math.max(max, price);
      }
      const cents = costOfProduct(p)?.cents ?? null;
      if (cents == null) { noCost += 1; continue; }
      const cost = cents / 100;
      costSum += cost; costN += 1;
      const m = marginPct(price, cost);
      if (m != null) { marginSum += m; marginN += 1; }
    }
    return {
      models: list.length,
      colors,
      min, max,
      cost: costN ? Math.round((costSum / costN) * 100) / 100 : null,
      margin: marginN ? Math.round(marginSum / marginN) : null,
      // Mientras el servidor no haya contestado no se acusa a nadie de estar
      // sin costo: todavía no se sabe.
      noCost: costs ? noCost : 0,
    };
  }, [overrideOf, costOfProduct, costs]);

  /* ── Escrituras ────────────────────────────────────────────────────── */

  const doExport = (kind) => {
    setBusy("export");
    try {
      const n = kind === "csv" ? exportCatalogCsv(products, cases) : exportCatalogExcel(products, cases);
      toast({ tone: "success", title: t("adm.cat.exported", { n }) });
    } finally { setBusy(null); }
  };

  /** Precio propio del modelo: /admin/pricing/frames/override, como el panel de precios. */
  const onSavePrice = useCallback(async (p, value) => {
    const price = Number(value);
    if (!p.medusaId || !Number.isFinite(price) || price <= 0) return false;
    setBusy(p.slug || p.sku);
    try {
      const slice = await savePricingOverride({
        productId: p.medusaId, price, kind: p.isCase ? "case" : "frame", store: priceScope,
      });
      setPricing((prev) => (prev ? { ...prev, ...slice } : prev));
      toast({ tone: "success", title: t("adm.cm.priceSaved", { name: p.name, price: usd(price) }) });
      loadLive({ force: true }).catch(() => {});
      return true;
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
      return false;
    } finally { setBusy(null); }
  }, [priceScope, toast, t, usd]);

  /** Quitar el precio propio: el modelo vuelve a la regla (price null). */
  const onClearPrice = useCallback(async (p) => {
    if (!p.medusaId) return;
    setBusy(p.slug || p.sku);
    try {
      const slice = await savePricingOverride({
        productId: p.medusaId, price: null, kind: p.isCase ? "case" : "frame", store: priceScope,
      });
      setPricing((prev) => (prev ? { ...prev, ...slice } : prev));
      toast({ tone: "success", title: t("adm.cm.priceCleared", { name: p.name }) });
      loadLive({ force: true }).catch(() => {});
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(null); }
  }, [priceScope, toast, t]);

  /**
   * Costo del proveedor de un modelo: POST /admin/pricing/frames/cost. Va por
   * SKU (no por `medusaId`): el costo es del modelo del proveedor, así que un
   * modelo del catálogo semilla todavía sin enlazar también puede llevarlo.
   * No cuelga de la tienda — lo que cuesta no cambia de mostrador.
   */
  const onSaveCost = useCallback(async (p, value) => {
    const cost = Number(value);
    if (!p.sku || !Number.isFinite(cost) || cost < 0) return false;
    setBusy(p.slug || p.sku);
    try {
      await saveFrameCost({ sku: p.sku, costUsd: cost });
      await loadCosts(true);
      toast({ tone: "success", title: t("adm.cm.costSaved", { name: p.name, cost: usd(cost) }) });
      return true;
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
      return false;
    } finally { setBusy(null); }
  }, [loadCosts, toast, t, usd]);

  /** Quitar el costo propio: el modelo vuelve al de la lista del proveedor. */
  const onClearCost = useCallback(async (p) => {
    if (!p.sku) return;
    setBusy(p.slug || p.sku);
    try {
      await saveFrameCost({ sku: p.sku, costUsd: null });
      await loadCosts(true);
      toast({ tone: "success", title: t("adm.cm.costCleared", { name: p.name }) });
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(null); }
  }, [loadCosts, toast, t]);

  /** Surtido de la tienda: una regla por marca o por modelo (el modelo manda). */
  const writeRule = useCallback(async (rule, key, title) => {
    if (!storeInfo.id) return;
    setBusy(key);
    try {
      await setAssortmentRule(storeInfo.id, rule);
      toast({ tone: "success", title });
      loadAssort();
    } catch (err) {
      toast({ tone: "error", title: t(err.message || "adm.cm.swFailed") });
    } finally { setBusy(null); }
  }, [storeInfo.id, toast, t, loadAssort]);

  const onBrandSwitch = useCallback((brand, next) => writeRule(
    { scope: "brand", target: brand.slug, exposed: next },
    `brand:${brand.slug}`,
    t(next ? "adm.cm.brandShown" : "adm.cm.brandHidden", { name: brand.name, store: storeInfo.label })
  ), [writeRule, t, storeInfo.label]);

  const onModelSwitch = useCallback((p, next) => writeRule(
    { scope: "product", target: p.medusaId, exposed: next },
    p.slug || p.sku,
    t(next ? "adm.cm.modelShown" : "adm.cm.modelHidden", { name: p.name, store: storeInfo.label })
  ), [writeRule, t, storeInfo.label]);

  /** Descontinuar/reactivar: saca o devuelve el modelo al catálogo ENTERO. */
  const setStatus = useCallback(async (p, discontinue) => {
    const ok = await confirm({
      title: t(discontinue ? "adm.cat.offConfirm" : "adm.cat.onConfirm", { name: p.name }),
      message: t(discontinue ? "adm.cat.offBody" : "adm.cat.onBody"),
    });
    if (!ok) return;
    setBusy(p.slug || p.medusaId);
    try {
      await setProductStatus(p.medusaId, discontinue);
      toast({ tone: "success", title: t(discontinue ? "adm.cat.offDone" : "adm.cat.onDone", { name: p.name }) });
      refreshOff();
      loadLive({ force: true }).catch(() => {});
    } catch {
      toast({ tone: "error", title: t("adm.cat.statusFailed") });
    } finally { setBusy(null); }
  }, [confirm, toast, t, refreshOff]);

  /* ── Pintado ───────────────────────────────────────────────────────── */

  const ProdList = ({ list, empty }) => (
    <div className="adm-prodlist">
      {list.length === 0 ? <div className="adm-nodata">{empty}</div> : list.slice(0, 100).map((x, i) => {
        const p = prodByKey[normKey(x.sku)];
        return (
          <div className="adm-prodlist-row" key={i}>
            <div className="adm-tb-thumb sm">
              {p?.colors?.[0]?.image
                ? <img src={p.colors[0].image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.opacity = 0; }} />
                : <span>◈</span>}
            </div>
            <div className="adm-pl-main"><b>{p?.name || x.sku}</b>{p && <small className="muted">{p.brand}</small>}</div>
            <small className="muted">{shortDate(x.date, lang)}</small>
          </div>
        );
      })}
    </div>
  );

  const frameRuleLabel = ruleText(pricing?.frames?.rule, t, lang);
  const caseRuleLabel = ruleText(pricing?.frames?.case_rule, t, lang);
  const shown = groups.filter((g) => g.models.length > 0);
  const casesShown = caseGroup.models.length > 0;

  const brandProps = (g, isCase) => ({
    brand: g,
    models: g.models,
    stats: statsOf(g.models),
    offCount: offCountBySlug.get(g.slug) || 0,
    store: storeInfo,
    isCase,
    brandRule: brandRuleBySlug.has(g.slug) ? brandRuleBySlug.get(g.slug) : null,
    // Precedencia del backend (store-assortment.ts): la regla del modelo manda
    // sobre la de su marca, y sin ninguna el modelo está expuesto.
    exposedOf: (p) => {
      const own = ownRuleOf(p);
      if (own !== null) return own;
      const brandRule = brandRuleBySlug.has(g.slug) ? brandRuleBySlug.get(g.slug) : null;
      return brandRule === false ? false : true;
    },
    ownRuleOf,
    overrideOf,
    costOf: costOfProduct,
    ruleLabel: isCase ? caseRuleLabel : frameRuleLabel,
    busy,
    onBrandSwitch,
    onModelSwitch,
    onSavePrice,
    onClearPrice,
    onSaveCost,
    onClearCost,
    onDiscontinue: (p) => setStatus(p, true),
    onOpen: setCardProduct,
  });

  return (
    <div className="cm adm-section">
      {/* Cabecera: las tarjetas y los chips de período, tal como estaban. */}
      <div className="cm-head">
        <h2>{t("adm.cm.title")}<HelpTip topic="catalog.assortVsOff" /></h2>
        <span className="cm-scope">
          <Icon name="store" size={12} />
          {storeInfo.isAll ? t("adm.cm.scope.all") : t("adm.cm.scope.store", { store: storeInfo.label })}
        </span>
        <RangePicker value={preset} onChange={setPreset} />
        <div className="cm-tools adm-noprint">
          <button type="button" className="btn-sm" disabled={busy === "export"} onClick={() => doExport("xls")}>
            <Icon name="excel" size={14} /> {t("adm.cat.exportXls")}
          </button>
          <button type="button" className="btn-sm" disabled={busy === "export"} onClick={() => doExport("csv")}>
            <Icon name="download" size={14} /> {t("adm.cat.exportCsv")}
          </button>
        </div>
      </div>
      <p className="cm-intro">{t("adm.cm.intro")}</p>
      {demo && <p className="adm-sub">{t("adm.cat.demoNote")}</p>}
      {!history && <div className="adm-demo-banner" dangerouslySetInnerHTML={{ __html: t("adm.prod.noHistory") }} />}

      <div className="adm-kpis">
        <KpiCard label={t("adm.prod.frames")} value={int(products.length)} icon={<Icon name="glasses" />} />
        <KpiCard label={t("adm.prod.cases")} value={int(cases.length)} icon={<Icon name="box" />} />
        <KpiCard label={t("adm.prod.added")} value={int(added.length)} icon={<Icon name="sparkles" />} deltaGood />
        <KpiCard label={t("adm.prod.removed")} value={int(removed.length)} icon={<Icon name="alert" />} />
      </div>
      <div className="adm-grid-2">
        <div className="adm-card">
          <h3>{t("adm.prod.newTitle")}</h3>
          <ProdList list={added} empty={t("adm.prod.noAdded")} />
        </div>
        <div className="adm-card">
          <h3>{t("adm.prod.goneTitle")}</h3>
          <ProdList list={removed} empty={t("adm.prod.noRemoved")} />
        </div>
      </div>

      {/* Buscador + un acordeón por marca. */}
      <div className="cm-head">
        <label className="adm-find compact cm-find">
          <Icon name="search" size={15} />
          <input aria-label={t("adm.cm.search")} placeholder={t("adm.cm.search")} value={q}
                 onChange={(e) => setQ(e.target.value)} />
        </label>
        {q && (
          <button type="button" className="btn-xs" title={t("adm.cm.clearSearch")} aria-label={t("adm.cm.clearSearch")} onClick={() => setQ("")}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {storeInfo.isAll && <p className="cm-warn"><Icon name="info" size={13} />{t("adm.cm.scope.needStore")}</p>}
      {/* El servidor no dio los costos: se enseña el respaldo del navegador y
          se dice, porque en ese estado el costo no se puede editar. */}
      {costs?.offline && <p className="cm-warn bad"><Icon name="alert" size={13} />{t("adm.cm.costsOffline")}</p>}

      <AccordionGroup>
        {shown.map((g, i) => <BrandAccordion key={g.slug || "-"} {...brandProps(g, false)} defaultOpen={i === 0 && !!needle} />)}
        {casesShown && <BrandAccordion key="case" {...brandProps(caseGroup, true)} />}
        {!shown.length && !casesShown && <div className="adm-nodata">{t("adm.cm.noMatch")}</div>}
      </AccordionGroup>

      {/* Descontinuadas: visibles y reactivables (no las tapa ningún acordeón). */}
      {off.length > 0 && (
        <div className="adm-card">
          <h3>{t("adm.cat.offList", { n: off.length })}</h3>
          <div className="cm-offlist">
            {off.map((p) => (
              <span key={p.medusaId}>
                <b>{p.name}</b>
                <button type="button" className="btn-xs primary" disabled={demo || !!busy}
                        title={t("adm.cat.on")} aria-label={t("adm.cat.on")}
                        onClick={() => setStatus({ medusaId: p.medusaId, name: p.name, slug: p.slug }, false)}>
                  <Icon name="rotate" size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {cardProduct && <AdminFrameCard product={cardProduct} onClose={() => setCardProduct(null)} />}
    </div>
  );
}
