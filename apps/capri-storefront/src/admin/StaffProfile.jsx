// Dónde se usa: pestaña «Mi perfil» de /admin (cualquier rol) y el editor de
// perfil de cada persona en la pestaña Equipo (dueño y superadmin).
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { formatAddressLine } from "../data/addressAutocomplete.js";
import AddressChoice from "./AddressChoice.jsx";
import AddressInput from "./AddressInput.jsx";
import Icon from "./icons.jsx";
import { PRIVILEGES, changeOwnPassword, fetchMyProfile, fetchProfile, saveMyProfile, saveProfile, signMeOutEverywhere } from "./adminTeam.js";
import { logout } from "./adminAuth.js";
import FieldError from "../components/FieldError.jsx";
import { emailProblem, LIMITS, phoneProblem, typedEmail, typedPhone } from "../data/fieldRules.js";

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

/** Photo upload/capture widget (also used by the Team form when creating a person). */
export function PhotoUpload({ value, onChange, disabled, t, optional = false }) {
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
      <legend>{t("adm.profile.g.photo")}{optional ? ` · ${t("adm.team.photoOptional")}` : ""}</legend>
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
  { key: "contact", fields: [["phone_mobile", "tel"], ["phone_whatsapp", "tel"], ["phone_landline", "tel"], ["email_alt", "email"], ["address", "address"]] },
  { key: "prefs", fields: [["alert_email", "email"], ["locale", "locale"]] },
  { key: "work", fields: [["hire_date", "date"], ["commission_pct", "number"], ["monthly_goal", "number"]], admin: true },
  { key: "emergency", fields: [["emergency_name", "text"], ["emergency_relation", "text"], ["emergency_phone", "tel"]], admin: true },
];

/** Mi contraseña, cuando la persona quiera: pide la actual. Formulario propio, separado de los datos del perfil. */
function OwnPassword() {
  const { t } = useLang();
  const { toast, confirm } = useFeedback();
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  // Every device, this one included: the server refuses the old tokens and the
  // panel returns to the login on purpose (a forgotten open session elsewhere
  // is exactly what this closes).
  const signOutAll = async () => {
    if (busy) return;
    const ok = await confirm({ tone: "danger", title: t("adm.profile.sessions.confirmTitle"), message: t("adm.profile.sessions.confirmBody"), confirmLabel: t("adm.profile.sessions.all") });
    if (!ok) return;
    setBusy(true);
    try {
      await signMeOutEverywhere();
      logout();
      window.location.reload();
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
      setBusy(false);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (f.next.length < 8) return toast({ tone: "error", title: t("adm.err.team.weak_password") });
    if (f.next !== f.again) return toast({ tone: "error", title: t("adm.team.gate.mismatch") });
    setBusy(true);
    try {
      await changeOwnPassword({ currentPassword: f.current, newPassword: f.next });
      setF({ current: "", next: "", again: "" });
      toast({ tone: "success", title: t("adm.profile.pw.done") });
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };
  return (
    <form className="adm-profile" onSubmit={submit} style={{ marginTop: 14 }}>
      <fieldset className="adm-profile-group" disabled={busy}>
        <legend>{t("adm.profile.pw.title")}</legend>
        <div className="adm-profile-grid">
          <label><span>{t("adm.profile.pw.current")}</span><input type="password" required autoComplete="current-password" value={f.current} onChange={set("current")} /></label>
          <label><span>{t("adm.profile.pw.new")}</span><input type="password" required minLength={8} autoComplete="new-password" value={f.next} onChange={set("next")} /></label>
          <label><span>{t("adm.profile.pw.again")}</span><input type="password" required minLength={8} autoComplete="new-password" value={f.again} onChange={set("again")} /></label>
        </div>
      </fieldset>
      <div className="adm-profile-actions">
        <button className="btn-sm primary" disabled={busy}><Icon name="lock" size={14} /> {busy ? "…" : t("adm.profile.pw.save")}</button>
        <button type="button" className="btn-sm" disabled={busy} onClick={signOutAll} title={t("adm.profile.sessions.help")}>
          <Icon name="logout" size={14} /> {t("adm.profile.sessions.all")}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>{t("adm.profile.sessions.help")}</p>
    </form>
  );
}

const toForm = (p) => {
  const f = {};
  for (const g of GROUPS) for (const [k] of g.fields) f[k] = p?.[k] ?? "";
  f.privileges = p?.privileges ?? [];
  f.internal_notes = p?.internal_notes ?? "";
  f.photo_url = p?.photo_url ?? null;
  return f;
};

/**
 * mode "self": la persona edita contacto, preferencias y su nombre para mostrar
 * y foto; el resto se ve en solo lectura. mode "admin": todo editable (dueño o
 * superadmin). El código de vendedor no lo escribe nadie.
 */
export default function StaffProfile({ mode = "self", userId = null, onSaved }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(toForm(null));
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [badField, setBadField] = useState(null);
  const [addressLink, setAddressLink] = useState(null);
  const isAdmin = mode === "admin";

  useEffect(() => {
    let on = true;
    setState("loading");
    (isAdmin ? fetchProfile(userId) : fetchMyProfile())
      .then((r) => {
        if (!on) return;
        setProfile(r.profile || {});
        setForm(toForm(r.profile));
        setAddressLink(r.address_link || null);
        setState("ok");
      })
      .catch(() => on && setState("error"));
    return () => { on = false; };
  }, [isAdmin, userId]);

  // La persona edita contacto, preferencias y su identidad (nombre para mostrar
  // y foto); las condiciones de trabajo y la emergencia, solo el dueño.
  // Misma lista que SELF_EDITABLE_FIELDS en lib/staff-profile.ts (backend).
  const editable = (group) => isAdmin || group === "contact" || group === "prefs" || group === "identity";
  // El código de recibos lo genera el sistema (lib/staff-code.ts): nadie lo escribe.
  const readOnly = (k) => k === "seller_code";
  const set = (k, typed = (v) => v) => (e) => { setBadField(null); setForm((f) => ({ ...f, [k]: typed(e.target.value) })); };
  const typedOf = (type) => (type === "tel" ? typedPhone : type === "email" ? typedEmail : undefined);
  const problemOf = (k, type) => (type === "tel" ? phoneProblem(form[k]) : type === "email" ? emailProblem(form[k]) : null);
  const fieldsWithProblems = GROUPS.filter((g) => editable(g.key) && g.fields[0][0] in (profile || {})).flatMap((g) => g.fields).filter(([k, type]) => problemOf(k, type));
  const togglePriv = (p) => setForm((f) => ({ ...f, privileges: f.privileges.includes(p) ? f.privileges.filter((x) => x !== p) : [...f.privileges, p] }));

  const chooseAddress = async (address_choice) => {
    if (busy) return;
    setBusy(true);
    try {
      const body = { address: form.address === "" ? null : form.address, address_choice };
      const r = await (isAdmin ? saveProfile(userId, body) : saveMyProfile(body));
      setProfile(r.profile || {});
      setForm(toForm(r.profile));
      setAddressLink(r.address_link || null);
      toast({ tone: "success", title: t("adm.profile.saved") });
      onSaved?.(r.profile);
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    if (busy || fieldsWithProblems.length) return;
    // Solo lo que cambió y lo que este modo puede escribir.
    const patch = {};
    for (const g of GROUPS) {
      if (!editable(g.key) || !(g.fields[0][0] in (profile || {}))) continue;
      for (const [k] of g.fields) if (!readOnly(k) && String(form[k] ?? "") !== String(profile?.[k] ?? "")) patch[k] = form[k] === "" ? null : form[k];
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
      setAddressLink(r.address_link || null);
      toast({ tone: "success", title: t("adm.profile.saved") });
      onSaved?.(r.profile);
    } catch (err) {
      // No es un error: dos direcciones distintas las decide quien edita, aquí mismo.
      if (err.reason === "address_conflict") {
        setAddressLink({ state: "conflict", other: err.other });
        return;
      }
      setBadField(err.field || null);
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  if (state === "loading") return <div className="adm-src-note loading">{t("adm.ord.loading")}</div>;
  if (state === "error") return <div className="adm-demo-banner">{t("adm.err.profile.loadFailed")}</div>;

  return (
    <>
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
                ) : type === "address" ? (
                  <AddressInput maxLength={200} value={form[k]} onChange={set(k)} onPick={(p) => { setBadField(null); setForm((f) => ({ ...f, [k]: formatAddressLine(p) })); }} />
                ) : (
                  <input
                    type={type === "code" ? "text" : type === "number" ? "number" : type}
                    step={type === "number" ? "0.01" : undefined}
                    value={form[k]}
                    onChange={set(k, typedOf(type))}
                    aria-invalid={problemOf(k, type) ? true : undefined}
                    maxLength={type === "code" ? 12 : type === "tel" ? LIMITS.phone : type === "email" ? LIMITS.email : undefined}
                    readOnly={readOnly(k)}
                    disabled={readOnly(k) || undefined}
                    placeholder={readOnly(k) ? t("adm.sel.codeAuto") : undefined}
                  />
                )}
                <FieldError error={problemOf(k, type)} />
              </label>
            ))}
          </div>
          {g.key === "contact" && addressLink && <AddressChoice state={addressLink.state} other={addressLink.other} place="record" busy={busy} onChoose={chooseAddress} />}
          {g.key === "identity" && <small className="muted">{t("adm.profile.codeHint")}</small>}
        </fieldset>
      ))}

      {/* En su propio perfil, solo los privilegios concedidos (sin la lista de todo lo que podría tener). */}
      {"privileges" in (profile || {}) && !isAdmin && form.privileges.length > 0 && (
        <fieldset className="adm-profile-group" disabled>
          <legend>{t("adm.profile.g.privileges")}</legend>
          <div className="adm-profile-privs">
            {form.privileges.map((p) => <span key={p} className="adm-chip ok"><Icon name="check" size={11} />{t(`adm.profile.priv.${p}`)}</span>)}
          </div>
        </fieldset>
      )}
      {"privileges" in (profile || {}) && isAdmin && (
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
        <button className="btn-sm primary" disabled={busy || fieldsWithProblems.length > 0}><Icon name="save" size={14} /> {busy ? "…" : t("adm.profile.save")}</button>
        {!isAdmin && <small className="muted">{t("adm.profile.selfHint")}</small>}
      </div>
    </form>
    {!isAdmin && <OwnPassword />}
    </>
  );
}
