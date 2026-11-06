// Dónde se usa: pestaña «Cobros pendientes» de /admin (todos los roles) y,
// embebida, en «Mi panel» del vendedor. Las ventas con saldo por cobrar de las
// tiendas de quien mira (GET /admin/pos/sales?pending=1): dueño y superadmin
// con el filtro global de tienda; supervisor y encargado, sus tiendas; el
// vendedor, su tienda — las suyas y las de sus compañeros, que para él llegan
// reducidas a lo necesario para cobrar (`limited`, regla del dueño). Cada fila
// cobra en línea (POST /admin/pos/sales/:id/payments); el servidor calcula.
//
// La tabla es DataTable.jsx (regla del dueño: todas las columnas, y «Columnas»
// para elegir cuáles ver): nº, fecha, tienda, cliente, teléfono, vendedor,
// marca / modelo, total, cobrado, saldo, días de atraso y la acción Cobrar.
// Cliente, teléfono, marca y modelo vienen en la propia venta (el servidor los
// lee de las tablas de origen), así que esta pantalla no hace una segunda
// llamada a la analítica: no muestra costo ni ganancia y no los necesita. Las
// filas `limited` (de un compañero, solo para cobrar) traen únicamente cliente
// y teléfono, nunca la montura.
//
// Props:
//   me          GET /admin/team/me (filtro de tienda y rol)
//   openSale(id)  abre la ficha de la venta (el número es un botón cuando se da)
//   embedded    sin cabecera de sección (dentro de «Mi panel»)
//   params      filtros que llegan de otra pantalla (go("pendingbalances", params)), todos opcionales:
//     q        texto libre: nº de venta, cliente o teléfono (sin acentos ni mayúsculas)
//     overdue  "1" | true → solo con más de 7 días de atraso; un número → más de esos días
//     stage    "delivered" | "undelivered" → por si la venta ya se entregó (las filas `limited` no lo saben y no se filtran)
//     seller   código de vendedor (va al servidor cuando el rol puede filtrar por vendedor; el vendedor solo ve lo suyo)
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money, shortDate } from "./adminOrders.js";
import { collectPayment, listSales, methodName, posContext } from "./posApi.js";
import Accordion from "./Accordion.jsx";
import DataTable, { tableSpecFrom } from "./DataTable.jsx";
import { useColumns } from "./useColumns.js";
import { mergeSaleDetails } from "./PosSales.jsx";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import { ExportMenu } from "./ui.jsx";
import { daysOverdue } from "./lateness.js";
import "./screens.css";
import "./roles.css";

/** Días transcurridos desde la fecha prometida (o, sin ella, desde la venta); vive en lateness.js (también la usa Pedidos y etapas). */
export { daysOverdue };
const OVERDUE_DAYS = 7;
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Formulario de cobro de una fila: forma de pago de la tienda, importe (el saldo por defecto) y referencia. */
function CollectRow({ sale, ctx, colSpan, onDone, onCancel }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const store = ctx.stores.find((x) => x.id === sale.establishment_id);
  const methods = ctx.payment_methods.filter((m) => (!store || store.payment_methods.includes(m.code)) && !(m.kind === "insurance" || m.receivable));
  const [pay, setPay] = useState({ method_code: methods.length === 1 ? methods[0].code : "", amount: String(sale.balance), details: {} });
  const [busy, setBusy] = useState(false);
  const meth = methods.find((m) => m.code === pay.method_code);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await collectPayment(sale.id, [{ method_code: pay.method_code, amount: pay.amount, details: pay.details }]);
      toast({ tone: "success", title: t("adm.pb.collected", { n: sale.number }) });
      onDone(r.sale);
    } catch (e) {
      toast({ tone: "error", title: t(e.message) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr className="pb-form adm-noprint">
      <td colSpan={colSpan} className="full">
        <div className="pos-pay">
          <select value={pay.method_code} onChange={(e) => setPay({ method_code: e.target.value, amount: pay.amount, details: {} })} aria-label={t("adm.pos.pay.method")} title={t("adm.pos.pay.method")}>
            <option value="">{t("adm.pos.pay.method")}</option>
            {methods.map((x) => <option key={x.code} value={x.code}>{methodName(x, t, lang)}</option>)}
          </select>
          <input inputMode="decimal" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value.replace(/[^\d.]/g, "") }))} placeholder={t("adm.pos.pay.amount")} aria-label={t("adm.pos.pay.amount")} />
          <button type="button" className="btn-xs" onClick={() => setPay((p) => ({ ...p, amount: String(sale.balance) }))}>{t("adm.pos.pay.rest")}</button>
          {meth?.reference_fields?.map((f) => (
            <input key={f.key} value={pay.details[f.key] || ""} onChange={(e) => setPay((p) => ({ ...p, details: { ...p.details, [f.key]: e.target.value } }))}
              placeholder={`${meth.builtin ? t(`adm.pos.ref.${f.key}`) : (lang === "en" && f.label_en) || f.label || f.key}${f.required ? " *" : ""}`}
              aria-label={meth.builtin ? t(`adm.pos.ref.${f.key}`) : f.label || f.key} />
          ))}
          <button type="button" className="btn-sm primary" disabled={busy || !pay.method_code || !Number(pay.amount)} onClick={submit}><Icon name="hand" size={14} /> {t("adm.pb.confirm")}</button>
          <button type="button" className="btn-xs" disabled={busy} onClick={onCancel}>{t("adm.pb.cancel")}</button>
        </div>
      </td>
    </tr>
  );
}

/** `params` → lo que se aplica en el navegador (q, overdue, stage) y lo que va al servidor (seller). */
export function pendingFilters(params) {
  const p = params || {};
  const q = norm(p.q || "").trim();
  const overdue = p.overdue === true || p.overdue === "1" || p.overdue === 1 ? OVERDUE_DAYS : Number(p.overdue) > 0 ? Number(p.overdue) : null;
  const stage = p.stage === "delivered" || p.stage === "undelivered" ? p.stage : null;
  const seller = typeof p.seller === "string" && p.seller.trim() ? p.seller.trim() : "";
  return { q, overdue, stage, seller };
}

export default function PendingBalances({ me, openSale, embedded = false, params }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [ctx, setCtx] = useState(null);
  const [sales, setSales] = useState([]);
  const [state, setState] = useState("loading");
  const [openId, setOpenId] = useState(null);
  const isAdmin = !me || me.is_admin !== false;
  const seller = me?.role === "seller";
  const { storeId, isAll, isWeb } = useStoreFilter(me);
  const store = isAll || isWeb ? "" : storeId;
  const m = (v) => money(v, "usd", lang);
  const filters = useMemo(() => pendingFilters(params), [params?.q, params?.overdue, params?.stage, params?.seller]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { posContext().then(setCtx).catch((e) => toast({ tone: "error", title: t(e.message) })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => {
    setState("loading");
    // Un vendedor nunca filtra por otro vendedor (el servidor lo ignora); los demás roles sí.
    listSales({ pending: 1, store, limit: 200, seller: seller ? "" : filters.seller })
      .then((r) => { setSales(r.sales || []); setState("ok"); })
      .catch((e) => { setState("error"); toast({ tone: "error", title: t(e.message) }); });
  };
  useEffect(load, [store, filters.seller]); // eslint-disable-line react-hooks/exhaustive-deps

  const storeCode = (id) => ctx?.stores.find((x) => x.id === id)?.code || "";
  const rows = useMemo(() => sales
    .filter((s) => s.balance > 0)
    .map((s) => ({ ...mergeSaleDetails(s), days: daysOverdue(s), store_code: storeCode(s.establishment_id) }))
    .filter((r) => {
      if (filters.overdue != null && !(r.days > filters.overdue)) return false;
      if (filters.stage && !r.limited && (filters.stage === "delivered") !== Boolean(r.delivered_at)) return false;
      if (filters.q) {
        const hay = norm([r.number, r.customer, r.customer_phone, r.seller_code, r.frame_brand, r.frame_model].filter(Boolean).join(" "));
        if (!hay.includes(filters.q)) return false;
      }
      return true;
    }), [sales, filters, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => ({
    count: rows.length,
    total: Math.round(rows.reduce((a, r) => a + (Number(r.total) || 0), 0) * 100) / 100,
    paid: Math.round(rows.reduce((a, r) => a + (Number(r.paid) || 0), 0) * 100) / 100,
    balance: Math.round(rows.reduce((a, r) => a + r.balance, 0) * 100) / 100,
    late: rows.filter((r) => r.days > OVERDUE_DAYS).length,
  }), [rows]);
  const summary = [
    { label: t("adm.pb.count"), value: totals.count },
    { label: t("adm.pb.balanceTotal"), value: m(totals.balance), strong: true },
    { label: t("adm.pb.overdue7"), value: totals.late, tone: totals.late ? "bad" : "good" },
  ];
  const onCollected = (updated) => {
    setOpenId(null);
    // El servidor devuelve la venta con el saldo nuevo: la fila se actualiza y desaparece si quedó en cero.
    setSales((list) => list.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)).filter((s) => s.balance > 0));
  };
  const dayTone = (d) => (d > OVERDUE_DAYS * 2 ? "late" : d > OVERDUE_DAYS ? "warn" : "");
  const frameText = (r) => [r.frame_brand || (r.own_frame ? t("adm.rpt.ownFrame") : ""), r.frame_model].filter(Boolean).join(" · ");

  const cols = useMemo(() => [
    {
      key: "number", header: t("adm.pb.number"), essential: true, width: 12,
      render: (r) => (
        <span className="pb-num">
          {openSale ? <button type="button" onClick={(e) => { e.stopPropagation(); openSale(r.id); }} title={t("adm.pb.open", { n: r.number })}>{r.number}</button> : r.number}
        </span>
      ),
    },
    { key: "created_at", header: t("adm.pb.date"), type: "date", essential: true, width: 11, render: (r) => <>{shortDate(r.created_at, lang)}{r.promised_on && <small className="muted" title={t("adm.pb.promised", { date: r.promised_on })}> · {r.promised_on}</small>}</>, text: (r) => r.created_at.slice(0, 10) },
    { key: "store_code", header: t("adm.pb.store"), hiddenByDefault: !(isAll && isAdmin), width: 8 },
    { key: "customer", header: t("adm.pb.customer"), essential: true, width: 22 },
    { key: "customer_phone", header: t("adm.pb.phone"), essential: true, width: 14 },
    { key: "seller_code", header: t("adm.pb.seller"), essential: true, width: 9, render: (r) => <>{r.seller_code || "—"}{seller && !r.limited && <span className="adm-chip ok"> {t("adm.pb.mine")}</span>}</> },
    { key: "frame", header: t("adm.pb.frame"), get: frameText, essential: true, width: 24 },
    { key: "total", header: t("adm.pb.total"), type: "money", essential: true, width: 11 },
    { key: "paid", header: t("adm.pb.paid"), type: "money", essential: true, width: 11 },
    { key: "balance", header: t("adm.pb.balance"), type: "money", essential: true, width: 11, render: (r) => <b>{m(r.balance)}</b> },
    { key: "days", header: t("adm.pb.overdue"), type: "int", essential: true, width: 9, render: (r) => <span className={`pb-days ${dayTone(r.days)}`}>{t("adm.pb.days", { n: r.days })}</span>, totalRender: (v) => (v ? <span className="pb-days late">{v}</span> : null) },
    {
      key: "collect", header: t("adm.pb.collect"), type: "action", always: true, align: "r", width: 8,
      render: (r) => (ctx && r.status !== "voided" ? (
        <button type="button" className={`btn-xs ${openId === r.id ? "" : "primary"}`} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
          <Icon name="hand" size={12} /> {t("adm.pb.collect")}
        </button>
      ) : null),
    },
  ], [t, lang, isAll, isAdmin, seller, openSale, ctx, openId]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useColumns("pending-balances", cols);
  const tableTotals = { total: totals.total, paid: totals.paid, balance: totals.balance, days: totals.late || null };

  const report = () => {
    const st = store ? ctx?.stores.find((x) => x.id === store) : null;
    const scopeName = st ? st.name || st.code : t("adm.rpt.allStores");
    return {
      title: `${t("adm.pb.title")} · ${scopeName}`,
      store: st ? { code: st.code, name: st.name, color: st.color, address: st.address, phone: st.phone } : null,
      scope: st ? undefined : scopeName,
      kpis: [
        { label: t("adm.pb.count"), value: totals.count, raw: totals.count },
        { label: t("adm.pb.balanceTotal"), value: m(totals.balance), raw: totals.balance, neg: totals.balance > 0 },
        { label: t("adm.pb.overdue7"), value: totals.late, raw: totals.late },
      ],
      tables: [tableSpecFrom(cols, columns.keys, rows, tableTotals, { title: t("adm.pb.title"), totalsLabel: t("adm.pb.totalRow"), empty: t("adm.pb.empty"), main: true, lang, t })],
      landscape: true, lang, t,
      filename: `cobros-pendientes-${st?.code || "all"}-${new Date().toISOString().slice(0, 10)}`,
    };
  };

  const activeFilter = [filters.q, filters.overdue != null ? t("adm.pb.onlyOverdue") : "", filters.stage, filters.seller].filter(Boolean).join(" · ");
  const tools = (
    <span className="pb-sum">
      <button type="button" className="btn-xs" onClick={load} disabled={state === "loading"} aria-label={t("adm.pb.refresh")} title={t("adm.pb.refresh")}><Icon name="refresh" size={13} /></button>
      <ExportMenu title={t("adm.pb.title")} name="cobros-pendientes" report={report} />
    </span>
  );

  return (
    <div className={embedded ? "" : "adm-section pos"}>
      {!embedded && (
        <div className="adm-head-row">
          <div>
            <h2>{t("adm.pb.title")}</h2>
            <p className="adm-sub">{t(seller ? "adm.pb.subSeller" : "adm.pb.sub")}</p>
          </div>
          <div className="pos-filters">
            <StoreFilter me={me} />
          </div>
        </div>
      )}
      <Accordion id={embedded ? "my-pending" : "pending-balances"} icon="hand" title={embedded ? t("adm.my.pendingStore") : t("adm.pb.title")} summary={summary} defaultOpen right={tools}>
        <DataTable
          id="pending-balances" cols={cols} columns={columns} rows={rows} rowKey="id" totals={tableTotals} totalsLabel={t("adm.pb.totalRow")}
          defaultSort={{ key: "days", dir: "desc" }} loading={state === "loading" && !sales.length} emptyText={t("adm.pb.empty")} emptyIcon="hand"
          tableClassName="pb-table" dense
          expanded={(r) => (ctx && openId === r.id ? <CollectRow key={`${r.id}-form`} sale={r} ctx={ctx} colSpan={columns.keys.length} onDone={onCollected} onCancel={() => setOpenId(null)} /> : null)}
        >
          {activeFilter && <span className="adm-chip warn" title={t("adm.pb.filtered", { what: activeFilter })}>{t("adm.pb.filtered", { what: activeFilter })}</span>}
        </DataTable>
      </Accordion>
    </div>
  );
}
