// Dónde se usa: pestaña Seguridad de /admin — checklist de seguridad y configuración del backend (GET /admin/security-status).
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { adminFetch } from "./adminApi.js";
import { shortDate } from "./adminOrders.js";

/** Frase exacta que exige el servidor (POST /admin/maintenance/purge-orders). */
const PURGE_PHRASE = "BORRAR PEDIDOS";

/**
 * ZONA DE PELIGRO — puesta a cero de pedidos (base de datos + bucket privado +
 * hoja de Google). Pensada para dejar atrás los pedidos de desarrollo justo
 * antes de la primera venta real. El servidor exige la frase exacta; aquí
 * además se enseña primero el informe (qué se va a borrar) y el botón solo se
 * activa con la frase escrita. Configuración, catálogo y clientes no se tocan.
 */
function DangerZone({ t, lang, demo }) {
  const { toast } = useFeedback();
  const [report, setReport] = useState(null);
  const [state, setState] = useState("idle"); // idle | loading | ready | running | done | error
  const [phrase, setPhrase] = useState("");
  const [result, setResult] = useState(null);

  const preview = () => {
    setState("loading");
    adminFetch("/admin/maintenance/purge-orders")
      .then((r) => { setReport(r); setState("ready"); })
      .catch(() => setState("error"));
  };
  const run = async () => {
    if (phrase.trim() !== PURGE_PHRASE || state === "running") return;
    setState("running");
    try {
      const r = await adminFetch("/admin/maintenance/purge-orders", { method: "POST", body: { confirm: PURGE_PHRASE } });
      setResult(r);
      setState("done");
      toast({ tone: "success", title: t("adm.sec.purge.done", { n: r.total_rows }) });
    } catch (err) {
      setState("error");
      toast({ tone: "error", title: t(err.message) });
    }
  };

  return (
    <div className="adm-card adm-danger">
      <h3>{t("adm.sec.purge.title")}</h3>
      <p className="adm-sub">{t("adm.sec.purge.intro")}</p>
      {state === "idle" && <button className="btn-sm" disabled={demo} onClick={preview}>{t("adm.sec.purge.preview")}</button>}
      {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.security.purgeFailed")}</div>}
      {(state === "ready" || state === "running") && report && (
        <>
          <ul className="adm-sec-list">
            <li className="fail"><span className="adm-sec-mark" aria-hidden="true"><Icon name="alert" size={15} /></span><span className="adm-sec-main"><b>{t("adm.sec.purge.rows", { n: report.total_rows })}</b>
              <small className="muted">{report.tables.filter((x) => x.rows > 0).map((x) => `${x.table}: ${x.rows}`).join(" · ") || "—"}</small></span></li>
            <li className="fail"><span className="adm-sec-mark" aria-hidden="true"><Icon name="alert" size={15} /></span><span className="adm-sec-main"><b>{t("adm.sec.purge.files", { n: report.private_files })}</b></span></li>
            <li><span className="adm-sec-mark" aria-hidden="true"><Icon name="check" size={15} /></span><span className="adm-sec-main"><b>{t("adm.sec.purge.keeps")}</b></span></li>
          </ul>
          <label className="adm-sec-phrase">
            {t("adm.sec.purge.type", { phrase: PURGE_PHRASE })}
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn-sm warn" disabled={phrase.trim() !== PURGE_PHRASE || state === "running"} onClick={run}>
            {state === "running" ? "…" : t("adm.sec.purge.run")}
          </button>
        </>
      )}
      {state === "done" && result && (
        <div className="adm-sec-done">
          <b>{t("adm.sec.purge.done", { n: result.total_rows })}</b>
          <small className="muted">
            {t("adm.sec.purge.doneDetail", { files: result.private_files_deleted ?? 0, sheet: result.sheet ? `${result.sheet.orders} / ${result.sheet.history}` : (result.sheet_error || "—") })}
            {" · "}{shortDate(new Date().toISOString(), lang)}
          </small>
        </div>
      )}
    </div>
  );
}

/**
 * SEGURIDAD — lo que el dueño necesita saber sin leer logs.
 *
 * El backend evalúa cada punto (secretos fuertes, orígenes solo https, Stripe
 * en vivo o en pruebas, webhook, proveedores de correo/SMS, hoja, OCR…) y
 * responde pasa/no pasa. Nunca viaja un valor: solo si está en orden. La
 * pestaña pinta cada punto con su etiqueta y, si falla, cómo arreglarlo.
 *
 * Las claves de los puntos (`checks[].key`) son el contrato con el servidor;
 * la etiqueta y la ayuda salen del diccionario (`adm.sec.k.*` / `adm.sec.h.*`),
 * así que un punto nuevo sin traducción se ve como su clave, no como un fallo.
 */
const GROUPS = [
  ["secrets", (k) => k.startsWith("secret.") || k.startsWith("storage.")],
  ["access", (k) => k.startsWith("auth.") || k.startsWith("cors.") || k.startsWith("urls.") || k.startsWith("node_env.") || k.startsWith("security.")],
  ["payments", (k) => k.startsWith("payments.")],
  ["services", (k) => k.startsWith("notifications.") || k.startsWith("sheet.") || k.startsWith("ocr.")],
];

export default function Security() {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const [audit, setAudit] = useState(null);
  const [state, setState] = useState(demo ? "demo" : "loading");

  const load = () => {
    if (demo) return;
    setState("loading");
    adminFetch("/admin/security-status")
      .then((r) => { setAudit(r); setState("ok"); })
      .catch(() => setState("error"));
  };
  useEffect(load, [demo]);

  const label = (key) => {
    const s = t(`adm.sec.k.${key}`);
    return s === `adm.sec.k.${key}` ? key : s;
  };
  const hint = (key) => {
    const s = t(`adm.sec.h.${key}`);
    return s === `adm.sec.h.${key}` ? "" : s;
  };

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>{t("adm.sec.title")}</h2>
        {state === "ok" && (
          <button className="btn-sm" onClick={load}>{t("adm.sec.refresh")}</button>
        )}
      </div>
      <p className="adm-sub">{t("adm.sec.intro")}</p>
      {demo && <div className="adm-demo-banner">{t("adm.sec.demoNote")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.security.loadFailed")}</div>}
      {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}

      {audit && (
        <>
          <div className="adm-kpis">
            <div className={`adm-card adm-sec-kpi ${audit.failing ? "warn" : "ok"}`}>
              <small>{t("adm.sec.summary")}</small>
              <b>{audit.failing ? t("adm.sec.failing", { n: audit.failing }) : t("adm.sec.allOk")}</b>
            </div>
            <div className="adm-card adm-sec-kpi">
              <small>{t("adm.sec.checked")}</small>
              <b>{shortDate(audit.checked_at, lang)}</b>
            </div>
            <div className={`adm-card adm-sec-kpi ${audit.strict_mode ? "ok" : ""}`}>
              <small>{t("adm.sec.strict")}</small>
              <b>{audit.strict_mode ? t("adm.sec.on") : t("adm.sec.off")}</b>
            </div>
          </div>

          <DangerZone t={t} lang={lang} demo={demo} />

          {GROUPS.map(([group, match]) => {
            const items = audit.checks.filter((c) => match(c.key));
            if (!items.length) return null;
            return (
              <div className="adm-card" key={group}>
                <h3>{t(`adm.sec.g.${group}`)}</h3>
                <ul className="adm-sec-list">
                  {items.map((c) => (
                    <li key={c.key} className={c.ok ? "ok" : "fail"}>
                      <span className="adm-sec-mark" aria-hidden="true"><Icon name={c.ok ? "check" : "close"} size={15} /></span>
                      <span className="adm-sec-main">
                        <b>{label(c.key)}</b>
                        {c.detail ? <small className="muted"> · {c.detail}</small> : null}
                        {!c.ok && hint(c.key) ? <small className="adm-sec-hint">{hint(c.key)}</small> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
