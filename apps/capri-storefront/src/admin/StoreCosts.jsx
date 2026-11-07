// Dónde se usa: pestaña «Resultado por tienda» de /admin (E13): costos fijos,
// variables y compartidos de cada tienda, el resultado del mes con el punto de
// equilibrio, las comisiones por vendedor y la liquidación con las tiendas que
// no son propias (HU-33, HU-34, HU-90 a HU-97). Con el privilegio «Ver costos»
// se lee; con «Gestionar costos» se edita.
//
// NO tiene filtros propios: la tienda y el período salen de la barra de
// filtros GLOBAL del panel (GlobalFilterBar.jsx → useStoreFilter +
// usePeriodFilter) y PDF · Excel · CSV se registran en esa misma barra
// (useRegisterExport). El resultado es MENSUAL: del período elegido se toma su
// mes (el del final del rango), así que «Hoy» y «Mes» del mismo mes enseñan el
// mismo resultado — se dice en la pastilla del mes para que no parezca que el
// filtro no hace nada. Cambiar de tienda o de mes vuelve a pedir el resultado
// y los costos (el resultado llega con todas las tiendas y aquí se acota a la
// elegida: la ruta /admin/store-costs/pnl no toma tienda).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";
import { posContext } from "./posApi.js";
import { useStoreFilter } from "./StoreFilter.jsx";
import { usePeriodFilter } from "./periodStore.js";
import { menuHandlers, useRegisterExport } from "./GlobalFilterBar.jsx";
import DataTable, { tableSpecFrom } from "./DataTable.jsx";
import { useColumns } from "./useColumns.js";
import { useSortable } from "./useSortable.js";
import SortTh from "./SortTh.jsx";
import "./screens.css";

const CATEGORIES = ["rent", "maintenance", "utilities", "salaries", "insurance", "licenses", "subscriptions", "equipment", "supplies", "shipping", "repairs", "remakes", "accounting", "other"];
// Every frequency the server accepts (lib/store-costs.ts, «Reglas y comisiones»): a weekly or
// daily item opened here showed a raw key and a select that silently read «Mensual» (QA v2).
const FREQS = ["daily", "weekly", "biweekly", "monthly", "quarterly", "annual", "one_time"];
const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : "adm.err.pos.generic");
const thisMonth = () => new Date().toISOString().slice(0, 7);
const EMPTY = { establishment_id: "", kind: "fixed", category: "rent", description: "", amount: "", frequency: "monthly", amortize_months: "", starts_on: `${thisMonth()}-01`, ends_on: "", vendor: "", notes: "", allocation: { method: "sales", shares: {} }, attachment: null };

const fileToDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });

/** Filas del resultado, en el orden del papel; `minus` = se resta. */
const ROWS = [["net_sales", false], ["cogs", true], ["payment_fees", true], ["commissions", true], ["variable_manual", true], ["contribution", false], ["fixed", true], ["shared", true], ["result", false]];
/** Lo que suma «Costos» en la tira de indicadores. */
const COST_KEYS = ["cogs", "payment_fees", "commissions", "variable_manual", "fixed", "shared"];

export default function StoreCosts({ me }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [ctx, setCtx] = useState(null);
  // Período global del panel → el MES que se lee (el del final del período).
  const { to: periodTo, from: periodFrom, label: periodLabel } = usePeriodFilter();
  const month = String(periodTo || "").slice(0, 7) || thisMonth();
  const [pnl, setPnl] = useState(null);
  const [items, setItems] = useState([]);
  const [state, setState] = useState("loading");
  const [form, setForm] = useState(null); // EMPTY o el costo en edición (con id)
  const canManage = !me || me.is_admin !== false || (me.privileges || []).includes("costs.manage");
  const isAdmin = !me || me.is_admin !== false;
  const m = (v) => (v === null || v === undefined ? "—" : money(v, "usd", lang));
  // Tienda del filtro global del panel: acota los costos (?store=) y la columna
  // del resultado. La online no tiene costos de tienda: se enseña el negocio.
  const who = me || (ctx ? { is_admin: ctx.is_admin, role: ctx.role } : undefined);
  const { storeId, isAll, isWeb } = useStoreFilter(who);
  const storeOnly = isAll || isWeb ? "" : storeId;

  useEffect(() => { posContext().then(setCtx).catch(() => setCtx({ stores: [] })); }, []);
  // Cada cambio de mes o de tienda vuelve a pedir las dos lecturas (y se
  // descarta la respuesta de una petición que ya quedó vieja). El contador
  // cubre también la relectura tras guardar o borrar, que no pasa por la
  // limpieza del efecto: solo la última petición pinta.
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    let cancelled = false;
    setState("loading");
    Promise.all([
      adminFetch(`/admin/store-costs/pnl?month=${month}`).catch(() => null),
      adminFetch(`/admin/store-costs${storeOnly ? `?store=${encodeURIComponent(storeOnly)}` : ""}`).catch(() => null),
    ]).then(([p, list]) => {
      if (cancelled || seq !== loadSeq.current) return;
      setPnl(p);
      setItems(list?.items || []);
      setState(p || list ? "ready" : "error");
    });
    return () => { cancelled = true; };
  }, [month, storeOnly]);
  useEffect(load, [load]);

  // Con una tienda elegida, el resultado enseña solo su columna (y no el total del negocio).
  const pnlStores = useMemo(() => (pnl ? (storeOnly ? pnl.stores.filter((s) => s.establishment_id === storeOnly) : pnl.stores) : []), [pnl, storeOnly]);
  const showTotal = !storeOnly && pnlStores.length > 1;
  // La columna que manda en los indicadores: la tienda elegida o el negocio entero.
  const focus = storeOnly ? pnlStores[0] : pnl?.total;
  const costsOf = (p) => (p ? COST_KEYS.reduce((a, k) => a + (Number(p[k]) || 0), 0) : null);
  const storeName = (id) => { const s = ctx?.stores.find((x) => x.id === id); return s ? `${s.code} · ${s.name}` : id; };
  const storeCode = (id) => (id ? ctx?.stores.find((s) => s.id === id)?.code || "…" : t("adm.costs2.shared"));
  const scopeLabel = storeOnly ? storeName(storeOnly) : t("adm.theme.allStores");

  const settlementRows = useMemo(() => pnlStores.filter((s) => s.settlement), [pnlStores]);
  const settleSorted = useSortable(settlementRows, { id: "costs-settlement", defaultKey: "net_sales", defaultDir: "desc", getters: { store_share: (s) => s.settlement.store_share, owner_share: (s) => s.settlement.owner_share } });
  const commSorted = useSortable(pnl?.sellers || [], { id: "costs-commissions", defaultKey: "commission", defaultDir: "desc" });
  const sth = (sorted, col, label, align = "") => <SortTh col={col} sort={sorted.sort} onSort={sorted.toggle} align={align}>{label}</SortTh>;

  const save = async (e) => {
    e.preventDefault();
    const body = { ...form, establishment_id: form.establishment_id || null };
    try {
      await adminFetch(form.id ? `/admin/store-costs/${form.id}` : "/admin/store-costs", { method: "POST", body });
      toast({ tone: "success", title: t("adm.costs2.saved") });
      setForm(null);
      load();
    } catch (err) { toast({ tone: "error", title: t(errKey(err)) }); }
  };
  const remove = async (it) => {
    if (!(await confirm({ tone: "danger", title: t("adm.costs2.deleteConfirm"), message: t("adm.costs2.deleteBody") }))) return;
    try { await adminFetch(`/admin/store-costs/${it.id}`, { method: "DELETE" }); load(); } catch (err) { toast({ tone: "error", title: t(errKey(err)) }); }
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const edit = (it) => setForm({ ...EMPTY, ...it, establishment_id: it.establishment_id || "", amount: String(it.amount), amortize_months: it.amortize_months ?? "", ends_on: it.ends_on || "", allocation: it.allocation || { method: "sales", shares: {} }, attachment: null });

  // ── Costos registrados: una sola tabla con orden y selector de columnas ──
  const cols = useMemo(() => [
    { key: "store", header: t("adm.pos.store"), get: (it) => storeCode(it.establishment_id), essential: true, width: 10 },
    { key: "category", header: t("adm.costs2.category"), get: (it) => t(`adm.costs2.cat.${it.category}`), essential: true, width: 22 },
    { key: "kind", header: t("adm.costs2.kind"), get: (it) => t(`adm.costs2.kind.${it.kind}`), type: "chip", tone: (it) => (it.kind === "fixed" ? "neutral" : "warn"), width: 10 },
    { key: "description", header: t("adm.costs2.description"), get: (it) => it.description || "", width: 26 },
    { key: "amount", header: t("adm.pos.pay.amount"), type: "money", essential: true, width: 12 },
    { key: "frequency", header: t("adm.costs2.frequency"), get: (it) => t(`adm.costs2.freq.${it.frequency}`), essential: true, width: 12 },
    { key: "validity", header: t("adm.costs2.validity"), get: (it) => `${it.starts_on || ""}${it.ends_on ? ` → ${it.ends_on}` : ""}`, sortValue: (it) => it.starts_on || "", width: 20 },
    { key: "vendor", header: t("adm.costs2.vendor"), get: (it) => it.vendor || "", hiddenByDefault: true, width: 18 },
    { key: "notes", header: t("adm.costs2.notes"), get: (it) => it.notes || "", hiddenByDefault: true, width: 26 },
    {
      key: "acts", header: "", type: "action", always: true, export: false,
      render: (it) => (
        <span className="pos-actions">
          {it.attachment_url && <a className="btn-xs" href={it.attachment_url} target="_blank" rel="noreferrer" title={t("adm.scr.sc.receipt")} aria-label={t("adm.scr.sc.receipt")}><Icon name="receipt" size={12} /></a>}
          {canManage && <button type="button" className="btn-xs" onClick={() => edit(it)} title={t("adm.stores.edit")} aria-label={t("adm.stores.edit")}><Icon name="edit" size={12} /></button>}
          {canManage && <button type="button" className="btn-xs warn" onClick={() => remove(it)} aria-label={t("adm.pos.remove")} title={t("adm.pos.remove")}><Icon name="trash" size={12} /></button>}
        </span>
      ),
    },
  ], [t, lang, ctx, canManage]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useColumns("store-costs-items", cols);
  const itemsTotal = useMemo(() => items.reduce((a, it) => a + (Number(it.amount) || 0), 0), [items]);

  // ── PDF · Excel · CSV desde la barra global (un solo reporte, tres formatos) ──
  const report = useCallback(() => {
    if (!pnl) return null;
    const colsOf = [
      { header: t("adm.scr.sc.concept"), key: "concept", width: 34 },
      ...pnlStores.map((s) => ({ header: s.code, key: s.establishment_id, type: "money", width: 13 })),
      ...(showTotal ? [{ header: t("adm.costs2.total"), key: "total", type: "money", width: 13 }] : []),
    ];
    const line = (label, pick) => ({ concept: label, ...Object.fromEntries(pnlStores.map((s) => [s.establishment_id, pick(s)])), total: pick(pnl.total) });
    const rows = [
      ...ROWS.map(([k, minus]) => line(`${minus ? "− " : k === "net_sales" ? "" : "= "}${t(`adm.costs2.row.${k}`)}`, (p) => Number(p?.[k]) || 0)),
      line(t("adm.costs2.row.margin"), (p) => (p?.contribution_pct == null ? "" : `${p.contribution_pct} %`)),
      line(t("adm.costs2.row.breakEven"), (p) => (p?.break_even == null ? "" : Number(p.break_even))),
    ];
    const store = storeOnly ? ctx?.stores.find((s) => s.id === storeOnly) : null;
    return {
      title: t("adm.scr.sc.reportTitle", { month }),
      subtitle: `${scopeLabel} · ${periodLabel(t)}`,
      store: store ? { code: store.code, name: store.name, color: store.color, address: store.address, phone: store.phone } : null,
      period: { from: periodFrom, to: periodTo },
      kpis: [
        { label: t("adm.costs2.row.net_sales"), value: m(focus?.net_sales) },
        { label: t("adm.scr.sc.costs"), value: m(costsOf(focus)) },
        { label: t("adm.costs2.row.result"), value: m(focus?.result), tone: (focus?.result ?? 0) < 0 ? "bad" : "good", neg: (focus?.result ?? 0) < 0 },
        { label: t("adm.costs2.row.margin"), value: focus?.contribution_pct == null ? "—" : `${focus.contribution_pct} %` },
        { label: t("adm.costs2.row.breakEven"), value: m(focus?.break_even) },
      ],
      summaries: [],
      tables: [
        { title: t("adm.costs2.pnlTitle"), sheet: t("adm.costs2.pnlTitle"), cols: colsOf, rows },
        { ...tableSpecFrom(cols, columns.keys, items, { amount: itemsTotal }, { title: t("adm.costs2.items"), totalsLabel: t("adm.costs2.total"), lang, t }), main: true, sheet: t("adm.costs2.items") },
        ...(pnl.sellers?.length ? [{
          title: t("adm.costs2.commissions"), sheet: t("adm.costs2.commissions"),
          cols: [{ header: t("adm.pos.sales.seller"), key: "seller_code", width: 14 }, { header: t("adm.costs2.row.net_sales"), key: "net_sales", type: "money", width: 13 }, { header: "%", key: "pct", width: 8 }, { header: t("adm.costs2.row.commissions"), key: "commission", type: "money", width: 13 }],
          rows: pnl.sellers,
        }] : []),
        ...(settlementRows.length ? [{
          title: t("adm.costs2.settlement"), sheet: t("adm.costs2.settlement"),
          cols: [{ header: t("adm.pos.store"), key: "code", width: 10 }, { header: t("adm.costs2.row.net_sales"), key: "net_sales", type: "money", width: 13 }, { header: t("adm.costs2.storeShare"), get: (s) => s.settlement.store_share, type: "money", width: 14 }, { header: t("adm.costs2.ownerShare"), get: (s) => s.settlement.owner_share, type: "money", width: 14 }],
          rows: settlementRows,
        }] : []),
      ],
      landscape: pnlStores.length > 3,
      lang,
      t,
      filename: `resultado-${storeOnly ? storeCode(storeOnly) : "todas"}-${month}`,
    };
  }, [pnl, pnlStores, items, columns.keys, month, storeOnly, lang, t]); // eslint-disable-line react-hooks/exhaustive-deps
  useRegisterExport(pnl ? menuHandlers({ report, title: t("adm.scr.sc.reportTitle", { month }), name: "resultado" }) : null);

  const cell = (p, k, col) => <td key={col} data-label={p?.code || t("adm.costs2.total")} className={k === "result" && Number(p?.[k]) < 0 ? "neg" : ""}>{m(p?.[k])}</td>;

  return (
    <div className="adm-section pos sc">
      <div className="adm-head-row">
        <h2><Icon name="costs" size={20} /> {t("adm.tab.storecosts")}</h2>
        {/* Tienda y período: barra de filtros global. Aquí solo se dice qué mes y qué tienda se están leyendo. */}
        <div className="scr-tools">
          <span className="adm-chip neutral" title={t("adm.scr.sc.monthly")}><Icon name="calendar" size={12} /> {t("adm.costs2.month")}: {month}</span>
          <span className="adm-chip neutral" title={t("adm.theme.current")}><Icon name="store" size={12} /> {scopeLabel}</span>
        </div>
      </div>
      <p className="adm-sub">{t("adm.costs2.sub")}</p>
      <p className="adm-sub sc-note"><Icon name="info" size={13} /> {t("adm.scr.sc.monthly")}</p>
      {isWeb && <div className="adm-demo-banner">{t("adm.scr.sc.webNote")}</div>}
      {pnl?.cost_rules_missing && <div className="adm-demo-banner">{t("adm.costs2.noRules")}</div>}
      {state === "loading" && !pnl && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
      {state === "error" && <div className="adm-login-err">{t("adm.err.pos.generic")}</div>}

      {focus && (
        <div className="sc-kpis">
          <div className="sc-kpi"><small>{t("adm.costs2.row.net_sales")}</small><b>{m(focus.net_sales)}</b></div>
          <div className="sc-kpi"><small>{t("adm.scr.sc.costs")}</small><b>{m(costsOf(focus))}</b></div>
          <div className="sc-kpi hero"><small>{t("adm.costs2.row.result")}</small><b className={Number(focus.result) < 0 ? "neg" : "good"}>{m(focus.result)}</b></div>
          <div className="sc-kpi"><small>{t("adm.costs2.row.margin")}</small><b>{focus.contribution_pct == null ? "—" : `${focus.contribution_pct} %`}</b></div>
          <div className="sc-kpi"><small>{t("adm.costs2.row.breakEven")}</small><b>{m(focus.break_even)}</b><span>{t("adm.costs2.breakEvenHint")}</span></div>
        </div>
      )}

      {pnl && (
        <div className="adm-card sc-card">
          <div className="adm-head-row"><h3>{t("adm.costs2.pnlTitle")} · {month}{storeOnly && <small className="muted"> · {t("adm.scr.onlyStore")}</small>}</h3></div>
          <div className="adm-table-wrap">
            <table className="adm-table responsive pnl sc-pnl">
              <thead><tr><th scope="col">{t("adm.scr.sc.concept")}</th>{pnlStores.map((s) => <th key={s.establishment_id} scope="col" title={s.name}>{s.code}</th>)}{showTotal && <th scope="col">{t("adm.costs2.total")}</th>}</tr></thead>
              <tbody>
                {ROWS.map(([k, minus]) => (
                  <tr key={k} className={["contribution", "result"].includes(k) ? "strong" : ""}>
                    <th scope="row">{minus ? "− " : k === "net_sales" ? "" : "= "}{t(`adm.costs2.row.${k}`)}</th>
                    {pnlStores.map((s) => cell(s, k, s.establishment_id))}
                    {showTotal && cell(pnl.total, k, "total")}
                  </tr>
                ))}
                <tr><th scope="row">{t("adm.costs2.row.margin")}</th>{pnlStores.map((s) => <td key={s.establishment_id} data-label={s.code}>{s.contribution_pct == null ? "—" : `${s.contribution_pct} %`}</td>)}{showTotal && <td data-label={t("adm.costs2.total")}>{pnl.total.contribution_pct == null ? "—" : `${pnl.total.contribution_pct} %`}</td>}</tr>
                <tr className="strong"><th scope="row">{t("adm.costs2.row.breakEven")}</th>{pnlStores.map((s) => <td key={s.establishment_id} data-label={s.code}>{m(s.break_even)}</td>)}{showTotal && <td data-label={t("adm.costs2.total")}>{m(pnl.total.break_even)}</td>}</tr>
              </tbody>
            </table>
          </div>
          {pnlStores.length === 0 && <div className="adm-nodata">{t("adm.scr.sc.noStore")}</div>}
        </div>
      )}

      {settlementRows.length > 0 && (
        <div className="adm-card sc-card">
          <h3>{t("adm.costs2.settlement")}</h3>
          <table className="adm-table responsive">
            <thead><tr>{sth(settleSorted, "code", t("adm.pos.store"))}{sth(settleSorted, "net_sales", t("adm.costs2.row.net_sales"), "num")}{sth(settleSorted, "store_share", t("adm.costs2.storeShare"), "num")}{sth(settleSorted, "owner_share", t("adm.costs2.ownerShare"), "num")}</tr></thead>
            <tbody>
              {settleSorted.rows.map((s) => (
                <tr key={s.establishment_id}>
                  <td data-label={t("adm.pos.store")}>{s.code} · {t(`adm.stores.kind.${s.kind}`)}</td>
                  <td data-label={t("adm.costs2.row.net_sales")} className="num">{m(s.net_sales)}</td>
                  <td data-label={t("adm.costs2.storeShare")} className="num">{m(s.settlement.store_share)} ({s.settlement.pct} %)</td>
                  <td data-label={t("adm.costs2.ownerShare")} className="num"><b>{m(s.settlement.owner_share)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pnl && pnl.sellers.length > 0 && (
        <div className="adm-card sc-card">
          <h3>{t("adm.costs2.commissions")}</h3>
          <table className="adm-table responsive">
            <thead><tr>{sth(commSorted, "seller_code", t("adm.pos.sales.seller"))}{sth(commSorted, "net_sales", t("adm.costs2.row.net_sales"), "num")}{sth(commSorted, "pct", "%", "num")}{sth(commSorted, "commission", t("adm.costs2.row.commissions"), "num")}</tr></thead>
            <tbody>
              {commSorted.rows.map((s, i) => (
                <tr key={i}><td data-label={t("adm.pos.sales.seller")}>{s.seller_code || "—"}</td><td data-label={t("adm.costs2.row.net_sales")} className="num">{m(s.net_sales)}</td><td data-label="%" className="num">{s.pct == null ? "—" : `${s.pct} %`}</td><td data-label={t("adm.costs2.row.commissions")} className="num"><b>{m(s.commission)}</b></td></tr>
              ))}
            </tbody>
          </table>
          <small className="muted">{t("adm.costs2.commissionHint")}</small>
        </div>
      )}

      <div className="adm-card sc-card sc-items">
        {form && (
          <form className="alr-form" onSubmit={save}>
            <div className="pos-form">
              <label>{t("adm.pos.store")}
                <select value={form.establishment_id} onChange={(e) => set("establishment_id", e.target.value)}>
                  {isAdmin && <option value="">{t("adm.costs2.shared")}</option>}
                  {ctx?.stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                </select>
              </label>
              <label>{t("adm.costs2.kind")}
                <select value={form.kind} onChange={(e) => set("kind", e.target.value)}><option value="fixed">{t("adm.costs2.kind.fixed")}</option><option value="variable">{t("adm.costs2.kind.variable")}</option></select>
              </label>
              <label>{t("adm.costs2.category")}
                <select value={form.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`adm.costs2.cat.${c}`)}</option>)}</select>
              </label>
              <label>{t("adm.costs2.description")}<input value={form.description} onChange={(e) => set("description", e.target.value)} /></label>
              <label>{t("adm.pos.pay.amount")}<input inputMode="decimal" required value={form.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} /></label>
              <label>{t("adm.costs2.frequency")}
                <select value={form.frequency} onChange={(e) => set("frequency", e.target.value)}>{FREQS.map((f) => <option key={f} value={f}>{t(`adm.costs2.freq.${f}`)}</option>)}</select>
              </label>
              {form.frequency === "one_time" && <label>{t("adm.costs2.amortize")}<input type="number" min="1" max="120" value={form.amortize_months} onChange={(e) => set("amortize_months", e.target.value)} /></label>}
              <label>{t("adm.costs2.starts")}<input type="date" required value={form.starts_on} onChange={(e) => set("starts_on", e.target.value)} /></label>
              <label>{t("adm.costs2.ends")}<input type="date" value={form.ends_on || ""} onChange={(e) => set("ends_on", e.target.value)} /></label>
              <label>{t("adm.costs2.vendor")}<input value={form.vendor || ""} onChange={(e) => set("vendor", e.target.value)} /></label>
            </div>
            {!form.establishment_id && (
              <fieldset className="alr-stores">
                <legend>{t("adm.costs2.allocation")}</legend>
                <label><input type="radio" checked={form.allocation?.method !== "percent"} onChange={() => set("allocation", { method: "sales", shares: {} })} /> {t("adm.costs2.bySales")}</label>
                <label><input type="radio" checked={form.allocation?.method === "percent"} onChange={() => set("allocation", { method: "percent", shares: form.allocation?.shares || {} })} /> {t("adm.costs2.byPercent")}</label>
                {form.allocation?.method === "percent" && ctx?.stores.map((s) => (
                  <label key={s.id}>{s.code} <input type="number" min="0" max="100" style={{ width: 70 }} value={form.allocation.shares[s.id] ?? ""} onChange={(e) => set("allocation", { method: "percent", shares: { ...form.allocation.shares, [s.id]: e.target.value } })} /> %</label>
                ))}
              </fieldset>
            )}
            <label className="pos-file"><Icon name="upload" size={14} /> {form.attachment ? t("adm.costs2.attached") : t("adm.costs2.receipt")}
              <input type="file" accept="image/*,application/pdf" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set("attachment", await fileToDataUrl(f)); }} />
            </label>
            <label className="alr-recipients">{t("adm.costs2.notes")}<textarea rows={2} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} /></label>
            <div className="pos-actions">
              <button className="btn-sm primary"><Icon name="save" size={14} /> {t("adm.costs2.save")}</button>
              <button type="button" className="btn-sm" onClick={() => setForm(null)}>{t("adm.alerts.cancel")}</button>
            </div>
          </form>
        )}
        <DataTable
          id="store-costs-items"
          cols={cols}
          columns={columns}
          rows={items}
          rowKey="id"
          dense
          title={t("adm.costs2.items")}
          loading={state === "loading"}
          emptyText={t("adm.costs2.empty")}
          emptyIcon="costs"
          defaultSort={{ key: "amount", dir: "desc" }}
          totals={{ amount: itemsTotal }}
          totalsLabel={t("adm.costs2.total")}
          right={canManage && !form ? (
            <button type="button" className="btn-xs primary" onClick={() => setForm({ ...EMPTY, establishment_id: storeOnly || (isAdmin ? "" : ctx?.stores[0]?.id || "") })}><Icon name="plus" size={13} /> {t("adm.costs2.add")}</button>
          ) : null}
        />
      </div>
    </div>
  );
}
