// Dónde se usa: pestaña «Resultado por tienda» de /admin (E13): costos fijos,
// variables y compartidos de cada tienda, el resultado del mes con el punto de
// equilibrio, las comisiones por vendedor y la liquidación con las tiendas que
// no son propias (HU-33, HU-34, HU-90 a HU-97). Con el privilegio «Ver costos»
// se lee; con «Gestionar costos» se edita.
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";
import { posContext } from "./posApi.js";

const CATEGORIES = ["rent", "maintenance", "utilities", "salaries", "insurance", "licenses", "subscriptions", "equipment", "supplies", "shipping", "repairs", "remakes", "accounting", "other"];
const FREQS = ["monthly", "quarterly", "annual", "one_time"];
const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : "adm.err.pos.generic");
const thisMonth = () => new Date().toISOString().slice(0, 7);
const EMPTY = { establishment_id: "", kind: "fixed", category: "rent", description: "", amount: "", frequency: "monthly", amortize_months: "", starts_on: `${thisMonth()}-01`, ends_on: "", vendor: "", notes: "", allocation: { method: "sales", shares: {} }, attachment: null };

const fileToDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });

export default function StoreCosts({ me }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [ctx, setCtx] = useState(null);
  const [month, setMonth] = useState(thisMonth());
  const [pnl, setPnl] = useState(null);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(null); // EMPTY or item being edited (with id)
  const canManage = !me || me.is_admin !== false || (me.privileges || []).includes("costs.manage");
  const isAdmin = !me || me.is_admin !== false;
  const m = (v) => (v === null || v === undefined ? "—" : money(v, "usd", lang));

  useEffect(() => { posContext().then(setCtx).catch(() => setCtx({ stores: [] })); }, []);
  const load = () => {
    adminFetch(`/admin/store-costs/pnl?month=${month}`).then(setPnl).catch(() => setPnl(null));
    adminFetch("/admin/store-costs").then((r) => setItems(r.items || [])).catch(() => setItems([]));
  };
  useEffect(load, [month]);

  const storeCode = (id) => (id ? ctx?.stores.find((s) => s.id === id)?.code || "…" : t("adm.costs2.shared"));
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

  const ROWS = [["net_sales", false], ["cogs", true], ["payment_fees", true], ["commissions", true], ["variable_manual", true], ["contribution", false], ["fixed", true], ["shared", true], ["result", false]];

  return (
    <div className="adm-section pos">
      <div className="adm-head-row">
        <h2>{t("adm.tab.storecosts")}</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("adm.costs2.month")} title={t("adm.costs2.month")} />
      </div>
      <p className="adm-sub">{t("adm.costs2.sub")}</p>
      {pnl?.cost_rules_missing && <div className="adm-demo-banner">{t("adm.costs2.noRules")}</div>}

      {pnl && (
        <div className="adm-card">
          <h3>{t("adm.costs2.pnlTitle")}</h3>
          <table className="adm-table responsive pnl">
            <thead><tr><th />{pnl.stores.map((s) => <th key={s.establishment_id}>{s.code}</th>)}<th>{t("adm.costs2.total")}</th></tr></thead>
            <tbody>
              {ROWS.map(([k, minus]) => (
                <tr key={k} className={["contribution", "result"].includes(k) ? "strong" : ""}>
                  <th scope="row">{minus ? "− " : k === "net_sales" ? "" : "= "}{t(`adm.costs2.row.${k}`)}</th>
                  {pnl.stores.map((s) => <td key={s.establishment_id} data-label={s.code} className={k === "result" && s.result < 0 ? "neg" : ""}>{m(s[k])}</td>)}
                  <td data-label={t("adm.costs2.total")} className={k === "result" && pnl.total.result < 0 ? "neg" : ""}>{m(pnl.total[k])}</td>
                </tr>
              ))}
              <tr><th scope="row">{t("adm.costs2.row.margin")}</th>{pnl.stores.map((s) => <td key={s.establishment_id} data-label={s.code}>{s.contribution_pct == null ? "—" : `${s.contribution_pct} %`}</td>)}<td data-label={t("adm.costs2.total")}>{pnl.total.contribution_pct == null ? "—" : `${pnl.total.contribution_pct} %`}</td></tr>
              <tr className="strong"><th scope="row">{t("adm.costs2.row.breakEven")}</th>{pnl.stores.map((s) => <td key={s.establishment_id} data-label={s.code}>{m(s.break_even)}</td>)}<td data-label={t("adm.costs2.total")}>{m(pnl.total.break_even)}</td></tr>
            </tbody>
          </table>
          <small className="muted">{t("adm.costs2.breakEvenHint")}</small>
        </div>
      )}

      {pnl?.stores.some((s) => s.settlement) && (
        <div className="adm-card">
          <h3>{t("adm.costs2.settlement")}</h3>
          <table className="adm-table responsive">
            <thead><tr><th>{t("adm.pos.store")}</th><th>{t("adm.costs2.row.net_sales")}</th><th>{t("adm.costs2.storeShare")}</th><th>{t("adm.costs2.ownerShare")}</th></tr></thead>
            <tbody>
              {pnl.stores.filter((s) => s.settlement).map((s) => (
                <tr key={s.establishment_id}>
                  <td data-label={t("adm.pos.store")}>{s.code} · {t(`adm.stores.kind.${s.kind}`)}</td>
                  <td data-label={t("adm.costs2.row.net_sales")}>{m(s.net_sales)}</td>
                  <td data-label={t("adm.costs2.storeShare")}>{m(s.settlement.store_share)} ({s.settlement.pct} %)</td>
                  <td data-label={t("adm.costs2.ownerShare")}><b>{m(s.settlement.owner_share)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pnl && pnl.sellers.length > 0 && (
        <div className="adm-card">
          <h3>{t("adm.costs2.commissions")}</h3>
          <table className="adm-table responsive">
            <thead><tr><th>{t("adm.pos.sales.seller")}</th><th>{t("adm.costs2.row.net_sales")}</th><th>%</th><th>{t("adm.costs2.row.commissions")}</th></tr></thead>
            <tbody>
              {pnl.sellers.map((s, i) => (
                <tr key={i}><td data-label={t("adm.pos.sales.seller")}>{s.seller_code || "—"}</td><td data-label={t("adm.costs2.row.net_sales")}>{m(s.net_sales)}</td><td data-label="%">{s.pct == null ? "—" : `${s.pct} %`}</td><td data-label={t("adm.costs2.row.commissions")}><b>{m(s.commission)}</b></td></tr>
              ))}
            </tbody>
          </table>
          <small className="muted">{t("adm.costs2.commissionHint")}</small>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-head-row">
          <h3>{t("adm.costs2.items")}</h3>
          {canManage && !form && <button type="button" className="btn-sm primary" onClick={() => setForm({ ...EMPTY, establishment_id: isAdmin ? "" : ctx?.stores[0]?.id || "" })}><Icon name="plus" size={14} /> {t("adm.costs2.add")}</button>}
        </div>
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
        <table className="adm-table responsive">
          <thead><tr><th>{t("adm.pos.store")}</th><th>{t("adm.costs2.category")}</th><th>{t("adm.pos.pay.amount")}</th><th>{t("adm.costs2.frequency")}</th><th>{t("adm.costs2.validity")}</th><th /></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td data-label={t("adm.pos.store")}>{storeCode(it.establishment_id)}</td>
                <td data-label={t("adm.costs2.category")}><b>{t(`adm.costs2.cat.${it.category}`)}</b> <small className="muted">· {t(`adm.costs2.kind.${it.kind}`)}{it.description ? ` · ${it.description}` : ""}</small></td>
                <td data-label={t("adm.pos.pay.amount")}>{m(it.amount)}</td>
                <td data-label={t("adm.costs2.frequency")}>{t(`adm.costs2.freq.${it.frequency}`)}</td>
                <td data-label={t("adm.costs2.validity")}>{it.starts_on}{it.ends_on ? ` → ${it.ends_on}` : ""}</td>
                <td>
                  <span className="pos-actions">
                    {it.attachment_url && <a className="btn-xs" href={it.attachment_url} target="_blank" rel="noreferrer"><Icon name="receipt" size={12} /></a>}
                    {canManage && <button type="button" className="btn-xs" onClick={() => setForm({ ...EMPTY, ...it, establishment_id: it.establishment_id || "", amount: String(it.amount), amortize_months: it.amortize_months ?? "", ends_on: it.ends_on || "", allocation: it.allocation || { method: "sales", shares: {} }, attachment: null })}><Icon name="edit" size={12} /></button>}
                    {canManage && <button type="button" className="btn-xs warn" onClick={() => remove(it)} aria-label={t("adm.pos.remove")} title={t("adm.pos.remove")}><Icon name="trash" size={12} /></button>}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan="6" className="full"><div className="adm-nodata">{t("adm.costs2.empty")}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
