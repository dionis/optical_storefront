// Dónde se usa: pestaña Equipo de /admin — alta de usuarios con contraseña temporal de un solo primer uso y su rol; el dueño no puede eliminarse ni cambiar de rol.
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { shortDate } from "./adminOrders.js";
import { fetchTeam, createAdmin, deleteAdmin, setRole, setStores, ASSIGNABLE_ROLES, roleKey } from "./adminTeam.js";
import { fetchStores } from "./adminStores.js";
import { fetchSellers } from "./adminSellers.js";
import { listTerminals } from "./posApi.js";
import StaffProfile from "./StaffProfile.jsx";

const isAdminRole = (role) => role === "owner" || role === "superadmin";

/**
 * Ficha de vendedor de un usuario con rol VENDEDOR: una existente (activa y
 * libre) o una nueva con tienda y su único punto de venta. El servidor aplica
 * la misma regla (lib/seller-link.ts); aquí solo se evita el viaje.
 */
const EMPTY_LINK = { mode: "existing", seller_id: "", establishment_id: "", terminal_id: "", commission_pct: "10", code: "" };
const linkMissing = (l) => (l.mode === "existing" ? !l.seller_id : !l.establishment_id || !l.terminal_id);
const linkPayload = (l) => (l.mode === "existing"
  ? { seller_id: l.seller_id }
  : { create: { establishment_id: l.establishment_id, terminal_id: l.terminal_id, commission_pct: Number(l.commission_pct) || 0, code: l.code.trim().toUpperCase() } });

function SellerLinkFields({ value, onChange, userId = null, sellers, stores, terminals, disabled }) {
  const { t } = useLang();
  const set = (patch) => onChange({ ...value, ...patch });
  const free = sellers.filter((s) => s.active && (!s.user_id || s.user_id === userId));
  const storeOf = (id) => stores.find((x) => x.id === id);
  const tillOf = (id) => terminals.find((x) => x.id === id);
  const activeStores = stores.filter((x) => x.is_active);
  const tills = terminals.filter((p) => p.establishment_id === value.establishment_id && p.is_active);
  const pickStore = (id) => {
    const own = terminals.filter((p) => p.establishment_id === id && p.is_active);
    set({ establishment_id: id, terminal_id: own.length === 1 ? own[0].id : "" });
  };
  return (
    <fieldset className="adm-team-seller" disabled={disabled}>
      <legend>{t("adm.team.seller.title")}</legend>
      <p className="adm-sub">{t("adm.team.seller.hint")}</p>
      <div className="adm-range">
        <button type="button" className={value.mode === "existing" ? "on" : ""} onClick={() => set({ mode: "existing" })}>{t("adm.team.seller.existing")}</button>
        <button type="button" className={value.mode === "new" ? "on" : ""} onClick={() => set({ mode: "new" })}>{t("adm.team.seller.new")}</button>
      </div>
      {value.mode === "existing" ? (
        <label className="adm-field">{t("adm.team.seller.pick")}
          <select className="adm-input" required value={value.seller_id} onChange={(e) => set({ seller_id: e.target.value })}>
            <option value="">{free.length ? t("adm.team.seller.pickPh") : t("adm.team.seller.noneFree")}</option>
            {free.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name} — {storeOf(s.establishment_id)?.code || "?"} / {tillOf(s.terminal_id)?.code || "?"}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="adm-form-grid">
          <label className="adm-field">{t("adm.sel.store")} *
            <select className="adm-input" required value={value.establishment_id} onChange={(e) => pickStore(e.target.value)}>
              <option value="">{t("adm.sel.storeNone")}</option>
              {activeStores.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
            </select>
          </label>
          <label className="adm-field">{t("adm.pos.terminal")} *
            <select className="adm-input" required disabled={!value.establishment_id} value={value.terminal_id} onChange={(e) => set({ terminal_id: e.target.value })}>
              <option value="">{value.establishment_id && !tills.length ? t("adm.sel.terminalNoneInStore") : t("adm.sel.terminalNone")}</option>
              {tills.map((p) => <option key={p.id} value={p.id}>{p.name ? `${p.code} · ${p.name}` : p.code}</option>)}
            </select>
          </label>
          <label className="adm-field">{t("adm.sel.commission")}
            <input className="adm-input" type="number" min="0" max="100" step="0.5" value={value.commission_pct} onChange={(e) => set({ commission_pct: e.target.value })} />
          </label>
          <label className="adm-field">{t("adm.sel.code")}
            <input className="adm-input" maxLength={12} value={value.code} placeholder={t("adm.sel.codePh")} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
          </label>
        </div>
      )}
    </fieldset>
  );
}

/** Lo que muestra la fila de un vendedor: su ficha (tienda / punto de venta) o el aviso de que no tiene. */
function SellerRecordTag({ member, stores, terminals }) {
  const { t } = useLang();
  const s = member.seller;
  if (!s) return <span className="adm-team-tag temp" title={t("adm.team.seller.missingHint")}><Icon name="alert" size={12} /> {t("adm.team.seller.missing")}</span>;
  const store = stores.find((x) => x.id === s.establishment_id);
  const till = terminals.find((x) => x.id === s.terminal_id);
  return (
    <span className={`adm-team-tag ${s.active ? "" : "temp"}`} title={t("adm.team.seller.recordTitle")}>
      <Icon name="store" size={12} /> {store?.code || "?"} / {till?.code || "?"}{s.active ? "" : ` · ${t("adm.sel.off")}`}
    </span>
  );
}

/**
 * Tiendas de una persona: "Todas" o una lista. Un desplegable con casillas; se
 * guarda al cerrar, no en cada clic, para no reescribir sus filas por casilla.
 */
function StorePicker({ member, stores, disabled, onSave }) {
  const { t } = useLang();
  const current = member.establishment_ids || [];
  const [picked, setPicked] = useState(current);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) setPicked(member.establishment_ids || []); }, [member.establishment_ids, open]);

  const active = stores.filter((s) => s.is_active || current.includes(s.id));
  const label = current.length === 0
    ? t("adm.team.storesAll")
    : current.map((id) => stores.find((s) => s.id === id)?.code || "?").join(", ");
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const close = () => {
    setOpen(false);
    const same = picked.length === current.length && picked.every((id) => current.includes(id));
    if (!same) onSave(picked);
  };

  return (
    <details className="adm-team-stores" open={open} onToggle={(e) => (e.currentTarget.open ? setOpen(true) : close())}>
      <summary className="adm-team-role" aria-label={t("adm.team.stores")} title={t("adm.team.stores")}>
        <Icon name="store" size={12} /> {label}
      </summary>
      <div className="adm-team-stores-menu">
        {active.length === 0 && <small className="muted">{t("adm.team.storesNone")}</small>}
        {active.map((s) => (
          <label key={s.id}>
            <input type="checkbox" disabled={disabled} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
            <b>{s.code}</b> {s.name}
          </label>
        ))}
        <small className="muted">{t("adm.team.storesHint")}</small>
      </div>
    </details>
  );
}

/**
 * EQUIPO — personas que usan el panel y su rol.
 *  · El DUEÑO (el usuario más antiguo) lleva sello y NO tiene botón de borrar
 *    ni selector de rol: el sistema jamás se queda sin su administrador raíz.
 *  · Crear un usuario pide email + contraseña TEMPORAL abierta + rol: entra con
 *    ella UNA vez y el panel le exige poner la suya antes de ver nada (candado
 *    must_change_password, ver AdminPage).
 *  · Solo el dueño nombra o quita superadmins; nadie cambia su propio rol ni se
 *    borra a sí mismo. El panel solo ofrece lo que el backend aceptaría, pero la
 *    regla vive allí (lib/staff-roles.ts) y es la que manda.
 */
export default function Team() {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const demo = isDemoLogin();
  const [team, setTeam] = useState([]);
  const [meId, setMeId] = useState(null);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "", role: "" });
  const [newLink, setNewLink] = useState(EMPTY_LINK);
  // Fila cuya ficha de vendedor se está eligiendo: { id, role, link }.
  const [linking, setLinking] = useState(null);
  const [sellers, setSellers] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const myRole = team.find((m) => m.id === meId)?.role ?? null;
  const iAmOwner = myRole === "owner";
  // Roles que puedo dar: el superadmin solo puede darlo el dueño.
  const grantable = ASSIGNABLE_ROLES.filter((r) => iAmOwner || r !== "superadmin");
  const newRole = form.role || grantable[0];
  const canEditRole = (m) => !m.is_super && m.id !== meId && (iAmOwner || m.role !== "superadmin");

  const [stores, setStoreList] = useState([]);
  // Persona cuyo perfil está abierto bajo su fila.
  const [openProfile, setOpenProfile] = useState(null);

  const load = () => {
    if (demo) return;
    setState("loading");
    fetchTeam()
      .then((r) => { setTeam(r.team || []); setMeId(r.me || null); setState("ok"); })
      .catch(() => setState("error"));
    // Sin tiendas (o sin backend de tiendas aún) el selector simplemente no aparece.
    fetchStores().then((r) => setStoreList(r.establishments || [])).catch(() => setStoreList([]));
    fetchSellers().then((r) => setSellers(r.sellers || [])).catch(() => setSellers([]));
    listTerminals().then((r) => setTerminals(r.terminals || [])).catch(() => setTerminals([]));
  };
  useEffect(load, [demo]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await createAdmin({ ...form, role: newRole, seller: newRole === "seller" ? linkPayload(newLink) : undefined });
      setTeam(r.team || []);
      setForm({ email: "", password: "", firstName: "", lastName: "", role: "" });
      setNewLink(EMPTY_LINK);
      fetchSellers().then((x) => setSellers(x.sellers || [])).catch(() => {});
      toast({ tone: "success", title: t("adm.team.created"), message: t("adm.team.createdSub") });
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const remove = async (m) => {
    const ok = await confirm({
      tone: "danger",
      title: t("adm.team.deleteConfirm", { email: m.email }),
      message: t("adm.team.deleteBody"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await deleteAdmin(m.id);
      setTeam(r.team || []);
      toast({ tone: "success", title: t("adm.team.deleted", { email: m.email }) });
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const changeStores = async (m, ids) => {
    setBusy(true);
    try {
      const r = await setStores(m.id, ids);
      setTeam(r.team || []);
      toast({ tone: "success", title: t("adm.team.storesSaved", { email: m.email }) });
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const changeRole = async (m, role, seller) => {
    if (role === m.role && !seller) return;
    // Pasar a vendedor necesita su ficha: se elige antes de llamar al servidor.
    if (role === "seller" && !seller) { setLinking({ id: m.id, role, link: EMPTY_LINK }); return; }
    setBusy(true);
    try {
      const r = await setRole(m.id, role, seller);
      setTeam(r.team || []);
      setLinking(null);
      if (seller || m.role === "seller") fetchSellers().then((x) => setSellers(x.sellers || [])).catch(() => {});
      toast({ tone: "success", title: t("adm.team.roleChanged", { email: m.email, role: t(roleKey(role)) }) });
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  return (
    <div className="adm-section">
      <div className="adm-head-row"><h2>{t("adm.team.title")}</h2></div>
      {demo && <div className="adm-demo-banner">{t("adm.team.demoNote")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.team.loadFailed")}</div>}

      {/* Alta de un nuevo administrador */}
      <div className="adm-card">
        <h3>{t("adm.team.newTitle")}</h3>
        <p className="adm-sub">{t("adm.team.newSub")}</p>
        <form className="adm-team-form" onSubmit={submit}>
          <input type="email" required placeholder={t("adm.team.email")} value={form.email} onChange={set("email")} autoComplete="off" />
          <input type="text" required minLength={8} placeholder={t("adm.team.tempPass")} value={form.password} onChange={set("password")} autoComplete="off" />
          <input placeholder={t("adm.team.firstName")} value={form.firstName} onChange={set("firstName")} />
          <input placeholder={t("adm.team.lastName")} value={form.lastName} onChange={set("lastName")} />
          <select aria-label={t("adm.team.role")} title={t("adm.team.role")} value={newRole} onChange={set("role")}>
            {grantable.map((r) => <option key={r} value={r}>{t(roleKey(r))}</option>)}
          </select>
          <button className="btn-sm primary" disabled={demo || busy || (newRole === "seller" && linkMissing(newLink))}>{busy ? "…" : t("adm.team.create")}</button>
        </form>
        {newRole === "seller" && (
          <SellerLinkFields value={newLink} onChange={setNewLink} sellers={sellers} stores={stores} terminals={terminals} disabled={demo || busy} />
        )}
      </div>

      {/* Lista del equipo */}
      <div className="adm-card">
        <h3>{t("adm.team.listTitle", { n: team.length })}</h3>
        {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
        <div className="adm-team-rows">
          {team.map((m) => (
            <div key={m.id} className="adm-team-item">
            <div className={`adm-team-row ${m.is_super ? "super" : ""}`}>
              <span className="adm-team-avatar">{(m.first_name || m.email)[0].toUpperCase()}</span>
              <span className="adm-team-main">
                <b>{[m.first_name, m.last_name].filter(Boolean).join(" ") || m.email}</b>
                <small className="muted">{m.email} · {shortDate(m.created_at, lang)}</small>
              </span>
              {m.seller_code && <span className="adm-team-tag code" title={t("adm.profile.f.seller_code")}>{m.seller_code}</span>}
              {m.is_super && <span className="adm-team-tag super"><Icon name="sparkles" size={12} /> {t("adm.team.super")}</span>}
              {m.id === meId && <span className="adm-team-tag me">{t("adm.team.you")}</span>}
              {m.must_change_password && <span className="adm-team-tag temp">{t("adm.team.tempTag")}</span>}
              {m.role_legacy && <span className="adm-team-tag legacy" title={t("adm.team.roleLegacy")}>{t("adm.team.roleLegacyTag")}</span>}
              {canEditRole(m) ? (
                <select className="adm-team-role" aria-label={t("adm.team.role")} title={t("adm.team.role")}
                  value={linking?.id === m.id ? linking.role : m.role ?? ""} disabled={busy || demo} onChange={(e) => (e.target.value === m.role ? setLinking(null) : changeRole(m, e.target.value))}>
                  {m.role == null && <option value="" disabled>{t(roleKey(null))}</option>}
                  {grantable.map((r) => <option key={r} value={r}>{t(roleKey(r))}</option>)}
                </select>
              ) : (
                !m.is_super && <span className="adm-team-role-label">{t(roleKey(m.role))}</span>
              )}
              {m.role === "seller" ? (
                <>
                  <SellerRecordTag member={m} stores={stores} terminals={terminals} />
                  {canEditRole(m) && (
                    <button className="btn-xs" disabled={busy || demo} onClick={() => setLinking((l) => (l?.id === m.id ? null : { id: m.id, role: "seller", link: EMPTY_LINK }))}>
                      <Icon name="link" size={12} /> {m.seller ? t("adm.team.seller.change") : t("adm.team.seller.link")}
                    </button>
                  )}
                </>
              ) : m.role && !isAdminRole(m.role) && stores.length > 0 && (
                <StorePicker member={m} stores={stores} disabled={busy || demo} onSave={(ids) => changeStores(m, ids)} />
              )}
              {!m.is_super && m.id !== meId && (iAmOwner || m.role !== "superadmin") && (
                <button className="btn-xs warn" disabled={busy || demo} onClick={() => remove(m)}>
                  {t("adm.team.delete")}
                </button>
              )}
              {!demo && (
                <button className="btn-xs" aria-expanded={openProfile === m.id} onClick={() => setOpenProfile((o) => (o === m.id ? null : m.id))}>
                  <Icon name="user" size={12} /> {t("adm.team.profile")}
                </button>
              )}
            </div>
            {linking?.id === m.id && (
              <div className="adm-team-profile">
                <SellerLinkFields value={linking.link} onChange={(link) => setLinking((l) => ({ ...l, link }))} userId={m.id} sellers={sellers} stores={stores} terminals={terminals} disabled={busy || demo} />
                <div className="adm-actions" style={{ marginTop: 10 }}>
                  <button className="btn-sm primary" disabled={busy || demo || linkMissing(linking.link)} onClick={() => changeRole(m, "seller", linkPayload(linking.link))}>
                    <Icon name="save" size={14} /> {t("adm.team.seller.save")}
                  </button>
                  <button className="btn-sm" onClick={() => setLinking(null)}>{t("adm.ord.cancel")}</button>
                </div>
              </div>
            )}
            {openProfile === m.id && (
              <div className="adm-team-profile">
                <StaffProfile mode="admin" userId={m.id} onSaved={(p) => setTeam((list) => list.map((x) => (x.id === m.id ? { ...x, seller_code: p.seller_code ?? null } : x)))} />
              </div>
            )}
            </div>
          ))}
          {state === "ok" && team.length === 0 && <div className="adm-nodata">{t("adm.chart.noData")}</div>}
        </div>
        <p className="adm-sub adm-team-note">{t("adm.team.superNote")}</p>
        <p className="adm-sub">{t("adm.team.roleNote")}</p>
      </div>
    </div>
  );
}
