// Dónde se usa: sección "Costos y precios" de /admin — Rentabilidad (por
// pedido y por concepto), Fichas de costo (importes fijos: montura, lentes,
// laboratorio, envío, comisión de pago), Distribución % (lo que se lleva cada
// partida de cada venta: atención al cliente, renta, webmaster, impuestos… y la
// ganancia objetivo) y Precios (lo que ve el cliente). Backend: /admin/costing/*.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { money as fmtMoney, shortDate, stageErrorText } from "./adminOrders.js";
import { fetchCostRules, saveCostRules, deleteCostRule, fetchOrderCost, saveOrderCost, resetOrderCost, fetchCostSummary, RULE_GROUPS, marginTone, isAllocationRule, isProfitTarget, PROFIT_TARGET_KEY, ALLOCATION_SUGGESTIONS } from "./adminCosting.js";
import Icon from "./icons.jsx";
import { Card, SubTabs, ExportMenu, InfoTip } from "./ui.jsx";
import { printElement } from "./exportUtils.js";
import { AllocationBar } from "./ExecutiveCosts.jsx";

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const RANGES = ["30d", "90d", "ytd", "all"];
function rangeFrom(k) {
  if (k === "all") return "";
  if (k === "ytd") return `${new Date().getFullYear()}-01-01`;
  const days = { "30d": 30, "90d": 90 }[k] || 30;
  return ymd(Date.now() - days * 864e5);
}
const pct = (v) => (v == null || Number.isNaN(v) ? "—" : `${Math.round(v * 10) / 10}%`);
const capriUrl = (sku) => `https://caprioptics.com/product/${String(sku || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}/`;
const slug = (name) => String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

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

function NumInput({ value, onCommit, placeholder = "0.00", step = "0.01", max }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <input className="adm-price-input" type="number" step={step} min="0" max={max} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

/** Estado compartido de edición de reglas (fichas y distribución usan el mismo). */
function useRulesDraft(data, onSaved) {
  const { t } = useLang();
  const { toast, confirm } = useFeedback();
  const [rules, setRules] = useState(data.rules);
  const [dirty, setDirty] = useState(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRules(data.rules); setDirty(new Set()); }, [data]);
  const catalog = data.catalog || {};
  const patch = (id, p) => { setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r))); setDirty((d) => new Set(d).add(id)); };
  const add = (rule) => {
    const tmp = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setRules((rs) => [...rs, { id: tmp, active: true, unit: "fixed", sort_order: 0, ...rule }]);
    setDirty((d) => new Set(d).add(tmp));
    return tmp;
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
    try { await saveCostRules(changed); toast({ tone: "success", title: t("adm.cost.saved", { n: changed.length }) }); setDirty(new Set()); onSaved(); }
    catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.err.cost.saveFailed") }); }
    finally { setBusy(false); }
  };
  return { rules, catalog, dirty, busy, patch, add, remove, save };
}

/* ── Fichas de costo (importes) ─────────────────────────────────────────── */
function RulesEditor({ data, onSaved }) {
  const { t } = useLang();
  const { rules, catalog, dirty, busy, patch, add, remove, save } = useRulesDraft(data, onSaved);
  const [newSku, setNewSku] = useState("");
  const [newSkuAmt, setNewSkuAmt] = useState("");
  const [newFixed, setNewFixed] = useState("");
  const ref = useRef(null);
  const undefinedCount = rules.filter((r) => r.active && r.unit !== "percent" && !(Number(r.amount) > 0) && r.kind !== "shipping").length;

  return (
    <div ref={ref}>
      <div className="adm-head-row compact">
        <p className="muted" style={{ margin: 0, maxWidth: 760 }}>{t("adm.cost.rulesIntro")}</p>
        <div className="adm-actions adm-noprint">
          {undefinedCount > 0 && <span className="adm-chip warn"><Icon name="alert" size={13} />{t("adm.cost.undefinedN", { n: undefinedCount })}</span>}
          <ExportMenu targetRef={ref} title={t("adm.cost.tab.rules")} name="fichas-costo" compact={false} csv={{ cols: [[t("adm.cost.line"), (r) => ruleLabel(r, catalog, t)], [t("adm.cost.kind"), (r) => t(`adm.cost.kind.${r.kind}`)], [t("adm.cost.amount"), "amount"], [t("adm.cost.unit"), (r) => (r.unit === "percent" ? "%" : "USD")], [t("adm.cost.active"), (r) => (r.active ? "1" : "0")]], rows: rules }} />
          <button className="btn-sm primary" disabled={busy || !dirty.size} onClick={save}><Icon name="save" size={14} />{t("adm.cost.saveRules")}{dirty.size ? ` (${dirty.size})` : ""}</button>
        </div>
      </div>
      <div className="cost-accordions">
        {RULE_GROUPS.map((g) => {
          const list = rules.filter((r) => g.kinds.includes(r.kind) && (!g.only || r.kind !== "order_percent" || g.only.includes(r.match_key)))
            .sort((a, b) => (a.kind > b.kind ? 1 : a.kind < b.kind ? -1 : String(ruleLabel(a, catalog, t)).localeCompare(ruleLabel(b, catalog, t))));
          const undef = list.filter((r) => r.active && r.unit !== "percent" && !(Number(r.amount) > 0) && r.kind !== "shipping").length;
          return (
            <details key={g.key} className="cost-accordion" open>
              <summary className="cost-acc-head">
                <Icon name={g.icon} size={16} />
                <span className="cost-acc-title">{t(`adm.cost.g.${g.key}`)}</span>
                <small className="cost-acc-count">{list.length}</small>
                {undef > 0 && <span className="adm-chip warn" style={{ fontSize: 11, padding: "1px 7px" }}><Icon name="alert" size={11} />{undef}</span>}
                <Icon name="chevronDown" size={14} className="cost-acc-arrow" />
              </summary>
              <div className="cost-acc-body">
                <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>{t(`adm.cost.g.${g.key}.hint`)}</p>
                <div className="cost-rules">
                  {list.map((r) => {
                    const isActual = r.kind === "shipping" && r.match_key === "actual";
                    const undefinedAmt = r.active && r.unit !== "percent" && !(Number(r.amount) > 0) && !isActual;
                    return (
                      <div className={`cost-rule ${undefinedAmt ? "undefined" : ""} ${r.active ? "" : "off"}`} key={r.id}>
                        <div className="cost-rule-name">
                          <b>{ruleLabel(r, catalog, t)}</b>
                          <small>{t(isAllocationRule(r) ? "adm.cost.kind.order_percent_net" : `adm.cost.kind.${r.kind}`)}{r.kind === "frame_sku" ? <> · <a href={capriUrl(r.match_key)} target="_blank" rel="noopener noreferrer">{t("adm.cost.capriRef")}</a></> : null}</small>
                        </div>
                        {isActual ? <span className="cost-unit">{t("adm.cost.shippingActual")}</span> : (
                          <NumInput value={r.amount} onCommit={(v) => patch(r.id, { amount: Number(v) || 0 })} step={r.unit === "percent" ? "0.1" : "0.01"} />
                        )}
                        <span className="cost-unit">{r.unit === "percent" ? "%" : "$"}</span>
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
                  <form className="ord-edit-row adm-noprint" onSubmit={(e) => { e.preventDefault(); if (!newSku.trim()) return; add({ kind: "frame_sku", match_key: newSku.trim().toUpperCase(), label: newSku.trim().toUpperCase(), amount: Number(newSkuAmt) || 0 }); setNewSku(""); setNewSkuAmt(""); }}>
                    <input value={newSku} placeholder={t("adm.cost.skuPh")} onChange={(e) => setNewSku(e.target.value)} />
                    <input type="number" step="0.01" min="0" value={newSkuAmt} placeholder="0.00" style={{ maxWidth: 110 }} onChange={(e) => setNewSkuAmt(e.target.value)} />
                    <button className="btn-sm"><Icon name="plus" size={14} />{t("adm.cost.addSku")}</button>
                  </form>
                )}
                {g.key === "order" && (
                  <form className="ord-edit-row adm-noprint" onSubmit={(e) => { e.preventDefault(); const name = newFixed.trim(); if (!name) return; add({ kind: "order_fixed", match_key: slug(name), label: name, amount: 0 }); setNewFixed(""); }}>
                    <input value={newFixed} placeholder={t("adm.cost.fixedPh")} onChange={(e) => setNewFixed(e.target.value)} />
                    <button className="btn-sm"><Icon name="plus" size={14} />{t("adm.cost.addFixed")}</button>
                  </form>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

/* ── Distribución por porcentajes + ganancia objetivo ───────────────────── */
function AllocationEditor({ data, onSaved, lang, go }) {
  const { t } = useLang();
  const { rules, dirty, busy, patch, add, remove, save } = useRulesDraft(data, onSaved);
  const [newName, setNewName] = useState("");
  const [newPct, setNewPct] = useState("");
  const ref = useRef(null);
  const alloc = rules.filter(isAllocationRule);
  const target = rules.find(isProfitTarget);
  const sumAlloc = alloc.filter((r) => r.active).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const targetPct = target && target.active ? Number(target.amount) || 0 : 0;
  // Ejemplo: 100 USD netos (ya descontados envío, impuestos y Stripe).
  const sampleRevenue = 100;
  const sample = alloc.filter((r) => r.active).map((r) => ({ key: r.id, label: r.label || r.match_key, amount: (sampleRevenue * (Number(r.amount) || 0)) / 100, group: "percent" }));
  const setTarget = (v) => {
    const n = Math.max(0, Math.min(100, Number(v) || 0));
    if (target) patch(target.id, { amount: n, active: true, unit: "percent" });
    else add({ kind: "order_percent", match_key: PROFIT_TARGET_KEY, label: t("adm.cost.profitTarget"), amount: n, unit: "percent", active: true });
  };
  const addAlloc = (name, p) => {
    const label = name.trim(); if (!label) return;
    add({ kind: "order_percent", match_key: slug(label), label, amount: Number(p) || 0, unit: "percent", active: true });
  };
  const free = 100 - sumAlloc - targetPct;

  return (
    <div ref={ref}>
      <div className="adm-head-row compact">
        <p className="muted" style={{ margin: 0, maxWidth: 820 }}>{t("adm.cost.allocIntro")}</p>
        <div className="adm-actions adm-noprint">
          <ExportMenu targetRef={ref} title={t("adm.cost.tab.allocation")} name="distribucion" compact={false} csv={{ cols: [[t("adm.cost.line"), (r) => r.label || r.match_key], ["%", "amount"], [t("adm.cost.active"), (r) => (r.active ? "1" : "0")]], rows: [...alloc, ...(target ? [target] : [])] }} />
          <button className="btn-sm primary" disabled={busy || !dirty.size} onClick={save}><Icon name="save" size={14} />{t("adm.cost.saveRules")}{dirty.size ? ` (${dirty.size})` : ""}</button>
        </div>
      </div>
      <div className="adm-grid-2 tight">
        <Card icon="percent" title={t("adm.cost.allocLines")} hint={t("adm.cost.allocLinesHint")} exportable={false} className="tight">
          <div className="cost-rules">
            {alloc.map((r) => (
              <div className={`cost-rule ${r.active ? "" : "off"}`} key={r.id}>
                <div className="cost-rule-name"><input className="adm-input" value={r.label || ""} onChange={(e) => patch(r.id, { label: e.target.value })} placeholder={t("adm.cost.linePh")} /></div>
                <NumInput value={r.amount} onCommit={(v) => patch(r.id, { amount: Number(v) || 0 })} step="0.1" max={100} />
                <span className="cost-unit">%</span>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <label className="adm-switch" title={t("adm.cost.active")}><input type="checkbox" checked={!!r.active} onChange={(e) => patch(r.id, { active: e.target.checked })} /></label>
                  <button type="button" className="btn-xs warn" onClick={() => remove(r)} title={t("adm.cost.remove")}><Icon name="trash" size={13} /></button>
                </div>
              </div>
            ))}
            {alloc.length === 0 && <div className="adm-nodata">{t("adm.cost.noAlloc")}</div>}
          </div>
          <form className="ord-edit-row adm-noprint" onSubmit={(e) => { e.preventDefault(); addAlloc(newName, newPct); setNewName(""); setNewPct(""); }}>
            <input value={newName} placeholder={t("adm.cost.allocPh")} onChange={(e) => setNewName(e.target.value)} list="alloc-suggest" />
            <datalist id="alloc-suggest">{ALLOCATION_SUGGESTIONS.map((k) => <option key={k} value={t(`adm.cost.alloc.${k}`)} />)}</datalist>
            <input type="number" step="0.1" min="0" max="100" value={newPct} placeholder="%" style={{ maxWidth: 90 }} onChange={(e) => setNewPct(e.target.value)} />
            <button className="btn-sm"><Icon name="plus" size={14} />{t("adm.cost.addAlloc")}</button>
          </form>
          <div className="alloc-suggest adm-noprint">
            {ALLOCATION_SUGGESTIONS.filter((k) => !alloc.some((r) => r.match_key === slug(t(`adm.cost.alloc.${k}`)))).map((k) => (
              <button type="button" key={k} className="adm-chip neutral" onClick={() => addAlloc(t(`adm.cost.alloc.${k}`), 0)}><Icon name="plus" size={11} />{t(`adm.cost.alloc.${k}`)}</button>
            ))}
          </div>
        </Card>
        <div className="adm-stack">
          <Card icon="gauge" title={t("adm.cost.profitTarget")} hint={t("adm.cost.profitTargetHint")} exportable={false} className="tight">
            <div className="cost-rule" style={{ gridTemplateColumns: "1fr 110px 40px" }}>
              <div className="cost-rule-name"><b>{t("adm.cost.profitTargetLabel")}</b><small>{t("adm.cost.profitTargetSmall")}</small></div>
              <NumInput value={target ? target.amount : ""} onCommit={setTarget} step="0.5" max={100} placeholder="30" />
              <span className="cost-unit">%</span>
            </div>
            <div className={`alloc-sum ${free < 0 ? "bad" : ""}`}>
              <span>{t("adm.cost.allocSum", { alloc: pct(sumAlloc), target: pct(targetPct) })}</span>
              <b>{free < 0 ? t("adm.cost.allocOver", { pct: pct(-free) }) : t("adm.cost.allocFree", { pct: pct(free) })}</b>
            </div>
          </Card>
          <Card icon="layers" title={t("adm.cost.allocSample")} hint={t("adm.cost.allocSampleHint")} exportable={false} className="tight">
            <AllocationBar byKind={sample} revenue={sampleRevenue} targetAmount={targetPct ? sampleRevenue * targetPct / 100 : null} lang={lang} go={go || (() => {})} compact />
            <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>{t("adm.cost.allocSampleNote")}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Cascada del dinero de UN pedido: lo que pagó el cliente → se descuenta lo
 * que no es del dueño (envío, impuestos, Stripe) → ingreso neto → materiales,
 * partidas por porcentaje y comisión del vendedor → ganancia del dueño, frente
 * al objetivo (30 % del neto) y el precio que habría cubierto todo.
 */
function Waterfall({ sheet, lines, dirty, cur, lang }) {
  const { t } = useLang();
  const sum = (g) => lines.filter((l) => (l.group || "manual") === g).reduce((a, l) => a + (Number(l.amount) || 0) * (Number(l.qty) || 1), 0);
  const gross = Number(sheet.gross ?? sheet.revenue) || 0;
  // Con cambios sin guardar se recalcula en vivo desde las líneas; guardado, manda el servidor.
  const ded = dirty ? sum("deduction") : Number(sheet.deductions_total) || sum("deduction");
  const mat = dirty ? sum("material") + sum("manual") : Number(sheet.materials_total) || 0;
  const per = dirty ? sum("percent") : Number(sheet.percent_total) || 0;
  const sel = dirty ? sum("seller") : Number(sheet.commission_total) || 0;
  const net = sheet.manual && !dirty ? Number(sheet.net_base) || gross - ded : gross - ded;
  const profit = gross - ded - mat - per - sel;
  const tp = sheet.profit_target_pct;
  const target = tp == null ? null : (net * tp) / 100;
  const gap = target == null ? null : profit - target;
  const row = (cls, icon, label, value, sub) => (
    <div className={`wf-row ${cls}`}><span className="wf-l"><Icon name={icon} size={14} />{label}{sub && <small className="muted"> · {sub}</small>}</span><b className="wf-v num">{value}</b></div>
  );
  return (
    <div className="wf">
      {row("gross", "dollar", t("adm.cost.wf.gross"), fmtMoney(gross, cur, lang))}
      {row("minus", "truck", t("adm.cost.wf.deductions"), `− ${fmtMoney(ded, cur, lang)}`, t("adm.cost.wf.deductionsSub"))}
      {row("net", "wallet", t("adm.cost.wf.net"), fmtMoney(net, cur, lang), t("adm.cost.wf.netSub"))}
      {row("minus", "glasses", t("adm.cost.wf.materials"), `− ${fmtMoney(mat, cur, lang)}`)}
      {row("minus", "percent", t("adm.cost.wf.percent"), `− ${fmtMoney(per, cur, lang)}`, net > 0 ? pct((per / net) * 100) + " " + t("adm.cost.ofNetShort") : undefined)}
      {sel > 0 && row("minus", "sellers", t("adm.cost.wf.seller"), `− ${fmtMoney(sel, cur, lang)}`, net > 0 ? pct((sel / net) * 100) + " " + t("adm.cost.ofNetShort") : undefined)}
      {row(`profit ${gap == null ? "" : gap >= 0 ? "good" : "bad"}`, "trendUp", t("adm.cost.wf.profit"), fmtMoney(profit, cur, lang), net > 0 ? pct((profit / net) * 100) + " " + t("adm.cost.ofNetShort") : undefined)}
      {target != null && (
        <div className={`alloc-sum ${gap >= 0 ? "good" : "bad"}`}>
          <span>{t("adm.cost.targetLine", { pct: tp })} = {fmtMoney(target, cur, lang)}</span>
          <b>{gap >= 0 ? t("adm.cost.aboveTarget", { v: fmtMoney(gap, cur, lang) }) : t("adm.cost.belowTargetBy", { v: fmtMoney(-gap, cur, lang) })}</b>
        </div>
      )}
      {sheet.suggested_price != null && !dirty && (
        <div className="wf-suggest">
          <span><Icon name="sparkles" size={14} />{t("adm.cost.suggestedFull", { pct: tp })}</span>
          <b>{fmtMoney(sheet.suggested_price, cur, lang)}</b>
          <small className={sheet.suggested_delta > 0 ? "bad" : "good"}>{sheet.suggested_delta > 0 ? "+" : ""}{fmtMoney(sheet.suggested_delta, cur, lang)} {t("adm.cost.vsPaid")}</small>
          <small className="muted">{t("adm.cost.suggestedNote")}</small>
        </div>
      )}
    </div>
  );
}

/* ── Ficha de un pedido (editable) ──────────────────────────────────────── */
export function OrderCostSheet({ orderId, onClose, onChanged, go }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [sheet, setSheet] = useState(null);
  const [lines, setLines] = useState([]);
  const [state, setState] = useState("loading");
  const [dirty, setDirty] = useState(false);
  const ref = useRef(null);
  const load = () => {
    setState("loading");
    fetchOrderCost(orderId).then((s) => { setSheet(s); setLines(s.lines || []); setDirty(false); setState("ok"); }).catch(() => setState("error"));
  };
  useEffect(load, [orderId]);

  const total = useMemo(() => lines.reduce((a, l) => a + (Number(l.amount) || 0) * (Number(l.qty) || 1), 0), [lines]);
  const revenue = Number(sheet?.gross ?? sheet?.revenue) || 0;
  const cur = sheet?.currency_code || "usd";
  const byKind = useMemo(() => lines.map((l, i) => ({ key: `${l.key}-${i}`, label: l.label, amount: (Number(l.amount) || 0) * (Number(l.qty) || 1), kind: l.kind, group: l.group })), [lines]);

  const setLine = (i, p) => { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l))); setDirty(true); };
  const addLine = () => { setLines((ls) => [...ls, { key: `manual_${Date.now()}`, label: "", amount: 0, qty: 1, source: "manual", kind: "manual" }]); setDirty(true); };
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
  const title = t("adm.cost.sheetFor", { order: sheet?.display_id ? `#${sheet.display_id}` : "…" });

  return (
    <div className="adm-card cost-sheet" style={{ borderColor: "#c9dcf8" }} ref={ref}>
      <div className="adm-card-head">
        <h3 className={go ? "go" : ""} onClick={go ? () => go("orders", { order: orderId }) : undefined} title={go ? t("adm.exec.openOrder") : undefined}><Icon name="receipt" size={16} />{title}{sheet?.manual && <span className="adm-chip gold"><Icon name="edit" size={12} />{t("adm.cost.manual")}</span>}{go && <Icon name="arrowUpRight" size={14} className="adm-go-ico" />}</h3>
        <span className="adm-card-tools">
          <InfoTip text={t("adm.cost.sheetHint")} title={title} />
          <ExportMenu targetRef={ref} title={title} name={`ficha-${sheet?.display_id || "pedido"}`} csv={{ cols: [[t("adm.cost.line"), "label"], [t("adm.cost.amount"), "amount"], [t("adm.cost.qty"), "qty"], [t("adm.cost.subtotal"), (l) => ((Number(l.amount) || 0) * (Number(l.qty) || 1)).toFixed(2)]], rows: lines }} />
          {sheet?.manual && <button className="btn-xs adm-noprint" onClick={reset}><Icon name="rotate" size={13} />{t("adm.cost.resetToRules")}</button>}
          <button className="btn-xs primary adm-noprint" disabled={!dirty} onClick={save}><Icon name="save" size={13} />{t("adm.cost.saveSheet")}</button>
          {onClose && <button className="adm-mini adm-noprint" onClick={onClose} title={t("adm.nav.close")}><Icon name="close" size={14} /></button>}
        </span>
      </div>
      {state === "loading" && <div className="adm-skel-rows"><div className="adm-skel" /><div className="adm-skel" /><div className="adm-skel" /></div>}
      {state === "error" && <div className="adm-login-err">{t("adm.err.cost.loadFailed")}</div>}
      {state === "ok" && (
        <div className="cost-sheet-grid">
          <div>
            <div className="cost-line head"><span>{t("adm.cost.line")}</span><span>{t("adm.cost.amount")}</span><span>{t("adm.cost.qty")}</span><span className="r">{t("adm.cost.subtotal")}</span><span /></div>
            {lines.map((l, i) => (
              <div className={`cost-line ${l.source === "manual" ? "manual" : ""}`} key={l.key + i}>
                <span className="cost-line-name">
                  {l.source === "manual" ? <input className="adm-input" value={l.label} placeholder={t("adm.cost.linePh")} onChange={(e) => setLine(i, { label: e.target.value })} style={{ width: "100%" }} /> : <>{l.label}<small className="muted"> · {l.kind === "order_percent" && l.group === "percent" ? t("adm.cost.kind.order_percent_net") : t(`adm.cost.kind.${l.kind || "manual"}`) !== `adm.cost.kind.${l.kind || "manual"}` ? t(`adm.cost.kind.${l.kind || "manual"}`) : t(`adm.cost.src.${l.source}`)}</small></>}
                </span>
                <NumInput value={l.amount} onCommit={(v) => setLine(i, { amount: Number(v) || 0 })} />
                <NumInput value={l.qty ?? 1} onCommit={(v) => setLine(i, { qty: Number(v) || 1 })} step="1" placeholder="1" />
                <span className="r num">{fmtMoney((Number(l.amount) || 0) * (Number(l.qty) || 1), cur, lang)}</span>
                <button type="button" className="btn-xs warn adm-noprint" onClick={() => removeLine(i)} title={t("adm.cost.remove")}><Icon name="trash" size={13} /></button>
              </div>
            ))}
            <div className="ord-edit-row adm-noprint"><button type="button" className="btn-sm" onClick={addLine}><Icon name="plus" size={14} />{t("adm.cost.addLine")}</button></div>
            <div className="cost-line total"><span>{t("adm.cost.cost")}</span><span /><span /><span className="r num">{fmtMoney(total, cur, lang)}</span><span /></div>
          </div>
          <div>
            <Waterfall sheet={sheet} lines={lines} dirty={dirty} cur={cur} lang={lang} />
            <b style={{ display: "block", margin: "10px 0 6px", fontSize: 13 }}>{t("adm.cost.allocation")}</b>
            <AllocationBar byKind={byKind} revenue={revenue} targetAmount={sheet.profit_target_amount} lang={lang} go={go || (() => {})} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Rentabilidad del período ───────────────────────────────────────────── */
function Profitability({ sellers, focusOrder, go }) {
  const { t, lang } = useLang();
  const [range, setRange] = useState(focusOrder ? "all" : "30d");
  const [seller, setSeller] = useState("");
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [sort, setSort] = useState(["created_at", -1]);
  const [open, setOpen] = useState(focusOrder || "");
  const [q, setQ] = useState("");
  const tableRef = useRef(null);
  const load = () => {
    setState("loading");
    fetchCostSummary({ from: rangeFrom(range), seller }).then((d) => { setData(d); setState("ok"); }).catch(() => setState("error"));
  };
  useEffect(load, [range, seller]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const csvCols = [[t("adm.col.order"), "display_id"], [t("adm.col.date"), (o) => shortDate(o.created_at, lang)], [t("adm.ord.colCustomer"), "customer_name"], [t("adm.ord.seller"), "seller_code"], [t("adm.cost.gross"), "gross"], [t("adm.cost.netBase"), "net_base"], [t("adm.cost.cost"), "cost_total"], [t("adm.cost.ownerProfit"), "margin"], [t("adm.cost.pctNet"), "profit_pct_net"], [t("adm.cost.suggested"), "suggested_price"]];

  return (
    <>
      <div className="adm-head-row compact">
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
            <button type="button" className="cost-kpi" onClick={() => go?.("orders", { preset: "all" })}><small><Icon name="orders" size={13} />{t("adm.kpi.orders")}</small><b>{tot.orders ?? 0}</b></button>
            <button type="button" className="cost-kpi" onClick={() => go?.("exec", { sub: "sales" })}><small><Icon name="dollar" size={13} />{t("adm.cost.gross")}</small><b>{fmtMoney(tot.gross ?? tot.revenue, cur, lang)}</b><em>{t("adm.cost.netBase")}: {fmtMoney(tot.net_base, cur, lang)}</em></button>
            <button type="button" className="cost-kpi bad" onClick={() => go?.("costs", { sub: "rules" })}><small><Icon name="receipt" size={13} />{t("adm.cost.cost")}</small><b>{fmtMoney(tot.cost, cur, lang)}</b><em>{t("adm.cost.deductionsSub", { v: fmtMoney(tot.deductions, cur, lang) })}</em></button>
            <button type="button" className={`cost-kpi ${tot.profit_gap == null ? (marginTone(tot.margin_pct) === "bad" ? "bad" : "good") : tot.profit_gap >= 0 ? "good" : "bad"}`} onClick={() => go?.("exec", { sub: "costs" })}><small><Icon name="trendUp" size={13} />{t("adm.cost.ownerProfit")}</small><b>{fmtMoney(tot.profit ?? tot.margin, cur, lang)}</b><em>{t("adm.cost.ofNet", { pct: pct(tot.profit_pct_net) })}</em></button>
            <button type="button" className={`cost-kpi ${tot.profit_target_pct == null ? "" : tot.profit_gap >= 0 ? "good" : "bad"}`} onClick={() => go?.("costs", { sub: "allocation" })}><small><Icon name="gauge" size={13} />{t("adm.cost.target")}</small><b>{tot.profit_target_pct == null ? "—" : `${pct(tot.profit_target_pct)} · ${fmtMoney(tot.profit_target_amount, cur, lang)}`}</b><em>{tot.profit_target_pct == null ? t("adm.cost.noTargetShort") : t("adm.cost.gap", { v: fmtMoney(tot.profit_gap, cur, lang) })}</em></button>
            <button type="button" className={`cost-kpi ${undefinedOrders ? "bad" : "good"}`} onClick={() => go?.("costs", { sub: "rules" })}><small><Icon name="alert" size={13} />{t("adm.cost.incomplete")}</small><b>{undefinedOrders}</b><em>{t("adm.cost.incompleteHint")}</em></button>
          </div>
          {data.truncated && <div className="adm-find-note muted">{t("adm.ord.truncated", { n: 300 })}</div>}
          {open && <div style={{ marginBottom: 14 }}><OrderCostSheet orderId={open} onClose={() => setOpen("")} onChanged={load} go={go} /></div>}
          <Card icon="sales" title={t("adm.cost.byOrder")} hint={t("adm.cost.byOrderHint")} name="rentabilidad" csv={{ cols: csvCols, rows }} className="tight">
            <div className="adm-table-wrap" ref={tableRef}>
              <table className="adm-table responsive">
                <thead><tr>{th("display_id", t("adm.col.order"))}{th("created_at", t("adm.col.date"))}{th("customer_name", t("adm.ord.colCustomer"))}{th("seller_code", t("adm.ord.seller"))}{th("gross", t("adm.cost.gross"), "r")}{th("net_base", t("adm.cost.netBase"), "r")}{th("cost_total", t("adm.cost.cost"), "r")}{th("margin", t("adm.cost.ownerProfit"), "r")}{th("profit_pct_net", t("adm.cost.pctNet"), "r")}{th("suggested_price", t("adm.cost.suggested"), "r")}<th /></tr></thead>
                <tbody>
                  {rows.length === 0 ? <tr><td colSpan="11" className="full"><div className="adm-empty"><Icon name="costs" size={36} /><b>{t("adm.cost.noOrders")}</b></div></td></tr> : rows.map((o) => (
                    <tr key={o.id} className={`ord-row ${open === o.id ? "open" : ""}`} onClick={() => setOpen(open === o.id ? "" : o.id)}>
                      <td data-label={t("adm.col.order")}><b>#{o.display_id}</b>{o.manual && <span className="adm-chip gold" style={{ marginLeft: 6, fontSize: 10.5 }}><Icon name="edit" size={11} /></span>}{o.undefined_costs > 0 && <span className="adm-chip warn" style={{ marginLeft: 6, fontSize: 10.5 }} title={t("adm.cost.incompleteHint")}><Icon name="alert" size={11} />{o.undefined_costs}</span>}</td>
                      <td data-label={t("adm.col.date")}>{shortDate(o.created_at, lang)}</td>
                      <td data-label={t("adm.ord.colCustomer")}>{o.customer_name || "—"}</td>
                      <td data-label={t("adm.ord.seller")}>{o.seller_code || "—"}</td>
                      <td data-label={t("adm.cost.gross")} className="r num">{fmtMoney(o.gross ?? o.revenue, cur, lang)}</td>
                      <td data-label={t("adm.cost.netBase")} className="r num muted">{fmtMoney(o.net_base, cur, lang)}</td>
                      <td data-label={t("adm.cost.cost")} className="r num">{fmtMoney(o.cost_total, cur, lang)}</td>
                      <td data-label={t("adm.cost.ownerProfit")} className="r num">{fmtMoney(o.margin, cur, lang)}</td>
                      <td data-label={t("adm.cost.pctNet")} className="r"><span className={`margin-pct ${o.profit_gap == null ? marginTone(o.margin_pct) : o.profit_gap >= 0 ? "good" : "bad"}`}>{pct(o.profit_pct_net)}</span></td>
                      <td data-label={t("adm.cost.suggested")} className="r num">{o.suggested_price == null ? "—" : <span title={t("adm.cost.suggestedHint")}>{fmtMoney(o.suggested_price, cur, lang)} <small className={o.suggested_delta > 0 ? "bad" : "good"}>({o.suggested_delta > 0 ? "+" : ""}{fmtMoney(o.suggested_delta, cur, lang)})</small></span>}</td>
                      <td className="r"><Icon name={open === o.id ? "chevronUp" : "chevronDown"} size={14} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="adm-grid-2 tight" style={{ marginTop: 14 }}>
            <Card icon="layers" title={t("adm.cost.byKind")} hint={t("adm.cost.h.topConcepts")} name="conceptos" csv={{ cols: [[t("adm.cost.line"), "label"], [t("adm.cost.amount"), "amount"]], rows: data.by_kind || [] }} className="tight">
              {(data.by_kind || []).length === 0 ? <div className="adm-nodata">{t("adm.chart.noData")}</div> : (
                <div className="adm-thumbbars tight">
                  {data.by_kind.slice().sort((a, b) => b.amount - a.amount).map((k) => {
                    const max = Math.max(...data.by_kind.map((x) => x.amount), 1);
                    return (
                      <div className="adm-tb-row clickable" key={k.key || k.kind} onClick={() => go?.("costs", { sub: k.kind === "order_percent" ? "allocation" : "rules" })}>
                        <div className="adm-tb-main">
                          <div className="adm-tb-top"><span className="adm-tb-name">{k.label || k.kind}</span><b>{fmtMoney(k.amount, cur, lang)}</b></div>
                          <div className="adm-tb-track"><div className="adm-tb-fill" style={{ width: `${(k.amount / max) * 100}%` }} /></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            <Card icon="layers" title={t("adm.cost.allocation")} hint={t("adm.cost.allocationHint")} name="reparto" className="tight" onGo={() => go?.("costs", { sub: "allocation" })} goLabel={t("adm.cost.tab.allocation")}>
              <AllocationBar byKind={data.by_kind} revenue={tot.gross ?? tot.revenue} targetAmount={tot.profit_target_amount} lang={lang} go={go || (() => {})} />
              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "10px 0 0" }}>{t("adm.cost.howBody")}</p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

const SUBS = ["profit", "rules", "allocation", "prices"];

export default function Costs({ params = {}, sellers = [], go, onSub, pricesView }) {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const [view, setView] = useState(SUBS.includes(params.sub) ? params.sub : "profit");
  const [rulesData, setRulesData] = useState(null);
  const [rulesState, setRulesState] = useState("loading");
  const ref = useRef(null);
  const loadRules = () => { if (demo) return; setRulesState("loading"); fetchCostRules().then((d) => { setRulesData(d); setRulesState("ok"); }).catch(() => setRulesState("error")); };
  useEffect(loadRules, [demo]);
  useEffect(() => { if (SUBS.includes(params.sub)) setView(params.sub); }, [params.sub]);
  const items = [
    { key: "profit", icon: "trendUp", label: t("adm.cost.tab.profit") },
    { key: "rules", icon: "clipboard", label: t("adm.cost.tab.rules") },
    { key: "allocation", icon: "percent", label: t("adm.cost.tab.allocation") },
    { key: "prices", icon: "prices", label: t("adm.tab.prices") },
  ];
  const rulesBody = rulesState === "loading" ? <div className="adm-src-note loading">{t("adm.real.loading")}</div> : rulesState === "error" ? <div className="adm-login-err">{t("adm.err.cost.loadFailed")}</div> : null;

  return (
    <div className="adm-section">
      <div className="adm-head-row compact">
        <h2>{t("adm.tab.costs")}</h2>
        <ExportMenu targetRef={ref} title={`${t("adm.tab.costs")} · ${items.find((i) => i.key === view)?.label || ""}`} name={`costos-${view}`} compact={false} />
      </div>
      <p className="adm-sub">{t("adm.cost.intro")}</p>
      {demo && <div className="adm-demo-banner">{t("adm.sec.demoNote")}</div>}
      <SubTabs items={items} value={view} onChange={(k) => { setView(k); onSub?.(k); }} />
      <div ref={ref}>
        {!demo && view === "profit" && <Profitability sellers={sellers} focusOrder={params.order} go={go} />}
        {!demo && view === "rules" && (rulesBody || <RulesEditor data={rulesData} onSaved={loadRules} />)}
        {!demo && view === "allocation" && (rulesBody || <AllocationEditor data={rulesData} onSaved={loadRules} lang={lang} go={go} />)}
        {view === "prices" && pricesView}
      </div>
    </div>
  );
}
