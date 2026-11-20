// Dónde se usa: /admin → Configuración de la óptica → «Marca» (dentro de Setup.jsx).
// El dueño elige colores y sube sus logos; la vista previa muestra cabecera, botón,
// precio de oferta y la franja del correo antes de guardar. El servidor
// (POST /admin/tenant/brand) es quien exige el contraste; aquí solo se adelanta.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { TENANT } from "../config/tenant.js";
import { applyBrand } from "../config/brandRuntime.js";
import { contrastRatio, HEX_RE, MIN_CONTRAST } from "../config/brandVars.js";
import { fetchBrand, publishBrand, revertBrand, saveBrand, uploadLogo } from "./adminTenant.js";

// Colores con los que arranca el editor cuando no hay marca guardada: los que
// la tienda está pintando ahora mismo (variables CSS del build).
function currentCssColor(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return HEX_RE.test(v) ? v.toLowerCase() : fallback;
}

const ACCEPT = "image/png,image/webp,image/jpeg,image/svg+xml";

function ColorField({ label, value, onChange, ratio, t }) {
  const ok = ratio >= MIN_CONTRAST;
  return (
    <label className="adm-field">
      {label}
      <span className="adm-brand-color">
        <input type="color" value={HEX_RE.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <input className="adm-input" value={value} maxLength={7} onChange={(e) => onChange(e.target.value.trim())} />
      </span>
      {HEX_RE.test(value) && (
        <small className={ok ? "adm-brand-ok" : "adm-brand-bad"}>
          {t(ok ? "adm.brand.contrastOk" : "adm.brand.contrastLow", { ratio: ratio.toFixed(2), min: MIN_CONTRAST })}
        </small>
      )}
    </label>
  );
}

function LogoField({ label, url, fallback, busy, onFile, onClear, t }) {
  return (
    <div className="adm-field">
      {label}
      <div className="adm-brand-logo">
        <img src={url || fallback} alt="" />
        <label className="btn-sm adm-brand-upload">
          {busy ? t("adm.brand.uploading") : t("adm.brand.upload")}
          <input type="file" accept={ACCEPT} hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
        </label>
        {url && <button type="button" className="btn-sm" onClick={onClear}>{t("adm.brand.useBuildLogo")}</button>}
      </div>
    </div>
  );
}

export default function BrandEditor() {
  const { t } = useLang();
  const { toast, confirm } = useFeedback();
  const [state, setState] = useState("loading");
  const [saved, setSaved] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [canPublish, setCanPublish] = useState(false);
  const [form, setForm] = useState({ primary: "", accent: "", logo_url: "", logo_mark_url: "" });
  const [busy, setBusy] = useState("");

  const fill = (r) => {
    const b = r.brand;
    setSaved(b);
    setPrevious(r.previous ?? null);
    setForm({
      primary: b?.primary || currentCssColor("--primary-blue", "#01326b"),
      accent: b?.accent || currentCssColor("--red", "#d6123e"),
      logo_url: b?.logo_url || "",
      logo_mark_url: b?.logo_mark_url || "",
    });
  };

  useEffect(() => {
    fetchBrand()
      .then((r) => { fill(r); setCanPublish(Boolean(r.can_publish)); setState("ok"); })
      .catch(() => setState("error"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ratios = useMemo(() => ({
    primary: HEX_RE.test(form.primary) ? contrastRatio(form.primary, "#ffffff") : 0,
    accent: HEX_RE.test(form.accent) ? contrastRatio(form.accent, "#ffffff") : 0,
  }), [form.primary, form.accent]);
  const valid = ratios.primary >= MIN_CONTRAST && ratios.accent >= MIN_CONTRAST;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const after = (r, title) => {
    fill(r);
    applyBrand(r.brand);
    toast({ tone: "success", title: t(title) });
  };
  const fail = (err) => toast({
    tone: "error",
    title: t(err.message, { ratio: err.ratio ?? "", min: MIN_CONTRAST }),
  });

  const save = async () => {
    setBusy("save");
    try {
      after(await saveBrand({ primary: form.primary, accent: form.accent, logo_url: form.logo_url || null, logo_mark_url: form.logo_mark_url || null }), "adm.brand.saved");
    } catch (err) { fail(err); } finally { setBusy(""); }
  };
  const reset = async () => {
    const ok = await confirm({ title: t("adm.brand.resetTitle"), message: t("adm.brand.resetBody"), confirmLabel: t("adm.brand.reset") });
    if (!ok) return;
    setBusy("reset");
    try { after(await saveBrand({ reset: true }), "adm.brand.resetDone"); } catch (err) { fail(err); } finally { setBusy(""); }
  };
  const revert = async () => {
    setBusy("revert");
    try { after(await revertBrand(), "adm.brand.reverted"); } catch (err) { fail(err); } finally { setBusy(""); }
  };
  const publish = async () => {
    setBusy("publish");
    try {
      await publishBrand();
      toast({ tone: "success", title: t("adm.brand.published"), message: t("adm.brand.publishedSub") });
    } catch (err) { fail(err); } finally { setBusy(""); }
  };
  const upload = (kind) => async (file) => {
    setBusy(kind);
    try {
      const url = await uploadLogo(kind, file);
      setForm((f) => ({ ...f, [kind === "logo" ? "logo_url" : "logo_mark_url"]: url }));
      toast({ tone: "info", title: t("adm.brand.uploaded") });
    } catch (err) { fail(err); } finally { setBusy(""); }
  };

  if (state === "loading") return <div className="adm-card"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (state === "error") return <div className="adm-card"><div className="adm-demo-banner">{t("adm.err.brand.load_failed")}</div></div>;

  const primary = HEX_RE.test(form.primary) ? form.primary : "#01326b";
  const accent = HEX_RE.test(form.accent) ? form.accent : "#d6123e";
  const logo = form.logo_url || TENANT.logo;

  return (
    <div className="adm-card adm-brand">
      <div className="adm-head-row">
        <h3>{t("adm.brand.title")}</h3>
        <span className="muted">{saved ? t("adm.brand.custom") : t("adm.brand.fromBuild")}</span>
      </div>
      <p className="adm-sub">{t("adm.brand.sub")}</p>

      <div className="adm-brand-grid">
        <div>
          <div className="adm-form-grid">
            <ColorField label={t("adm.brand.primary")} value={form.primary} onChange={set("primary")} ratio={ratios.primary} t={t} />
            <ColorField label={t("adm.brand.accent")} value={form.accent} onChange={set("accent")} ratio={ratios.accent} t={t} />
          </div>
          <LogoField label={t("adm.brand.logo")} url={form.logo_url} fallback={TENANT.logo} busy={busy === "logo"} onFile={upload("logo")} onClear={() => set("logo_url")("")} t={t} />
          <LogoField label={t("adm.brand.logoMark")} url={form.logo_mark_url} fallback={TENANT.logoMark} busy={busy === "logo_mark"} onFile={upload("logo_mark")} onClear={() => set("logo_mark_url")("")} t={t} />
          <small className="muted">{t("adm.brand.logoRules")}</small>
        </div>

        <div className="adm-brand-preview" aria-label={t("adm.brand.preview")}>
          <small className="muted">{t("adm.brand.preview")}</small>
          <div className="adm-brand-pv-header" style={{ background: primary }}>
            <img src={logo} alt="" />
          </div>
          <div className="adm-brand-pv-body">
            <b style={{ color: primary }}>{t("adm.brand.pvProduct")}</b>
            <span className="adm-brand-pv-price" style={{ color: accent }}>$129.00</span>
            <button type="button" tabIndex={-1} style={{ background: primary }}>{t("adm.brand.pvButton")}</button>
            <span className="adm-brand-pv-badge" style={{ background: accent }}>{t("adm.brand.pvBadge")}</span>
          </div>
          <div className="adm-brand-pv-mail" style={{ borderLeftColor: accent }}>
            <div style={{ background: primary }}><img src={logo} alt="" /></div>
            <p>{t("adm.brand.pvMail")}</p>
          </div>
        </div>
      </div>

      <div className="adm-setup-actions">
        {saved && <button type="button" className="btn-sm" disabled={Boolean(busy)} onClick={reset}>{t("adm.brand.reset")}</button>}
        {previous && <button type="button" className="btn-sm" disabled={Boolean(busy)} onClick={revert}>{t("adm.brand.revert")}</button>}
        {canPublish && saved && <button type="button" className="btn-sm" disabled={Boolean(busy)} onClick={publish}>{busy === "publish" ? t("adm.brand.publishing") : t("adm.brand.publish")}</button>}
        <button type="button" className="btn btn-primary" disabled={!valid || Boolean(busy)} onClick={save}>{busy === "save" ? t("adm.auth.saving") : t("adm.brand.save")}</button>
      </div>
      {!canPublish && saved && <small className="muted">{t("adm.brand.noPublish")}</small>}
    </div>
  );
}
