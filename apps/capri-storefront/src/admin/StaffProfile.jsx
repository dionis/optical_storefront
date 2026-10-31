// Dónde se usa: pestaña «Mi perfil» de /admin (cualquier rol) y el editor de
// perfil de cada persona en la pestaña Equipo (dueño y superadmin).
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { PRIVILEGES, fetchMyProfile, fetchProfile, saveMyProfile, saveProfile } from "./adminTeam.js";

/* ── Photo helpers ─────────────────────────────────────────────── */
const MAX_PHOTO_BYTES = 200_000; // 200 KB of base64 text
const PHOTO_SIZE = 256;

/** Resize an image file/blob to a PHOTO_SIZE×PHOTO_SIZE JPEG data URL. */
function resizeToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = PHOTO_SIZE; c.height = PHOTO_SIZE;
      const ctx = c.getContext("2d");
      // Center-crop: use the shorter side as the square.
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
      const dataUrl = c.toDataURL("image/jpeg", 0.82);
      URL.revokeObjectURL(img.src);
      if (dataUrl.length > MAX_PHOTO_BYTES) { reject(new Error("tooBig")); return; }
      resolve(dataUrl);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error("badFormat")); };
    img.src = URL.createObjectURL(file);
  });
}

/** Load an image from a URL into a data URL (via a temporary image). */
function urlToDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = PHOTO_SIZE; c.height = PHOTO_SIZE;
      const ctx = c.getContext("2d");
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
      const dataUrl = c.toDataURL("image/jpeg", 0.82);
      if (dataUrl.length > MAX_PHOTO_BYTES) { reject(new Error("tooBig")); return; }
      resolve(dataUrl);
    };
    img.onerror = () => reject(new Error("urlFailed"));
    img.src = url;
  });
}

/** Photo upload/capture widget. */
function PhotoUpload({ value, onChange, disabled, t }) {
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const [urlMode, setUrlMode] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setLoading(true);
    try { onChange(await resizeToDataUrl(file)); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); e.target.value = ""; }
  }, [onChange]);

  const handleUrl = useCallback(async () => {
    const u = urlInput.trim();
    if (!u) return;
    setErr(null); setLoading(true);
    try { onChange(await urlToDataUrl(u)); setUrlMode(false); setUrlInput(""); }
    catch (ex) { setErr(ex.message === "tooBig" ? "tooBig" : "urlFailed"); }
    finally { setLoading(false); }
  }, [urlInput, onChange]);

  return (
    <fieldset className="adm-profile-group adm-photo-group" disabled={disabled}>
      <legend>{t("adm.profile.g.photo")}</legend>
      <div className="adm-photo-wrap">
        <div className="adm-photo-preview">
          {value
            ? <img src={value} alt="" className="adm-photo-img" />
            : <span className="adm-photo-placeholder"><Icon name="user" size={36} /></span>}
        </div>
        <div className="adm-photo-actions">
          {!disabled && <>
            <button type="button" className="btn-xs" onClick={() => cameraRef.current?.click()}>
              <Icon name="eye" size={13} /> {t("adm.profile.photo.camera")}
            </button>
            <button type="button" className="btn-xs" onClick={() => fileRef.current?.click()}>
              <Icon name="products" size={13} /> {t("adm.profile.photo.file")}
            </button>
            <button type="button" className="btn-xs" onClick={() => setUrlMode(u => !u)}>
              <Icon name="globe" size={13} /> {t("adm.profile.photo.url")}
            </button>
            {value && (
              <button type="button" className="btn-xs danger" onClick={() => { onChange(null); setErr(null); }}>
                <Icon name="close" size={13} /> {t("adm.profile.photo.remove")}
              </button>
            )}
          </>}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={handleFile} />
          <input ref={cameraRef} type="file" accept="image/*" capture="user" style={{ display: "none" }} onChange={handleFile} />
        </div>
        {urlMode && !disabled && (
          <div className="adm-photo-url-row">
            <input type="url" placeholder={t("adm.profile.photo.urlPlaceholder")} value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
            <button type="button" className="btn-xs primary" onClick={handleUrl} disabled={loading || !urlInput.trim()}>
              {t("adm.profile.photo.urlLoad")}
            </button>
          </div>
        )}
        {loading && <small className="adm-photo-hint muted">…</small>}
        {err && <small className="adm-photo-err">{t(`adm.profile.photo.${err}`)}</small>}
        {!err && !loading && <small className="adm-photo-hint muted">{t("adm.profile.photo.hint")}</small>}
      </div>
    </fieldset>
  );
}

/**
 * Grupos del perfil (documento funcional, «Perfil del vendedor»). Qué grupos
 * llegan lo decide el servidor (lib/staff-profile.ts viewProfile): aquí solo se
 * pinta lo que vino y se deja editar lo que el modo permite.
 */
const GROUPS = [
  { key: "identity", fields: [["display_name", "text"], ["seller_code", "code"]], admin: true },
  { key: "contact", fields: [["phone_mobile", "tel"], ["phone_whatsapp", "tel"], ["phone_landline", "tel"], ["email_alt", "email"], ["address", "text"]] },
  { key: "prefs", fields: [["alert_email", "email"], ["locale", "locale"]] },
  { key: "work", fields: [["hire_date", "date"], ["commission_pct", "number"], ["monthly_goal", "number"]], admin: true },
  { key: "emergency", fields: [["emergency_name", "text"], ["emergency_relation", "text"], ["emergency_phone", "tel"]], admin: true },
];

const toForm = (p) => {
  const f = {};
  for (const g of GROUPS) for (const [k] of g.fields) f[k] = p?.[k] ?? "";
  f.privileges = p?.privileges ?? [];
  f.internal_notes = p?.internal_notes ?? "";
  f.photo_url = p?.photo_url ?? null;
  return f;
};

/**
 * mode "self": la persona edita contacto y preferencias; el resto se ve en
 * solo lectura. mode "admin": todo editable (dueño o superadmin).
 */
export default function StaffProfile({ mode = "self", userId = null, onSaved }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(toForm(null));
  const [suggested, setSuggested] = useState(null);
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [badField, setBadField] = useState(null);
  const isAdmin = mode === "admin";

  useEffect(() => {
    let on = true;
    setState("loading");
    (isAdmin ? fetchProfile(userId) : fetchMyProfile())
      .then((r) => {
        if (!on) return;
        setProfile(r.profile || {});
        setForm(toForm(r.profile));
        setSuggested(r.suggested_seller_code || null);
        setState("ok");
      })
      .catch(() => on && setState("error"));
    return () => { on = false; };
  }, [isAdmin, userId]);

  const editable = (group) => isAdmin || group === "contact" || group === "prefs";
  const set = (k) => (e) => { setBadField(null); setForm((f) => ({ ...f, [k]: e.target.value })); };
  const togglePriv = (p) => setForm((f) => ({ ...f, privileges: f.privileges.includes(p) ? f.privileges.filter((x) => x !== p) : [...f.privileges, p] }));

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    // Solo lo que cambió y lo que este modo puede escribir.
    const patch = {};
    for (const g of GROUPS) {
      if (!editable(g.key) || !(g.fields[0][0] in (profile || {}))) continue;
      for (const [k] of g.fields) if (String(form[k] ?? "") !== String(profile?.[k] ?? "")) patch[k] = form[k] === "" ? null : form[k];
    }
    if (isAdmin) {
      const prev = profile?.privileges || [];
      if (prev.length !== form.privileges.length || prev.some((p) => !form.privileges.includes(p))) patch.privileges = form.privileges;
      if ((form.internal_notes || "") !== (profile?.internal_notes || "")) patch.internal_notes = form.internal_notes || null;
    }
    // Photo: always send if changed (available to both self and admin).
    if ((form.photo_url || null) !== (profile?.photo_url || null)) patch.photo_url = form.photo_url;
    if (!Object.keys(patch).length) return;
    setBusy(true);
    try {
      const r = await (isAdmin ? saveProfile(userId, patch) : saveMyProfile(patch));
      setProfile(r.profile || {});
      setForm(toForm(r.profile));
      setSuggested(null);
      toast({ tone: "success", title: t("adm.profile.saved") });
      onSaved?.(r.profile);
    } catch (err) {
      setBadField(err.field || null);
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  if (state === "loading") return <div className="adm-src-note loading">{t("adm.ord.loading")}</div>;
  if (state === "error") return <div className="adm-demo-banner">{t("adm.err.profile.loadFailed")}</div>;

  return (
    <form className="adm-profile" onSubmit={save}>
      <PhotoUpload
        value={form.photo_url}
        onChange={(v) => { setBadField(null); setForm((f) => ({ ...f, photo_url: v })); }}
        disabled={busy}
        t={t}
      />
      {GROUPS.filter((g) => g.fields[0][0] in (profile || {})).map((g) => (
        <fieldset key={g.key} className="adm-profile-group" disabled={!editable(g.key) || busy}>
          <legend>{t(`adm.profile.g.${g.key}`)}</legend>
          <div className="adm-profile-grid">
            {g.fields.map(([k, type]) => (
              <label key={k} className={badField === k ? "bad" : ""}>
                <span>{t(`adm.profile.f.${k}`)}</span>
                {type === "locale" ? (
                  <select value={form[k]} onChange={set(k)}>
                    <option value="">{t("adm.profile.localeDefault")}</option>
                    <option value="es">Español</option>
                    <option value="en">English</option>
                  </select>
                ) : (
                  <input
                    type={type === "code" ? "text" : type === "number" ? "number" : type}
                    step={type === "number" ? "0.01" : undefined}
                    value={form[k]}
                    onChange={set(k)}
                    placeholder={k === "seller_code" && suggested ? suggested : undefined}
                    maxLength={type === "code" ? 8 : undefined}
                  />
                )}
                {k === "seller_code" && suggested && !form.seller_code && isAdmin && (
                  <button type="button" className="btn-xs" onClick={() => setForm((f) => ({ ...f, seller_code: suggested }))}>
                    {t("adm.profile.useSuggested", { code: suggested })}
                  </button>
                )}
              </label>
            ))}
          </div>
          {g.key === "identity" && <small className="muted">{t("adm.profile.codeHint")}</small>}
        </fieldset>
      ))}

      {"privileges" in (profile || {}) && (
        <fieldset className="adm-profile-group" disabled={!isAdmin || busy}>
          <legend>{t("adm.profile.g.privileges")}</legend>
          <div className="adm-profile-privs">
            {PRIVILEGES.map((p) => (
              <label key={p}>
                <input type="checkbox" checked={form.privileges.includes(p)} onChange={() => togglePriv(p)} />
                {t(`adm.profile.priv.${p}`)}
              </label>
            ))}
          </div>
          <small className="muted">{t("adm.profile.privHint")}</small>
        </fieldset>
      )}

      {isAdmin && (
        <fieldset className="adm-profile-group" disabled={busy}>
          <legend>{t("adm.profile.g.notes")}</legend>
          <textarea rows={3} value={form.internal_notes} onChange={set("internal_notes")} aria-label={t("adm.profile.g.notes")} />
        </fieldset>
      )}

      <div className="adm-profile-actions">
        <button className="btn-sm primary" disabled={busy}><Icon name="save" size={14} /> {busy ? "…" : t("adm.profile.save")}</button>
        {!isAdmin && <small className="muted">{t("adm.profile.selfHint")}</small>}
      </div>
    </form>
  );
}
