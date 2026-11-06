// Dónde se usa: /admin → Administración → «Configuración de la óptica» (tab=setup).
// «Primeros pasos» del dueño (lista que calcula el servidor, GET /admin/tenant/setup)
// y el perfil de la óptica (contacto, redes y recogida en tienda, POST /admin/tenant).
// docs/MULTI-TENANT-TECNICO.md §7.1 y §7.3.
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { shortDate } from "./adminOrders.js";
import { fetchSetup, fetchTenantProfile, saveTenantProfile, SOCIAL_NETWORKS } from "./adminTenant.js";
import BrandEditor from "./BrandEditor.jsx";
import "./setup.css";

const PICKUP_LANGS = ["es", "en"];

const emptyForm = {
  display_name: "", legal_name: "", support_phone: "", whatsapp: "",
  social: {}, pickup_enabled: false, pickup_name: "", pickup_address: "", pickup_hours: {}, pickup_maps: "",
};

function formFrom(profile) {
  const p = profile || {};
  return {
    display_name: p.display_name || "",
    legal_name: p.legal_name || "",
    support_phone: p.support_phone || "",
    whatsapp: p.whatsapp || "",
    social: { ...(p.social || {}) },
    pickup_enabled: Boolean(p.pickup?.enabled),
    pickup_name: p.pickup?.name || "",
    pickup_address: p.pickup?.address || "",
    pickup_hours: { ...(p.pickup?.hours || {}) },
    pickup_maps: p.pickup?.maps_url || "",
  };
}

function patchFrom(f) {
  return {
    display_name: f.display_name,
    legal_name: f.legal_name,
    support_phone: f.support_phone,
    whatsapp: f.whatsapp,
    social: f.social,
    // Guardar el perfil decide la recogida: ofrecida (con dirección) o no.
    pickup: {
      enabled: f.pickup_enabled,
      name: f.pickup_name,
      address: f.pickup_address,
      hours: f.pickup_hours,
      maps_url: f.pickup_maps,
    },
  };
}

export default function Setup({ go, onChanged }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const demo = isDemoLogin();
  const [setup, setSetup] = useState(null);
  const [effective, setEffective] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [busy, setBusy] = useState(false);
  const [badField, setBadField] = useState(null);

  const load = () => {
    if (demo) return;
    setState("loading");
    Promise.all([fetchSetup(), fetchTenantProfile()])
      .then(([s, p]) => {
        setSetup(s);
        setEffective(p.effective || null);
        setForm(formFrom(p.profile));
        setState("ok");
        onChanged?.(s);
      })
      .catch(() => setState("error"));
  };
  useEffect(load, [demo]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const setSocial = (n) => (e) => setForm((f) => ({ ...f, social: { ...f.social, [n]: e.target.value } }));
  const setHours = (l) => (e) => setForm((f) => ({ ...f, pickup_hours: { ...f.pickup_hours, [l]: e.target.value } }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setBadField(null);
    try {
      await saveTenantProfile(patchFrom(form));
      toast({ tone: "success", title: t("adm.setup.saved") });
      load();
    } catch (err) {
      setBadField(err.field || null);
      toast({ tone: "error", title: t(err.message), message: err.field ? t("adm.setup.badField", { field: err.field }) : undefined });
    } finally {
      setBusy(false);
    }
  };

  const finish = async (done) => {
    if (done && setup?.pending) {
      const ok = await confirm({
        title: t("adm.setup.finishPendingTitle"),
        message: t("adm.setup.finishPendingBody", { n: setup.pending }),
        confirmLabel: t("adm.setup.finish"),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await saveTenantProfile({ setup_completed: done });
      toast({ tone: "success", title: t(done ? "adm.setup.finished" : "adm.setup.reopened") });
      load();
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally {
      setBusy(false);
    }
  };

  const bad = (name) => (badField === name ? " is-bad" : "");

  return (
    <div className="adm-section adm-setup">
      <div className="adm-head-row">
        <h2>{t("adm.tab.setup")}</h2>
        {state === "ok" && <button className="btn-sm" onClick={load}>{t("adm.sec.refresh")}</button>}
      </div>
      <p className="adm-sub">{t("adm.setup.intro")}</p>
      {demo && <div className="adm-demo-banner">{t("adm.setup.demoNote")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.tenant.load_failed")}</div>}
      {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}

      {setup && (
        <div className="adm-card">
          <div className="adm-head-row">
            <h3>{t("adm.setup.stepsTitle")}</h3>
            {setup.completed_at
              ? <span className="adm-setup-done"><Icon name="checkCircle" size={15} /> {t("adm.setup.completedOn", { date: shortDate(setup.completed_at, lang) })}</span>
              : <span className="muted">{setup.pending ? t("adm.setup.pending", { n: setup.pending }) : t("adm.setup.allDone")}</span>}
          </div>
          <ul className="adm-sec-list">
            {setup.steps.map((s) => (
              <li key={s.key} className={s.ok === true ? "ok" : s.ok === false ? "fail" : "unknown"}>
                <span className="adm-sec-mark" aria-hidden="true"><Icon name={s.ok === true ? "check" : s.ok === false ? "close" : "info"} size={15} /></span>
                <span className="adm-sec-main">
                  <b>{t(`adm.setup.step.${s.key}`)}</b>
                  {s.detail ? <small className="muted"> · {s.detail}</small> : null}
                  {s.ok === false && <small className="adm-sec-hint">{t(`adm.setup.hint.${s.key}`)}</small>}
                  {s.ok === null && <small className="adm-sec-hint">{t("adm.setup.unknown")}</small>}
                </span>
                {s.ok !== true && s.tab !== "setup" && (
                  <button type="button" className="btn-sm" onClick={() => go?.(s.tab)}>
                    {t("adm.setup.go")} <Icon name="arrowRight" size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="adm-setup-actions">
            {setup.completed_at
              ? <button type="button" className="btn-sm" disabled={busy} onClick={() => finish(false)}>{t("adm.setup.reopen")}</button>
              : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => finish(true)}>{t("adm.setup.finish")}</button>}
          </div>
        </div>
      )}

      {state === "ok" && (
        <form className="adm-card" onSubmit={save}>
          <h3>{t("adm.setup.profileTitle")}</h3>
          <p className="adm-sub">{t("adm.setup.profileSub", { name: effective?.name || "" })}</p>
          <div className="adm-form-grid">
            <label className={`adm-field${bad("display_name")}`}>{t("adm.setup.f.display_name")}
              <input className="adm-input" value={form.display_name} maxLength={80} placeholder={effective?.name || ""} onChange={set("display_name")} />
            </label>
            <label className={`adm-field${bad("legal_name")}`}>{t("adm.setup.f.legal_name")}
              <input className="adm-input" value={form.legal_name} maxLength={160} onChange={set("legal_name")} />
            </label>
            <label className={`adm-field${bad("support_phone")}`}>{t("adm.setup.f.support_phone")}
              <input className="adm-input" type="tel" value={form.support_phone} placeholder="+1 713 555 0100" onChange={set("support_phone")} />
            </label>
            <label className={`adm-field${bad("whatsapp")}`}>{t("adm.setup.f.whatsapp")}
              <input className="adm-input" type="tel" value={form.whatsapp} placeholder="+1 713 555 0100" onChange={set("whatsapp")} />
            </label>
          </div>

          <h4 className="adm-setup-h4">{t("adm.setup.socialTitle")}</h4>
          <div className="adm-form-grid">
            {SOCIAL_NETWORKS.map((n) => (
              <label key={n} className={`adm-field${bad(`social.${n}`)}`}>{t(`adm.setup.net.${n}`)}
                <input className="adm-input" type="url" value={form.social[n] || ""} placeholder="https://" onChange={setSocial(n)} />
              </label>
            ))}
          </div>

          <h4 className="adm-setup-h4">{t("adm.setup.pickupTitle")}</h4>
          <label className="adm-setup-check">
            <input type="checkbox" checked={form.pickup_enabled} onChange={set("pickup_enabled")} /> {t("adm.setup.f.pickup_enabled")}
          </label>
          {form.pickup_enabled && (
            <div className="adm-form-grid">
              <label className={`adm-field${bad("pickup.name")}`}>{t("adm.setup.f.pickup_name")}
                <input className="adm-input" value={form.pickup_name} maxLength={80} onChange={set("pickup_name")} />
              </label>
              <label className={`adm-field${bad("pickup.address")}`}>{t("adm.setup.f.pickup_address")} *
                <input className="adm-input" value={form.pickup_address} maxLength={200} onChange={set("pickup_address")} />
              </label>
              {PICKUP_LANGS.map((l) => (
                <label key={l} className={`adm-field${bad(`pickup.hours.${l}`)}`}>{t(`adm.setup.f.pickup_hours_${l}`)}
                  <input className="adm-input" value={form.pickup_hours[l] || ""} maxLength={120} onChange={setHours(l)} />
                </label>
              ))}
              <label className={`adm-field${bad("pickup.maps_url")}`}>{t("adm.setup.f.pickup_maps")}
                <input className="adm-input" type="url" value={form.pickup_maps} placeholder="https://maps.google.com/…" onChange={set("pickup_maps")} />
              </label>
            </div>
          )}

          <div className="adm-setup-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? t("adm.auth.saving") : t("adm.setup.save")}</button>
          </div>
        </form>
      )}

      {state === "ok" && <BrandEditor />}
    </div>
  );
}
