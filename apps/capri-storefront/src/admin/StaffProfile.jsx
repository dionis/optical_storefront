// Dónde se usa: pestaña «Mi perfil» de /admin (cualquier rol) y el editor de
// perfil de cada persona en la pestaña Equipo (dueño y superadmin).
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { PRIVILEGES, fetchMyProfile, fetchProfile, saveMyProfile, saveProfile } from "./adminTeam.js";

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
