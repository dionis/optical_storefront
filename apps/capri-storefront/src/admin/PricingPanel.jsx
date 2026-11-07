// Dónde se usa: pestaña «Productos y precios» de /admin (clave `products`,
// grupo Comercial, solo dueño y superadmin). Desde el 6-nov-2026 fusiona las
// antiguas «Productos» (catálogo por marca, surtido por tienda) y «Precios y
// costos» en UNA pantalla, como pidió el dueño (contrato: docs/PRICE-MATRIX.md).
//
// Subpestañas, en `?sub=`: Monturas · Estuches · Lentes · Tratamientos son la
// MATRIZ (pricing/PriceMatrix.jsx: artículo · costo · por tienda precio y
// descuento); «Reglas y comisiones» guarda todo lo que NO es de un artículo y
// ya existía en «Precios y costos»: regla general de monturas y estuches y %
// de lentes por tienda, suelo y techo del precio (banda), comisiones, costos
// de la tienda y por venta, impuesto, importar la lista de precios del
// navegador y las fichas de costo por pedido. Nada de lo anterior se perdió.
//
// Enlaces viejos: `?tab=pricing` cae aquí (LEGACY_TABS en AdminDashboard) y
// los `sub` antiguos se traducen: frames/lenses(-prog)/treatments a su matriz,
// costs/sheets a «Reglas y comisiones».
//
// Selector de tienda GLOBAL (StoreFilter): en la matriz, una tienda elegida deja
// solo SUS columnas (cómodo en el teléfono); «Todas las tiendas» las enseña
// todas. En «Reglas y comisiones» decide, como antes, si se edita el maestro o
// la variación de esa tienda.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { Profitability } from "./Costs.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import { menuHandlers, useRegisterExport } from "./GlobalFilterBar.jsx";
import HelpTip from "./HelpTip.jsx";
import Icon from "./icons.jsx";
import { SubTabs } from "./ui.jsx";
import { money } from "./adminOrders.js";
import { isDemoLogin } from "./adminAuth.js";
import { fetchPricingOverview } from "./pricing/api.js";
import { BandBlock, RuleRow } from "./pricing/FramesSection.jsx";
import { AdjustRow } from "./pricing/lensShared.jsx";
import CommissionsSection from "./pricing/CommissionsSection.jsx";
import CostsAccordions from "./pricing/CostsSection.jsx";
import FinAcc, { useOpenSet } from "./finance/Accordion.jsx";
import RulesIO from "./finance/RulesIO.jsx";
import { fetchFinanceRules } from "./finance/financeApi.js";
import FinancialStatement from "./FinancialStatement.jsx";
import { TENANT } from "../config/tenant.js";
import "./finance/finance.css";
import PriceMatrix from "./pricing/PriceMatrix.jsx";
import PriceImport from "./PriceImport.jsx";
import useSubTab from "./pricing/useSub.js";
import "./pricing.css";

const dollars = (cents) => (cents == null ? 0 : Math.round(Number(cents)) / 100);

/** Subpestañas, en el orden del dueño: los artículos primero, las reglas al final. */
const TABS = ["frames", "cases", "lenses", "treatments", "rules"];
/** `sub` de la pantalla vieja → la nueva (los enlaces de correos y de la hoja siguen sirviendo). */
const LEGACY_SUB = { costs: "rules", sheets: "rules", commissions: "rules", band: "rules" };

const normalizeSub = (v) => {
  const raw = String(v || "");
  const head = raw.split("-")[0];
  if (TABS.includes(head)) return head;
  return LEGACY_SUB[head] || null;
};

export default function PricingPanel({ me = null, sellers = [], go, params = null, onSub = null }) {
  const { t } = useLang();
  const { storeId, isAll, isWeb } = useStoreFilter(me);
  const [view, pickSub] = useSubTab({ normalize: normalizeSub, fallback: TABS[0], sub: params?.sub ?? null, onSub });

  const items = [
    { key: "frames", icon: "glasses", label: t("adm.pm.sub.frames") },
    { key: "cases", icon: "case", label: t("adm.pm.sub.cases") },
    { key: "lenses", icon: "lens", label: t("adm.pm.sub.lenses") },
    { key: "treatments", icon: "drop", label: t("adm.pm.sub.treatments") },
    { key: "rules", icon: "percent", label: t("adm.pm.sub.rules") },
  ];
  const intro = {
    frames: "adm.pm.intro.frames",
    cases: "adm.pm.intro.cases",
    lenses: "adm.pm.intro.lenses",
    treatments: "adm.pm.intro.treatments",
    rules: "adm.pm.intro.rules",
  }[view];

  return (
    <div className="pp adm-section">
      <div className="pp-head">
        <h2>{t("adm.tab.products")}<HelpTip topic="price.rule" /></h2>
      </div>
      <SubTabs items={items} value={view} onChange={(k) => pickSub(k)} />
      <p className="pp-intro pm-intro-m">{t(intro)}</p>
      {view === "rules" ? (
        <RulesView me={me} sellers={sellers} go={go} params={params} />
      ) : (
        <PriceMatrix
          key={view}
          section={view}
          me={me}
          onlyStore={isAll || isWeb ? null : storeId}
          initialQ={params?.q || ""}
        />
      )}
    </div>
  );
}

/**
 * «Reglas y comisiones» (7-nov-2026): TODO en una vista, en acordeones —
 * costos fijos, variables, compartidos, por venta, impuestos, comisiones y el
 * ajuste general con la banda de precio — con una tira de indicadores del mes
 * (ventas netas, fijos, margen de contribución, punto de equilibrio,
 * resultado), Excel de ida y vuelta de todo el bloque (finance/RulesIO.jsx) y
 * el botón «Estado de resultados» (FinancialStatement.jsx). Costos y
 * comisiones leen GET /admin/finance/rules; el ajuste y la banda, como
 * siempre, `GET /admin/pricing/overview` (maestro o variación de la tienda
 * elegida arriba) con RuleRow/BandBlock/AdjustRow de siempre.
 */
function RulesView({ me, sellers, go, params = null }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const { storeId, store, isAll, isWeb } = useStoreFilter(me);
  const scope = isAll || isWeb ? "all" : storeId;
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  // Costos, comisiones e impuestos: GET /admin/finance/rules (los acordeones).
  const [fin, setFin] = useState(null);
  const [finState, setFinState] = useState("loading");
  // ?sub=rules-statement abre directamente el estado de resultados (enlace del Ejecutivo).
  const [showStatement, setShowStatement] = useState(() => String(params?.sub || "") === "rules-statement");
  const [open, toggleAcc] = useOpenSet(["fixed", "commissions"]);
  const ref = useRef(null);
  const demo = isDemoLogin();

  const load = useCallback(() => {
    setState("loading");
    fetchPricingOverview(scope)
      .then((d) => { setData(d); setState("ok"); })
      .catch((err) => { setState(err.message || "adm.err.pricing.load_failed"); });
  }, [scope]);
  useEffect(load, [load]);
  const loadFin = useCallback(() => {
    let off = false;
    fetchFinanceRules(scope)
      .then((d) => { if (!off) { setFin(d); setFinState("ok"); } })
      .catch((err) => { if (!off) setFinState(err.message || "adm.err.fin.load_failed"); });
    return () => { off = true; };
  }, [scope]);
  useEffect(loadFin, [loadFin]);
  // Una escritura de costos o comisiones: se relee la vista (los totales
  // mensuales, el reparto y el resultado del mes los calcula el servidor).
  const onFinSaved = useCallback(() => { toast({ tone: "success", title: t("adm.price.saved") }); loadFin(); }, [toast, t, loadFin]);

  // Cada escritura contesta la porción que cambió: se fusiona sin releer todo.
  const onSaved = useCallback((slice) => {
    if (!slice) return;
    setData((prev) => (prev ? { ...prev, ...slice } : prev));
    toast({ tone: "success", title: t("adm.price.saved") });
  }, [toast, t]);
  const onError = useCallback((key) => { toast({ tone: "error", title: t(key) }); }, [toast, t]);

  const scopeLabel = data?.store
    ? t("adm.price.storeScope", { store: [data.store.code, data.store.name].filter(Boolean).join(" · ") })
    : t("adm.price.master");

  /** El reporte formal: la lista que el personal imprime (PDF, Excel y CSV). */
  const report = useMemo(() => {
    if (!data) return null;
    return () => {
      const labelOf = (row) => String((lang === "en" ? row.label_en : row.label_es) || row.code);
      const designs = new Map(data.lenses.designs.map((d) => [d.code, d]));
      const materials = new Map(data.lenses.materials.map((m) => [m.code, m]));
      const priceOf = (cell) => dollars(data.store ? (cell.store_cents ?? cell.cents) : cell.cents);
      return {
        title: t("adm.price.reportTitle"),
        subtitle: scopeLabel,
        store: data.store ? { code: data.store.code, name: data.store.name, color: store?.color } : null,
        period: null,
        lang,
        t,
        landscape: true,
        filename: `precios-${data.store?.code || "maestro"}`,
        kpis: [
          { label: t("adm.price.frames.pills.frames"), value: data.frames.counts.frames },
          { label: t("adm.price.frames.pills.cases"), value: data.frames.counts.cases },
          { label: t("adm.price.comm.pills.sellers"), value: data.commissions.sellers.length },
          { label: t("adm.price.costs.tax"), value: `${data.costs.taxes.rate_pct} %` },
        ],
        summaries: [
          {
            title: t("adm.price.frames.title"),
            pills: [
              {
                label: t("adm.price.frames.ruleFrames"),
                value: data.frames.rule
                  ? data.frames.rule.mode === "percent"
                    ? `${data.frames.rule.value} %`
                    : money(data.frames.rule.value, "usd", lang)
                  : t("adm.price.none"),
                strong: true,
              },
              {
                label: t("adm.price.frames.ruleCases"),
                value: data.frames.case_rule
                  ? data.frames.case_rule.mode === "percent"
                    ? `${data.frames.case_rule.value} %`
                    : money(data.frames.case_rule.value, "usd", lang)
                  : t("adm.price.none"),
              },
              ...(data.lenses.store?.adjust_pct != null
                ? [{ label: t("adm.price.lenses.adjust"), value: `${data.lenses.store.adjust_pct} %` }]
                : []),
            ],
          },
        ],
        tables: [
          {
            title: t("adm.price.lenses.matrix"),
            main: true,
            cols: [
              { header: t("adm.price.lenses.design"), get: (r) => r.design, width: 26 },
              { header: t("adm.price.lenses.design"), get: (r) => r.tier, width: 14 },
              { header: t("adm.price.frames.col.kind"), get: (r) => r.material, width: 18 },
              { header: t("adm.price.frames.col.price"), get: (r) => r.price, type: "money", width: 12 },
            ],
            rows: data.lenses.base.map((cell) => ({
              design: labelOf(designs.get(cell.design_code) || { code: cell.design_code }),
              tier: designs.get(cell.design_code)?.tier || "",
              // El acabado se nombra donde el diseño admite los dos (stock / tallado digital).
              material: [
                labelOf(materials.get(cell.material_code) || { code: cell.material_code }),
                designs.get(cell.design_code)?.category !== "prog" && cell.finish ? t(`adm.price.lens.finish.${cell.finish}`) : "",
              ].filter(Boolean).join(" · "),
              price: priceOf(cell),
            })),
          },
          {
            title: t("adm.price.lenses.photo"),
            cols: [
              { header: t("adm.price.lenses.photo"), get: (r) => r.label, width: 30 },
              { header: t("adm.price.frames.col.kind"), get: (r) => r.cat, width: 18 },
              { header: t("adm.price.frames.col.price"), get: (r) => r.price, type: "money", width: 12 },
            ],
            rows: data.lenses.photo.flatMap((p) =>
              ["sv", "bifocal", "prog"]
                .filter((c) => p[c] != null)
                .map((c) => ({
                  label: labelOf(p),
                  cat: t(`adm.price.lenses.cat.${c}`),
                  price: dollars(data.store ? (p.store?.[c] ?? p[c]) : p[c]),
                }))
            ),
          },
          {
            title: t("adm.price.lenses.ar"),
            cols: [
              { header: t("adm.price.lenses.ar"), get: (r) => r.label, width: 30 },
              { header: t("adm.price.frames.col.kind"), get: (r) => r.group, width: 22 },
              { header: t("adm.price.frames.col.price"), get: (r) => r.price, type: "money", width: 12 },
            ],
            rows: data.lenses.ar.map((a) => ({
              label: labelOf(a),
              group: t(`adm.price.lenses.arGroup.${a.ar_group === "sv" || a.ar_group === "bifprog" ? a.ar_group : "all"}`),
              price: dollars(data.store ? (a.store_cents ?? a.cents) : a.cents),
            })),
          },
          {
            title: t("adm.price.frames.modified"),
            empty: t("adm.price.frames.empty"),
            cols: [
              { header: t("adm.price.frames.col.title"), get: (r) => r.title, width: 30 },
              { header: t("adm.price.frames.col.kind"), get: (r) => t(`adm.price.frames.kind.${r.kind}`), width: 12 },
              { header: t("adm.price.frames.col.sku"), get: (r) => r.sku, width: 18 },
              { header: t("adm.price.frames.col.base"), get: (r) => r.base, type: "money", width: 12 },
              { header: t("adm.price.frames.col.price"), get: (r) => r.price, type: "money", width: 12 },
            ],
            rows: data.frames.overrides,
          },
          {
            title: t("adm.price.comm.title"),
            cols: [
              { header: t("adm.price.comm.seller"), get: (r) => r.name, width: 26 },
              { header: t("adm.price.comm.code"), get: (r) => r.code, width: 12 },
              { header: t("adm.price.comm.pct"), get: (r) => r.pct, type: "pct", width: 10 },
            ],
            rows: data.commissions.sellers,
          },
          {
            title: t("adm.price.costs.title"),
            cols: [
              { header: t("adm.price.costs.col.label"), get: (r) => r.label, width: 32 },
              { header: t("adm.price.costs.col.value"), get: (r) => r.value, type: "money", width: 12 },
              { header: t("adm.price.costs.col.on"), get: (r) => (r.enabled ? t("adm.price.costs.on") : t("adm.price.costs.off")), width: 16 },
            ],
            rows: data.costs.rules,
          },
        ],
      };
    };
  }, [data, lang, t, scopeLabel, store]);

  useRegisterExport(
    data ? menuHandlers({ targetRef: ref, title: t("adm.price.reportTitle"), name: "precios", report }) : null
  );

  if (showStatement) {
    return <FinancialStatement initialStore={scope === "all" ? null : scope} onClose={() => setShowStatement(false)} />;
  }

  if (state === "loading") return <div className="adm-src-note loading">{t("adm.price.loading")}</div>;
  if (state !== "ok" || !data) {
    return (
      <div className="pp">
        <div className="adm-login-err">{t(state === "ok" ? "adm.price.loadFailed" : state)}</div>
        <button type="button" className="btn-xs" onClick={load}>{t("adm.price.retry")}</button>
      </div>
    );
  }

  const pnl = fin?.pnl;
  const focus = scope !== "all" ? pnl?.stores?.find((s) => s.establishment_id === scope) : pnl?.total;
  const mo = (v) => (v === null || v === undefined ? "—" : money(Number(v), "usd", lang));
  const kpis = focus ? [
    { k: "net_sales", v: mo(focus.net_sales), help: "fin.kpi.netSales" },
    { k: "fixed_total", v: mo(focus.fixed_total), help: "fin.fixedTotal" },
    { k: "contribution_pct", v: focus.contribution_pct == null ? "—" : `${focus.contribution_pct} %`, help: "fin.contributionMargin" },
    { k: "break_even", v: mo(focus.break_even), help: "fin.breakEven" },
    { k: "result", v: mo(focus.result), help: "fin.kpi.result", tone: Number(focus.result) < 0 ? "bad" : "good" },
  ] : [];

  return (
    <div className="pp-rules fin-view" ref={ref}>
      <div className="pp-meta fin-top">
        {/* El «maestro vs. variación de tienda» va en la pastilla de ámbito: se
            elige con el selector de tienda de arriba. */}
        <span className="pp-scope" title={t("adm.price.intro")}><Icon name="store" size={12} />{scopeLabel}</span>
        <span className="fin-top-act">
          <button type="button" className="btn-xs primary" onClick={() => setShowStatement(true)}><Icon name="receipt" size={13} /> {t("adm.fin.st.open")}</button>
          {fin && <RulesIO data={fin} who={me?.display_name || me?.email || ""} business={TENANT.name} onApplied={onFinSaved} onError={onError} />}
        </span>
      </div>
      {kpis.length > 0 && (
        <div className="fin-kpis" aria-label={t("adm.fin.kpi.title", { month: pnl.month })}>
          <span className="fin-kpi-m"><Icon name="calendar" size={12} /> {t("adm.fin.kpi.month", { month: pnl.month })}</span>
          {kpis.map((x) => (
            <span key={x.k} className={`fin-kpi ${x.tone || ""}`}>
              <small>{t(`adm.fin.kpi.${x.k}`)}<HelpTip topic={x.help} /></small>
              <b>{x.v}</b>
            </span>
          ))}
        </div>
      )}
      {finState !== "ok" && finState !== "loading" && (
        <div className="adm-login-err">{t(finState)} <button type="button" className="btn-xs" onClick={loadFin}>{t("adm.price.retry")}</button></div>
      )}
      {!fin && finState === "loading" && <div className="adm-src-note loading">{t("adm.fin.loading")}</div>}
      {fin && (
        <div className="fin-accs">
          <CostsAccordions data={fin} scopeStore={scope === "all" ? null : scope} open={open} onToggle={toggleAcc} onSaved={onFinSaved} onError={onError} />
          <FinAcc id="commissions" icon="sellers" title={t("adm.fin.acc.commissions")} help="fin.acc.commissions" count={fin.commissions.sellers.filter((x) => x.active).length}
            total={focus ? focus.commissions : null} totalLabel={t("adm.fin.acc.thisMonth")} totalHelp="fin.commissionBase" open={open.has("commissions")} onToggle={toggleAcc}>
            <CommissionsSection commissions={fin.commissions} stores={fin.stores} earned={pnl?.sellers || []} onSaved={onFinSaved} onError={onError} />
          </FinAcc>
          <FinAcc id="adjust" icon="percent" title={t("adm.fin.acc.adjust")} help="fin.acc.adjust" open={open.has("adjust")} onToggle={toggleAcc}>
            <div className="pp-two fin-adjust">
              <section className="pp-pane">
                <RuleRow scope="frame" rule={data.frames.rule} store={scope} onSaved={onSaved} onError={onError} t={t} lang={lang} />
                <RuleRow scope="case" rule={data.frames.case_rule} store={scope} onSaved={onSaved} onError={onError} t={t} lang={lang} />
                <AdjustRow lenses={data.lenses} store={scope} onSaved={onSaved} onError={onError} id="pp-rules-lens-adjust" />
                {!data.store && <p className="pp-intro">{t("adm.pm.rules.adjustHint")}</p>}
              </section>
              <section className="pp-pane">
                <BandBlock store={scope} onError={onError} />
              </section>
            </div>
          </FinAcc>
        </div>
      )}
      {/* PriceImport trae su propia tarjeta. */}
      {!demo && <PriceImport />}
      <details className="pp-pane">
        <summary><Icon name="receipt" size={14} /> {t("adm.price.tab.sheets")}</summary>
        <Profitability sellers={sellers} go={go} />
      </details>
    </div>
  );
}
