// Dónde se usa: pestaña «Precios y costos» de /admin (clave `pricing`, grupo
// Comercial, solo dueño y superadmin).
//
// UN solo panel para todo lo que pidió el dueño: «agrupar todo lo de gestión de
// costos y precios y ganancia en un solo panel para el superadmin, incluido el
// precio por tienda … en el mismo sitio: comisiones, costos fijos, costos
// variables, impuestos, para saber dónde ir si quiere cambiar algo concreto».
//
// Usa el selector de tienda GLOBAL (StoreFilter): «Todas las tiendas» edita el
// MAESTRO (la lista del dueño) y una tienda edita SUS variaciones sobre ese
// maestro, con la pastilla «Heredado» donde no ha cambiado nada. No tiene filtro
// de período: un precio no es un informe. Backend: /admin/pricing/* (una sola
// lectura, `GET /admin/pricing/overview`).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Accordion, { AccordionGroup } from "./Accordion.jsx";
import { Profitability } from "./Costs.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import { menuHandlers, useRegisterExport } from "./GlobalFilterBar.jsx";
import HelpTip from "./HelpTip.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { fetchPricingOverview } from "./pricing/api.js";
import FramesSection from "./pricing/FramesSection.jsx";
import LensesSection from "./pricing/LensesSection.jsx";
import CommissionsSection from "./pricing/CommissionsSection.jsx";
import CostsSection from "./pricing/CostsSection.jsx";
import "./pricing.css";

const dollars = (cents) => (cents == null ? 0 : Math.round(Number(cents)) / 100);

export default function PricingPanel({ me = null, sellers = [], go }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const { storeId, store, stores, isAll, isWeb } = useStoreFilter(me);
  // «Todas las tiendas» y «Tienda online» son el maestro: el canal web no es un
  // establecimiento y no tiene variaciones propias.
  const scope = isAll || isWeb ? "all" : storeId;
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const ref = useRef(null);

  const load = useCallback(() => {
    setState("loading");
    fetchPricingOverview(scope)
      .then((d) => { setData(d); setState("ok"); })
      .catch((err) => { setState(err.message || "adm.err.pricing.load_failed"); });
  }, [scope]);
  useEffect(load, [load]);

  // Cada escritura contesta solo la porción que cambió: se fusiona en el
  // payload en vez de volver a leerlo todo (la matriz de lentes es grande y el
  // dueño la repasa celda a celda).
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
              material: labelOf(materials.get(cell.material_code) || { code: cell.material_code }),
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

  if (state === "loading") return <div className="adm-src-note loading">{t("adm.price.loading")}</div>;
  if (state !== "ok" || !data) {
    return (
      <div className="pp">
        <div className="adm-login-err">{t(state === "ok" ? "adm.price.loadFailed" : state)}</div>
        <button type="button" className="btn-xs" onClick={load}>{t("adm.price.retry")}</button>
      </div>
    );
  }

  const offCount = data.costs.rules.filter((r) => !r.enabled).length;
  const changedCells = data.lenses.store?.cells.length ?? 0;

  return (
    <div className="pp adm-section" ref={ref}>
      <div className="pp-head">
        <h2>{t("adm.tab.pricing")}<HelpTip topic="price.rule" /></h2>
        <span className="pp-scope"><Icon name="store" size={12} />{scopeLabel}</span>
      </div>
      <p className="pp-intro">{t("adm.price.intro")}</p>

      <AccordionGroup>
        <Accordion
          id="pricing-frames"
          icon="prices"
          title={t("adm.price.frames.title")}
          subtitle={t("adm.price.frames.sub")}
          defaultOpen
          summary={[
            {
              label: t("adm.price.frames.ruleFrames"),
              value: data.frames.rule
                ? data.frames.rule.mode === "percent"
                  ? `${data.frames.rule.value > 0 ? "+" : ""}${data.frames.rule.value} %`
                  : money(data.frames.rule.value, "usd", lang)
                : t("adm.price.none"),
              strong: true,
            },
            { label: t("adm.price.frames.pills.frames"), value: data.frames.counts.frames },
            { label: t("adm.price.frames.pills.cases"), value: data.frames.counts.cases },
          ]}
        >
          <FramesSection
            frames={data.frames}
            store={scope}
            storeId={data.store?.id || stores[0]?.id || null}
            onSaved={onSaved}
            onError={onError}
          />
        </Accordion>

        <Accordion
          id="pricing-lenses"
          icon="eye"
          title={t("adm.price.lenses.title")}
          subtitle={t("adm.price.lenses.sub")}
          summary={[
            { label: t("adm.price.lenses.pills.designs"), value: data.lenses.designs.length },
            { label: t("adm.price.lenses.pills.materials"), value: data.lenses.materials.length },
            ...(data.lenses.store
              ? [
                  {
                    label: t("adm.price.lenses.adjust"),
                    value: data.lenses.store.adjust_pct == null ? t("adm.price.none") : `${data.lenses.store.adjust_pct} %`,
                    strong: true,
                  },
                  ...(changedCells ? [{ label: t("adm.price.lenses.cellsOwn"), value: changedCells }] : []),
                ]
              : []),
          ]}
        >
          <LensesSection lenses={data.lenses} store={scope} onSaved={onSaved} onError={onError} />
        </Accordion>

        <Accordion
          id="pricing-commissions"
          icon="sellers"
          title={t("adm.price.comm.title")}
          subtitle={t("adm.price.comm.sub")}
          summary={[
            {
              label: t("adm.price.comm.default"),
              value: data.commissions.default_pct == null ? t("adm.price.none") : `${data.commissions.default_pct} %`,
              strong: true,
            },
            { label: t("adm.price.comm.pills.sellers"), value: data.commissions.sellers.length },
          ]}
        >
          <CommissionsSection commissions={data.commissions} onSaved={onSaved} onError={onError} />
        </Accordion>

        <Accordion
          id="pricing-costs"
          icon="costs"
          title={t("adm.price.costs.title")}
          subtitle={t("adm.price.costs.sub")}
          summary={[
            { label: t("adm.price.costs.pills.rules"), value: data.costs.rules.length },
            ...(offCount ? [{ label: t("adm.price.costs.pills.off"), value: offCount, tone: "warn" }] : []),
            { label: t("adm.price.costs.tax"), value: `${data.costs.taxes.rate_pct} %`, strong: true },
          ]}
        >
          <CostsSection
            costs={data.costs}
            store={scope}
            isStore={Boolean(data.store)}
            onSaved={onSaved}
            onError={onError}
          />
        </Accordion>

        <Accordion
          id="pricing-sheets"
          icon="receipt"
          title={t("adm.price.sheets.title")}
          subtitle={t("adm.price.sheets.sub")}
        >
          <Profitability sellers={sellers} go={go} />
        </Accordion>
      </AccordionGroup>
    </div>
  );
}
