// Dónde se usa: pestaña «Sincronización del catálogo» de /admin (grupo Catálogo).
// Estado del worker del scraper (app propia en Coolify), «Ejecutar ahora»,
// progreso y «Detener», resultado de la última corrida con los modelos nuevos,
// programación mensual e historial. Backend: /admin/catalog-sync.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { useCatalog } from "../data/catalogStore.js";
import { resolveImage } from "../data/imageUrl.js";
import Icon from "./icons.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { money } from "./adminOrders.js";
import {
  ACTIVE_POLL_MS, STATUS_TONE, cancelSyncRun, dateTime, duration, fetchCatalogSync,
  fetchSyncRun, queueSyncRun, runPercent, saveSyncSettings, syncErrorKey,
} from "./catalogSync.js";
import "./catalog-sync.css";

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function StatusChip({ status, t }) {
  return <span className={`adm-chip ${STATUS_TONE[status] ?? ""}`}>{t(`adm.sync.status.${status}`)}</span>;
}

/** Los números de una corrida terminada, como tarjetas. */
function SummaryKpis({ summary, t, lang }) {
  const s = summary || {};
  const items = [
    ["new", s.new, "gold"],
    ["updated", s.updated],
    ["unchanged", s.unchanged],
    ["failed", s.failed, s.failed ? "bad" : ""],
    ["drafted", s.drafted],
    ["found", s.found],
  ];
  return (
    <div className="cs-kpis">
      {items.map(([key, value, tone]) => (
        <div key={key} className={`cs-kpi ${tone || ""}`}>
          <b>{value ?? 0}</b>
          <small>{t(`adm.sync.kpi.${key}`)}</small>
        </div>
      ))}
      <div className="cs-kpi views">
        <b>{s.views_generated ?? 0}</b>
        <small>
          {t("adm.sync.kpi.views", { cost: money(s.views_cost_usd || 0, "usd", lang) })}
          {s.views_note ? <> · {t(`adm.sync.viewsNote.${s.views_note}`)}</> : null}
        </small>
      </div>
    </div>
  );
}

/** Detalle de una corrida: números, modelos nuevos, errores y registro. */
function RunDetail({ run, t, lang }) {
  const [full, setFull] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => { setFull(null); setShowLog(false); setShowErrors(false); }, [run?.id]);

  const detail = full || run;
  const loadFull = () => {
    if (full) return Promise.resolve(full);
    return fetchSyncRun(run.id).then((r) => { setFull(r); return r; });
  };
  const toggleLog = () => {
    if (showLog) { setShowLog(false); return; }
    loadFull().then(() => setShowLog(true)).catch(() => setShowLog(false));
  };
  const toggleErrors = () => {
    if (showErrors) { setShowErrors(false); return; }
    loadFull().then(() => setShowErrors(true)).catch(() => setShowErrors(false));
  };

  const newProducts = detail.new_products || [];
  const errors = detail.errors || [];
  const opts = detail.options || {};

  return (
    <div className="cs-detail">
      <div className="cs-meta">
        <StatusChip status={detail.status} t={t} />
        <span className="adm-chip neutral">{t(`adm.sync.trigger.${detail.trigger}`)}</span>
        {opts.full && <span className="adm-chip neutral">{t("adm.sync.opt.full")}</span>}
        {opts.collection && <span className="adm-chip neutral">{opts.collection}</span>}
        <span className="muted">
          {dateTime(detail.started_at || detail.created_at, lang)} · {duration(detail.started_at, detail.finished_at)}
        </span>
      </div>
      {detail.error_reason && <p className="cs-reason">{t(`adm.sync.reason.${detail.error_reason}`)}</p>}

      <SummaryKpis summary={detail.summary} t={t} lang={lang} />

      <h4 className="cs-h4">
        <Icon name="sparkles" size={15} /> {t("adm.sync.newModels", { n: detail.summary?.new ?? newProducts.length })}
      </h4>
      {/* El historial no trae la lista (pesa); se pide al abrir la corrida. */}
      {!Array.isArray(detail.new_products) && (
        <button className="btn-xs" onClick={() => loadFull().catch(() => {})}>{t("adm.sync.loadNew")}</button>
      )}
      {Array.isArray(detail.new_products) && newProducts.length === 0 && <p className="adm-sub">{t("adm.sync.noNew")}</p>}
      {newProducts.length > 0 && (
        <div className="cs-new-grid">
          {newProducts.map((p) => (
            <div key={p.handle} className="cs-new">
              <div className="cs-new-img">
                {p.thumbnail ? <img src={resolveImage(p.thumbnail)} alt="" loading="lazy" /> : <Icon name="glasses" size={22} />}
                <span className="cs-new-badge">{t("adm.sync.newBadge")}</span>
              </div>
              <b title={p.handle}>{p.title || p.handle}</b>
              <small className="muted">{p.brand || "—"} · {t("adm.sync.colors", { n: p.colors || 0 })}</small>
            </div>
          ))}
        </div>
      )}

      <div className="cs-actions">
        {(detail.summary?.failed > 0 || detail.summary?.views_failed > 0 || errors.length > 0) && (
          <button className="btn-xs" onClick={toggleErrors}>
            <Icon name="alert" size={13} /> {t(showErrors ? "adm.sync.hideErrors" : "adm.sync.showErrors")}
          </button>
        )}
        <button className="btn-xs" onClick={toggleLog}>
          <Icon name="clipboard" size={13} /> {t(showLog ? "adm.sync.hideLog" : "adm.sync.showLog")}
        </button>
      </div>
      {showErrors && (
        errors.length
          ? <ul className="cs-errors">{errors.map((e, i) => <li key={i}><b>{e.handle || "—"}</b> <span>{e.message}</span></li>)}</ul>
          : <p className="adm-sub">{t("adm.sync.noErrors")}</p>
      )}
      {showLog && <pre className="cs-log">{detail.log_tail || t("adm.sync.noLog")}</pre>}
    </div>
  );
}

export default function CatalogSync() {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const demo = isDemoLogin();
  const { products } = useCatalog();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | error
  const [busy, setBusy] = useState(null);         // "run" | "cancel" | "settings"
  const [runOpts, setRunOpts] = useState({ full: false, collection: "", views_max_cost: "" });
  const [draft, setDraft] = useState(null);       // ajustes en edición
  const [selected, setSelected] = useState(null); // corrida elegida en el historial

  const load = useCallback(() => {
    if (demo) { setState("error"); return Promise.resolve(); }
    return fetchCatalogSync()
      .then((r) => { setData(r); setState("ready"); })
      .catch(() => setState("error"));
  }, [demo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (data?.settings && !draft) setDraft(data.settings);
  }, [data, draft]);

  // Con una corrida en cola o en curso, refresco frecuente; si no, cada minuto (el worker puede conectarse).
  const active = data?.active || null;
  useEffect(() => {
    if (state !== "ready") return undefined;
    const id = setInterval(load, active ? ACTIVE_POLL_MS : 60000);
    return () => clearInterval(id);
  }, [state, active, load]);

  const collections = useMemo(() => {
    const set = new Set(products.map((p) => p.brand_slug).filter(Boolean));
    return [...set].sort();
  }, [products]);

  const run = async () => {
    setBusy("run");
    try {
      const body = { full: runOpts.full };
      if (runOpts.collection) body.collection = runOpts.collection;
      if (runOpts.views_max_cost !== "") body.views_max_cost = Number(runOpts.views_max_cost);
      await queueSyncRun(body);
      toast({ tone: "success", title: t("adm.sync.queued") });
      await load();
    } catch (err) {
      toast({ tone: "error", title: t(syncErrorKey(err)) });
    } finally { setBusy(null); }
  };

  const cancel = async () => {
    if (!active) return;
    const ok = await confirm({ title: t("adm.sync.cancelConfirm"), message: t("adm.sync.cancelBody") });
    if (!ok) return;
    setBusy("cancel");
    try {
      const r = await cancelSyncRun(active.id);
      toast({ tone: "info", title: t(r.status === "canceled" ? "adm.sync.canceled" : "adm.sync.cancelRequested") });
      await load();
    } catch (err) {
      toast({ tone: "error", title: t(syncErrorKey(err)) });
    } finally { setBusy(null); }
  };

  const saveSettings = async () => {
    setBusy("settings");
    try {
      const saved = await saveSyncSettings({ ...draft, views_max_cost: Number(draft.views_max_cost) });
      setDraft(saved);
      toast({ tone: "success", title: t("adm.sync.settingsSaved") });
      await load();
    } catch (err) {
      toast({ tone: "error", title: t(syncErrorKey(err)) });
    } finally { setBusy(null); }
  };

  if (demo) return <div className="adm-card"><h3>{t("adm.sync.title")}</h3><p className="adm-sub">{t("adm.sync.demo")}</p></div>;
  if (state === "loading") return <div className="adm-card"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (state === "error" || !data) {
    return (
      <div className="adm-card">
        <h3>{t("adm.sync.title")}</h3>
        <div className="adm-demo-banner">{t("adm.sync.loadFailed")}</div>
        <button className="btn-sm" onClick={() => { setState("loading"); load(); }}>{t("adm.sync.retry")}</button>
      </div>
    );
  }

  const worker = data.worker || {};
  const shown = selected || data.last;
  const pct = runPercent(active?.progress);
  const settingsDirty = draft && JSON.stringify(draft) !== JSON.stringify(data.settings);
  const localHour = (h) => {
    const d = new Date();
    d.setUTCHours(h, 0, 0, 0);
    return d.toLocaleTimeString(lang === "en" ? "en-US" : "es", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="cs-wrap">
      {/* Cabecera: worker, próxima corrida y «Ejecutar ahora» */}
      <div className="adm-card">
        <div className="adm-head-row">
          <h3>{t("adm.sync.title")}</h3>
          <span className={`adm-chip ${worker.online ? "ok" : "bad"}`} title={worker.id || undefined}>
            <Icon name={worker.online ? "checkCircle" : "alert"} size={13} />
            {worker.online ? t("adm.sync.workerOnline") : t("adm.sync.workerOffline")}
          </span>
        </div>
        <p className="adm-sub">{t("adm.sync.sub")}</p>
        {!worker.online && (
          <p className="cs-hint">
            {worker.seen_at ? t("adm.sync.workerLastSeen", { when: dateTime(worker.seen_at, lang) }) : t("adm.sync.workerNever")}
          </p>
        )}
        <div className="cs-next">
          <Icon name="calendar" size={15} />
          {data.next_scheduled_at
            ? t("adm.sync.nextRun", { when: dateTime(data.next_scheduled_at, lang) })
            : t("adm.sync.scheduleOff")}
        </div>

        <div className="adm-form-grid cs-run-form">
          <label className="adm-field">{t("adm.sync.opt.collection")}
            <select className="adm-input" value={runOpts.collection} disabled={!!active}
                    onChange={(e) => setRunOpts((o) => ({ ...o, collection: e.target.value }))}>
              <option value="">{t("adm.sync.opt.allCollections")}</option>
              {collections.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="adm-field">{t("adm.sync.opt.viewsBudget")}
            <input className="adm-input" type="number" min="0" max="100" step="1" disabled={!!active}
                   placeholder={String(data.settings.views_max_cost)} value={runOpts.views_max_cost}
                   onChange={(e) => setRunOpts((o) => ({ ...o, views_max_cost: e.target.value }))} />
          </label>
          <label className="adm-field cs-check">
            <span><input type="checkbox" checked={runOpts.full} disabled={!!active}
                         onChange={(e) => setRunOpts((o) => ({ ...o, full: e.target.checked }))} /> {t("adm.sync.opt.full")}</span>
            <small className="muted">{t("adm.sync.opt.fullHint")}</small>
          </label>
        </div>
        <div className="cs-actions">
          <button className="btn-sm primary" disabled={!!active || busy === "run"} onClick={run}>
            <Icon name="refresh" size={14} /> {t("adm.sync.runNow")}
          </button>
          {active && <span className="muted">{t("adm.sync.oneAtATime")}</span>}
        </div>
      </div>

      {/* Corrida en cola o en curso */}
      {active && (
        <div className="adm-card cs-active">
          <div className="adm-head-row">
            <h3><StatusChip status={active.status} t={t} /> {t(`adm.sync.trigger.${active.trigger}`)}</h3>
            <button className="btn-sm warn" disabled={busy === "cancel" || active.cancel_requested} onClick={cancel}>
              {t(active.cancel_requested ? "adm.sync.stopping" : "adm.sync.stop")}
            </button>
          </div>
          {active.status === "queued" && (
            <p className="adm-sub">{worker.online ? t("adm.sync.waitingWorker") : t("adm.sync.queuedOffline")}</p>
          )}
          {active.status === "running" && (
            <>
              <div className="cs-bar" role="progressbar" aria-label={t("adm.sync.progress")}
                   aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
                <span style={{ width: `${pct ?? 3}%` }} className={pct == null ? "indeterminate" : ""} />
              </div>
              <p className="cs-progress muted">
                {active.progress?.phase ? t(`adm.sync.phase.${active.progress.phase}`) : t("adm.sync.phase.start")}
                {active.progress?.collection ? ` · ${active.progress.collection}` : ""}
                {active.progress?.total ? ` · ${active.progress.position}/${active.progress.total}` : ""}
                {active.progress?.collections_total
                  ? ` · ${t("adm.sync.collectionsDone", { done: active.progress.collections_done || 0, total: active.progress.collections_total })}`
                  : ""}
                {" · "}{duration(active.started_at)}
              </p>
            </>
          )}
        </div>
      )}

      {/* Resultado: la última corrida terminada, o la elegida en el historial */}
      <div className="adm-card">
        <div className="adm-head-row">
          <h3>{selected ? t("adm.sync.selectedRun") : t("adm.sync.lastRun")}</h3>
          {selected && <button className="btn-xs" onClick={() => setSelected(null)}>{t("adm.sync.backToLast")}</button>}
        </div>
        {shown ? <RunDetail run={shown} t={t} lang={lang} /> : <p className="adm-sub">{t("adm.sync.noRuns")}</p>}
      </div>

      <div className="adm-grid-2">
        {/* Programación mensual */}
        {draft && (
          <div className="adm-card">
            <h3>{t("adm.sync.scheduleTitle")}</h3>
            <p className="adm-sub">{t("adm.sync.scheduleSub")}</p>
            <div className="adm-form-grid">
              <label className="adm-field cs-check">
                <span><input type="checkbox" checked={draft.schedule_enabled}
                             onChange={(e) => setDraft((d) => ({ ...d, schedule_enabled: e.target.checked }))} /> {t("adm.sync.scheduleEnabled")}</span>
              </label>
              <label className="adm-field">{t("adm.sync.scheduleDay")}
                <select className="adm-input" value={draft.schedule_day} disabled={!draft.schedule_enabled}
                        onChange={(e) => setDraft((d) => ({ ...d, schedule_day: Number(e.target.value) }))}>
                  {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="adm-field">{t("adm.sync.scheduleHour")}
                <select className="adm-input" value={draft.schedule_hour} disabled={!draft.schedule_enabled}
                        onChange={(e) => setDraft((d) => ({ ...d, schedule_hour: Number(e.target.value) }))}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00 UTC · ${localHour(h)}`}</option>
                  ))}
                </select>
              </label>
              <label className="adm-field">{t("adm.sync.viewsBudgetDefault")}
                <input className="adm-input" type="number" min="0" max="100" step="1" value={draft.views_max_cost}
                       onChange={(e) => setDraft((d) => ({ ...d, views_max_cost: e.target.value }))} />
              </label>
              <label className="adm-field cs-check">
                <span><input type="checkbox" checked={draft.schedule_full} disabled={!draft.schedule_enabled}
                             onChange={(e) => setDraft((d) => ({ ...d, schedule_full: e.target.checked }))} /> {t("adm.sync.scheduleFull")}</span>
                <small className="muted">{t("adm.sync.opt.fullHint")}</small>
              </label>
            </div>
            <p className="cs-hint">{t("adm.sync.viewsHint")}</p>
            <div className="cs-actions">
              <button className="btn-sm primary" disabled={!settingsDirty || busy === "settings"} onClick={saveSettings}>
                <Icon name="save" size={14} /> {t("adm.sync.saveSettings")}
              </button>
            </div>
          </div>
        )}

        {/* Historial */}
        <div className="adm-card">
          <h3>{t("adm.sync.history")}</h3>
          {data.runs.length === 0 ? <p className="adm-sub">{t("adm.sync.noRuns")}</p> : (
            <div className="adm-table-wrap">
              <table className="adm-table responsive cs-history">
                <thead>
                  <tr>
                    <th>{t("adm.sync.col.when")}</th>
                    <th>{t("adm.sync.col.status")}</th>
                    <th>{t("adm.sync.kpi.new")}</th>
                    <th>{t("adm.sync.kpi.updated")}</th>
                    <th>{t("adm.sync.kpi.failed")}</th>
                    <th>{t("adm.sync.col.duration")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((r) => (
                    <tr key={r.id} className={shown?.id === r.id ? "on" : ""} tabIndex={0}
                        onClick={() => setSelected(r)} onKeyDown={(e) => { if (e.key === "Enter") setSelected(r); }}>
                      <td data-label={t("adm.sync.col.when")}>
                        {dateTime(r.started_at || r.created_at, lang)}
                        <small className="muted"> · {t(`adm.sync.trigger.${r.trigger}`)}</small>
                      </td>
                      <td data-label={t("adm.sync.col.status")}><StatusChip status={r.status} t={t} /></td>
                      <td data-label={t("adm.sync.kpi.new")}>{r.summary?.new ?? "—"}</td>
                      <td data-label={t("adm.sync.kpi.updated")}>{r.summary?.updated ?? "—"}</td>
                      <td data-label={t("adm.sync.kpi.failed")}>{r.summary?.failed ?? "—"}</td>
                      <td data-label={t("adm.sync.col.duration")}>{duration(r.started_at, r.finished_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
