// Dónde se usa: pestaña Seguridad de /admin — checklist de seguridad y configuración del backend (GET /admin/security-status).
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { adminFetch } from "./adminApi.js";
import { shortDate } from "./adminOrders.js";

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

          {GROUPS.map(([group, match]) => {
            const items = audit.checks.filter((c) => match(c.key));
            if (!items.length) return null;
            return (
              <div className="adm-card" key={group}>
                <h3>{t(`adm.sec.g.${group}`)}</h3>
                <ul className="adm-sec-list">
                  {items.map((c) => (
                    <li key={c.key} className={c.ok ? "ok" : "fail"}>
                      <span className="adm-sec-mark" aria-hidden="true">{c.ok ? "✓" : "✕"}</span>
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
