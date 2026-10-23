// Dónde se usa: pestaña Costos de /admin — fichas de costo (reglas por marca,
// SKU, lente, laboratorio, envío y comisiones), ficha por pedido editable y
// rentabilidad del período. Backend: /admin/costing/*. Todo el copy via t().
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { money as fmtMoney, shortDate, stageErrorText } from "./adminOrders.js";
import { fetchCostRules, saveCostRules, deleteCostRule, fetchOrderCost, saveOrderCost, resetOrderCost, fetchCostSummary, RULE_GROUPS, marginTone } from "./adminCosting.js";
import Icon from "./icons.jsx";

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const RANGES = ["30d", "90d", "ytd", "all"];
function rangeFrom(k) {
  if (k === "all") return "";
  if (k === "ytd") return `${new Date().getFullYear()}-01-01`;
  const days = { "30d": 30, "90d": 90 }[k] || 30;
  return ymd(Date.now() - days * 864e5);
}
const pct = (v) => (v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}%`);
const capriUrl = (sku) => `https://caprioptics.com/product/${String(sku || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}/`;

/** Etiqueta legible de una regla: la del servidor o, si falta, el catálogo. */
function ruleLabel(rule, catalog, t) {
  if (rule.label) return rule.label;
  const find = (list) => (list || []).find((x) => (x.slug || x.code) === rule.match_key);
  if (rule.kind === "frame_brand") return find(catalog.brands)?.name || rule.match_key;
  if (rule.kind === "lens_design") return find(catalog.designs)?.label || rule.match_key;
  if (rule.kind === "lens_material") return find(catalog.materials)?.label || rule.match_key;
  if (rule.kind === "lens_photo") return find(catalog.photo)?.label || rule.match_key;
  if (rule.kind === "lens_ar") return find(catalog.ar)?.label || rule.match_key;
  const k = `adm.cost.key.${rule.match_key}`;
  const s = t(k);
  return s === k ? rule.match_key : s;
}

function NumInput({ value, onCommit, placeholder = "0.00", step = "0.01" }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <input className="adm-price-input" type="number" step={step} min="0" value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

/* ── Reglas (fichas de costo) ───────────────────────────────────────────── */
function RulesEditor({ data, onSaved }) {
  const { t } = useLang();
  const { toast, confirm } = useFeedback();
  const [rules, setRules] = useState(data.rules);
  const [dirty, setDirty] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newSkuAmt, setNewSkuAmt] = useState("");
  const [newFixed, setNewFixed] = useState("");
  useEffect(() => { setRules(data.rules); setDirty(new Set()); }, [data]);
  const catalog = data.catalog || {};

  const patch = (id, p) => {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
    setDirty((d) => new Set(d).add(id));
  };
  const add = (rule) => {
    const tmp = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setRules((rs) => [...rs, { id: tmp, active: true, unit: "fixed", sort_order: 0, ...rule }]);
    setDirty((d) => new Set(d).add(tmp));
  };
  const remove = async (rule) => {
    if (!(await confirm({ tone: "danger", title: t("adm.cost.removeRule"), message: ruleLabel(rule, catalog, t), confirmLabel: t("adm.cost.remove") }))) return;
    if (String(rule.id).startsWith("new-")) { setRules((rs) => rs.filter((r) => r.id !== rule.id)); return; }
    try { await deleteCostRule(rule.id); setRules((rs) => rs.filter((r) => r.id !== rule.id)); toast({ tone: "success", title: t("adm.cost.removed") }); onSaved(); }
    catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.err.cost.saveFailed") }); }
  };
  const save = async () => {
    const changed = rules.filter((r) => dirty.has(r.id)).map((r) => ({ ...r, id: String(r.id).startsWith("new-") ? undefined : r.id, amount: Number(r.amount) || 0 }));
    if (!changed.length) return;
    setBusy(true);
    try {
      await saveCostRules(changed);
      toast({ tone: "success", title: t("adm.cost.saved", { n: changed.length }) });
      setDirty(new Set());
      onSaved();
    } catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.err.cost.saveFailed") }); }
    finally { setBusy(false); }
  };

  const undefinedCount = rules.filter((r) => r.active && r.unit !== "percent" && !(Number(r.amount) > 0) && r.kind !== "shipping").length;

  return (
    <>
      <div className="adm-head-row">
        <p className="muted" style={{ margin: 0, maxWidth: 760 }}>{t("adm.cost.rulesIntro")}</p>
        <div className="adm-actions">
          {undefinedCount > 0 && <span className="adm-chip warn"><Icon name="alert" size={13} />{t("adm.cost.undefinedN", { n: undefinedCount })}</span>}
          <button className="btn-sm primary" disabled={busy || !dirty.size} onClick={save}><Icon name="save" size={14} />{t("adm.cost.saveRules")}{dirty.size ? ` (${dirty.size})` : ""}</button>
        </div>
      </div>
      <div className="adm-grid-2">
        {RULE_GROUPS.map((g) => {
          const list = rules.filter((r) => g.kinds.includes(r.kind)).sort((a, b) => (a.kind > b.kind ? 1 : a.kind < b.kind ? -1 : String(ruleLabel(a, catalog, t)).localeCompare(ruleLabel(b, catalog, t))));
          return (
            <div className="adm-card" key={g.key}>
              <h3><Icon name={g.icon} size={16} />{t(`adm.cost.g.${g.key}`)}</h3>
              <p className="adm-sub">{t(`adm.cost.g.${g.key}.hint`)}</p>
              <div className="cost-rules">
                {list.map((r) => {
                  const undefinedAmt = r.active && r.unit !== "percent" && !(Number(r.amount) > 0) && !(r.kind === "shipping" && r.match_key === "actual");
                  const isActual = r.kind === "shipping" && r.match_key === "actual";
                  return (
                    <div className={`cost-rule ${undefinedAmt ? "undefined" : ""} ${r.active ? "" : "off"}`} key={r.id}>
                      <div className="cost-rule-name">
                        <b>{ruleLabel(r, catalog, t)}</b>
                        <small>{t(`adm.cost.kind.${r.kind}`)}{r.kind === "frame_sku" ? <> · <a href={capriUrl(r.match_key)} target="_blank" rel="noopener noreferrer">{t("adm.cost.capriRef")}</a></> : null}</small>
                      </div>
                      {isActual ? <span className="cost-unit">{t("adm.cost.shippingActual")}</span> : (
                        <NumInput value={r.amount} onCommit={(v) => patch(r.id, { amount: Number(v) || 0 })} step={r.unit === "percent" ? "0.1" : "0.01"} />
                      )}
                      <span className="cost-unit">{r.unit === "percent" ? "%" : "USD"}</span>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <label className="adm-switch" title={t("adm.cost.active")}><input type="checkbox" checked={!!r.active} onChange={(e) => patch(r.id, { active: e.target.checked })} /></label>
                        {(r.kind === "frame_sku" || (r.kind === "order_fixed" && !["lab", "packaging", "case"].includes(r.match_key))) && (
                          <button type="button" className="btn-xs warn" onClick={() => remove(r)} title={t("adm.cost.remove")}><Icon name="trash" size={13} /></button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {list.length === 0 && <div className="adm-nodata">{t("adm.cost.noRules")}</div>}
              </div>
              {g.key === "frames" && (
                <form className="ord-edit-row" onSubmit={(e) => { e.preventDefault(); if (!newSku.trim()) return; add({ kind: "frame_sku", match_key: newSku.trim().toUpperCase(), label: newSku.trim().toUpperCase(), amount: Number(newSkuAmt) || 0 }); setNewSku(""); setNewSkuAmt(""); }}>
                  <input value={newSku} placeholder={t("adm.cost.skuPh")} onChange={(e) => setNewSku(e.target.value)} />
                  <input type="number" step="0.01" min="0" value={newSkuAmt} placeholder="0.00" style={{ maxWidth: 110 }} onChange={(e) => setNewSkuAmt(e.target.value)} />
                  <button className="btn-sm"><Icon name="plus" size={14} />{t("adm.cost.addSku")}</button>
                </form>
              )}
              {g.key === "order" && (
                <form className="ord-edit-row" onSubmit={(e) => { e.preventDefault(); const name = newFixed.trim(); if (!name) return; add({ kind: "order_fixed", match_key: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40), label: name, amount: 0 }); setNewFixed(""); }}>
                  <input value={newFixed} placeholder={t("adm.cost.fixedPh")} onChange={(e) => setNewFixed(e.target.value)} />
                  <button className="btn-sm"><Icon name="plus" size={14} />{t("adm.cost.addFixed")}</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Ficha de un pedido (editable) ──────────────────────────────────────── */
export function OrderCostSheet({ orderId, onClose, onChanged }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [sheet, setSheet] = useState(null);
  const [lines, setLines] = useState([]);
  const [state, setState] = useState("loading");
  const [dirty, setDirty] = useState(false);
  const load = () => {
    setState("loading");
    fetchOrderCost(orderId).then((s) => { setSheet(s); setLines(s.lines || []); setDirty(false); setState("ok"); }).catch(() => setState("error"));
  };
  useEffect(load, [orderId]);

  const total = useMemo(() => lines.reduce((a, l) => a + (Number(l.amount) || 0) * (Number(l.qty) || 1), 0), [lines]);
  const revenue = sheet?.revenue || 0;
  const margin = revenue - total;
  const mpct = revenue > 0 ? (margin / revenue) * 100 : null;
  const cur = sheet?.currency_code || "usd";

  const setLine = (i, p) => { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l))); setDirty(true); };
  const addLine = () => { setLines((ls) => [...ls, { key: `manual_${Date.now()}`, label: "", amount: 0, qty: 1, source: "manual" }]); setDirty(true); };
  const removeLine = (i) => { setLines((ls) => ls.filter((_, j) => j !== i)); setDirty(true); };
  const save = async () => {
    try {
      const s = await saveOrderCost(orderId, lines.map((l) => ({ key: l.key, label: l.label, amount: Number(l.amount) || 0, qty: Number(l.qty) || 1 })));
      setSheet(s); setLines(s.lines || []); setDirty(false);
      toast({ tone: "success", title: t("adm.cost.sheetSaved") }); onChanged?.();
    } catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.err.cost.saveFailed") }); }
  };
  const reset = async () => {
    if (!(await confirm({ tone: "danger", title: t("adm.cost.resetTitle"), message: t("adm.cost.resetBody"), confirmLabel: t("adm.cost.resetConfirm") }))) return;
    try { const s = await resetOrderCost(orderId); setSheet(s); setLines(s.lines || []); setDirty(false); toast({ tone: "success", title: t("adm.cost.resetDone") }); onChanged?.(); }
    catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.err.cost.saveFailed") }); }
  };

  return (
    <div className="adm-card" style={{ borderColor: "#c9dcf8" }}>
      <div className="adm-head-row" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}><Icon name="receipt" size={16} />{t("adm.cost.sheetFor", { order: sheet?.display_id ? `#${sheet.display_id}` : "…" })}{sheet?.manual && <span className="adm-chip gold"><Icon name="edit" size={12} />{t("adm.cost.manual")}</span>}</h3>
        <div className="adm-actions">
          {sheet?.manual && <button className="btn-sm" onClick={reset}><Icon name="rotate" size={14} />{t("adm.cost.resetToRules")}</button>}
          <button className="btn-sm primary" disabled={!dirty} onClick={save}><Icon name="save" size={14} />{t("adm.cost.saveSheet")}</button>
          {onClose && <button className="btn-sm ghost" onClick={onClose}><Icon name="close" size={14} /></button>}
        </div>
      </div>
      {state === "loading" && <div className="adm-skel-rows"><div className="adm-skel" /><div className="adm-skel" /><div className="adm-skel" /></div>}
      {state === "error" && <div className="adm-login-err">{t("adm.err.cost.loadFailed")}</div>}
      {state === "ok" && (
        <>
          <div className="cost-line" style={{ color: "var(--adm-muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>
            <span>{t("adm.cost.line")}</span><span>{t("adm.cost.amount")}</span><span>{t("adm.cost.qty")}</span><span className="r">{t("adm.cost.subtotal")}</span><span />
          </div>
          {lines.map((l, i) => (
            <div className={`cost-line ${l.source === "manual" ? "manual" : ""}`} key={l.key + i}>
              <span className="cost-line-name">
                {l.source === "manual" ? <input className="adm-input" value={l.label} placeholder={t("adm.cost.linePh")} onChange={(e) => setLine(i, { label: e.target.value })} style={{ width: "100%" }} /> : <>{l.label}<small className="muted"> · {t(`adm.cost.src.${l.source}`)}</small></>}
              </span>
              <NumInput value={l.amount} onCommit={(v) => setLine(i, { amount: Number(v) || 0 })} />
              <NumInput value={l.qty ?? 1} onCommit={(v) => setLine(i, { qty: Number(v) || 1 })} step="1" placeholder="1" />
              <span className="r num">{fmtMoney((Number(l.amount) || 0) * (Number(l.qty) || 1), cur, lang)}</span>
              <button type="button" className="btn-xs warn" onClick={() => removeLine(i)} title={t("adm.cost.remove")}><Icon name="trash" size={13} /></button>
            </div>
          ))}
          <div className="ord-edit-row"><button type="button" className="btn-sm" onClick={addLine}><Icon name="plus" size={14} />{t("adm.cost.addLine")}</button></div>
          <div className="cost-line total">
            <span>{t("adm.cost.cost")}</span><span /><span /><span className="r num">{fmtMoney(total, cur, lang)}</span><span />
          </div>
          <div className="cost-kpi-row" style={{ marginTop: 12 }}>
            <div className="cost-kpi"><small><Icon name="dollar" size={13} />{t("adm.cost.revenue")}</small><b>{fmtMoney(revenue, cur, lang)}</b></div>
            <div className="cost-kpi bad"><small><Icon name="receipt" size={13} />{t("adm.cost.cost")}</small><b>{fmtMoney(total, cur, lang)}</b></div>
            <div className={`cost-kpi ${marginTone(mpct) === "bad" ? "bad" : "good"}`}><small><Icon name="trendUp" size={13} />{t("adm.cost.margin")}</small><b>{fmtMoney(margin, cur, lang)}</b><em>{pct(mpct)}</em></div>
          </div>
          <div className="cost-bar"><i className="c" style={{ width: `${revenue > 0 ? Math.min(100, (total / revenue) * 100) : 0}%` }} /><i className="m" style={{ width: `${revenue > 0 ? Math.max(0, 100 - (total / revenue) * 100) : 0}%` }} /></div>
          <div className="cost-legend"><span><i style={{ background: "var(--adm-red)" }} />{t("adm.cost.cost")}</span><span><i style={{ background: "var(--adm-green)" }} />{t("adm.cost.margin")}</span></div>
        </>
      )}
    </div>
  );
}

/* ── Rentabilidad del período ───────────────────────────────────────────── */
function Profitability({ sellers, focusOrder, onFocusDone }) {
  const { t, lang } = useLang();
  const [range, setRange] = useState("30d");
  const [seller, setSeller] = useState("");
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [sort, setSort] = useState(["created_at", -1]);
  const [open, setOpen] = useState(focusOrder || "");
  const [q, setQ] = useState("");
  const load = () => {
    setState("loading");
    fetchCostSummary({ from: rangeFrom(range), seller }).then((d) => { setData(d); setState("ok"); }).catch(() => setState("error"));
  };
  useEffect(load, [range, seller]);
  useEffect(() => { if (focusOrder) { setOpen(focusOrder); setRange("all"); onFocusDone?.(); } }, [focusOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const list = (data?.orders || []).filter((o) => !q || `${o.display_id} ${o.customer_name || ""} ${o.seller_code || ""}`.toLowerCase().includes(q.toLowerCase()));
    const [k, dir] = sort;
    return list.slice().sort((a, b) => ((a[k] ?? "") > (b[k] ?? "") ? 1 : (a[k] ?? "") < (b[k] ?? "") ? -1 : 0) * dir);
  }, [data, sort, q]);
  const th = (key, label, cls = "") => (
    <th className={`sortable ${cls} ${sort[0] === key ? "on" : ""}`} onClick={() => setSort(([k, d]) => [key, k === key ? -d : -1])}>{label}{sort[0] === key ? (sort[1] > 0 ? " ↑" : " ↓") : ""}</th>
  );
  const tot = data?.totals || {};
  const cur = "usd";
  const undefinedOrders = (data?.orders || []).filter((o) => o.undefined_costs > 0).length;

  return (
    <>
      <div className="adm-head-row">
        <div className="adm-orders-tools">
          <div className="adm-range">{RANGES.map((k) => <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{t(`adm.range.${k}`)}</button>)}</div>
          <select className="adm-sel" style={{ width: "auto" }} value={seller} onChange={(e) => setSeller(e.target.value)}>
            <option value="">{t("adm.cost.allSellers")}</option>
            <option value="none">{t("adm.ord.noSeller")}</option>
            {sellers.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
          </select>
          <label className="adm-find compact"><Icon name="search" size={15} /><input placeholder={t("adm.cost.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className="btn-sm ghost" onClick={load} title={t("adm.sec.refresh")}><Icon name="refresh" size={15} /></button>
        </div>
      </div>
      {state === "loading" && !data && <div className="adm-src-note loading">{t("adm.real.loading")}</div>}
      {state === "error" && <div className="adm-login-err">{t("adm.err.cost.loadFailed")}</div>}
      {data && (
        <>
          <div className="cost-kpi-row">
            <div className="cost-kpi"><small><Icon name="orders" size={13} />{t("adm.kpi.orders")}</small><b>{tot.orders ?? 0}</b></div>
            <div className="cost-kpi"><small><Icon name="dollar" size={13} />{t("adm.cost.revenue")}</small><b>{fmtMoney(tot.revenue, cur, lang)}</b></div>
            <div className="cost-kpi bad"><small><Icon name="receipt" size={13} />{t("adm.cost.cost")}</small><b>{fmtMoney(tot.cost, cur, lang)}</b></div>
            <div className={`cost-kpi ${marginTone(tot.margin_pct) === "bad" ? "bad" : "good"}`}><small><Icon name="trendUp" size={13} />{t("adm.cost.margin")}</small><b>{fmtMoney(tot.margin, cur, lang)}</b><em>{pct(tot.margin_pct)}</em></div>
            <div className={`cost-kpi ${undefinedOrders ? "bad" : "good"}`}><small><Icon name="alert" size={13} />{t("adm.cost.incomplete")}</small><b>{undefinedOrders}</b><em>{t("adm.cost.incompleteHint")}</em></div>
          </div>
          {data.truncated && <div className="adm-find-note muted">{t("adm.ord.truncated", { n: 300 })}</div>}
          {open && <div style={{ marginBottom: 16 }}><OrderCostSheet orderId={open} onClose={() => setOpen("")} onChanged={load} /></div>}
          <div className="adm-grid-2">
            <div className="adm-card" style={{ gridColumn: "1 / -1" }}>
              <h3><Icon name="sales" size={16} />{t("adm.cost.byOrder")}</h3>
              <div className="adm-table-wrap">
                <table className="adm-table responsive">
                  <thead><tr>{th("display_id", t("adm.col.order"))}{th("created_at", t("adm.col.date"))}{th("customer_name", t("adm.ord.colCustomer"))}{th("seller_code", t("adm.ord.seller"))}{th("revenue", t("adm.cost.revenue"), "r")}{th("cost_total", t("adm.cost.cost"), "r")}{th("margin", t("adm.cost.margin"), "r")}{th("margin_pct", "%", "r")}<th /></tr></thead>
                  <tbody>
                    {rows.length === 0 ? <tr><td colSpan="9" className="full"><div className="adm-empty"><Icon name="costs" size={36} /><b>{t("adm.cost.noOrders")}</b></div></td></tr> : rows.map((o) => (
                      <tr key={o.id} className={`ord-row ${open === o.id ? "open" : ""}`} onClick={() => setOpen(open === o.id ? "" : o.id)}>
                        <td data-label={t("adm.col.order")}><b>#{o.display_id}</b>{o.manual && <span className="adm-chip gold" style={{ marginLeft: 6, fontSize: 10.5 }}><Icon name="edit" size={11} /></span>}{o.undefined_costs > 0 && <span className="adm-chip warn" style={{ marginLeft: 6, fontSize: 10.5 }} title={t("adm.cost.incompleteHint")}><Icon name="alert" size={11} />{o.undefined_costs}</span>}</td>
                        <td data-label={t("adm.col.date")}>{shortDate(o.created_at, lang)}</td>
                        <td data-label={t("adm.ord.colCustomer")}>{o.customer_name || "—"}</td>
                        <td data-label={t("adm.ord.seller")}>{o.seller_code || "—"}</td>
                        <td data-label={t("adm.cost.revenue")} className="r num">{fmtMoney(o.revenue, cur, lang)}</td>
                        <td data-label={t("adm.cost.cost")} className="r num">{fmtMoney(o.cost_total, cur, lang)}</td>
                        <td data-label={t("adm.cost.margin")} className="r num">{fmtMoney(o.margin, cur, lang)}</td>
                        <td data-label="%" className="r"><span className={`margin-pct ${marginTone(o.margin_pct)}`}>{pct(o.margin_pct)}</span></td>
                        <td className="r"><Icon name={open === o.id ? "chevronUp" : "chevronDown"} size={14} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="adm-card">
              <h3><Icon name="layers" size={16} />{t("adm.cost.byKind")}</h3>
              {(data.by_kind || []).length === 0 ? <div className="adm-nodata">{t("adm.chart.noData")}</div> : (
                <div className="adm-thumbbars">
                  {data.by_kind.slice().sort((a, b) => b.amount - a.amount).map((k) => {
                    const max = Math.max(...data.by_kind.map((x) => x.amount), 1);
                    return (
                      <div className="adm-tb-row" key={k.kind}>
                        <div className="adm-tb-main">
                          <div className="adm-tb-top"><span className="adm-tb-name">{t(`adm.cost.kind.${k.kind}`) !== `adm.cost.kind.${k.kind}` ? t(`adm.cost.kind.${k.kind}`) : k.label || k.kind}</span><b>{fmtMoney(k.amount, cur, lang)}</b></div>
                          <div className="adm-tb-track"><div className="adm-tb-fill" style={{ width: `${(k.amount / max) * 100}%` }} /></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="adm-card">
              <h3><Icon name="info" size={16} />{t("adm.cost.howTitle")}</h3>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>{t("adm.cost.howBody")}</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function Costs({ focusOrder, onFocusDone, sellers = [] }) {
  const { t } = useLang();
  const demo = isDemoLogin();
  const [view, setView] = useState(focusOrder ? "profit" : "profit");
  const [rulesData, setRulesData] = useState(null);
  const [rulesState, setRulesState] = useState("loading");
  const loadRules = () => { if (demo) return; setRulesState("loading"); fetchCostRules().then((d) => { setRulesData(d); setRulesState("ok"); }).catch(() => setRulesState("error")); };
  useEffect(loadRules, [demo]);
  useEffect(() => { if (focusOrder) setView("profit"); }, [focusOrder]);

  return (
    <div className="adm-section">
      <div className="adm-head-row"><h2>{t("adm.tab.costs")}</h2></div>
      <p className="adm-sub" style={{ marginTop: -8 }}>{t("adm.cost.intro")}</p>
      {demo && <div className="adm-demo-banner">{t("adm.sec.demoNote")}</div>}
      <div className="adm-subtabs">
        <button className={view === "profit" ? "on" : ""} onClick={() => setView("profit")}><Icon name="trendUp" size={15} />{t("adm.cost.tab.profit")}</button>
        <button className={view === "rules" ? "on" : ""} onClick={() => setView("rules")}><Icon name="clipboard" size={15} />{t("adm.cost.tab.rules")}</button>
      </div>
      {!demo && view === "profit" && <Profitability sellers={sellers} focusOrder={focusOrder} onFocusDone={onFocusDone} />}
      {!demo && view === "rules" && (
        rulesState === "loading" ? <div className="adm-src-note loading">{t("adm.real.loading")}</div>
          : rulesState === "error" ? <div className="adm-login-err">{t("adm.err.cost.loadFailed")}</div>
            : <RulesEditor data={rulesData} onSaved={loadRules} />
      )}
    </div>
  );
}
