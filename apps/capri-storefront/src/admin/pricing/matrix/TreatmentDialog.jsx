// Alta y edición de un tratamiento en «Productos y precios» → Tratamientos.
//   Alta    POST /admin/pricing/treatments. Fotocromático = costo Y precio por
//           tipo de lente (visión sencilla, bifocal, progresivo: cada uno cuesta
//           y se vende distinto; el tipo sin precio no se ofrece); antirreflejo
//           = un costo, un precio y el grupo de diseños donde se ofrece.
//   Edición POST /admin/pricing/treatments/:code (v2, desde el ⋯ de la fila):
//           nombres; fotocromático: costo y precio base de cada tipo (solo viaja
//           lo que cambia); antirreflejo: costo y grupo. Los precios POR TIENDA
//           son casillas de la matriz, así que aquí no se repiten.
// Los nombres van en los dos idiomas porque son lo que lee el cliente.
import { useState } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import Icon from "../../icons.jsx";
import { createTreatment, updateTreatment } from "../api.js";
import { knownErr } from "./BrandDialog.jsx";
import Modal from "./Modal.jsx";
import { PHOTO_CATS, photoFormFrom, treatmentCode, validateTreatmentForm } from "./model.js";

const CATS = PHOTO_CATS;
const money2 = (v) => (v == null ? "" : Number(v).toFixed(2));
const FIELD_OF = { bad_type: "type", bad_label: "label_es", bad_value: "price", code_taken: "label_es" };

export default function TreatmentDialog({ row = null, groups = [], costAccess = true, onClose, onCreated }) {
  const { t } = useLang();
  const editing = Boolean(row);
  const [form, setForm] = useState(() => {
    const emptyCats = Object.fromEntries(CATS.map((c) => [c, { cost: "", price: "" }]));
    if (row?.kind === "photo") {
      // Cost and base price of every lens type of this photochromic, from its rows.
      const initial = photoFormFrom(groups, treatmentCode(row));
      return {
        type: "photo",
        label_es: row.label_es || row.title || "",
        label_en: row.label_en || row.label_es || row.title || "",
        initial,
        cats: Object.fromEntries(CATS.map((c) => [c, { cost: money2(initial[c].cost), price: money2(initial[c].price) }])),
      };
    }
    return row ? {
    type: "ar",
    label_es: row.label_es || row.title || "",
    label_en: row.label_en || row.label_es || row.title || "",
    cost: row.cost_cents != null ? (Number(row.cost_cents) / 100).toFixed(2) : "",
    hadCost: row.cost_cents != null,
    prices: {},
    price: "",
    ar_group: row.ar_group || "all",
  } : { type: "photo", label_es: "", label_en: "", cost: "", cats: emptyCats, price: "", ar_group: "all" };
  });
  const [errors, setErrors] = useState({});
  const [serverErr, setServerErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setCat = (c, k, v) => setForm((f) => ({ ...f, cats: { ...(f.cats || {}), [c]: { ...((f.cats || {})[c] || {}), [k]: v } } }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const { errors: errs, body } = validateTreatmentForm(form, { editing });
    setErrors(errs);
    setServerErr(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const payload = costAccess ? body : { ...body, cost: undefined, costs: undefined };
      const res = editing ? await updateTreatment(treatmentCode(row), payload) : await createTreatment(payload);
      onCreated(res, { ...body, type: form.type }, { editing });
    } catch (err) {
      const k = String(err.message || "adm.err.pricing.save_failed");
      const reason = k.replace("adm.err.pricing.", "");
      if (FIELD_OF[reason]) setErrors({ [FIELD_OF[reason]]: reason });
      setServerErr(knownErr(t, k));
    } finally {
      setBusy(false);
    }
  };
  const errText = (field) => (errors[field] ? <small className="pm-f-err">{t(`adm.err.pricing.${errors[field]}`)}</small> : null);
  const photo = form.type === "photo";

  return (
    <Modal
      title={editing ? t("adm.pm.edit.treatTitle", { name: form.label_es }) : t("adm.pm.add.treatTitle")}
      sub={t(editing ? (form.type === "photo" ? "adm.pm.edit.treatSubPhoto" : "adm.pm.edit.treatSub") : "adm.pm.add.treatSub")}
      onClose={onClose}
      footer={
        <>
          {serverErr && <span className="pm-f-err grow" role="alert"><Icon name="alert" size={13} /> {t(serverErr)}</span>}
          <button type="button" className="btn-sm" onClick={onClose}>{t("adm.pm.cancel")}</button>
          <button type="submit" form="pm-treat" className="btn-sm primary" disabled={busy}>
            <Icon name={editing ? "save" : "plus"} size={14} /> {busy ? t("adm.pm.saving") : t(editing ? "adm.pm.save" : "adm.pm.add.create")}
          </button>
        </>
      }
    >
      <form id="pm-treat" className="pm-form" onSubmit={submit} noValidate>
        <div className="pm-f-row">
          <label className="pm-f">
            <span>{t("adm.pm.add.treatType")}</span>
            <span className="pp-seg">
              {["photo", "ar"].map((k) => (
                <button key={k} type="button" className={form.type === k ? "on" : ""} aria-pressed={form.type === k} disabled={editing} onClick={() => set("type", k)}>
                  <Icon name={k === "photo" ? "sun" : "sparkles"} size={14} /> {t(`adm.pm.treat.${k}`)}
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
        {photo ? (
          <>
            <table className="pm-cat-grid">
              <thead>
                <tr>
                  <th scope="col">{t("adm.pm.add.lensType")}</th>
                  {costAccess && <th scope="col" className="num">{t("adm.pm.col.cost")}</th>}
                  <th scope="col" className="num">{t("adm.pm.add.salePrice")}</th>
                </tr>
              </thead>
              <tbody>
                {CATS.map((c) => {
                  const cell = form.cats?.[c] || {};
                  const off = String(cell.price ?? "").trim() === "";
                  return (
                    <tr key={c} className={off ? "is-off" : ""}>
                      <th scope="row">{t(`adm.price.lenses.cat.${c}`)}</th>
                      {costAccess && (
                        <td>
                          <input className="pp-input pm-num" inputMode="decimal" value={cell.cost ?? ""} onChange={(e) => setCat(c, "cost", e.target.value)} placeholder="0.00"
                            aria-label={t("adm.pm.add.catCostAria", { type: t(`adm.price.lenses.cat.${c}`) })} aria-invalid={Boolean(errors[`cost:${c}`]) || undefined} />
                        </td>
                      )}
                      <td>
                        <input className="pp-input pm-num" inputMode="decimal" value={cell.price ?? ""} onChange={(e) => setCat(c, "price", e.target.value)} placeholder="—"
                          aria-label={t("adm.pm.add.catPriceAria", { type: t(`adm.price.lenses.cat.${c}`) })} aria-invalid={Boolean(errors[`price:${c}`] || errors.prices) || undefined} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(errors.prices || CATS.some((c) => errors[`price:${c}`] || errors[`cost:${c}`])) && <small className="pm-f-err">{t("adm.pm.add.photoPricesErr")}</small>}
            <small className="pm-f-hint">{t(editing ? "adm.pm.edit.photoHint" : "adm.pm.add.photoHint")}</small>
          </>
        ) : (
          <div className="pm-f-row">
            {costAccess && (
              <label className="pm-f num">
                <span>{t("adm.pm.col.cost")}</span>
                <input className="pp-input pm-num" inputMode="decimal" value={form.cost} onChange={(e) => set("cost", e.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.cost) || undefined} />
                {errText("cost")}
              </label>
            )}
            {!editing && (
              <label className="pm-f num">
                <span>{t("adm.pm.col.price")}</span>
                <input className="pp-input pm-num" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.price) || undefined} />
                {errText("price")}
              </label>
            )}
            <label className="pm-f grow">
              <span>{t("adm.pm.add.arGroup")}</span>
              <select className="pp-input" value={form.ar_group} onChange={(e) => set("ar_group", e.target.value)}>
                {["all", "sv", "bifprog"].map((g) => <option key={g} value={g}>{t(`adm.price.lenses.arGroup.${g}`)}</option>)}
              </select>
            </label>
          </div>
        )}
        {editing && !photo && <small className="pm-f-hint">{t("adm.pm.edit.treatPricesHint")}</small>}
      </form>
    </Modal>
  );
}
