// Alta de un tratamiento desde «Productos y precios» → Tratamientos:
// POST /admin/pricing/treatments. Fotocromático = un precio por tipo de lente
// (visión sencilla, bifocal, progresivo; el que se deje vacío no se ofrece en
// ese tipo); antirreflejo = un solo precio y el grupo de diseños donde se
// ofrece. Los nombres van en los dos idiomas porque son lo que lee el cliente.
import { useState } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import Icon from "../../icons.jsx";
import { createTreatment } from "../api.js";
import Modal from "./Modal.jsx";
import { validateTreatmentForm } from "./model.js";

const CATS = ["sv", "bifocal", "prog"];
const FIELD_OF = { bad_type: "type", bad_label: "label_es", bad_value: "price", code_taken: "label_es" };

export default function AddTreatmentDialog({ costAccess = true, onClose, onCreated }) {
  const { t } = useLang();
  const [form, setForm] = useState({ type: "photo", label_es: "", label_en: "", cost: "", prices: {}, price: "", ar_group: "all" });
  const [errors, setErrors] = useState({});
  const [serverErr, setServerErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const { errors: errs, body } = validateTreatmentForm(form);
    setErrors(errs);
    setServerErr(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await createTreatment(costAccess ? body : { ...body, cost: undefined });
      onCreated(res, body);
    } catch (err) {
      const k = String(err.message || "adm.err.pricing.save_failed");
      const reason = k.replace("adm.err.pricing.", "");
      if (FIELD_OF[reason]) setErrors({ [FIELD_OF[reason]]: reason });
      setServerErr(k);
    } finally {
      setBusy(false);
    }
  };
  const errText = (field) => (errors[field] ? <small className="pm-f-err">{t(`adm.err.pricing.${errors[field]}`)}</small> : null);
  const photo = form.type === "photo";

  return (
    <Modal
      title={t("adm.pm.add.treatTitle")}
      sub={t("adm.pm.add.treatSub")}
      onClose={onClose}
      footer={
        <>
          {serverErr && <span className="pm-f-err grow" role="alert"><Icon name="alert" size={13} /> {t(serverErr)}</span>}
          <button type="button" className="btn-sm" onClick={onClose}>{t("adm.pm.cancel")}</button>
          <button type="submit" form="pm-add-treat" className="btn-sm primary" disabled={busy}>
            <Icon name="plus" size={14} /> {busy ? t("adm.pm.saving") : t("adm.pm.add.create")}
          </button>
        </>
      }
    >
      <form id="pm-add-treat" className="pm-form" onSubmit={submit} noValidate>
        <div className="pm-f-row">
          <label className="pm-f">
            <span>{t("adm.pm.add.treatType")}</span>
            <span className="pp-seg">
              {["photo", "ar"].map((k) => (
                <button key={k} type="button" className={form.type === k ? "on" : ""} onClick={() => set("type", k)}>
                  <Icon name={k === "photo" ? "sun" : "sparkles"} size={13} /> {t(`adm.pm.treat.${k}`)}
                </button>
              ))}
            </span>
            {errText("type")}
          </label>
        </div>
        <div className="pm-f-row">
          <label className="pm-f grow">
            <span>{t("adm.pm.add.labelEs")}</span>
            <input className="pp-input" value={form.label_es} onChange={(e) => set("label_es", e.target.value)} placeholder={t(photo ? "adm.pm.add.labelPhotoPh" : "adm.pm.add.labelArPh")} aria-invalid={Boolean(errors.label_es) || undefined} />
            {errText("label_es")}
          </label>
          <label className="pm-f grow">
            <span>{t("adm.pm.add.labelEn")}</span>
            <input className="pp-input" value={form.label_en} onChange={(e) => set("label_en", e.target.value)} placeholder={t(photo ? "adm.pm.add.labelPhotoPh" : "adm.pm.add.labelArPh")} aria-invalid={Boolean(errors.label_en) || undefined} />
            {errText("label_en")}
          </label>
        </div>
        <div className="pm-f-row">
          {costAccess && (
            <label className="pm-f num">
              <span>{t("adm.pm.col.cost")}</span>
              <input className="pp-input pm-num" inputMode="decimal" value={form.cost} onChange={(e) => set("cost", e.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.cost) || undefined} />
              {errText("cost")}
            </label>
          )}
          {photo ? (
            CATS.map((c) => (
              <label className="pm-f num" key={c}>
                <span>{t(`adm.price.lenses.cat.${c}`)}</span>
                <input className="pp-input pm-num" inputMode="decimal" value={form.prices[c] ?? ""} onChange={(e) => set("prices", { ...form.prices, [c]: e.target.value })} placeholder="—" aria-invalid={Boolean(errors[`price:${c}`] || errors.prices) || undefined} />
              </label>
            ))
          ) : (
            <>
              <label className="pm-f num">
                <span>{t("adm.pm.col.price")}</span>
                <input className="pp-input pm-num" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.price) || undefined} />
                {errText("price")}
              </label>
              <label className="pm-f grow">
                <span>{t("adm.pm.add.arGroup")}</span>
                <select className="pp-input" value={form.ar_group} onChange={(e) => set("ar_group", e.target.value)}>
                  {["all", "sv", "bifprog"].map((g) => <option key={g} value={g}>{t(`adm.price.lenses.arGroup.${g}`)}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        {photo && (errors.prices || CATS.some((c) => errors[`price:${c}`])) && <small className="pm-f-err">{t("adm.pm.add.photoPricesErr")}</small>}
        {photo && <small className="pm-f-hint">{t("adm.pm.add.photoHint")}</small>}
      </form>
    </Modal>
  );
}
