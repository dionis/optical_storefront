// Dónde se usa: pestaña Vendedores de /admin — alta y gestión de vendedores,
// enlace de referido para redes sociales, enlace a su propio panel (/vendedor)
// y ventas/comisión por vendedor. Backend: /admin/sellers*.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { money as fmtMoney, shortDate, stageErrorText } from "./adminOrders.js";
import { fetchStores } from "./adminStores.js";
import { listTerminals } from "./posApi.js";
import { fetchSellers, createSeller, updateSeller, deleteSeller, rotateSellerLink, fetchSellerStats, copyText } from "./adminSellers.js";
import { TENANT } from "../config/tenant.js";
import Icon from "./icons.jsx";
import { SOURCE_ICON, SocialLinks } from "./sellerShared.jsx";
import { Card } from "./ui.jsx";

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const RANGES = ["30d", "90d", "ytd", "all"];
function rangeFrom(k) {
  if (k === "all") return "";
  if (k === "ytd") return `${new Date().getFullYear()}-01-01`;
  return ymd(Date.now() - ({ "30d": 30, "90d": 90 }[k] || 30) * 864e5);
}
const EMPTY = { name: "", email: "", phone: "", code: "", commission_pct: "10", notes: "", active: true, establishment_id: "", terminal_id: "", social: { instagram: "", facebook: "", tiktok: "", whatsapp: "" } };
// Un vendedor activo siempre tiene tienda y un único punto de venta de esa
// tienda; inactivo puede no tener ninguno. El servidor aplica la misma regla
// (sellerPlacementProblem); esto solo evita el viaje de ida y vuelta.
const placementMissing = (f) => (f.active ? (!f.establishment_id ? "store_required" : !f.terminal_id ? "terminal_required" : null) : null);
const termLabel = (x) => (x ? (x.name ? `${x.code} · ${x.name}` : x.code) : "");
const initials = (name) => String(name || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

function SellerForm({ initial = EMPTY, stores, terminals, onSubmit, onCancel, busy }) {
  const { t } = useLang();
  const [f, setF] = useState({ ...EMPTY, ...initial, establishment_id: initial.establishment_id || "", terminal_id: initial.terminal_id || "", social: { ...EMPTY.social, ...(initial.social || {}) }, commission_pct: String(initial.commission_pct ?? "10") });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setS = (k, v) => setF((x) => ({ ...x, social: { ...x.social, [k]: v } }));
  // Cambiar de tienda suelta el punto de venta: el anterior es de otra tienda.
  const setStore = (id) => setF((x) => {
    const own = terminals.filter((p) => p.establishment_id === id && p.is_active);
    return { ...x, establishment_id: id, terminal_id: own.length === 1 ? own[0].id : "" };
  });
  // Solo tiendas/puntos activos, salvo el que ya tenía (para que se vea qué hay que cambiar).
  const storeOpts = stores.filter((x) => x.is_active || x.id === f.establishment_id);
  const termOpts = terminals.filter((p) => p.establishment_id === f.establishment_id && (p.is_active || p.id === f.terminal_id));
  const missing = placementMissing(f);
  return (
    <form className="adm-card" onSubmit={(e) => { e.preventDefault(); if (missing) return; onSubmit({ ...f, establishment_id: f.establishment_id || null, terminal_id: f.terminal_id || null, commission_pct: Number(f.commission_pct) || 0, code: f.code.trim().toUpperCase() || undefined }); }}>
      <h3><Icon name={initial.id ? "edit" : "plus"} size={16} />{initial.id ? t("adm.sel.editTitle", { name: initial.name }) : t("adm.sel.newTitle")}</h3>
      <div className="adm-form-grid">
        <label className="adm-field">{t("adm.sel.name")}<input className="adm-input" required value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("adm.sel.namePh")} /></label>
        <label className="adm-field">{t("adm.sel.code")}<input className="adm-input" value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder={t("adm.sel.codePh")} maxLength={12} /></label>
        <label className="adm-field">{t("adm.sel.commission")}<input className="adm-input" type="number" min="0" max="100" step="0.5" value={f.commission_pct} onChange={(e) => set("commission_pct", e.target.value)} /></label>
        <label className="adm-field">{t("adm.login.email")}<input className="adm-input" type="email" value={f.email || ""} onChange={(e) => set("email", e.target.value)} /></label>
        <label className="adm-field">{t("adm.sel.phone")}<input className="adm-input" value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} /></label>
        <label className="adm-field">Instagram<input className="adm-input" value={f.social.instagram} onChange={(e) => setS("instagram", e.target.value)} placeholder="@usuario" /></label>
        <label className="adm-field">Facebook<input className="adm-input" value={f.social.facebook} onChange={(e) => setS("facebook", e.target.value)} /></label>
        <label className="adm-field">TikTok<input className="adm-input" value={f.social.tiktok} onChange={(e) => setS("tiktok", e.target.value)} placeholder="@usuario" /></label>
        <label className="adm-field">WhatsApp<input className="adm-input" value={f.social.whatsapp} onChange={(e) => setS("whatsapp", e.target.value)} placeholder="+1 …" /></label>
        <label className="adm-field">{t("adm.sel.status")}
          <select className="adm-input" value={f.active ? "1" : "0"} onChange={(e) => set("active", e.target.value === "1")}>
            <option value="1">{t("adm.sel.statusActive")}</option>
            <option value="0">{t("adm.sel.statusInactive")}</option>
          </select>
        </label>
        <label className="adm-field">{t("adm.sel.store")}{f.active && " *"}
          <select className="adm-input" required={f.active} value={f.establishment_id} onChange={(e) => setStore(e.target.value)}>
            <option value="">{t("adm.sel.storeNone")}</option>
            {storeOpts.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}{x.is_active ? "" : ` (${t("adm.sel.off")})`}</option>)}
          </select>
        </label>
        <label className="adm-field">{t("adm.pos.terminal")}{f.active && " *"}
          <select className="adm-input" required={f.active} disabled={!f.establishment_id} value={f.terminal_id} onChange={(e) => set("terminal_id", e.target.value)}>
            <option value="">{f.establishment_id && !termOpts.length ? t("adm.sel.terminalNoneInStore") : t("adm.sel.terminalNone")}</option>
            {termOpts.map((p) => <option key={p.id} value={p.id}>{termLabel(p)}{p.is_active ? "" : ` (${t("adm.sel.off")})`}</option>)}
          </select>
        </label>
        <label className="adm-field" style={{ gridColumn: "1 / -1" }}>{t("adm.sel.notes")}<input className="adm-input" value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} /></label>
      </div>
      <p className={missing ? "adm-login-err" : "muted"} style={{ fontSize: 12, margin: "10px 0 0" }}>{missing ? t(`adm.err.stage.${missing}`) : t("adm.sel.placementHint")}</p>
      <div className="adm-actions" style={{ marginTop: 12 }}>
        <button className="btn-sm primary" disabled={busy || !!missing}><Icon name="save" size={14} />{t("adm.sel.save")}</button>
        {onCancel && <button type="button" className="btn-sm" onClick={onCancel}>{t("adm.ord.cancel")}</button>}
      </div>
    </form>
  );
}

function SellerCard({ s, stat, lang, store, terminal, onEdit, onToggle, onDelete, onRotate }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const text = t("adm.sel.shareText", { name: TENANT.name });
  const copy = async (v, label) => { toast({ tone: (await copyText(v)) ? "success" : "error", title: label }); };
  return (
    <div className={`sel-card ${s.active ? "" : "off"}`}>
      <div className="sel-head">
        <span className="sel-avatar">{initials(s.name)}</span>
        <div className="sel-name"><b>{s.name}</b><small>{[s.email, s.phone].filter(Boolean).join(" · ") || t("adm.sel.noContact")}</small></div>
        <span className="sel-code" title={t("adm.sel.codeTitle")}>{s.code}</span>
      </div>
      <div className="sel-stats">
        <div className="sel-stat"><small>{t("adm.kpi.orders")}</small><b>{stat?.orders ?? 0}</b></div>
        <div className="sel-stat"><small>{t("adm.sel.sales")}</small><b>{fmtMoney(stat?.revenue ?? 0, "usd", lang)}</b></div>
        <div className="sel-stat"><small>{t("adm.sel.commissionShort", { pct: s.commission_pct })}</small><b>{fmtMoney(stat?.commission ?? 0, "usd", lang)}</b></div>
      </div>
      <small className="muted"><Icon name="store" size={12} /> {store ? `${store.code} · ${store.name}` : t("adm.sel.storeNone")}{terminal ? ` — ${termLabel(terminal)}` : s.establishment_id ? ` — ${t("adm.sel.terminalNone")}` : ""}</small>
      {!s.active && <span className="adm-chip bad"><Icon name="alert" size={12} />{t("adm.sel.inactive")}</span>}
      <div className="sel-link" title={s.referral_url}><Icon name="link" size={14} /><code>{s.referral_url}</code><button type="button" className="btn-xs" onClick={() => copy(s.referral_url, t("adm.sel.copied"))}><Icon name="copy" size={13} />{t("adm.sel.copy")}</button></div>
      <SocialLinks seller={s} text={text} stat={stat} onCopy={copy} />
      <div className="sel-link" title={s.dashboard_url}><Icon name="dashboard" size={14} /><code>{t("adm.sel.dashboardLink")}</code>
        <button type="button" className="btn-xs" onClick={() => copy(s.dashboard_url, t("adm.sel.copiedDash"))}><Icon name="copy" size={13} />{t("adm.sel.copy")}</button>
        <a className="btn-xs" href={s.dashboard_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={13} /></a>
      </div>
      <div className="sel-actions">
        <button type="button" className="btn-xs" onClick={() => onEdit(s)}><Icon name="edit" size={13} />{t("adm.sel.edit")}</button>
        <button type="button" className="btn-xs" onClick={() => onToggle(s)}><Icon name={s.active ? "lock" : "check"} size={13} />{s.active ? t("adm.sel.deactivate") : t("adm.sel.activate")}</button>
        <button type="button" className="btn-xs" onClick={() => onRotate(s)} title={t("adm.sel.rotateHint")}><Icon name="rotate" size={13} />{t("adm.sel.rotate")}</button>
        <button type="button" className="btn-xs warn" onClick={() => onDelete(s)}><Icon name="trash" size={13} />{t("adm.sel.delete")}</button>
      </div>
      {stat?.last_order_at && <small className="muted">{t("adm.sel.lastOrder", { date: shortDate(stat.last_order_at, lang) })}</small>}
    </div>
  );
}

export default function Sellers({ onChanged, go }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const demo = isDemoLogin();
  const [sellers, setSellers] = useState([]);
  const [stores, setStores] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [stats, setStats] = useState(null);
  const [state, setState] = useState("loading");
  const [range, setRange] = useState("30d");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = () => {
    if (demo) { setState("demo"); return; }
    setState("loading");
    Promise.all([fetchSellers(), fetchSellerStats({ from: rangeFrom(range) })])
      .then(([a, b]) => { setSellers(a.sellers || []); setStats(b); setState("ok"); })
      .catch(() => setState("error"));
  };
  useEffect(load, [range, demo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (demo) return;
    fetchStores().then((r) => setStores(r.establishments || [])).catch(() => setStores([]));
    listTerminals().then((r) => setTerminals(r.terminals || [])).catch(() => setTerminals([]));
  }, [demo]);
  const storeBy = useMemo(() => Object.fromEntries(stores.map((x) => [x.id, x])), [stores]);
  const termBy = useMemo(() => Object.fromEntries(terminals.map((x) => [x.id, x])), [terminals]);
  const openEditor = (x) => { setEditing(x); setCreating(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  // Activar sin tienda o sin punto de venta no se puede: se abre la ficha para elegirlos.
  const onToggle = (x) => {
    if (!x.active && placementMissing({ ...x, active: true })) {
      toast({ tone: "info", title: t("adm.sel.activateNeedsPlacement") });
      openEditor({ ...x, active: true });
      return;
    }
    run(() => updateSeller(x.id, { active: !x.active }), x.active ? "adm.sel.deactivated" : "adm.sel.activated");
  };
  const statBy = useMemo(() => Object.fromEntries((stats?.sellers || []).map((s) => [s.id, s])), [stats]);
  const list = sellers.filter((s) => !q || `${s.name} ${s.code} ${s.email || ""}`.toLowerCase().includes(q.toLowerCase()));
  const totals = (stats?.sellers || []).reduce((a, s) => ({ orders: a.orders + s.orders, revenue: a.revenue + s.revenue, commission: a.commission + s.commission }), { orders: 0, revenue: 0, commission: 0 });

  const run = async (fn, okKey) => {
    setBusy(true);
    try { await fn(); toast({ tone: "success", title: t(okKey) }); setCreating(false); setEditing(null); load(); onChanged?.(); }
    catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.err.sel.saveFailed") }); }
    finally { setBusy(false); }
  };
  const onDelete = async (s) => {
    if (!(await confirm({ tone: "danger", title: t("adm.sel.deleteTitle", { name: s.name }), message: t("adm.sel.deleteBody"), confirmLabel: t("adm.sel.delete") }))) return;
    run(() => deleteSeller(s.id), "adm.sel.deleted");
  };
  const onRotate = async (s) => {
    if (!(await confirm({ tone: "danger", title: t("adm.sel.rotateTitle"), message: t("adm.sel.rotateBody"), confirmLabel: t("adm.sel.rotate") }))) return;
    run(() => rotateSellerLink(s.id), "adm.sel.rotated");
  };

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>{t("adm.tab.sellers")}</h2>
        <div className="adm-orders-tools">
          <div className="adm-range">{RANGES.map((k) => <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{t(`adm.range.${k}`)}</button>)}</div>
          <label className="adm-find compact"><Icon name="search" size={15} /><input placeholder={t("adm.sel.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className="btn-sm primary" disabled={demo} onClick={() => { setCreating(true); setEditing(null); }}><Icon name="plus" size={14} />{t("adm.sel.new")}</button>
        </div>
      </div>
      <p className="adm-sub" style={{ marginTop: -8 }}>{t("adm.sel.intro")}</p>
      {demo && <div className="adm-demo-banner">{t("adm.sec.demoNote")}</div>}
      {state === "error" && <div className="adm-login-err">{t("adm.err.sel.loadFailed")}</div>}

      {stats && (
        <div className="cost-kpi-row">
          <button type="button" className="cost-kpi" onClick={() => setCreating(true)}><small><Icon name="sellers" size={13} />{t("adm.sel.active")}</small><b>{sellers.filter((s) => s.active).length}</b></button>
          <button type="button" className="cost-kpi" onClick={() => go?.("orders", { preset: "all" })}><small><Icon name="orders" size={13} />{t("adm.sel.attributed")}</small><b>{totals.orders}</b><em>{t("adm.sel.unattributed", { n: stats.unattributed?.orders ?? 0 })}</em></button>
          <button type="button" className="cost-kpi" onClick={() => go?.("exec", { sub: "sales" })}><small><Icon name="dollar" size={13} />{t("adm.sel.sales")}</small><b>{fmtMoney(totals.revenue, "usd", lang)}</b></button>
          <button type="button" className="cost-kpi bad" onClick={() => go?.("exec", { sub: "costs" })}><small><Icon name="percent" size={13} />{t("adm.sel.commissions")}</small><b>{fmtMoney(totals.commission, "usd", lang)}</b></button>
        </div>
      )}

      {creating && <div style={{ marginBottom: 16 }}><SellerForm stores={stores} terminals={terminals} busy={busy} onCancel={() => setCreating(false)} onSubmit={(body) => run(() => createSeller(body), "adm.sel.created")} /></div>}
      {editing && <div style={{ marginBottom: 16 }}><SellerForm key={`${editing.id}-${editing.active}`} initial={editing} stores={stores} terminals={terminals} busy={busy} onCancel={() => setEditing(null)} onSubmit={(body) => run(() => updateSeller(editing.id, body), "adm.sel.updated")} /></div>}

      {state === "loading" && !sellers.length ? <div className="adm-skel-rows"><div className="adm-skel" style={{ height: 160 }} /></div>
        : !demo && list.length === 0 ? (
          <div className="adm-card"><div className="adm-empty"><Icon name="sellers" size={40} /><b>{t("adm.sel.empty")}</b><p>{t("adm.sel.emptyHint")}</p><button className="btn-sm primary" onClick={() => setCreating(true)}><Icon name="plus" size={14} />{t("adm.sel.new")}</button></div></div>
        ) : (
          <div className="sel-grid">
            {list.map((s) => (
              <SellerCard key={s.id} s={s} stat={statBy[s.id]} lang={lang} store={storeBy[s.establishment_id]} terminal={termBy[s.terminal_id]}
                onEdit={openEditor} onToggle={onToggle}
                onDelete={onDelete} onRotate={onRotate} />
            ))}
          </div>
        )}

      {stats && (stats.sellers || []).length > 0 && (
        <Card icon="sales" title={t("adm.sel.ranking")} hint={t("adm.sel.rankingHint")} name="ranking-vendedores" style={{ marginTop: 16 }} csv={{ cols: [[t("adm.sel.name"), "name"], [t("adm.sel.code"), "code"], [t("adm.kpi.orders"), "orders"], [t("adm.sel.sales"), "revenue"], ["%", "commission_pct"], [t("adm.sel.commissions"), "commission"]], rows: stats.sellers }}>
          <div className="adm-table-wrap">
            <table className="adm-table responsive">
              <thead><tr><th>#</th><th>{t("adm.sel.name")}</th><th>{t("adm.sel.code")}</th><th className="r">{t("adm.kpi.orders")}</th><th className="r">{t("adm.sel.sales")}</th><th className="r">%</th><th className="r">{t("adm.sel.commissions")}</th><th>{t("adm.sel.lastOrderCol")}</th></tr></thead>
              <tbody>
                {stats.sellers.slice().sort((a, b) => b.revenue - a.revenue).map((s, i) => (
                  <tr key={s.id}>
                    <td data-label="#">{i + 1}</td><td data-label={t("adm.sel.name")}><b>{s.name}</b></td><td data-label={t("adm.sel.code")}><span className="sel-code">{s.code}</span></td>
                    <td data-label={t("adm.kpi.orders")} className="r num">{s.orders}</td><td data-label={t("adm.sel.sales")} className="r num">{fmtMoney(s.revenue, "usd", lang)}</td>
                    <td data-label="%" className="r">{s.commission_pct}%</td><td data-label={t("adm.sel.commissions")} className="r num">{fmtMoney(s.commission, "usd", lang)}</td>
                    <td data-label={t("adm.sel.lastOrderCol")}>{s.last_order_at ? shortDate(s.last_order_at, lang) : "—"}</td>
                  </tr>
                ))}
                <tr><td data-label="">—</td><td data-label={t("adm.sel.name")} className="muted">{t("adm.ord.noSeller")}</td><td /><td data-label={t("adm.kpi.orders")} className="r num">{stats.unattributed?.orders ?? 0}</td><td data-label={t("adm.sel.sales")} className="r num">{fmtMoney(stats.unattributed?.revenue ?? 0, "usd", lang)}</td><td /><td /><td /></tr>
              </tbody>
            </table>
          </div>
          {(stats.sources || []).length > 0 && (
            <div className="exec-sources" style={{ marginTop: 10 }}>
              {stats.sources.map((x) => <span className="adm-chip neutral" key={x.source}><Icon name={SOURCE_ICON[x.source] || "link"} size={12} />{t(`adm.src.${x.source}`) === `adm.src.${x.source}` ? x.source : t(`adm.src.${x.source}`)} · {x.orders} · {fmtMoney(x.revenue, "usd", lang)}</span>)}
            </div>
          )}
        </Card>
      )}

      <div className="adm-card" style={{ marginTop: 16 }}>
        <h3><Icon name="info" size={16} />{t("adm.sel.howTitle")}</h3>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>{t("adm.sel.howBody")}</p>
      </div>
    </div>
  );
}
