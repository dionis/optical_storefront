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
//
// VISTAS EN PESTAÑAS, no una pila de acordeones: «vamos a hacerlo por vistas en
// pestañas, para evitar hacer scroll lo menos posible. Primero el manejo de las
// monturas, luego el manejo de los lentes … luego el tratamiento de los
// lentes». Ese es el orden de TABS, y cada pestaña entra sola en la pantalla.
// La pestaña abierta viaja en `?sub=` (ver pricing/useSub.js), así que recargar
// no devuelve al principio y el enlace abre la vista exacta.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { SummaryPills } from "./Accordion.jsx";
import { Profitability } from "./Costs.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import { menuHandlers, useRegisterExport } from "./GlobalFilterBar.jsx";
import HelpTip from "./HelpTip.jsx";
import Icon from "./icons.jsx";
import { SubTabs } from "./ui.jsx";
import { money } from "./adminOrders.js";
import { fetchPricingOverview } from "./pricing/api.js";
import FramesSection from "./pricing/FramesSection.jsx";
import LensesSection from "./pricing/LensesSection.jsx";
import TreatmentsSection from "./pricing/TreatmentsSection.jsx";
import CommissionsSection from "./pricing/CommissionsSection.jsx";
import CostsSection from "./pricing/CostsSection.jsx";
import useSubTab from "./pricing/useSub.js";
import "./pricing.css";

const dollars = (cents) => (cents == null ? 0 : Math.round(Number(cents)) / 100);

/**
 * Las vistas, en el orden que pidió el dueño: monturas → lentes →
 * tratamientos → lo que queda (comisiones y costos) → las fichas por pedido.
 */
const TABS = ["frames", "lenses", "treatments", "costs", "sheets"];

/**
 * `?sub=` lleva DOS niveles con un solo parámetro: `lenses-prog` abre los
 * lentes por el tipo «progresivo». Un solo parámetro porque es el que el
 * armazón ya reparte (`params.sub`), y así un enlace apunta a la vista exacta
 * sin inventar otro nombre de consulta.
 */
const headOf = (v) => String(v || "").split("-")[0];
const tailOf = (v) => String(v || "").split("-").slice(1).join("-") || null;
const normalizeSub = (v) => {
  const raw = String(v || "");
  const head = headOf(raw);
  if (!TABS.includes(head)) return null;
  // Solo los lentes tienen segundo nivel; el resto se queda en su nombre.
  return head === "lenses" ? raw : head;
};

export default function PricingPanel({ me = null, sellers = [], go, params = null, onSub = null }) {
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

  // Antes de los `return` de carga y error: un hook no puede quedar detrás de
  // un return condicional.
  const [sub, pickSub] = useSubTab({
    normalize: normalizeSub,
    fallback: TABS[0],
    sub: params?.sub ?? null,
    onSub,
  });
  const view = headOf(sub);
  const lensCat = tailOf(sub);

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

  /**
   * Lo esencial de cada vista como pastillas, al lado del título: es lo que
   * antes se leía en la cabecera del acordeón sin abrirlo, y sin ellas cambiar
   * de pestaña sería cambiar a ciegas.
   */
  const PILLS = {
    frames: [
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
    ],
    lenses: [
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
    ],
    treatments: [
      { label: t("adm.price.treat.pills.photo"), value: data.lenses.photo.length },
      { label: t("adm.price.treat.pills.ar"), value: data.lenses.ar.length },
    ],
    costs: [
      {
        label: t("adm.price.comm.default"),
        value: data.commissions.default_pct == null ? t("adm.price.none") : `${data.commissions.default_pct} %`,
        strong: true,
      },
      { label: t("adm.price.comm.pills.sellers"), value: data.commissions.sellers.length },
      { label: t("adm.price.costs.pills.rules"), value: data.costs.rules.length },
      ...(offCount ? [{ label: t("adm.price.costs.pills.off"), value: offCount, tone: "warn" }] : []),
      { label: t("adm.price.costs.tax"), value: `${data.costs.taxes.rate_pct} %` },
    ],
    sheets: [],
  };

  // `sub` es la frase de la vista: una sola línea de prosa antes de los datos,
  // y escrita como literal para que `check-i18n` pueda comprobar la clave.
  const items = [
    { key: "frames", icon: "glasses", label: t("adm.price.tab.frames"), sub: t("adm.price.frames.sub") },
    { key: "lenses", icon: "eye", label: t("adm.price.tab.lenses"), sub: t("adm.price.lenses.sub") },
    { key: "treatments", icon: "palette", label: t("adm.price.tab.treatments"), sub: t("adm.price.treat.sub") },
    { key: "costs", icon: "costs", label: t("adm.price.tab.costs"), sub: t("adm.price.tab.costsSub") },
    { key: "sheets", icon: "receipt", label: t("adm.price.tab.sheets"), sub: t("adm.price.sheets.sub") },
  ];
  const current = items.find((i) => i.key === view) || items[0];

  return (
    <div className="pp adm-section" ref={ref}>
      <div className="pp-head">
        <h2>{t("adm.tab.pricing")}<HelpTip topic="price.rule" /></h2>
        {/* El «maestro vs. variación de tienda» se explica en la pastilla de
            ámbito en vez de en un párrafo: una línea menos antes de los datos. */}
        <span className="pp-scope" title={t("adm.price.intro")}><Icon name="store" size={12} />{scopeLabel}</span>
      </div>

      <SubTabs items={items} value={view} onChange={(k) => pickSub(k)} />

      <div className="pp-meta">
        <p className="pp-intro">{current.sub}</p>
        <SummaryPills items={PILLS[view] || []} />
      </div>

      {view === "frames" && (
        <FramesSection
          frames={data.frames}
          store={scope}
          storeId={data.store?.id || stores[0]?.id || null}
          onSaved={onSaved}
          onError={onError}
        />
      )}

      {view === "lenses" && (
        <LensesSection
          lenses={data.lenses}
          store={scope}
          cat={lensCat}
          onCat={(c) => pickSub(`lenses-${c}`)}
          onSaved={onSaved}
          onError={onError}
        />
      )}

      {view === "treatments" && (
        <TreatmentsSection lenses={data.lenses} store={scope} onSaved={onSaved} onError={onError} />
      )}

      {/* UNA pestaña y DOS columnas, no dos pestañas: el dueño pidió
          «comisiones, costos fijos, costos variables, impuestos … en el mismo
          sitio, para saber dónde ir si quiere cambiar algo concreto», y las
          comisiones son un costo más de la venta. Las dos listas son estrechas
          (concepto + número), así que lado a lado caben enteras y se comparan
          de un vistazo; partirlas en dos pestañas sería un clic más para ver
          dos mitades de la misma cuenta. */}
      {view === "costs" && (
        <div className="pp-two">
          {/* A la izquierda lo que se paga a la gente y lo que cuesta el mes;
              a la derecha lo que se le descuenta a CADA venta. Repartido así
              las dos columnas acaban a la misma altura y la pestaña entra
              entera en la pantalla, que es de lo que iba el encargo. */}
          <div className="pp-col">
            <section className="pp-pane">
              <h3>
                <Icon name="sellers" size={14} />
                <span className="pp-pane-t">{t("adm.price.comm.title")}</span>
              </h3>
              <CommissionsSection commissions={data.commissions} onSaved={onSaved} onError={onError} />
            </section>
            <section className="pp-pane">
              <h3>
                <Icon name="store" size={14} />
                <span className="pp-pane-t">{t("adm.price.costs.perStore")}</span>
              </h3>
              <CostsSection
                costs={data.costs}
                store={scope}
                isStore={Boolean(data.store)}
                part="store"
                onSaved={onSaved}
                onError={onError}
              />
            </section>
          </div>
          <section className="pp-pane">
            <h3>
              <Icon name="costs" size={14} />
              <span className="pp-pane-t">{t("adm.price.costs.perSale")}</span>
            </h3>
            <CostsSection
              costs={data.costs}
              store={scope}
              isStore={Boolean(data.store)}
              part="rules"
              onSaved={onSaved}
              onError={onError}
            />
          </section>
        </div>
      )}

      {view === "sheets" && <Profitability sellers={sellers} go={go} />}
    </div>
  );
}
