// Dónde se usa: ficha de la persona (StaffProfile.jsx), como última sección.
//
// Datos de pago: cómo cobra, su número fiscal (SSN/ITIN/EIN) y su cuenta
// bancaria. Lo delicado de verdad del panel, así que:
//   · El servidor NO devuelve los números: esta pantalla solo recibe el banco y
//     «•••• 1234». No hay botón de ver ni de copiar — si se perdió el número se
//     vuelve a escribir. Así una sesión robada no se lleva un SSN.
//   · Los campos van con autoComplete="off" y el número fiscal como password,
//     para que no queden en el autorrelleno del navegador ni a la vista de quien
//     pase por detrás del mostrador.
//   · Al guardar, el campo vuelve a su máscara: la pantalla nunca se queda con
//     el número en memoria más de lo necesario.
//   · Sin clave de cifrado en el servidor no se guarda nada y se explica por qué.
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { fetchPayroll, savePayroll } from "./adminTeam.js";
import Icon from "./icons.jsx";

const PAY_METHODS = ["direct_deposit", "check", "cash", "zelle"];
const TAX_KINDS = ["ssn", "itin", "ein"];
const ACCOUNT_TYPES = ["checking", "savings"];
const EMPTY = { pay_method: "", tax_id_kind: "ssn", tax_id: "", bank_name: "", account_holder: "", account_type: "", routing_number: "", account_number: "" };
/** Solo dígitos y guiones mientras se teclea (el servidor se queda con los dígitos). */
const typedId = (v) => String(v ?? "").replace(/[^\d-]/g, "").slice(0, 20);

export default function StaffPayroll({ userId = null, canEdit = true }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [view, setView] = useState(null);
  const [state, setState] = useState("loading");
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [badField, setBadField] = useState(null);

  // La máscara se enseña como valor actual: mientras no se escriba encima, el
  // formulario manda «•••• 1234» y el servidor sabe que eso no cambia nada.
  const hydrate = (p) => {
    setView(p);
    setForm({
      pay_method: p.pay_method || "",
      tax_id_kind: p.tax_id_kind || "ssn",
      tax_id: p.tax_id_masked || "",
      bank_name: p.bank_name || "",
      account_holder: p.account_holder || "",
      account_type: p.account_type || "",
      routing_number: p.routing_masked || "",
      account_number: p.account_masked || "",
    });
  };

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetchPayroll(userId)
      .then((r) => { if (alive) { hydrate(r.payroll); setState("ready"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [userId]);

  const set = (k, clean) => (e) => { setBadField(null); setForm((f) => ({ ...f, [k]: clean ? clean(e.target.value) : e.target.value })); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await savePayroll(userId, form);
      hydrate(r.payroll); // vuelve a la máscara: el número no se queda en pantalla
      toast({ tone: "success", title: t("adm.pay.saved") });
    } catch (err) {
      setBadField(err.field || null);
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  if (state === "loading") return <div className="adm-src-note loading">{t("adm.ord.loading")}</div>;
  if (state === "error") return null; // la ficha ya avisa si no se pudo cargar

  const needsBank = form.pay_method === "direct_deposit";
  const locked = !canEdit || !view?.storage_ready || busy;

  return (
    <form className="adm-profile adm-payroll" onSubmit={submit}>
      <fieldset className="adm-profile-group" disabled={locked}>
        <legend><Icon name="lock" size={12} /> {t("adm.pay.g.payment")}</legend>
        <p className="adm-pay-note">{t("adm.pay.privacy")}</p>
        {!view?.storage_ready && <div className="adm-demo-banner">{t("adm.err.profile.payroll_key_missing")}</div>}
        <div className="adm-profile-grid">
          <label>
            <span>{t("adm.pay.f.method")}</span>
            <select value={form.pay_method} onChange={set("pay_method")}>
              <option value="">—</option>
              {PAY_METHODS.map((m) => <option key={m} value={m}>{t(`adm.pay.method.${m}`)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("adm.pay.f.taxKind")}</span>
            <select value={form.tax_id_kind} onChange={set("tax_id_kind")}>
              {TAX_KINDS.map((k) => <option key={k} value={k}>{t(`adm.pay.tax.${k}`)}</option>)}
            </select>
          </label>
          <label className={badField === "tax_id" ? "bad" : ""}>
            <span>{t("adm.pay.f.taxId")}</span>
            <input type="password" inputMode="numeric" autoComplete="off" spellCheck={false} value={form.tax_id}
                   onChange={set("tax_id", typedId)} onFocus={(e) => { if (e.target.value.includes("•")) setForm((f) => ({ ...f, tax_id: "" })); }}
                   placeholder={view?.tax_id_masked || "000-00-0000"} aria-label={t("adm.pay.f.taxId")} />
            <small className="muted">{t("adm.pay.f.taxIdHint")}</small>
          </label>
        </div>
      </fieldset>

      <fieldset className="adm-profile-group" disabled={locked}>
        <legend>{t("adm.pay.g.bank")}</legend>
        <div className="adm-profile-grid">
          <label>
            <span>{t("adm.pay.f.bankName")}</span>
            <input value={form.bank_name} onChange={set("bank_name")} autoComplete="off" maxLength={80} />
          </label>
          <label>
            <span>{t("adm.pay.f.holder")}</span>
            <input value={form.account_holder} onChange={set("account_holder")} autoComplete="off" maxLength={120} placeholder={t("adm.pay.f.holderPh")} />
          </label>
          <label>
            <span>{t("adm.pay.f.accountType")}</span>
            <select value={form.account_type} onChange={set("account_type")}>
              <option value="">—</option>
              {ACCOUNT_TYPES.map((k) => <option key={k} value={k}>{t(`adm.pay.acct.${k}`)}</option>)}
            </select>
          </label>
          <label className={badField === "routing_number" ? "bad" : ""}>
            <span>{t("adm.pay.f.routing")}</span>
            <input type="password" inputMode="numeric" autoComplete="off" spellCheck={false} value={form.routing_number}
                   onChange={set("routing_number", typedId)} onFocus={(e) => { if (e.target.value.includes("•")) setForm((f) => ({ ...f, routing_number: "" })); }}
                   placeholder={view?.routing_masked || "000000000"} aria-label={t("adm.pay.f.routing")} />
            <small className="muted">{t("adm.pay.f.routingHint")}</small>
          </label>
          <label className={badField === "account_number" ? "bad" : ""}>
            <span>{t("adm.pay.f.account")}</span>
            <input type="password" inputMode="numeric" autoComplete="off" spellCheck={false} value={form.account_number}
                   onChange={set("account_number", typedId)} onFocus={(e) => { if (e.target.value.includes("•")) setForm((f) => ({ ...f, account_number: "" })); }}
                   placeholder={view?.account_masked || ""} aria-label={t("adm.pay.f.account")} />
          </label>
        </div>
        {needsBank && (!view?.routing_masked || !view?.account_masked) && <div className="adm-demo-banner">{t("adm.pay.needsBank")}</div>}
      </fieldset>

      <div className="adm-profile-actions">
        <button className="btn-sm primary" disabled={locked}><Icon name="save" size={14} /> {busy ? "…" : t("adm.pay.save")}</button>
        {view?.updated_at && <small className="muted">{t("adm.pay.updated", { d: new Date(view.updated_at).toLocaleDateString() })}</small>}
      </div>
    </form>
  );
}
