// Dónde se usa: pestaña «Estado de cuenta» de /admin. Estado de cuenta de una
// tienda por período (GET /admin/pos/statement): todas las ventas del mes con
// sus cobros y saldos, totales por método, vendedor y día, y la liquidación de
// una tienda familiar/asociada/en consignación. Documento imprimible (carta)
// y exportable a Excel (Ventas / Cobros / Vendedores / Días). Todo importe lo
// calcula el servidor; aquí solo se pinta y se formatea.
//
// Tienda y período salen de la barra de filtros global del panel (AdminShell):
// «Mes» = el mes natural entero, «Mes pasado» = el anterior entero, y cualquier
// otro período o rango se toma tal cual. PDF y Excel se registran en esa barra.
//
// La identidad del documento es la de ESTE despliegue (config/tenant.js: nombre
// y logo de la óptica), igual que en los reportes de ReportDoc. El bloque
// `business` del servidor solo aporta el nombre legal y la dirección: su
// `name`/`url` traen el valor por defecto del backend (STORE_NAME /
// STOREFRONT_URL, «RUBI LENS» mientras no se configuren) y poner eso en la
// cabecera de la óptica era el fallo que reportó el dueño.
//
// El alcance se dice siempre en pantalla: la tienda online no tiene estado de
// cuenta (se enseña el consolidado) y a quien no es administrador se le enseña
// una de sus tiendas aunque la barra tenga otra elegida.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useAdminLensCatalog } from "../data/lensCatalog.js";
import { TENANT } from "../config/tenant.js";
import Icon from "./icons.jsx";
import HelpTip from "./HelpTip.jsx";
import { money } from "./adminOrders.js";
import { downloadXlsx } from "./exportXlsx.js";
import { printElement } from "./exportUtils.js";
import { inkOn } from "./ReportDoc.jsx";
import { fetchStatement, posContext } from "./posApi.js";
import { useStoreFilter } from "./StoreFilter.jsx";
import { usePeriodFilter } from "./periodStore.js";
import { useRegisterExport } from "./GlobalFilterBar.jsx";
import { useSalePanel } from "./SaleDetailPanel.jsx";
import { useSortable } from "./useSortable.js";
import SortTh from "./SortTh.jsx";
import "./store-statement.css";
import "./screens.css";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthRange = (offset) => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: ymd(first), to: ymd(last) };
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Un YYYY-MM-DD como fecha local (new Date("2026-10-01") sería la medianoche UTC: un día antes en América). */
const dayLabel = (day, lang) => {
  if (!day || !DAY_RE.test(day)) return "—";
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es", { year: "numeric", month: "short", day: "numeric" });
};
const whenLabel = (iso, lang) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(lang === "en" ? "en-US" : "es", { dateStyle: "medium", timeStyle: "short" });
};
const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : e?.message?.startsWith("adm.") ? e.message : "adm.err.pos.generic");

/**
 * Logo de ESTA óptica. `/logo-oficial.png` es el que trae el repositorio y es
 * la marca RUBI LENS: hasta que el despliegue ponga `VITE_TENANT_LOGO` con el
 * suyo, el documento va con el NOMBRE de la óptica y sin imagen — nunca con el
 * logo de otra marca (fallo reportado por el dueño).
 * TODO(multi-tenant): cuando cada despliegue tenga su VITE_TENANT_LOGO, esta
 * lista de logos genéricos sobra.
 */
const GENERIC_LOGOS = ["/logo-oficial.png", "/logo-rubilens.png"];
const brandLogo = TENANT.logo && !GENERIC_LOGOS.includes(TENANT.logo) ? TENANT.logo : null;
/** El dominio de ESTE panel; el `business.url` del servidor es el del backend (STOREFRONT_URL). */
const panelHost = () => { try { return window.location.host.replace(/^www\./, ""); } catch { return ""; } };

/** Acordeón con totales en la cabecera; abierto a la fuerza mientras se imprime. */
function Acc({ open, onToggle, title, sum, children }) {
  return (
    <details className="cost-accordion stmt-acc" open={open} onToggle={(e) => onToggle(e.target.open)}>
      <summary className="cost-acc-head">
        <span className="cost-acc-title">{title}</span>
        <span className="stmt-acc-sum">{sum}</span>
        <Icon name="chevronDown" size={14} className="cost-acc-arrow" />
      </summary>
      <div className="cost-acc-body">{children}</div>
    </details>
  );
}

/** Props: `me` (alcance del usuario; `go` del panel se acepta y no se usa). */
export default function StoreStatement({ me }) {
  const { t, lang } = useLang();
  const catalog = useAdminLensCatalog();
  const [ctx, setCtx] = useState(null);
  // Período global del panel: el mes natural entero para «Mes» y «Mes pasado»; el resto, tal cual.
  const per = usePeriodFilter();
  const range = useMemo(() => (per.period === "month" ? monthRange(0) : per.period === "lastMonth" ? monthRange(-1) : { from: per.from, to: per.to }), [per.period, per.from, per.to]);
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [open, setOpen] = useState({ sales: true, methods: true, sellers: false, days: false });
  const [printing, setPrinting] = useState(false);
  const ref = useRef(null);
  const isAdmin = Boolean(ctx?.is_admin ?? me?.is_admin);
  // El número de cada venta abre su ficha (SaleDetailPanel); cobrar o anular desde ahí vuelve a pedir el estado de cuenta.
  const [reload, setReload] = useState(0);
  const sp = useSalePanel({ me, onChanged: () => setReload((n) => n + 1) });
  // La tienda la fija el filtro global del panel: «Todas» (o la online, que no tiene estado de cuenta)
  // es el negocio entero para un administrador y la primera de las suyas para los demás.
  const who = me || (ctx ? { is_admin: ctx.is_admin, role: ctx.role } : undefined);
  const { storeId: globalId, isAll, isWeb } = useStoreFilter(who);
  // `establishment_id` que acepta el servidor (lib/pos-statement.ts + su ruta):
  // el id de una tienda, o `all` SOLO para un administrador. Nunca «web»: la
  // tienda online no es un establecimiento y no tiene ventas de mostrador.
  const mine = !ctx ? null : ctx.stores.find((s) => s.id === globalId) || null;
  const storeId = !ctx ? "" : mine ? mine.id : isAdmin ? "all" : ctx.stores[0]?.id || "";
  // Por qué el documento no es de la tienda de la píldora de arriba.
  const scopeNote = !ctx || mine ? null : isWeb ? "web" : isAll ? null : "fallback";

  useEffect(() => { posContext().then(setCtx).catch(() => setCtx({ stores: [] })); }, []);

  useEffect(() => {
    if (!storeId) { setState("idle"); return undefined; }
    let cancelled = false;
    setState("loading");
    setError("");
    fetchStatement({ establishment_id: storeId, from: range.from, to: range.to })
      .then((d) => { if (!cancelled) { setData(d); setState("ready"); } })
      // Un error deja de enseñar el documento anterior: un estado de cuenta de
      // otra tienda o de otro período bajo un error es peor que no enseñar nada.
      .catch((e) => { if (!cancelled) { setData(null); setError(errKey(e)); setState("error"); } });
    return () => { cancelled = true; };
  }, [storeId, range.from, range.to, reload]);

  // Para imprimir se abren todos los acordeones (un <details> cerrado no se clona con contenido).
  useEffect(() => {
    if (!printing) return undefined;
    const id = setTimeout(() => {
      // El encabezado del navegador lleva «Óptica — Estado de cuenta EST-…», no el título de la tienda online.
      // En «Todas las tiendas» el servidor manda store.name = nombre del
      // backend (RUBI LENS por defecto): en el papel va el texto del panel.
      const meta = !data ? "" : data.store.kind === "all" ? t("adm.stmt.allStores") : `${data.store.code} · ${data.store.name}`;
      printElement(ref.current, { title: `${t("adm.stmt.title")} ${data?.number || ""}`, meta, docTitle: `${TENANT.name} — ${t("adm.stmt.title")} ${data?.number || ""}`.trim() });
      setPrinting(false);
    }, 50);
    return () => clearTimeout(id);
  }, [printing, data, t]);

  const m = (c) => money((Number(c) || 0) / 100, "usd", lang);
  const L = (o) => (o ? o[lang] ?? o.es : "");
  // Un método propio del dueño trae su nombre; los de serie salen del
  // diccionario. Un código sin clave (uno viejo) se lee por su código, nunca
  // como «adm.pos.method.loquesea» (t() cae en silencio en la clave).
  const methodLabel = (code, label) => {
    if (label) return L(label);
    const key = `adm.pos.method.${code}`;
    const txt = t(key);
    return txt === key ? String(code || "—").toUpperCase() : txt;
  };
  const sellerLabel = (code) => code || t("adm.stmt.noSeller");
  const lensSummary = (lens) => {
    if (!lens) return "";
    const ars = [...(catalog.AR?.sv || []), ...(catalog.AR?.bifprog || [])];
    return [
      L(catalog.DESIGNS.find((d) => d.id === lens.design)?.label) || lens.design,
      lens.material ? L(catalog.MATERIALS.find((d) => d.id === lens.material)?.label) || lens.material : null,
      lens.photo ? L(catalog.PHOTO.find((d) => d.id === lens.photo)?.label) || lens.photo : null,
      lens.ar ? L(ars.find((d) => d.id === lens.ar)?.label) || lens.ar : null,
    ].filter(Boolean).join(" · ");
  };
  const itemName = (it) => {
    if (it.kind === "own_frame") return t("adm.pos.own.tag");
    if (it.kind === "case") return [t("adm.stmt.case"), it.title].filter(Boolean).join(" · ");
    return [[it.brand, it.title].filter(Boolean).join(" "), it.variant].filter(Boolean).join(" · ");
  };
  const itemLine = (it) => {
    const lens = lensSummary(it.lens);
    return `${itemName(it)}${it.qty > 1 ? ` ×${it.qty}` : ""}${lens ? ` · ${lens}` : it.kind === "frame" ? ` · ${t("adm.pos.sum.frameOnly")}` : ""}`;
  };
  const itemsText = (s) => s.items.map(itemLine).join(" | ");

  const totals = data?.totals;
  const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");
  // Regla del documento: el total de la cabecera de cada acordeón y la fila de
  // total de su tabla son la SUMA DE SUS FILAS, no otra cifra del servidor —
  // así nunca se lee un total que no cuadra con lo que hay debajo (con el
  // período recortado, `truncated`, las dos cosas pueden diferir y se avisa).
  const sum = (rows, pick) => (rows || []).reduce((a, r) => a + (Number(pick(r)) || 0), 0);
  const live = useMemo(() => (data?.sales || []).filter((x) => x.status !== "voided"), [data]);
  const salesSum = useMemo(() => ({
    count: live.length,
    list_cents: sum(live, (x) => x.list_cents),
    discount_cents: sum(live, (x) => x.discount_cents),
    total_cents: sum(live, (x) => x.total_cents),
    paid_cents: sum(live, (x) => x.paid_cents),
    insurance_cents: sum(live, (x) => x.insurance_cents),
    balance_cents: sum(live, (x) => x.balance_cents),
  }), [live]);
  const methodsSum = useMemo(() => sum(totals?.by_method, (r) => r.cents), [totals]);
  const sellersSum = useMemo(() => sum(totals?.by_seller, (r) => r.total_cents), [totals]);
  const daysSum = useMemo(() => sum(totals?.by_day, (r) => r.total_cents), [totals]);
  // Cabeceras que ordenan (useSortable.js); la fila de total de cada tabla se pinta aparte y queda abajo.
  const salesSorted = useSortable(data?.sales || [], { id: "stmt-sales", defaultKey: "day", defaultDir: "asc", deps: [lang, catalog], getters: { items: itemsText, status: (x) => (x.status === "voided" ? 1 : 0) } });
  const methodsSorted = useSortable(totals?.by_method || [], { id: "stmt-methods", defaultKey: "cents", defaultDir: "desc", deps: [lang], getters: { method: (r) => methodLabel(r.code, r.label) } });
  const sellersSorted = useSortable(totals?.by_seller || [], { id: "stmt-sellers", defaultKey: "total_cents", defaultDir: "desc" });
  const daysSorted = useSortable(totals?.by_day || [], { id: "stmt-days", defaultKey: "date", defaultDir: "asc" });
  const sth = (sorted, col, label, align = "") => <SortTh col={col} sort={sorted.sort} onSort={sorted.toggle} align={align}>{label}</SortTh>;

  const onExcel = () => {
    if (!data) return;
    const tt = data.totals;
    const all = data.store.kind === "all";
    const cents = (v) => (Number(v) || 0) / 100;
    const sales = {
      name: t("adm.stmt.sheet.sales"),
      cols: [
        { header: t("adm.stmt.col.number"), key: "number", width: 14 },
        { header: t("adm.stmt.col.date"), get: (s) => s.day, type: "date", width: 12 },
        ...(all ? [{ header: t("adm.stmt.col.store"), key: "store_code", width: 8 }] : []),
        { header: t("adm.stmt.col.customer"), get: (s) => s.customer_name || "", width: 24 },
        { header: t("adm.stmt.col.seller"), get: (s) => s.seller_code || "", width: 10 },
        { header: t("adm.stmt.col.items"), get: itemsText, width: 60 },
        { header: t("adm.stmt.col.delivery"), get: (s) => t(`adm.stmt.delivery.${s.delivery}`), width: 10 },
        { header: t("adm.stmt.col.status"), get: (s) => t(`adm.stmt.status.${s.status}`), width: 11 },
        { header: t("adm.stmt.col.list"), key: "list", get: (s) => cents(s.list_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.discount"), key: "discount", get: (s) => cents(s.discount_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.tax"), key: "tax", get: (s) => cents(s.tax_cents), type: "money", width: 10 },
        { header: t("adm.stmt.col.total"), key: "total", get: (s) => cents(s.total_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.paid"), key: "paid", get: (s) => cents(s.paid_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.insurance"), key: "insurance", get: (s) => cents(s.insurance_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.balance"), key: "balance", get: (s) => cents(s.balance_cents), type: "money", width: 11 },
      ],
      rows: data.sales,
      totals: { list: cents(tt.list_cents), discount: cents(tt.discount_cents), tax: cents(tt.tax_cents), total: cents(tt.total_cents), paid: cents(tt.paid_cents), insurance: cents(tt.insurance_cents), balance: cents(tt.balance_cents) },
      totalsLabel: t("adm.stmt.total"),
    };
    const paymentRows = data.sales.filter((s) => s.status !== "voided").flatMap((s) => s.payments.map((p) => ({ ...p, sale: s.number, day: p.at.slice(0, 10) })));
    const payments = {
      name: t("adm.stmt.sheet.payments"),
      cols: [
        { header: t("adm.stmt.col.date"), key: "day", type: "date", width: 12 },
        { header: t("adm.stmt.col.sale"), key: "sale", width: 14 },
        { header: t("adm.stmt.col.method"), get: (p) => methodLabel(p.method_code, p.method), width: 18 },
        { header: t("adm.stmt.col.kind"), get: (p) => t(`adm.stmt.pay.${p.kind}`), width: 12 },
        { header: t("adm.stmt.col.reference"), get: (p) => p.reference || "", width: 18 },
        { header: t("adm.stmt.col.amount"), key: "amount", get: (p) => (p.kind === "refund" ? -1 : 1) * cents(p.amount_cents), type: "money", width: 12 },
      ],
      rows: paymentRows,
      totals: { amount: cents(tt.by_method.reduce((a, r) => a + r.cents, 0)) },
      totalsLabel: t("adm.stmt.total"),
    };
    const sellers = {
      name: t("adm.stmt.sheet.sellers"),
      cols: [
        { header: t("adm.stmt.col.seller"), get: (r) => sellerLabel(r.seller_code), width: 16 },
        { header: t("adm.stmt.col.count"), key: "count", type: "int", width: 10 },
        { header: t("adm.stmt.col.total"), key: "total", get: (r) => cents(r.total_cents), type: "money", width: 12 },
      ],
      rows: tt.by_seller,
      totals: { count: tt.count, total: cents(tt.total_cents) },
      totalsLabel: t("adm.stmt.total"),
    };
    const days = {
      name: t("adm.stmt.sheet.days"),
      cols: [
        { header: t("adm.stmt.col.day"), key: "date", type: "date", width: 12 },
        { header: t("adm.stmt.col.count"), key: "count", type: "int", width: 10 },
        { header: t("adm.stmt.col.total"), key: "total", get: (r) => cents(r.total_cents), type: "money", width: 12 },
      ],
      rows: tt.by_day,
      totals: { count: tt.count, total: cents(tt.total_cents) },
      totalsLabel: t("adm.stmt.total"),
    };
    downloadXlsx(`estado_${data.store.code}_${data.period.from}_${data.period.to}.xlsx`, [sales, payments, sellers, days]);
  };

  const acc = (k) => ({ open: printing || open[k], onToggle: (v) => { if (!printing) setOpen((o) => (o[k] === v ? o : { ...o, [k]: v })); } });
  // PDF y Excel desde la barra global del panel; sin datos todavía, no hay nada que exportar (ambos apagados).
  const canExport = Boolean(data) && !printing;
  useRegisterExport(canExport ? { pdf: () => setPrinting(true), xlsx: onExcel, label: `${t("adm.stmt.title")} ${data?.number || ""}`.trim() } : null);

  if (!ctx) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (!ctx.stores.length && !isAdmin) return <div className="adm-section"><div className="adm-empty"><Icon name="store" size={36} /><b>{t("adm.stmt.noStores")}</b></div></div>;

  const all = data?.store.kind === "all";
  // Nombre legal: solo si de verdad añade algo al nombre de la óptica.
  const legal = String(data?.business?.legal_name || "").trim();
  // Solo si el nombre legal es el de ESTA óptica («Óptica El Rancho LLC»); el
  // del backend sin configurar («RUBI LENS LLC») es otra marca: no se imprime.
  const brand = TENANT.name.trim().toLowerCase();
  const legalName = legal && legal.toLowerCase() !== brand && legal.toLowerCase().includes(brand) ? legal : "";
  const host = panelHost();
  // Alcance que se está leyendo (aunque el servidor todavía no haya contestado).
  const shown = ctx?.stores.find((x) => x.id === storeId);
  const scopeLabel = shown ? `${shown.code} · ${shown.name}` : t("adm.stmt.allStores");
  // «Mes» y «Mes pasado» son el mes natural ENTERO (un estado de cuenta es
  // mensual), no «del 1 a hoy» como en el resto del panel: se dice en pantalla.
  const naturalMonth = per.period === "month" || per.period === "lastMonth";
  // Franja en el color de la tienda sobre la cabecera impresa (como los reportes de ReportDoc).
  const bandColor = (!all && (ctx.stores.find((x) => x.id === storeId)?.color)) || "#1f2a44";
  const bandInk = inkOn(bandColor);
  const settlement = data?.settlement;
  return (
    <div className="adm-section stmt">
      <div className="adm-head-row">
        <h2><Icon name="clipboard" size={20} /> {t("adm.stmt.title")}<HelpTip topic="statement.what" size={16} /></h2>
        {/* Qué tienda cubre el documento: la píldora de la cabecera dice dónde
            está el operador, y aquí se dice el alcance del estado de cuenta
            (pueden no coincidir: la tienda online no tiene estado de cuenta). */}
        <div className="scr-tools adm-noprint">
          <span className="adm-chip neutral" title={t("adm.scr.st.scope")}><Icon name="store" size={12} /> {scopeLabel}</span>
          <span className="adm-chip neutral" title={naturalMonth ? t("adm.scr.st.naturalMonth") : t("adm.stmt.period")}><Icon name="calendar" size={12} /> {dayLabel(range.from, lang)} – {dayLabel(range.to, lang)}</span>
        </div>
      </div>
      <p className="adm-sub">{t("adm.stmt.sub")}</p>
      {/* Tienda, período y PDF/Excel: barra de filtros global del panel (AdminShell). */}
      <p className="adm-sub stmt-period adm-noprint"><Icon name="calendar" size={13} /> {t("adm.stmt.period")}: {dayLabel(range.from, lang)} – {dayLabel(range.to, lang)}{naturalMonth ? ` · ${t("adm.scr.st.naturalMonth")}` : ""}</p>
      {scopeNote === "web" && <div className="adm-demo-banner adm-noprint">{t("adm.scr.st.webNote")}</div>}
      {scopeNote === "fallback" && <div className="adm-demo-banner adm-noprint">{t("adm.scr.st.fallback", { store: scopeLabel })}</div>}

      {state === "loading" && !data && <div className="adm-src-note loading">{t("adm.stmt.loading")}</div>}
      {state === "error" && <div className="adm-login-err">{t(error)}</div>}

      {data && (
        <div className="stmt-doc" ref={ref} style={state === "loading" ? { opacity: 0.6 } : undefined}>
          <div className="stmt-band" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: bandColor, color: bandInk, borderRadius: 8, padding: "6px 12px", marginBottom: 10, fontSize: 12, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
            <span style={{ fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 10, opacity: 0.9 }}>{TENANT.name}</span>
            <b style={{ fontFamily: "var(--adm-display)", fontSize: 15 }}>{t("adm.stmt.title")} · {all ? t("adm.stmt.allStores") : data.store.name || data.store.code}</b>
            <span style={{ fontSize: 11, opacity: 0.9 }}>{dayLabel(data.period.from, lang)} – {dayLabel(data.period.to, lang)}</span>
          </div>
          <header className="stmt-head">
            {/* La óptica de ESTE despliegue (config/tenant.js), como en ReportDoc:
                nombre primero; el nombre legal solo si dice otra cosa, y nunca
                el `name`/`url` por defecto del backend (RUBI LENS). */}
            <div className="stmt-biz">
              {brandLogo && <img src={brandLogo} alt="" />}
              <div>
                <b>{TENANT.name}</b>
                {legalName && <small>{legalName}</small>}
                {data.business.address && <small>{data.business.address}</small>}
                {host && <small>{host}</small>}
              </div>
            </div>
            <div className="stmt-meta">
              <h3 className="stmt-title">{t("adm.stmt.title")}</h3>
              <div className="stmt-no">{t("adm.stmt.number")} {data.number}</div>
              <small>{t("adm.stmt.period")}: {dayLabel(data.period.from, lang)} – {dayLabel(data.period.to, lang)}</small>
              <small>{t("adm.stmt.generated")}: {whenLabel(data.generated_at, lang)}</small>
            </div>
            <div className="stmt-store">
              <span><small>{t("adm.stmt.store")}</small><b>{all ? t("adm.stmt.allStores") : `${data.store.code} · ${data.store.name}`}</b></span>
              {data.store.address && <span><small>{t("adm.stmt.business")}</small>{data.store.address}</span>}
              {data.store.phone && <span><small>{t("adm.stmt.phone")}</small>{data.store.phone}</span>}
              <span className="stmt-kind">{t(`adm.stmt.kind.${data.store.kind}`)}</span>
            </div>
          </header>

          {data.truncated && <div className="adm-login-err">{t("adm.stmt.truncated", { n: data.sales.length })}</div>}

          <div className="stmt-kpis">
            <div className="stmt-kpi"><small>{t("adm.stmt.k.sales")}</small><b>{m(totals.total_cents)}</b></div>
            <div className="stmt-kpi"><small>{t("adm.stmt.k.count")}</small><b>{totals.count}</b>{totals.voided_count > 0 && <i>{t("adm.stmt.k.voided", { n: totals.voided_count })}</i>}</div>
            <div className="stmt-kpi"><small>{t("adm.stmt.k.discount")}</small><b>{m(totals.discount_cents)}</b></div>
            <div className="stmt-kpi"><small>{t("adm.stmt.k.paid")}</small><b className="good">{m(totals.paid_cents)}</b></div>
            {totals.insurance_cents > 0 && <div className="stmt-kpi"><small>{t("adm.stmt.k.insurance")}</small><b>{m(totals.insurance_cents)}</b></div>}
            <div className="stmt-kpi"><small>{t("adm.stmt.k.balance")}</small><b className={totals.balance_cents > 0 ? "warn" : ""}>{m(totals.balance_cents)}</b></div>
            {settlement && <div className="stmt-kpi"><small>{t("adm.stmt.k.settlement", { pct: settlement.pct })}</small><b>{m(settlement.amount_cents)}</b></div>}
          </div>

          <Acc {...acc("sales")} title={t("adm.stmt.sec.sales")} sum={<><span>{salesSum.count}{totals.voided_count ? ` (+${totals.voided_count})` : ""}</span><b>{m(salesSum.total_cents)}</b></>}>
            {data.sales.length === 0 ? <div className="stmt-empty">{t("adm.stmt.empty")}</div> : (
              <div className="stmt-tbl-wrap">
                <table className="stmt-tbl">
                  <thead>
                    <tr>
                      {sth(salesSorted, "number", t("adm.stmt.col.number"))}
                      {sth(salesSorted, "day", t("adm.stmt.col.date"))}
                      {all && sth(salesSorted, "store_code", t("adm.stmt.col.store"))}
                      {sth(salesSorted, "customer_name", t("adm.stmt.col.customer"))}
                      {sth(salesSorted, "seller_code", t("adm.stmt.col.seller"))}
                      {sth(salesSorted, "items", t("adm.stmt.col.items"))}
                      {sth(salesSorted, "list_cents", t("adm.stmt.col.list"), "num")}
                      {sth(salesSorted, "discount_cents", t("adm.stmt.col.discount"), "num")}
                      {sth(salesSorted, "total_cents", t("adm.stmt.col.total"), "num")}
                      {sth(salesSorted, "paid_cents", t("adm.stmt.col.paid"), "num")}
                      {sth(salesSorted, "balance_cents", t("adm.stmt.col.balance"), "num")}
                      {sth(salesSorted, "status", t("adm.stmt.col.status"))}
                    </tr>
                  </thead>
                  <tbody>
                    {salesSorted.rows.map((s) => (
                      <tr key={s.id} className={s.status === "voided" ? "voided" : ""}>
                        <td className="mono"><button type="button" className="sd-link" onClick={() => sp.open(s.id)} title={t("adm.sd.openHint")}>{s.number}</button></td>
                        <td className="mono">{dayLabel(s.day, lang)}</td>
                        {all && <td className="mono">{s.store_code}</td>}
                        <td>{s.customer_name || <span className="muted">{t("adm.stmt.noCustomer")}</span>}</td>
                        <td className="mono">{sellerLabel(s.seller_code)}</td>
                        <td className="items">
                          {s.items.length === 0 ? <small>—</small> : s.items.map((it, i) => (
                            <div key={i}>{itemName(it)}{it.qty > 1 ? ` ×${it.qty}` : ""}{it.lens ? <small> · {lensSummary(it.lens)}</small> : it.kind === "frame" ? <small> · {t("adm.pos.sum.frameOnly")}</small> : null}</div>
                          ))}
                          {s.delivery === "ship" && <small>{t("adm.stmt.delivery.ship")}</small>}
                        </td>
                        <td className="num">{m(s.list_cents)}</td>
                        <td className="num">{s.discount_cents ? `−${m(s.discount_cents)}` : "—"}</td>
                        <td className="num"><b>{m(s.total_cents)}</b></td>
                        <td className="num">{m(s.paid_cents)}{s.insurance_cents > 0 && <small className="muted"> +{m(s.insurance_cents)}</small>}</td>
                        <td className="num">{s.balance_cents ? m(s.balance_cents) : "—"}</td>
                        <td className="status"><span className={`stmt-tag ${s.status === "voided" ? "void" : "ok"}`}>{t(`adm.stmt.status.${s.status}`)}</span></td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={all ? 6 : 5}>{t("adm.stmt.total")} · {salesSum.count}</td>
                      <td className="num">{m(salesSum.list_cents)}</td>
                      <td className="num">{salesSum.discount_cents ? `−${m(salesSum.discount_cents)}` : "—"}</td>
                      <td className="num">{m(salesSum.total_cents)}</td>
                      <td className="num">{m(salesSum.paid_cents)}{salesSum.insurance_cents > 0 && <small> +{m(salesSum.insurance_cents)}</small>}</td>
                      <td className="num">{m(salesSum.balance_cents)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Acc>

          <Acc {...acc("methods")} title={t("adm.stmt.sec.methods")} sum={<b>{m(methodsSum)}</b>}>
            {totals.by_method.length === 0 ? <div className="stmt-empty">{t("adm.stmt.empty")}</div> : (
              <table className="stmt-tbl">
                <thead><tr>{sth(methodsSorted, "method", t("adm.stmt.col.method"))}{sth(methodsSorted, "cents", t("adm.stmt.col.amount"), "num")}{sth(methodsSorted, "cents", t("adm.stmt.col.share"), "num")}</tr></thead>
                <tbody>
                  {methodsSorted.rows.map((r) => (
                    <tr key={r.code}><td>{methodLabel(r.code, r.label)}</td><td className="num">{m(r.cents)}</td><td className="num">{pct(r.cents, methodsSum)}</td></tr>
                  ))}
                  <tr className="total"><td>{t("adm.stmt.total")}</td><td className="num">{m(methodsSum)}</td><td className="num">{methodsSum ? "100%" : "—"}</td></tr>
                </tbody>
              </table>
            )}
          </Acc>

          <Acc {...acc("sellers")} title={t("adm.stmt.sec.sellers")} sum={<><span>{totals.by_seller.length}</span><b>{m(sellersSum)}</b></>}>
            {totals.by_seller.length === 0 ? <div className="stmt-empty">{t("adm.stmt.empty")}</div> : (
              <table className="stmt-tbl">
                <thead><tr>{sth(sellersSorted, "seller_code", t("adm.stmt.col.seller"))}{sth(sellersSorted, "count", t("adm.stmt.col.count"), "num")}{sth(sellersSorted, "total_cents", t("adm.stmt.col.total"), "num")}{sth(sellersSorted, "total_cents", t("adm.stmt.col.share"), "num")}</tr></thead>
                <tbody>
                  {sellersSorted.rows.map((r) => (
                    <tr key={r.seller_code || "-"}><td className="mono">{sellerLabel(r.seller_code)}</td><td className="num">{r.count}</td><td className="num">{m(r.total_cents)}</td><td className="num">{pct(r.total_cents, sellersSum)}</td></tr>
                  ))}
                  <tr className="total"><td>{t("adm.stmt.total")}</td><td className="num">{sum(totals.by_seller, (r) => r.count)}</td><td className="num">{m(sellersSum)}</td><td className="num">{sellersSum ? "100%" : "—"}</td></tr>
                </tbody>
              </table>
            )}
          </Acc>

          <Acc {...acc("days")} title={t("adm.stmt.sec.days")} sum={<><span>{totals.by_day.length}</span><b>{m(daysSum)}</b></>}>
            {totals.by_day.length === 0 ? <div className="stmt-empty">{t("adm.stmt.empty")}</div> : (
              <table className="stmt-tbl">
                <thead><tr>{sth(daysSorted, "date", t("adm.stmt.col.day"))}{sth(daysSorted, "count", t("adm.stmt.col.count"), "num")}{sth(daysSorted, "total_cents", t("adm.stmt.col.total"), "num")}</tr></thead>
                <tbody>
                  {daysSorted.rows.map((r) => <tr key={r.date}><td className="mono">{dayLabel(r.date, lang)}</td><td className="num">{r.count}</td><td className="num">{m(r.total_cents)}</td></tr>)}
                  <tr className="total"><td>{t("adm.stmt.total")}</td><td className="num">{sum(totals.by_day, (r) => r.count)}</td><td className="num">{m(daysSum)}</td></tr>
                </tbody>
              </table>
            )}
          </Acc>

          <footer className="stmt-foot">
            <div className="stmt-note">
              <p>{t("adm.stmt.footer.note")}</p>
              {data.store.receipt_note && <p>{data.store.receipt_note}</p>}
            </div>
            {settlement && (
              <div className="stmt-settle">
                <h4>{t("adm.stmt.settlement.title")}</h4>
                <dl>
                  <dt>{t("adm.stmt.settlement.base")}</dt><dd>{m(settlement.base_cents)}</dd>
                  <dt>{t("adm.stmt.settlement.pct")}</dt><dd>{settlement.pct}%</dd>
                  <div className="line" />
                  <dt>{t("adm.stmt.settlement.amount")}</dt><dd className="big">{m(settlement.amount_cents)}</dd>
                  <dt>{t("adm.stmt.settlement.owner")}</dt><dd>{m(settlement.base_cents - settlement.amount_cents)}</dd>
                </dl>
              </div>
            )}
          </footer>
        </div>
      )}
      {sp.panel}
    </div>
  );
}
