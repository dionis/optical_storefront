// Dónde se usa: «Productos y precios» → «Reglas y comisiones» (PricingPanel.jsx).
// Desde el 7-nov-2026 los costos de la tienda y los impuestos van en
// ACORDEONES en una sola vista, como pidió el dueño: «Costos fijos de tienda»,
// «Costos variables», «Costos compartidos», «Costos por venta» e «Impuestos».
// Cada partida se edita en su fila (nombre, tienda, importe, frecuencia,
// categoría fiscal, «se cobra en cada venta», activo), se añade con «+», se
// borra con confirmación (borrado lógico: queda en el historial) y apagarla la
// guarda pero la saca de todas las cifras. La frecuencia (diaria … única) se
// normaliza a un mes en la columna «Mensual» y alimenta el estado de
// resultados (FinancialStatement.jsx). Datos: GET /admin/finance/rules.
//
// «Costos por venta» junta lo que se cobra en CADA venta: las partidas de la
// tienda marcadas «se cobra en cada venta» (importe × ventas del mes) y las
// reglas de la ficha de costo (laboratorio, empaque, comisión del cobro…), con
// su «Se cobra» por tienda cuando hay una tienda elegida arriba.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { useFeedback } from "../../components/Feedback.jsx";
import { money } from "../adminOrders.js";
import HelpTip from "../HelpTip.jsx";
import Icon from "../icons.jsx";
import FinAcc from "../finance/Accordion.jsx";
import { deleteCostItem, deleteCostRule, saveCostItem, saveCostRule, saveSalesTax, toggleRuleInStore } from "../finance/financeApi.js";
import { blankItem, FREQUENCIES, groupOf, monthlyOf, round2, RULE_KINDS, slugOf, sumBy, TAX_CATEGORIES, TAX_DEFAULT_CATEGORY, taxOf } from "../finance/model.js";

const ICONS = { fixed: "store", variable: "trendUp", shared: "layers", perSale: "receipt", taxes: "clipboard" };
/** Categorías que se ofrecen en cada acordeón (todas valen en todos; estas van primero). */
const TAX_FIRST = { taxes: ["taxes_licenses", "payroll_taxes"] };

const sameRow = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const editable = (it) => ({
  id: it.id ?? null,
  establishment_id: it.establishment_id ?? null,
  kind: it.kind,
  category: it.category,
  tax_category: taxOf(it),
  description: it.description ?? "",
  amount: it.amount === "" ? "" : String(it.amount ?? ""),
  frequency: it.frequency || "monthly",
  amortize_months: it.amortize_months ?? "",
  starts_on: it.starts_on || "",
  ends_on: it.ends_on || "",
  vendor: it.vendor || "",
  notes: it.notes || "",
  active: it.active !== false,
  per_sale: it.per_sale === true,
  allocation: it.allocation ?? (it.establishment_id ? null : { method: "sales" }),
});

function Toggle({ on, label, disabled, onChange, className = "" }) {
  return (
    <label className={`fin-tog ${on ? "on" : ""} ${className}`} title={label}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span aria-hidden="true" />
    </label>
  );
}

/** Una partida de costo, editable en su fila. */
function CostRow({ item, group, stores, salesCount, chainSales, canShare, onSaved, onError, onCancelNew }) {
  const { t, lang } = useLang();
  const { confirm } = useFeedback();
  const start = useMemo(() => editable(item), [item]);
  const [row, setRow] = useState(start);
  const [more, setMore] = useState(!item.id);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRow(start), [start]);
  const dirty = !item.id || !sameRow(row, start);
  const set = (k, v) => setRow((r) => ({ ...r, [k]: v }));
  const m = (v) => money(Number(v) || 0, "usd", lang);
  const storeOf = (id) => stores.find((s) => s.id === id);
  const sales = row.per_sale ? (row.establishment_id ? salesCount[row.establishment_id] ?? 0 : chainSales) : null;
  const monthly = monthlyOf(row, sales);

  const persist = async (next) => {
    if (busy) return;
    if (!String(next.amount).trim() || !Number.isFinite(Number(next.amount))) return onError("adm.err.fin.bad_amount");
    setBusy(true);
    try {
      await saveCostItem(next);
      onSaved();
    } catch (e) {
      onError(e.message);
      setRow(start);
    } finally {
      setBusy(false);
    }
  };
  // Los interruptores guardan al momento (en una fila ya guardada).
  const flip = (k, v) => {
    const next = { ...row, [k]: v };
    setRow(next);
    if (item.id && sameRow({ ...row, [k]: start[k] }, start)) persist(next);
  };
  const remove = async () => {
    if (!item.id) return onCancelNew?.();
    if (!(await confirm({ tone: "danger", title: t("adm.fin.del.title"), message: t("adm.fin.del.body", { name: row.description || t(`adm.fin.tax.${row.tax_category}`) }) }))) return;
    setBusy(true);
    try {
      await deleteCostItem(item.id);
      onSaved();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e) => {
    if (e.key === "Enter" && dirty) { e.preventDefault(); persist(row); }
    if (e.key === "Escape") { e.preventDefault(); if (item.id) setRow(start); else onCancelNew?.(); }
  };
  const cats = [...(TAX_FIRST[group] || []), ...TAX_CATEGORIES.filter((c) => !(TAX_FIRST[group] || []).includes(c))];
  const s = storeOf(row.establishment_id);

  return (
    <div className={`fin-row ${row.active ? "" : "is-off"} ${dirty ? "is-dirty" : ""} ${busy ? "is-busy" : ""}`} onKeyDown={onKey} role="row">
      <span className="fin-c name" role="cell">
        <input className="fin-in" value={row.description} placeholder={t(`adm.fin.tax.${row.tax_category}`)} maxLength={160} aria-label={t("adm.fin.col.name")} onChange={(e) => set("description", e.target.value)} />
      </span>
      <span className="fin-c store" role="cell" data-label={t("adm.fin.col.store")}>
        <select className="fin-in" value={row.establishment_id || ""} aria-label={t("adm.fin.col.store")}
          onChange={(e) => setRow((r) => ({ ...r, establishment_id: e.target.value || null, allocation: e.target.value ? null : r.allocation || { method: "sales" } }))}>
          {canShare && <option value="">{t("adm.fin.shared")}</option>}
          {stores.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
        </select>
        {s && <span className="fin-dot" style={{ background: s.color || "var(--adm-muted)" }} aria-hidden="true" />}
      </span>
      <span className="fin-c amount" role="cell" data-label={t("adm.fin.col.amount")}>
        <input className="fin-in num" inputMode="decimal" value={row.amount} placeholder="0.00" aria-label={t("adm.fin.col.amount")} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} />
      </span>
      <span className="fin-c freq" role="cell" data-label={t("adm.fin.col.freq")}>
        {row.per_sale ? (
          <span className="fin-chip">{t("adm.fin.freq.per_sale")}</span>
        ) : (
          <select className="fin-in" value={row.frequency} aria-label={t("adm.fin.col.freq")} onChange={(e) => set("frequency", e.target.value)}>
            {FREQUENCIES.map((f) => <option key={f} value={f}>{t(`adm.fin.freq.${f}`)}</option>)}
          </select>
        )}
      </span>
      <span className="fin-c cat" role="cell" data-label={t("adm.fin.col.cat")}>
        <select className="fin-in" value={row.tax_category} aria-label={t("adm.fin.col.cat")}
          onChange={(e) => setRow((r) => ({ ...r, tax_category: e.target.value, category: TAX_DEFAULT_CATEGORY[e.target.value] }))}>
          {cats.map((c) => <option key={c} value={c}>{t(`adm.fin.tax.${c}`)}</option>)}
        </select>
      </span>
      <span className="fin-c monthly num" role="cell" data-label={t("adm.fin.col.monthly")} title={row.per_sale ? t("adm.fin.perSaleMonthly", { n: sales ?? 0 }) : undefined}>
        {m(monthly)}
      </span>
      <span className="fin-c flag" role="cell" data-label={t("adm.fin.col.perSale")}>
        <Toggle on={row.per_sale} label={t("adm.fin.col.perSaleLong")} disabled={busy} onChange={(v) => flip("per_sale", v)} className="sq" />
      </span>
      <span className="fin-c flag" role="cell" data-label={t("adm.fin.col.active")}>
        <Toggle on={row.active} label={row.active ? t("adm.fin.on") : t("adm.fin.off")} disabled={busy} onChange={(v) => flip("active", v)} />
      </span>
      <span className="fin-c acts" role="cell">
        <button type="button" className={`fin-ib ${more ? "on" : ""}`} onClick={() => setMore((v) => !v)} aria-expanded={more} title={t("adm.fin.more")} aria-label={t("adm.fin.more")}><Icon name="moreH" size={13} /></button>
        {dirty && <button type="button" className="fin-ib ok" disabled={busy} onClick={() => persist(row)} title={t("adm.fin.save")} aria-label={t("adm.fin.save")}><Icon name="check" size={13} /></button>}
        {dirty && item.id && <button type="button" className="fin-ib" disabled={busy} onClick={() => setRow(start)} title={t("adm.fin.undo")} aria-label={t("adm.fin.undo")}><Icon name="undo" size={13} /></button>}
        <button type="button" className="fin-ib warn" disabled={busy} onClick={remove} title={item.id ? t("adm.fin.delete") : t("adm.fin.cancel")} aria-label={item.id ? t("adm.fin.delete") : t("adm.fin.cancel")}><Icon name={item.id ? "trash" : "close"} size={13} /></button>
      </span>
      {more && (
        <div className="fin-more" role="cell">
          <label>{t("adm.fin.f.starts")}<input type="date" className="fin-in" value={row.starts_on} onChange={(e) => set("starts_on", e.target.value)} /></label>
          <label>{t("adm.fin.f.ends")}<input type="date" className="fin-in" value={row.ends_on} onChange={(e) => set("ends_on", e.target.value)} /></label>
          {row.frequency === "one_time" && !row.per_sale && (
            <label>{t("adm.fin.f.amortize")}<HelpTip topic="fin.amortize" /><input type="number" min="1" max="120" className="fin-in num" value={row.amortize_months} onChange={(e) => set("amortize_months", e.target.value)} /></label>
          )}
          {!row.establishment_id && !row.per_sale && (
            <label>{t("adm.fin.f.alloc")}<HelpTip topic="fin.shared" />
              <select className="fin-in" value={row.allocation?.method === "percent" ? "percent" : "sales"} onChange={(e) => set("allocation", e.target.value === "percent" ? { method: "percent", shares: row.allocation?.shares || {} } : { method: "sales" })}>
                <option value="sales">{t("adm.fin.f.bySales")}</option>
                <option value="percent">{t("adm.fin.f.byPercent")}</option>
              </select>
            </label>
          )}
          {!row.establishment_id && !row.per_sale && row.allocation?.method === "percent" && stores.map((x) => (
            <label key={x.id} className="pct">{x.code}
              <input type="number" min="0" max="100" className="fin-in num" value={row.allocation.shares?.[x.id] ?? ""} onChange={(e) => set("allocation", { method: "percent", shares: { ...row.allocation.shares, [x.id]: e.target.value === "" ? undefined : Number(e.target.value) } })} /> %
            </label>
          ))}
          <label>{t("adm.fin.f.kind")}
            <select className="fin-in" value={row.kind} onChange={(e) => set("kind", e.target.value)} disabled={row.per_sale}>
              <option value="fixed">{t("adm.fin.kind.fixed")}</option>
              <option value="variable">{t("adm.fin.kind.variable")}</option>
            </select>
          </label>
          <label>{t("adm.fin.f.vendor")}<input className="fin-in" value={row.vendor} maxLength={120} onChange={(e) => set("vendor", e.target.value)} /></label>
          <label className="wide">{t("adm.fin.f.notes")}<input className="fin-in" value={row.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
      )}
    </div>
  );
}

function Head({ perSale }) {
  const { t } = useLang();
  return (
    <div className="fin-row fin-head" role="row">
      <span className="fin-c name" role="columnheader">{t("adm.fin.col.name")}</span>
      <span className="fin-c store" role="columnheader">{t("adm.fin.col.store")}</span>
      <span className="fin-c amount" role="columnheader">{perSale ? t("adm.fin.col.amountSale") : t("adm.fin.col.amount")}</span>
      <span className="fin-c freq" role="columnheader">{t("adm.fin.col.freq")}<HelpTip topic="fin.frequency" /></span>
      <span className="fin-c cat" role="columnheader">{t("adm.fin.col.cat")}<HelpTip topic="fin.taxCategory" /></span>
      <span className="fin-c monthly num" role="columnheader">{t("adm.fin.col.monthly")}<HelpTip topic="fin.monthly" /></span>
      <span className="fin-c flag" role="columnheader" title={t("adm.fin.col.perSaleLong")}>{t("adm.fin.col.perSale")}<HelpTip topic="fin.perSale" /></span>
      <span className="fin-c flag" role="columnheader">{t("adm.fin.col.active")}<HelpTip topic="fin.active" /></span>
      <span className="fin-c acts" role="columnheader" />
    </div>
  );
}

/** Las reglas de la ficha de costo que se cobran en cada venta (laboratorio, empaque, comisión del cobro…). */
function RuleTable({ rules, store, isStore, salesCount, onSaved, onError }) {
  const { t, lang } = useLang();
  const { confirm } = useFeedback();
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState(null);
  const [edits, setEdits] = useState({});
  const m = (v) => money(Number(v) || 0, "usd", lang);
  const run = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); onSaved(); } catch (e) { onError(e.message); } finally { setBusy(""); }
  };
  const save = (r, patch) => run(r.id, () => saveCostRule({ id: r.id, kind: r.kind, match_key: r.match_key, label: r.label, amount: r.amount, unit: r.unit, active: r.active, sort_order: r.sort_order ?? 0, notes: r.notes ?? null, ...patch }));
  const remove = async (r) => {
    if (!(await confirm({ tone: "danger", title: t("adm.fin.del.title"), message: t("adm.fin.del.ruleBody", { name: r.label }) }))) return;
    run(r.id, () => deleteCostRule(r.id));
  };
  const add = async () => {
    const label = String(draft.label || "").trim();
    if (!label || !Number.isFinite(Number(draft.amount))) return onError("adm.err.fin.bad_amount");
    await run("new", () => saveCostRule({ kind: draft.kind, match_key: slugOf(label), label, amount: Number(draft.amount), unit: draft.kind === "order_percent" ? "percent" : "fixed", active: true, sort_order: 50 }));
    setDraft(null);
  };
  const totalSales = Object.values(salesCount).reduce((a, b) => a + b, 0);
  return (
    <div className="fin-rules" role="table" aria-label={t("adm.fin.rules.title")}>
      <div className="fin-sub-h">
        <h4>{t("adm.fin.rules.title")}<HelpTip topic="fin.perSaleRules" /></h4>
        {!isStore && <small className="muted">{t("adm.fin.rules.storeHint")}</small>}
        <button type="button" className="btn-xs" onClick={() => setDraft({ kind: "order_fixed", label: "", amount: "" })} disabled={Boolean(draft)}><Icon name="plus" size={12} /> {t("adm.fin.rules.add")}</button>
      </div>
      {draft && (
        <div className="fin-rrow is-dirty">
          <input className="fin-in" autoFocus placeholder={t("adm.fin.rules.namePh")} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setDraft(null); }} />
          <select className="fin-in" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
            {RULE_KINDS.map((k) => <option key={k} value={k}>{t(`adm.fin.rk.${k}`)}</option>)}
          </select>
          <input className="fin-in num" inputMode="decimal" placeholder={draft.kind === "order_percent" ? "%" : "$"} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^\d.]/g, "") })} />
          <span />
          <span className="fin-c acts">
            <button type="button" className="fin-ib ok" onClick={add} disabled={busy === "new"} aria-label={t("adm.fin.save")} title={t("adm.fin.save")}><Icon name="check" size={13} /></button>
            <button type="button" className="fin-ib warn" onClick={() => setDraft(null)} aria-label={t("adm.fin.cancel")} title={t("adm.fin.cancel")}><Icon name="close" size={13} /></button>
          </span>
        </div>
      )}
      {rules.map((r) => {
        const val = edits[r.id] ?? String(r.amount);
        const changed = val !== String(r.amount);
        return (
          <div key={r.id} className={`fin-rrow ${r.active ? "" : "is-off"} ${busy === r.id ? "is-busy" : ""}`}>
            <span className="fin-c name"><b>{r.label}</b><small className="muted"> · {t(`adm.fin.rk.${r.kind}`)}</small></span>
            <span className="fin-c amount" data-label={t("adm.fin.col.amount")}>
              <input className="fin-in num" inputMode="decimal" value={val} aria-label={`${t("adm.fin.col.amount")} · ${r.label}`}
                onChange={(e) => setEdits((x) => ({ ...x, [r.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                onKeyDown={(e) => { if (e.key === "Enter" && changed) save(r, { amount: Number(val) }); if (e.key === "Escape") setEdits((x) => ({ ...x, [r.id]: String(r.amount) })); }} />
              <span className="fin-unit">{r.unit === "percent" ? "%" : "$"}</span>
            </span>
            <span className="fin-c monthly num muted" data-label={t("adm.fin.col.monthly")} title={t("adm.fin.rules.estHint")}>
              {r.kind === "order_fixed" ? m(round2(r.amount * totalSales)) : r.unit === "percent" ? t("adm.fin.rules.ofSale") : t("adm.fin.rules.perPayment")}
            </span>
            <span className="fin-c flag" data-label={t("adm.fin.col.active")}>
              <Toggle on={r.active} label={r.active ? t("adm.fin.on") : t("adm.fin.off")} disabled={busy === r.id} onChange={(v) => save(r, { active: v })} />
            </span>
            <span className="fin-c flag" data-label={t("adm.fin.rules.inStore")}>
              {isStore ? (
                <Toggle on={r.enabled} label={t("adm.fin.rules.inStoreLong")} disabled={busy === r.id || !r.active} className="sq" onChange={(v) => run(r.id, () => toggleRuleInStore({ refId: r.id, store, enabled: v }))} />
              ) : <span className="muted">—</span>}
            </span>
            <span className="fin-c acts">
              {changed && <button type="button" className="fin-ib ok" onClick={() => save(r, { amount: Number(val) })} aria-label={t("adm.fin.save")} title={t("adm.fin.save")}><Icon name="check" size={13} /></button>}
              <button type="button" className="fin-ib warn" onClick={() => remove(r)} aria-label={t("adm.fin.delete")} title={t("adm.fin.delete")}><Icon name="trash" size={13} /></button>
            </span>
          </div>
        );
      })}
      {!rules.length && <p className="fin-empty">{t("adm.fin.rules.empty")}</p>}
    </div>
  );
}

function SalesTaxRow({ taxes, onSaved, onError }) {
  const { t } = useLang();
  const [v, setV] = useState(String(taxes.rate_pct ?? 0));
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(String(taxes.rate_pct ?? 0)), [taxes.rate_pct]);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await saveSalesTax(v); onSaved(); } catch (err) { onError(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="fin-taxrate" onSubmit={save}>
      <label htmlFor="fin-tax-rate">{t("adm.fin.taxRate")}<HelpTip topic="fin.salesTax" /></label>
      <input id="fin-tax-rate" className="fin-in num" type="number" step="0.01" min="0" max="50" value={v} onChange={(e) => setV(e.target.value)} />
      <span className="fin-unit">%</span>
      {v !== String(taxes.rate_pct ?? 0) && <button className="btn-xs primary" disabled={busy}>{t("adm.fin.save")}</button>}
      {taxes.source !== "database" && <span className="pp-badge">{t("adm.price.costs.taxEnv")}</span>}
      <small className="muted">{t("adm.fin.taxRateHint")}</small>
    </form>
  );
}

/**
 * Los cinco acordeones de costos. `data` = GET /admin/finance/rules;
 * `scopeStore` = la tienda elegida arriba (null = todas: el maestro).
 */
export default function CostsAccordions({ data, scopeStore, open, onToggle, onSaved, onError }) {
  const { t, lang } = useLang();
  const [drafts, setDrafts] = useState({});
  const stores = useMemo(() => data.stores.filter((s) => s.is_active || data.items.some((i) => i.establishment_id === s.id)), [data]);
  const canShare = true;
  const chainSales = Object.values(data.sales_count || {}).reduce((a, b) => a + b, 0);
  const visible = useMemo(() => data.items.filter((it) => !scopeStore || !it.establishment_id || it.establishment_id === scopeStore), [data.items, scopeStore]);
  const byGroup = useMemo(() => {
    const out = { fixed: [], variable: [], shared: [], perSale: [], taxes: [] };
    for (const it of visible) out[groupOf(it)].push(it);
    for (const k of Object.keys(out)) out[k].sort((a, b) => (b.active !== false) - (a.active !== false) || (Number(b.monthly) || 0) - (Number(a.monthly) || 0));
    return out;
  }, [visible]);
  const storeCode = (id) => stores.find((s) => s.id === id) || data.stores.find((s) => s.id === id);
  const pnlStore = (id) => data.pnl?.stores?.find((s) => s.establishment_id === id);

  const splitOf = (list, group) => {
    const live = list.filter((i) => i.active !== false);
    if (group === "shared") {
      // El reparto REAL de este mes (por ventas o por %), del resultado de la tienda.
      return (data.pnl?.stores || []).filter((s) => !scopeStore || s.establishment_id === scopeStore).filter((s) => s.shared).map((s) => ({ code: s.code, color: storeCode(s.establishment_id)?.color, amount: s.shared }));
    }
    const m = sumBy(live.filter((i) => i.establishment_id), (i) => i.establishment_id, (i) => i.monthly);
    const rows = [...m.entries()].map(([id, amount]) => ({ code: storeCode(id)?.code || "…", color: storeCode(id)?.color, amount: round2(amount) }));
    const shared = live.filter((i) => !i.establishment_id).reduce((a, i) => a + (Number(i.monthly) || 0), 0);
    if (shared) rows.push({ code: t("adm.fin.sharedShort"), color: null, amount: round2(shared) });
    return rows;
  };
  const totalOf = (list) => round2(list.filter((i) => i.active !== false).reduce((a, i) => a + (Number(i.monthly) || 0), 0));
  const addDraft = (group) => setDrafts((d) => ({ ...d, [group]: blankItem(group, { storeId: scopeStore, firstStoreId: stores[0]?.id }) }));
  const savedDraft = (group) => { setDrafts((d) => ({ ...d, [group]: null })); onSaved(); };

  const body = (group) => (
    <div className="fin-table" role="table" aria-label={t(`adm.fin.acc.${group}`)}>
      <Head perSale={group === "perSale"} />
      {drafts[group] && (
        <CostRow key="new" item={drafts[group]} group={group} stores={stores} salesCount={data.sales_count || {}} chainSales={chainSales} canShare={canShare}
          onSaved={() => savedDraft(group)} onError={onError} onCancelNew={() => setDrafts((d) => ({ ...d, [group]: null }))} />
      )}
      {byGroup[group].map((it) => (
        <CostRow key={it.id} item={it} group={group} stores={stores} salesCount={data.sales_count || {}} chainSales={chainSales} canShare={canShare} onSaved={onSaved} onError={onError} />
      ))}
      {!byGroup[group].length && !drafts[group] && <p className="fin-empty">{t(`adm.fin.empty.${group}`)}</p>}
    </div>
  );
  const addBtn = (group) => (
    <button type="button" className="btn-xs" onClick={() => addDraft(group)} disabled={Boolean(drafts[group])} title={t("adm.fin.add")}>
      <Icon name="plus" size={12} /> <span className="fin-hide-s">{t("adm.fin.add")}</span>
    </button>
  );

  const rules = data.rules || [];
  const perSaleRulesTotal = rules.filter((r) => r.active && r.kind === "order_fixed").reduce((a, r) => a + r.amount * chainSales, 0);
  const pnlShown = (k) => (scopeStore ? Number(pnlStore(scopeStore)?.[k]) || 0 : Number(data.pnl?.total?.[k]) || 0);

  return (
    <>
      {["fixed", "variable", "shared"].map((g) => (
        <FinAcc key={g} id={g} icon={ICONS[g]} title={t(`adm.fin.acc.${g}`)} help={`fin.acc.${g}`} count={byGroup[g].length}
          total={totalOf(byGroup[g])} totalHelp="fin.monthly" split={splitOf(byGroup[g], g)} open={open.has(g)} onToggle={onToggle} actions={addBtn(g)}>
          {body(g)}
        </FinAcc>
      ))}
      <FinAcc id="perSale" icon={ICONS.perSale} title={t("adm.fin.acc.perSale")} help="fin.acc.perSale" count={byGroup.perSale.length + rules.length}
        total={round2(totalOf(byGroup.perSale) + perSaleRulesTotal)} totalHelp="fin.perSaleCost" split={splitOf(byGroup.perSale, "perSale")}
        open={open.has("perSale")} onToggle={onToggle} actions={addBtn("perSale")}>
        <p className="fin-note"><Icon name="info" size={12} /> {t("adm.fin.perSaleNote", { n: scopeStore ? data.sales_count?.[scopeStore] ?? 0 : chainSales, fees: money(pnlShown("payment_fees"), "usd", lang) })}</p>
        {body("perSale")}
        <RuleTable rules={rules} store={scopeStore || "all"} isStore={Boolean(scopeStore)} salesCount={scopeStore ? { [scopeStore]: data.sales_count?.[scopeStore] ?? 0 } : data.sales_count || {}} onSaved={onSaved} onError={onError} />
      </FinAcc>
      <FinAcc id="taxes" icon={ICONS.taxes} title={t("adm.fin.acc.taxes")} help="fin.acc.taxes" count={byGroup.taxes.length}
        total={totalOf(byGroup.taxes)} totalHelp="fin.monthly" split={splitOf(byGroup.taxes, "taxes")} open={open.has("taxes")} onToggle={onToggle} actions={addBtn("taxes")}>
        <SalesTaxRow taxes={data.taxes} onSaved={onSaved} onError={onError} />
        {body("taxes")}
      </FinAcc>
    </>
  );
}

