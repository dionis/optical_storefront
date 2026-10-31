// Dónde se usa: Caja → «Movimientos» (PosCash.jsx). Todo lo cobrado por método
// de pago, las entradas y salidas de efectivo con su motivo, los arqueos y la
// serie por día del periodo. El servidor (GET /admin/pos/cash-report) acota por
// rol: aquí solo se elige periodo, tienda y persona dentro de lo permitido.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminFetch } from "./adminApi.js";
import { money } from "./adminOrders.js";
import { BarChart } from "./charts.jsx";
import { downloadXlsx } from "./exportXlsx.js";
import { printElement } from "./exportUtils.js";
import "./cash-report.css";

const PERIODS = ["today", "week", "month", "year", "range"];
const CATEGORIES = ["supplier_payment", "expense", "owner_withdrawal", "bank_deposit", "change_fund", "refund", "correction", "other"];

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local calendar bounds of a period chip (week starts on Monday). */
function periodRange(key, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (key === "today") return { from: ymd(d), to: ymd(d) };
  if (key === "week") {
    const dow = (d.getDay() + 6) % 7;
    const start = new Date(d); start.setDate(d.getDate() - dow);
    return { from: ymd(start), to: ymd(d) };
  }
  if (key === "year") return { from: `${d.getFullYear()}-01-01`, to: ymd(d) };
  return { from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, to: ymd(d) };
}

const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : "adm.err.pos.generic");

function Tot({ label, value, cls = "", hint }) {
  return <div className={`cr-tot ${cls}`} title={hint}><small>{label}</small><b>{value}</b></div>;
}

/** Acordeón con el total en la cabecera; `open` solo fija el estado inicial. */
function Acc({ icon, title, count, sum, children, open = true }) {
  return (
    <details className="cr-acc" open={open}>
      <summary>
        <Icon name={icon} size={15} /><span>{title}</span>{count != null && <span className="cr-acc-count">{count}</span>}
        {sum && <span className="cr-acc-sum">{sum}</span>}
        <Icon name="chevronDown" size={14} className="cr-acc-arrow" />
      </summary>
      <div className="cr-acc-body">{children}</div>
    </details>
  );
}

export default function CashReport({ ctx }) {
  const { t, lang } = useLang();
  const [period, setPeriod] = useState("month");
  const [range, setRange] = useState(() => periodRange("month"));
  const [storeId, setStoreId] = useState("");
  const [personId, setPersonId] = useState("");
  const [cat, setCat] = useState("");
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  const isAdmin = ctx?.is_admin !== false;
  const stores = ctx?.stores || [];
  const locale = lang === "en" ? "en-US" : "es-US";
  const m = (cents) => money((Number(cents) || 0) / 100, "usd", lang);
  const when = (iso) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—");
  const dayLabel = (ymdStr) => new Date(`${ymdStr}T12:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "short" });
  const methodLabel = (row) => (row.builtin ? t(`adm.pos.method.${row.code}`) : (lang === "en" && row.label?.en) || row.label?.es || row.label?.en || row.code);
  const catLabel = (c) => t(c ? `adm.cash.cat.${c}` : "adm.cash.cat.none");
  const storeLabel = (id) => { const s = stores.find((x) => x.id === id); return s ? `${s.code} · ${s.name}` : id || "—"; };
  const personLabel = (p) => (p ? `${p.name}${p.code ? ` (${p.code})` : ""}` : "—");

  const pick = (key) => { setPeriod(key); if (key !== "range") setRange(periodRange(key)); };

  useEffect(() => {
    if (!range.from || !range.to || range.from > range.to) return;
    let alive = true;
    setBusy(true);
    const q = new URLSearchParams({ from: range.from, to: range.to });
    if (storeId) q.set("establishment_id", storeId);
    if (personId) q.set("seller_id", personId);
    adminFetch(`/admin/pos/cash-report?${q}`)
      .then((r) => {
        if (!alive) return;
        setData(r); setError(null);
        // The list of people is kept from the unfiltered view, so one can switch person without going back to "everyone".
        if (!personId) setPeople(r.people || []);
        else setPeople((prev) => (prev.some((p) => p.id === personId) ? prev : [...prev, ...(r.people || [])]));
      })
      .catch((e) => { if (alive) { setError(errKey(e)); setData(null); } })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [range.from, range.to, storeId, personId]);

  const totals = data?.totals;
  const movements = useMemo(() => (data?.movements || []).filter((x) => !cat || (x.category || "none") === cat), [data, cat]);
  const catCounts = useMemo(() => {
    const out = {};
    for (const x of data?.movements || []) { const k = x.category || "none"; out[k] = (out[k] || 0) + 1; }
    return out;
  }, [data]);
  const periodText = `${range.from} → ${range.to}`;
  const scopeText = `${storeId ? storeLabel(storeId) : t("adm.cash.rep.allStores")}${personId ? ` · ${personLabel(people.find((p) => p.id === personId))}` : ""}`;
  const title = t("adm.cash.rep.title");

  const onPdf = () => {
    // The PDF carries every section: open the accordions for the clone, then put them back.
    const details = [...(ref.current?.querySelectorAll("details") || [])];
    const was = details.map((d) => d.open);
    details.forEach((d) => { d.open = true; });
    printElement(ref.current, title, `${scopeText} · ${periodText}`);
    details.forEach((d, i) => { d.open = was[i]; });
  };
  const onXlsx = () => {
    if (!data) return;
    const d = (c) => (Number(c) || 0) / 100;
    const sumRow = (label, value) => ({ label, value });
    const sheets = [
      {
        name: t("adm.cash.rep.summary"),
        cols: [{ header: t("adm.cash.rep.summary"), key: "label", width: 34 }, { header: t("adm.cash.rep.amount"), key: "value", type: "money", width: 16 }],
        rows: [
          { label: t("adm.cash.rep.store"), value: storeId ? storeLabel(storeId) : t("adm.cash.rep.allStores") },
          { label: t("adm.ins.period"), value: periodText },
          { label: t("adm.cash.rep.generated"), value: new Date().toLocaleString(locale) },
          sumRow(t("adm.cash.rep.t.payments"), d(totals.payments_cents)),
          sumRow(t("adm.cash.rep.t.cash"), d(totals.cash_payments_cents)),
          sumRow(t("adm.cash.rep.t.cards"), d(totals.card_cents)),
          sumRow(t("adm.cash.rep.t.other"), d(totals.other_cents)),
          sumRow(t("adm.cash.rep.t.receivable"), d(totals.receivable_cents)),
          sumRow(t("adm.cash.rep.t.in"), d(totals.movements_in_cents)),
          sumRow(t("adm.cash.rep.t.out"), d(totals.movements_out_cents)),
          sumRow(t("adm.cash.rep.t.net"), d(totals.cash_net_cents)),
          sumRow(t("adm.cash.rep.t.fees"), d(totals.fees_cents)),
          sumRow(t("adm.cash.rep.t.diff"), d(totals.sessions_diff_cents)),
        ],
      },
      {
        name: t("adm.cash.rep.byMethod"),
        cols: [
          { header: t("adm.cash.rep.method"), get: methodLabel, width: 24 },
          { header: t("adm.cash.rep.count"), key: "in_count", type: "int" },
          { header: t("adm.cash.rep.collected"), get: (r) => d(r.in_cents), type: "money" },
          { header: t("adm.cash.rep.refunds"), get: (r) => d(r.refund_cents), type: "money" },
          { header: t("adm.cash.rep.fee"), get: (r) => d(r.fee_cents), type: "money" },
          { header: t("adm.cash.rep.net"), get: (r) => d(r.net_cents), type: "money" },
        ],
        rows: data.by_method,
      },
      {
        name: t("adm.cash.rep.manual"),
        cols: [
          { header: t("adm.cash.rep.when"), get: (r) => when(r.at), width: 18 },
          { header: t("adm.cash.rep.store"), get: (r) => storeLabel(r.establishment_id), width: 20 },
          { header: t("adm.cash.rep.till"), key: "terminal_code" },
          { header: t("adm.cash.rep.type"), get: (r) => t(`adm.cash.mv.${r.kind}`) },
          { header: t("adm.cash.category"), get: (r) => catLabel(r.category), width: 20 },
          { header: t("adm.cash.rep.note"), key: "note", width: 40 },
          { header: t("adm.cash.rep.who"), get: (r) => personLabel(r.by), width: 22 },
          { header: t("adm.cash.rep.amount"), get: (r) => (r.kind === "out" ? -d(r.amount_cents) : d(r.amount_cents)), type: "money" },
        ],
        rows: data.movements,
      },
      {
        name: t("adm.cash.rep.closings"),
        cols: [
          { header: t("adm.cash.openedAt"), get: (r) => when(r.opened_at), width: 18 },
          { header: t("adm.cash.rep.closedAt"), get: (r) => (r.closed_at ? when(r.closed_at) : t("adm.cash.rep.stillOpen")), width: 18 },
          { header: t("adm.cash.rep.store"), get: (r) => storeLabel(r.establishment_id), width: 20 },
          { header: t("adm.cash.rep.till"), key: "terminal_code" },
          { header: t("adm.cash.opening"), get: (r) => d(r.opening_cents), type: "money" },
          { header: t("adm.cash.expected"), get: (r) => (r.expected_cents == null ? "" : d(r.expected_cents)), type: "money" },
          { header: t("adm.cash.counted"), get: (r) => (r.counted_cents == null ? "" : d(r.counted_cents)), type: "money" },
          { header: t("adm.cash.diffCol"), get: (r) => (r.diff_cents == null ? "" : d(r.diff_cents)), type: "money" },
          { header: t("adm.cash.rep.note"), key: "note", width: 30 },
        ],
        rows: data.sessions,
      },
      {
        name: t("adm.cash.rep.byDay"),
        cols: [
          { header: t("adm.cash.rep.date"), key: "date", width: 14 },
          { header: t("adm.cash.rep.t.payments"), get: (r) => d(r.payments_cents), type: "money" },
          { header: t("adm.cash.rep.cashIn"), get: (r) => d(r.cash_in_cents), type: "money" },
          { header: t("adm.cash.rep.cashOut"), get: (r) => d(r.cash_out_cents), type: "money" },
          { header: t("adm.cash.rep.cashNet"), get: (r) => d(r.cash_net_cents), type: "money" },
        ],
        rows: data.series,
      },
    ];
    downloadXlsx(`caja-${range.from}-${range.to}`, sheets);
  };

  const tone = (cents) => (cents > 0 ? "pos" : cents < 0 ? "neg" : "");
  const tot = (k, cents, cls = "", hint) => <Tot label={t(k)} value={m(cents)} cls={cls} hint={hint} />;

  return (
    <div className="cr">
      <div className="cr-filters adm-noprint">
        <span className="cr-chips" role="tablist" aria-label={t("adm.ins.period")}>
          {PERIODS.map((k) => <button key={k} type="button" className={`cr-chip ${period === k ? "on" : ""}`} onClick={() => pick(k)}>{t(`adm.cash.rep.${k}`)}</button>)}
        </span>
        {period === "range" && (
          <span className="cr-dates">
            <input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label={t("adm.cash.rep.from")} />
            <span>→</span>
            <input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label={t("adm.cash.rep.to")} />
          </span>
        )}
        {period !== "range" && <span className="cr-period">{periodText}</span>}
        {(isAdmin || stores.length > 1) && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label={t("adm.pos.store")} title={t("adm.pos.store")}>
            <option value="">{t("adm.cash.rep.allStores")}</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </select>
        )}
        {ctx?.role !== "seller" && (
          <select value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label={t("adm.cash.rep.who")} title={t("adm.cash.rep.who")}>
            <option value="">{t("adm.cash.rep.allPeople")}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
            {personId && !people.some((p) => p.id === personId) && <option value={personId}>{personId}</option>}
          </select>
        )}
        <span className="cr-actions">
          <button type="button" className="btn-xs" onClick={onXlsx} disabled={!data} title={t("adm.cash.rep.excel")}><Icon name="excel" size={13} /> Excel</button>
          <button type="button" className="btn-xs" onClick={onPdf} disabled={!data} title={t("adm.cash.rep.pdf")}><Icon name="printer" size={13} /> PDF</button>
        </span>
      </div>

      {error && <div className="adm-src-note error">{t(error)}</div>}
      {!data && !error && <div className="adm-src-note loading">{t("adm.cash.rep.loading")}</div>}

      {data && (
        <div ref={ref} className="cr" style={{ opacity: busy ? 0.6 : 1 }}>
          <div className="cr-totals">
            {tot("adm.cash.rep.t.payments", totals.payments_cents, "main")}
            {tot("adm.cash.rep.t.cash", totals.cash_payments_cents)}
            {tot("adm.cash.rep.t.cards", totals.card_cents)}
            {tot("adm.cash.rep.t.other", totals.other_cents)}
            {tot("adm.cash.rep.t.in", totals.movements_in_cents, totals.movements_in_cents ? "pos" : "")}
            {tot("adm.cash.rep.t.out", totals.movements_out_cents, totals.movements_out_cents ? "neg" : "")}
            {tot("adm.cash.rep.t.net", totals.cash_net_cents, `main ${tone(totals.cash_net_cents)}`, t("adm.cash.rep.t.netHint"))}
            {tot("adm.cash.rep.t.fees", totals.fees_cents)}
            {tot("adm.cash.rep.t.diff", totals.sessions_diff_cents, totals.sessions_diff_cents ? "warn" : "")}
            {totals.receivable_cents ? tot("adm.cash.rep.t.receivable", totals.receivable_cents) : null}
          </div>

          <Acc icon="wallet" title={t("adm.cash.rep.byMethod")} count={data.by_method.length}
            sum={<><span>{t("adm.cash.rep.net")}</span><b>{m(totals.payments_cents)}</b></>}>
            {data.by_method.length ? (
              <table className="adm-table responsive">
                <thead><tr><th>{t("adm.cash.rep.method")}</th><th className="r">{t("adm.cash.rep.count")}</th><th className="r">{t("adm.cash.rep.collected")}</th><th className="r">{t("adm.cash.rep.refunds")}</th><th className="r">{t("adm.cash.rep.fee")}</th><th className="r">{t("adm.cash.rep.net")}</th></tr></thead>
                <tbody>
                  {data.by_method.map((r) => (
                    <tr key={r.code}>
                      <td data-label={t("adm.cash.rep.method")}><b>{methodLabel(r)}</b>{r.receivable && <small className="cr-note"> · {t("adm.cash.rep.receivable")}</small>}</td>
                      <td className="r num" data-label={t("adm.cash.rep.count")}>{r.in_count}</td>
                      <td className="r num" data-label={t("adm.cash.rep.collected")}>{m(r.in_cents)}</td>
                      <td className={`r num ${r.refund_cents ? "cr-neg" : ""}`} data-label={t("adm.cash.rep.refunds")}>{r.refund_cents ? `−${m(r.refund_cents)}` : "—"}</td>
                      <td className="r num" data-label={t("adm.cash.rep.fee")}>{r.fee_cents ? m(r.fee_cents) : "—"}</td>
                      <td className="r num" data-label={t("adm.cash.rep.net")}><b>{m(r.net_cents)}</b></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>{t("adm.cash.rep.total")}</td><td className="r num">{data.by_method.reduce((s, r) => s + r.in_count, 0)}</td><td className="r num">{m(data.by_method.reduce((s, r) => s + r.in_cents, 0))}</td><td className="r num">{m(data.by_method.reduce((s, r) => s + r.refund_cents, 0))}</td><td className="r num">{m(totals.fees_cents)}</td><td className="r num">{m(totals.payments_cents + totals.receivable_cents)}</td></tr></tfoot>
              </table>
            ) : <div className="cr-empty">{t("adm.cash.rep.empty")}</div>}
          </Acc>

          <Acc icon="history" title={t("adm.cash.rep.manual")} count={t("adm.cash.rep.nMovements", { n: data.movements.length })}
            sum={<><span className="cr-pos">+{m(totals.movements_in_cents)}</span><span className="cr-neg">−{m(totals.movements_out_cents)}</span></>}>
            {data.movements.length > 0 && (
              <span className="cr-chips adm-noprint">
                <button type="button" className={`cr-chip cat ${!cat ? "on" : ""}`} onClick={() => setCat("")}>{t("adm.cash.rep.all")} · {data.movements.length}</button>
                {[...CATEGORIES, "none"].filter((c) => catCounts[c]).map((c) => (
                  <button key={c} type="button" className={`cr-chip cat ${cat === c ? "on" : ""}`} onClick={() => setCat(cat === c ? "" : c)}>{catLabel(c === "none" ? null : c)} · {catCounts[c]}</button>
                ))}
              </span>
            )}
            {data.truncated && <div className="cr-trunc">{t("adm.cash.rep.truncated", { n: data.movements.length })}</div>}
            {movements.length ? (
              <table className="adm-table responsive">
                <thead><tr><th>{t("adm.cash.rep.when")}</th><th>{t("adm.cash.rep.till")}</th><th>{t("adm.cash.rep.type")}</th><th>{t("adm.cash.category")}</th><th>{t("adm.cash.rep.note")}</th><th>{t("adm.cash.rep.who")}</th><th className="r">{t("adm.cash.rep.amount")}</th></tr></thead>
                <tbody>
                  {movements.map((x) => (
                    <tr key={x.id}>
                      <td data-label={t("adm.cash.rep.when")}>{when(x.at)}</td>
                      <td data-label={t("adm.cash.rep.till")}>{x.terminal_code || "—"}{!storeId && stores.length > 1 && <small className="cr-note"> · {storeLabel(x.establishment_id)}</small>}</td>
                      <td data-label={t("adm.cash.rep.type")}><span className={`cr-kind ${x.kind}`}>{t(`adm.cash.mv.${x.kind}`)}</span></td>
                      <td data-label={t("adm.cash.category")} className="cr-cat">{catLabel(x.category)}</td>
                      <td data-label={t("adm.cash.rep.note")} className="wrap cr-note">{x.note || "—"}</td>
                      <td data-label={t("adm.cash.rep.who")} className="cr-who">{x.by ? <>{x.by.name}{x.by.code && <> <code>{x.by.code}</code></>}</> : "—"}</td>
                      <td data-label={t("adm.cash.rep.amount")} className={`r num ${x.kind === "out" ? "cr-neg" : "cr-pos"}`}><b>{x.kind === "out" ? "−" : "+"}{m(x.amount_cents)}</b></td>
                    </tr>
                  ))}
                </tbody>
                {cat && <tfoot><tr><td colSpan="6">{catLabel(cat === "none" ? null : cat)}</td><td className="r num">{m(movements.reduce((s, x) => s + (x.kind === "out" ? -x.amount_cents : x.amount_cents), 0))}</td></tr></tfoot>}
              </table>
            ) : <div className="cr-empty">{t("adm.cash.rep.empty")}</div>}
          </Acc>

          <Acc icon="lock" title={t("adm.cash.rep.closings")} count={t("adm.cash.rep.nClosings", { n: data.sessions.length })}
            sum={<><span>{t("adm.cash.diffCol")}</span><b className={tone(totals.sessions_diff_cents) === "" ? "" : "cr-neg"}>{m(totals.sessions_diff_cents)}</b></>} open={data.sessions.length > 0}>
            {data.sessions.length ? (
              <table className="adm-table responsive">
                <thead><tr><th>{t("adm.cash.openedAt")}</th><th>{t("adm.cash.rep.closedAt")}</th><th>{t("adm.cash.rep.till")}</th><th className="r">{t("adm.cash.opening")}</th><th className="r">{t("adm.cash.expected")}</th><th className="r">{t("adm.cash.counted")}</th><th className="r">{t("adm.cash.diffCol")}</th></tr></thead>
                <tbody>
                  {data.sessions.map((s) => (
                    <tr key={s.id}>
                      <td data-label={t("adm.cash.openedAt")}>{when(s.opened_at)}</td>
                      <td data-label={t("adm.cash.rep.closedAt")}>{s.closed_at ? when(s.closed_at) : <span className="adm-chip ok">{t("adm.cash.rep.stillOpen")}</span>}</td>
                      <td data-label={t("adm.cash.rep.till")}>{s.terminal_code || "—"}{!storeId && stores.length > 1 && <small className="cr-note"> · {storeLabel(s.establishment_id)}</small>}</td>
                      <td className="r num" data-label={t("adm.cash.opening")}>{m(s.opening_cents)}</td>
                      <td className="r num" data-label={t("adm.cash.expected")}>{s.expected_cents == null ? "—" : m(s.expected_cents)}</td>
                      <td className="r num" data-label={t("adm.cash.counted")}>{s.counted_cents == null ? "—" : m(s.counted_cents)}</td>
                      <td className={`r num ${s.diff_cents ? (s.diff_cents < 0 ? "cr-neg" : "cr-pos") : ""}`} data-label={t("adm.cash.diffCol")}>
                        <b>{s.diff_cents == null ? "—" : m(s.diff_cents)}</b>{s.note && <small className="cr-note"> · {s.note}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="cr-empty">{t("adm.cash.rep.empty")}</div>}
          </Acc>

          <Acc icon="calendar" title={t("adm.cash.rep.byDay")} count={t("adm.cash.rep.nDays", { n: data.series.length })}
            sum={<><span>{t("adm.cash.rep.cashNet")}</span><b>{m(totals.cash_net_cents)}</b></>} open={false}>
            {data.series.length ? (
              <>
                {data.series.length <= 62 && (
                  <div className="cr-chart" title={t("adm.cash.rep.chart")}>
                    <BarChart data={data.series.map((r) => ({ label: dayLabel(r.date), value: Math.max(0, r.payments_cents) / 100 }))} height={150} valuePrefix="$" />
                  </div>
                )}
                <table className="adm-table responsive">
                  <thead><tr><th>{t("adm.cash.rep.date")}</th><th className="r">{t("adm.cash.rep.t.payments")}</th><th className="r">{t("adm.cash.rep.cashIn")}</th><th className="r">{t("adm.cash.rep.cashOut")}</th><th className="r">{t("adm.cash.rep.cashNet")}</th></tr></thead>
                  <tbody>
                    {data.series.map((r) => (
                      <tr key={r.date}>
                        <td data-label={t("adm.cash.rep.date")}>{r.date}</td>
                        <td className="r num" data-label={t("adm.cash.rep.t.payments")}>{m(r.payments_cents)}</td>
                        <td className={`r num ${r.cash_in_cents ? "cr-pos" : ""}`} data-label={t("adm.cash.rep.cashIn")}>{r.cash_in_cents ? m(r.cash_in_cents) : "—"}</td>
                        <td className={`r num ${r.cash_out_cents ? "cr-neg" : ""}`} data-label={t("adm.cash.rep.cashOut")}>{r.cash_out_cents ? m(r.cash_out_cents) : "—"}</td>
                        <td className="r num" data-label={t("adm.cash.rep.cashNet")}><b>{m(r.cash_net_cents)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>{t("adm.cash.rep.total")}</td><td className="r num">{m(totals.payments_cents)}</td><td className="r num">{m(totals.movements_in_cents)}</td><td className="r num">{m(totals.movements_out_cents)}</td><td className="r num">{m(totals.cash_net_cents)}</td></tr></tfoot>
                </table>
              </>
            ) : <div className="cr-empty">{t("adm.cash.rep.empty")}</div>}
          </Acc>
        </div>
      )}
    </div>
  );
}
