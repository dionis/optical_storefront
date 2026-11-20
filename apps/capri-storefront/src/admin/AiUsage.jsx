// Dónde se usa: pestaña «Consumo IA» de /admin (grupo Administración; solo dueño
// y superadmin). Saldo de cada proveedor de IA = lo que el dueño anotó (recarga o
// saldo real de la consola) menos el costo medido de cada llamada; ritmo de gasto,
// días restantes, alertas de saldo bajo y el desglose del consumo por actividad,
// modelo y día. Backend: /admin/ai-usage.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { Card } from "./ui.jsx";
import { BarChart } from "./charts.jsx";
import { isDemoLogin } from "./adminAuth.js";
import {
  ACTIVITIES, ALERT_UNITS, PROVIDERS, STATE_TONE, addCreditEntry, aiErrorKey, dailySeries,
  deleteAlert, deleteCreditEntry, fetchAiUsage, isoDay, needsAttention, saveAlert, usdFine,
} from "./aiUsage.js";
import "./ai-usage.css";

const dateTime = (v, lang) => (v ? new Date(v).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeStyle: "short" }) : "—");
const int = (v, lang) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es-US").format(Number(v || 0));

/** Tarjeta de saldo de un proveedor. */
function ProviderCard({ p, t, lang, onEntry }) {
  const pct = p.pct_left == null ? null : Math.max(0, Math.min(100, p.pct_left));
  return (
    <div className={`adm-card ai-prov ${p.state}`}>
      <div className="adm-head-row">
        <h3>{t(`adm.ai.provider.${p.provider}`)}</h3>
        <span className={`adm-chip ${STATE_TONE[p.state] ?? ""}`}>{t(`adm.ai.state.${p.state}`)}</span>
      </div>
      {p.tracked ? (
        <>
          <div className="ai-balance">
            <b>{usdFine(p.remaining, lang)}</b>
            <small>{t("adm.ai.remaining")}</small>
          </div>
          {pct != null && (
            <div className="ai-bar" role="progressbar" aria-label={t("adm.ai.pctLeft", { pct })} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          <dl className="ai-facts">
            <div><dt>{t("adm.ai.funded")}</dt><dd>{usdFine(p.funded, lang)}</dd></div>
            <div><dt>{t("adm.ai.spentCycle")}</dt><dd>{usdFine(p.spent, lang)}</dd></div>
            <div><dt>{t("adm.ai.pace")}</dt><dd>{t("adm.ai.perDay", { amount: usdFine(p.burn_per_day, lang) })}</dd></div>
            <div><dt>{t("adm.ai.daysLeft")}</dt><dd>{p.days_left == null ? t("adm.ai.noPace") : t("adm.ai.days", { n: p.days_left })}</dd></div>
          </dl>
          <p className="ai-since muted">
            {t(p.anchor_kind === "balance" ? "adm.ai.sinceBalance" : "adm.ai.sinceDeposit", { when: dateTime(p.cycle_start, lang) })}
          </p>
        </>
      ) : (
        <p className="adm-sub">{t("adm.ai.untrackedHint", { amount: usdFine(p.spent, lang) })}</p>
      )}
      {p.last_no_credit_at && <p className="ai-refused">{t("adm.ai.lastRefused", { when: dateTime(p.last_no_credit_at, lang) })}</p>}
      <div className="ai-actions">
        <button className="btn-sm primary" onClick={() => onEntry(p.provider, "deposit")}><Icon name="plus" size={14} /> {t("adm.ai.addDeposit")}</button>
        <button className="btn-sm" onClick={() => onEntry(p.provider, "balance")}><Icon name="edit" size={14} /> {t("adm.ai.setBalance")}</button>
      </div>
    </div>
  );
}

/** Anotar una recarga o el saldo real que muestra la consola. */
function EntryForm({ initial, t, onSave, onCancel, busy }) {
  const [f, setF] = useState({ provider: "gemini", kind: "deposit", amount_usd: "", effective_at: "", note: "", ...initial });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form className="adm-card ai-form" onSubmit={(e) => { e.preventDefault(); onSave({ ...f, effective_at: f.effective_at ? new Date(f.effective_at).toISOString() : undefined }); }}>
      <h3>{t(f.kind === "balance" ? "adm.ai.setBalance" : "adm.ai.addDeposit")}</h3>
      <p className="adm-sub">{t(f.kind === "balance" ? "adm.ai.balanceHint" : "adm.ai.depositHint")}</p>
      <div className="adm-form-grid">
        <label className="adm-field">{t("adm.ai.f.provider")}
          <select className="adm-input" value={f.provider} onChange={(e) => set("provider", e.target.value)}>
            {PROVIDERS.map((p) => <option key={p} value={p}>{t(`adm.ai.provider.${p}`)}</option>)}
          </select>
        </label>
        <label className="adm-field">{t("adm.ai.f.kind")}
          <select className="adm-input" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="deposit">{t("adm.ai.kind.deposit")}</option>
            <option value="balance">{t("adm.ai.kind.balance")}</option>
          </select>
        </label>
        <label className="adm-field">{t("adm.ai.f.amount")}
          <input className="adm-input" type="number" min={f.kind === "balance" ? 0 : 0.01} step="0.01" required value={f.amount_usd} onChange={(e) => set("amount_usd", e.target.value)} />
        </label>
        <label className="adm-field">{t("adm.ai.f.when")}
          <input className="adm-input" type="datetime-local" value={f.effective_at} max={isoDay(0) + "T23:59"} onChange={(e) => set("effective_at", e.target.value)} />
          <small className="muted">{t("adm.ai.f.whenHint")}</small>
        </label>
        <label className="adm-field ai-wide">{t("adm.ai.f.note")}
          <input className="adm-input" maxLength={300} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder={t("adm.ai.f.notePh")} />
        </label>
      </div>
      <div className="ai-actions">
        <button className="btn-sm primary" type="submit" disabled={busy}><Icon name="save" size={14} /> {t("adm.ai.save")}</button>
        <button className="btn-sm" type="button" onClick={onCancel}>{t("adm.ai.cancel")}</button>
      </div>
    </form>
  );
}

const EMPTY_ALERT = { provider: "gemini", unit: "usd", threshold: "", recipients: "", locale: "es", is_active: true };

function AlertForm({ initial, t, onSave, onCancel, busy }) {
  const [f, setF] = useState(() => ({ ...EMPTY_ALERT, ...initial, recipients: (initial?.recipients || []).join(", ") }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form className="ai-alert-form" onSubmit={(e) => { e.preventDefault(); onSave({ ...f, threshold: Number(f.threshold), recipients: f.recipients.split(/[,;\s]+/).filter(Boolean) }); }}>
      <div className="adm-form-grid">
        <label className="adm-field">{t("adm.ai.f.provider")}
          <select className="adm-input" value={f.provider} onChange={(e) => set("provider", e.target.value)}>
            {PROVIDERS.map((p) => <option key={p} value={p}>{t(`adm.ai.provider.${p}`)}</option>)}
          </select>
        </label>
        <label className="adm-field">{t("adm.ai.f.unit")}
          <select className="adm-input" value={f.unit} onChange={(e) => set("unit", e.target.value)}>
            {ALERT_UNITS.map((u) => <option key={u} value={u}>{t(`adm.ai.unit.${u}`)}</option>)}
          </select>
        </label>
        <label className="adm-field">{t(`adm.ai.f.threshold.${f.unit}`)}
          <input className="adm-input" type="number" min="0.01" max={f.unit === "percent" ? 100 : f.unit === "days" ? 365 : undefined} step="0.01" required value={f.threshold} onChange={(e) => set("threshold", e.target.value)} />
        </label>
        <label className="adm-field">{t("adm.ai.f.locale")}
          <select className="adm-input" value={f.locale} onChange={(e) => set("locale", e.target.value)}>
            <option value="es">Español</option><option value="en">English</option>
          </select>
        </label>
        <label className="adm-field ai-wide">{t("adm.ai.f.recipients")}
          <input className="adm-input" value={f.recipients} onChange={(e) => set("recipients", e.target.value)} placeholder={t("adm.ai.f.recipientsPh")} />
          <small className="muted">{t("adm.ai.f.recipientsHint")}</small>
        </label>
        <label className="adm-field ai-check">
          <span><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} /> {t("adm.ai.f.active")}</span>
        </label>
      </div>
      <div className="ai-actions">
        <button className="btn-sm primary" type="submit" disabled={busy}><Icon name="save" size={14} /> {t("adm.ai.save")}</button>
        <button className="btn-sm" type="button" onClick={onCancel}>{t("adm.ai.cancel")}</button>
      </div>
    </form>
  );
}

function alertText(a, t, lang) {
  const value = a.unit === "usd" ? usdFine(a.threshold, lang) : a.threshold;
  return t(`adm.ai.rule.${a.unit}`, { provider: t(`adm.ai.provider.${a.provider}`), value });
}

export default function AiUsage() {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const demo = isDemoLogin();
  const [filters, setFilters] = useState(() => ({ from: isoDay(29), to: isoDay(0), provider: "", activity: "" }));
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [entryForm, setEntryForm] = useState(null);
  const [alertForm, setAlertForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showAllCalls, setShowAllCalls] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchAiUsage(filters));
      setState("ready");
    } catch (err) {
      setState("error");
      toast({ tone: "error", title: t(aiErrorKey(err)) });
    }
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!demo) load(); }, [load, demo]);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const submitEntry = async (body) => {
    setBusy(true);
    try {
      await addCreditEntry(body);
      toast({ tone: "success", title: t("adm.ai.entrySaved") });
      setEntryForm(null);
      await load();
    } catch (err) {
      toast({ tone: "error", title: t(aiErrorKey(err)) });
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = async (e) => {
    const ok = await confirm({ title: t("adm.ai.deleteEntryConfirm"), message: t("adm.ai.deleteEntryBody", { amount: usdFine(e.amount_usd, lang), provider: t(`adm.ai.provider.${e.provider}`) }) });
    if (!ok) return;
    try {
      await deleteCreditEntry(e.id);
      await load();
    } catch (err) {
      toast({ tone: "error", title: t(aiErrorKey(err)) });
    }
  };

  const submitAlert = async (body) => {
    setBusy(true);
    try {
      await saveAlert(body, alertForm?.id);
      toast({ tone: "success", title: t("adm.ai.alertSaved") });
      setAlertForm(null);
      await load();
    } catch (err) {
      toast({ tone: "error", title: t(aiErrorKey(err)) });
    } finally {
      setBusy(false);
    }
  };

  const removeAlert = async (a) => {
    const ok = await confirm({ title: t("adm.ai.deleteAlertConfirm"), message: alertText(a, t, lang) });
    if (!ok) return;
    try {
      await deleteAlert(a.id);
      await load();
    } catch (err) {
      toast({ tone: "error", title: t(aiErrorKey(err)) });
    }
  };

  const series = useMemo(() => (data ? dailySeries(data.by_day, filters.from, filters.to) : []), [data, filters.from, filters.to]);

  if (demo) return <div className="adm-card"><h3>{t("adm.ai.title")}</h3><p className="adm-sub">{t("adm.ai.demo")}</p></div>;
  if (state === "loading" && !data) return <div className="adm-card"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (!data) {
    return (
      <div className="adm-card">
        <h3>{t("adm.ai.title")}</h3>
        <div className="adm-demo-banner">{t("adm.ai.loadFailed")}</div>
        <button className="btn-sm" onClick={() => { setState("loading"); load(); }}>{t("adm.ai.retry")}</button>
      </div>
    );
  }

  const providers = data.providers || [];
  const attention = providers.filter((p) => needsAttention(p.state));
  const totals = data.totals || {};
  const calls = showAllCalls ? data.events : (data.events || []).slice(0, 50);

  return (
    <div className="ai-wrap">
      <div className="adm-card">
        <div className="adm-head-row">
          <h3><Icon name="sparkles" size={18} /> {t("adm.ai.title")}</h3>
          <button className="btn-sm primary" onClick={() => setEntryForm({ provider: providers[0]?.provider || "gemini", kind: "deposit" })}>
            <Icon name="plus" size={14} /> {t("adm.ai.addDeposit")}
          </button>
        </div>
        <p className="adm-sub">{t("adm.ai.sub")}</p>
        <p className="ai-note muted">{t("adm.ai.estimateNote", { date: data.rates_read_on })}</p>
      </div>

      {attention.length > 0 && (
        <div className="ai-banner" role="alert">
          <Icon name="alert" size={18} />
          <div>
            {attention.map((p) => (
              <p key={p.provider}>
                {t(`adm.ai.banner.${p.state}`, {
                  provider: t(`adm.ai.provider.${p.provider}`),
                  amount: usdFine(p.remaining, lang),
                  days: p.days_left ?? "—",
                })}
              </p>
            ))}
          </div>
        </div>
      )}

      {entryForm && <EntryForm key={`${entryForm.provider}-${entryForm.kind}`} initial={entryForm} t={t} busy={busy} onSave={submitEntry} onCancel={() => setEntryForm(null)} />}

      {providers.length ? (
        <div className="ai-prov-grid">
          {providers.map((p) => <ProviderCard key={p.provider} p={p} t={t} lang={lang} onEntry={(provider, kind) => setEntryForm({ provider, kind })} />)}
        </div>
      ) : (
        <div className="adm-card"><p className="adm-sub">{t("adm.ai.noProviders")}</p></div>
      )}

      <Card icon="bell" title={t("adm.ai.alerts")} hint={t("adm.ai.alertsHint")} exportable={false}
        right={!alertForm && <button className="btn-xs" onClick={() => setAlertForm({})}><Icon name="plus" size={12} /> {t("adm.ai.newAlert")}</button>}>
        {alertForm && <AlertForm key={alertForm.id || "new"} initial={alertForm} t={t} busy={busy} onSave={submitAlert} onCancel={() => setAlertForm(null)} />}
        {data.alerts?.length ? (
          <ul className="ai-alerts">
            {data.alerts.map((a) => (
              <li key={a.id} className={a.is_active ? "" : "off"}>
                <span className="ai-alert-txt">
                  <b>{alertText(a, t, lang)}</b>
                  <small className="muted">
                    {a.recipients.length ? a.recipients.join(", ") : t("adm.ai.toAdmins")}
                    {a.fired_at ? ` · ${t("adm.ai.firedAt", { when: dateTime(a.fired_at, lang) })}` : ""}
                  </small>
                </span>
                {a.tripped && <span className="adm-chip warn">{t("adm.ai.tripped")}</span>}
                {!a.is_active && <span className="adm-chip neutral">{t("adm.ai.inactive")}</span>}
                <button className="btn-xs" onClick={() => setAlertForm(a)} aria-label={t("adm.ai.edit")} title={t("adm.ai.edit")}><Icon name="edit" size={12} /></button>
                <button className="btn-xs" onClick={() => removeAlert(a)} aria-label={t("adm.ai.delete")} title={t("adm.ai.delete")}><Icon name="trash" size={12} /></button>
              </li>
            ))}
          </ul>
        ) : (
          !alertForm && <p className="adm-sub">{t("adm.ai.noAlerts")}</p>
        )}
        <p className="ai-note muted">{t("adm.ai.noCreditAuto")}</p>
      </Card>

      <div className="adm-card ai-filters">
        <div className="adm-form-grid">
          <label className="adm-field">{t("adm.ai.from")}<input className="adm-input" type="date" value={filters.from} max={filters.to} onChange={(e) => setFilter("from", e.target.value)} /></label>
          <label className="adm-field">{t("adm.ai.to")}<input className="adm-input" type="date" value={filters.to} min={filters.from} onChange={(e) => setFilter("to", e.target.value)} /></label>
          <label className="adm-field">{t("adm.ai.f.provider")}
            <select className="adm-input" value={filters.provider} onChange={(e) => setFilter("provider", e.target.value)}>
              <option value="">{t("adm.ai.all")}</option>
              {PROVIDERS.map((p) => <option key={p} value={p}>{t(`adm.ai.provider.${p}`)}</option>)}
            </select>
          </label>
          <label className="adm-field">{t("adm.ai.f.activity")}
            <select className="adm-input" value={filters.activity} onChange={(e) => setFilter("activity", e.target.value)}>
              <option value="">{t("adm.ai.all")}</option>
              {ACTIVITIES.map((a) => <option key={a} value={a}>{t(`adm.ai.activity.${a}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="ai-kpis">
          <div className="ai-kpi gold"><b>{usdFine(totals.cost_usd, lang)}</b><small>{t("adm.ai.kpi.cost")}</small></div>
          <div className="ai-kpi"><b>{int(totals.calls, lang)}</b><small>{t("adm.ai.kpi.calls")}</small></div>
          <div className="ai-kpi"><b>{usdFine(totals.calls ? totals.cost_usd / totals.calls : 0, lang)}</b><small>{t("adm.ai.kpi.avg")}</small></div>
          <div className="ai-kpi"><b>{int((totals.input_tokens || 0) + (totals.output_tokens || 0), lang)}</b><small>{t("adm.ai.kpi.tokens")}</small></div>
          <div className={`ai-kpi ${totals.refused ? "bad" : ""}`}><b>{int(totals.refused, lang)}</b><small>{t("adm.ai.kpi.refused")}</small></div>
          <div className={`ai-kpi ${totals.unpriced ? "warn" : ""}`}><b>{int(totals.unpriced, lang)}</b><small>{t("adm.ai.kpi.unpriced")}</small></div>
        </div>
      </div>

      <Card icon="sales" title={t("adm.ai.daily")} hint={t("adm.ai.dailyHint")} name="consumo-ia-diario">
        <BarChart data={series} valuePrefix="$" />
      </Card>

      <Card icon="layers" title={t("adm.ai.byActivity")} hint={t("adm.ai.byActivityHint")} name="consumo-ia-actividad">
        {data.by_activity.length ? (
          <table className="adm-table responsive">
            <thead><tr>
              <th>{t("adm.ai.col.activity")}</th><th>{t("adm.ai.col.provider")}</th><th className="num">{t("adm.ai.col.calls")}</th>
              <th className="num">{t("adm.ai.col.cost")}</th><th className="num">{t("adm.ai.col.avg")}</th><th className="num">{t("adm.ai.col.tokens")}</th><th className="num">{t("adm.ai.col.refused")}</th>
            </tr></thead>
            <tbody>
              {data.by_activity.map((r) => (
                <tr key={`${r.provider}-${r.activity}`}>
                  <td data-label={t("adm.ai.col.activity")}>{t(`adm.ai.activity.${r.activity}`)}</td>
                  <td data-label={t("adm.ai.col.provider")}>{t(`adm.ai.provider.${r.provider}`)}</td>
                  <td data-label={t("adm.ai.col.calls")} className="num">{int(r.calls, lang)}</td>
                  <td data-label={t("adm.ai.col.cost")} className="num"><b>{usdFine(r.cost_usd, lang)}</b></td>
                  <td data-label={t("adm.ai.col.avg")} className="num">{usdFine(r.avg_usd, lang)}</td>
                  <td data-label={t("adm.ai.col.tokens")} className="num">{int(r.input_tokens + r.output_tokens, lang)}</td>
                  <td data-label={t("adm.ai.col.refused")} className="num">{r.refused ? <span className="adm-chip bad">{r.refused}</span> : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="adm-sub">{t("adm.ai.noUsage")}</p>}
      </Card>

      <Card icon="sparkles" title={t("adm.ai.byModel")} name="consumo-ia-modelo">
        {data.by_model.length ? (
          <table className="adm-table responsive">
            <thead><tr><th>{t("adm.ai.col.model")}</th><th>{t("adm.ai.col.provider")}</th><th className="num">{t("adm.ai.col.calls")}</th><th className="num">{t("adm.ai.col.cost")}</th><th className="num">{t("adm.ai.col.unpriced")}</th></tr></thead>
            <tbody>
              {data.by_model.map((r) => (
                <tr key={`${r.provider}-${r.model}`}>
                  <td data-label={t("adm.ai.col.model")}><code>{r.model || "—"}</code></td>
                  <td data-label={t("adm.ai.col.provider")}>{t(`adm.ai.provider.${r.provider}`)}</td>
                  <td data-label={t("adm.ai.col.calls")} className="num">{int(r.calls, lang)}</td>
                  <td data-label={t("adm.ai.col.cost")} className="num"><b>{usdFine(r.cost_usd, lang)}</b></td>
                  <td data-label={t("adm.ai.col.unpriced")} className="num">{r.unpriced ? <span className="adm-chip warn">{r.unpriced}</span> : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="adm-sub">{t("adm.ai.noUsage")}</p>}
      </Card>

      <Card icon="history" title={t("adm.ai.calls")} hint={t("adm.ai.callsHint")} name="consumo-ia-llamadas">
        {calls?.length ? (
          <>
            <table className="adm-table responsive">
              <thead><tr><th>{t("adm.ai.col.when")}</th><th>{t("adm.ai.col.activity")}</th><th>{t("adm.ai.col.model")}</th><th className="num">{t("adm.ai.col.tokensIo")}</th><th className="num">{t("adm.ai.col.cost")}</th><th>{t("adm.ai.col.status")}</th></tr></thead>
              <tbody>
                {calls.map((e) => (
                  <tr key={e.id}>
                    <td data-label={t("adm.ai.col.when")}>{dateTime(e.created_at, lang)}</td>
                    <td data-label={t("adm.ai.col.activity")}>{t(`adm.ai.activity.${e.activity}`)}</td>
                    <td data-label={t("adm.ai.col.model")}><code>{e.model || t(`adm.ai.provider.${e.provider}`)}</code></td>
                    <td data-label={t("adm.ai.col.tokensIo")} className="num">{e.input_tokens == null && e.output_tokens == null ? "—" : `${int(e.input_tokens, lang)} / ${int(e.output_tokens, lang)}`}</td>
                    <td data-label={t("adm.ai.col.cost")} className="num">{usdFine(e.cost_usd, lang)}</td>
                    <td data-label={t("adm.ai.col.status")}>
                      {e.status === "no_credit"
                        ? <span className="adm-chip bad">{t("adm.ai.status.no_credit")}</span>
                        : <span className={`adm-chip ${e.priced === "unpriced" ? "warn" : "neutral"}`}>{t(`adm.ai.priced.${e.priced}`)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!showAllCalls && data.events.length > calls.length && (
              <button className="btn-xs" onClick={() => setShowAllCalls(true)}>{t("adm.ai.showAll", { n: data.events.length })}</button>
            )}
          </>
        ) : <p className="adm-sub">{t("adm.ai.noUsage")}</p>}
      </Card>

      <Card icon="wallet" title={t("adm.ai.entries")} hint={t("adm.ai.entriesHint")} name="consumo-ia-recargas">
        {data.entries?.length ? (
          <table className="adm-table responsive">
            <thead><tr><th>{t("adm.ai.col.when")}</th><th>{t("adm.ai.col.provider")}</th><th>{t("adm.ai.f.kind")}</th><th className="num">{t("adm.ai.f.amount")}</th><th>{t("adm.ai.f.note")}</th><th /></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td data-label={t("adm.ai.col.when")}>{dateTime(e.effective_at, lang)}</td>
                  <td data-label={t("adm.ai.col.provider")}>{t(`adm.ai.provider.${e.provider}`)}</td>
                  <td data-label={t("adm.ai.f.kind")}>{t(`adm.ai.kind.${e.kind}`)}</td>
                  <td data-label={t("adm.ai.f.amount")} className="num"><b>{usdFine(e.amount_usd, lang)}</b></td>
                  <td data-label={t("adm.ai.f.note")}>{e.note || "—"}</td>
                  <td><button className="btn-xs" onClick={() => removeEntry(e)} aria-label={t("adm.ai.delete")} title={t("adm.ai.delete")}><Icon name="trash" size={12} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="adm-sub">{t("adm.ai.noEntries")}</p>}
      </Card>
    </div>
  );
}
