// Alta y edición de un DISEÑO de lente en «Productos y precios» → Lentes
// (Visión sencilla, Bifocal FT-28, Progresivo gama media…; docs/PRICE-MATRIX.md §12).
//   Alta    POST /admin/pricing/lens-designs: nombre en los dos idiomas, tipo
//           (visión sencilla, bifocal o progresivo; no cambia después), si pide
//           ADD, y para los progresivos la gama y «para quién».
//   Edición POST /admin/pricing/lens-designs/:code (solo lo que cambia).
// Los materiales y sus precios se añaden después desde el ⋯ del diseño.
import { useState } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import Icon from "../../icons.jsx";
import { createLensDesign, updateLensDesign } from "../api.js";
import { knownErr } from "./BrandDialog.jsx";
import Modal from "./Modal.jsx";

const CATS = ["sv", "bifocal", "prog"];
const FIELD_OF = { bad_label: "label_es", bad_category: "category", code_taken: "label_es", bad_value: "tier" };

export default function LensDesignDialog({ group = null, onClose, onSaved }) {
  const { t } = useLang();
  const editing = Boolean(group);
  const d = group?.design || {};
  const initial = {
    label_es: d.label_es || group?.label || "",
    label_en: d.label_en || group?.label_en || "",
    category: d.category || "sv",
    requires_add: editing ? Boolean(d.requires_add) : false,
    tier: d.tier || "",
    use_es: d.use_es || "",
    use_en: d.use_en || "",
  };
  const [form, setForm] = useState(initial);
  const [touchedAdd, setTouchedAdd] = useState(editing);
  const [errors, setErrors] = useState({});
  const [serverErr, setServerErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // ADD por defecto según el tipo (bifocal y progresivo la piden) hasta que se toque a mano.
  const setCategory = (c) => setForm((f) => ({ ...f, category: c, requires_add: touchedAdd ? f.requires_add : c !== "sv" }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const es = form.label_es.trim();
    const en = form.label_en.trim();
    const errs = {};
    if (!es && !en) errs.label_es = "bad_label";
    setErrors(errs);
    setServerErr(null);
    if (Object.keys(errs).length) return;
    const body = {};
    if (!editing) Object.assign(body, { label_es: es || en, label_en: en || es, category: form.category, requires_add: form.requires_add, tier: form.tier.trim(), use_es: form.use_es.trim(), use_en: form.use_en.trim() });
    else {
      for (const k of ["label_es", "label_en", "tier", "use_es", "use_en"]) if (form[k].trim() !== String(initial[k] || "").trim()) body[k] = form[k].trim();
      if (form.requires_add !== initial.requires_add) body.requires_add = form.requires_add;
      if (body.label_es === "" ) delete body.label_es;
      if (body.label_en === "") delete body.label_en;
      if (!Object.keys(body).length) { onClose(); return; }
    }
    setBusy(true);
    try {
      const res = editing ? await updateLensDesign(group.key, body) : await createLensDesign(body);
      onSaved(res, { ...form, label_es: es || en, label_en: en || es }, { editing });
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
  const prog = form.category === "prog";

  return (
    <Modal
      title={editing ? t("adm.pm.lens.editTitle", { name: initial.label_es }) : t("adm.pm.lens.addTitle")}
      sub={t(editing ? "adm.pm.lens.editSub" : "adm.pm.lens.addSub")}
      onClose={onClose}
      footer={
        <>
          {serverErr && <span className="pm-f-err grow" role="alert"><Icon name="alert" size={13} /> {t(serverErr)}</span>}
          <button type="button" className="btn-sm" onClick={onClose}>{t("adm.pm.cancel")}</button>
          <button type="submit" form="pm-lens-design" className="btn-sm primary" disabled={busy}>
            <Icon name={editing ? "save" : "plus"} size={14} /> {busy ? t("adm.pm.saving") : t(editing ? "adm.pm.save" : "adm.pm.add.create")}
          </button>
        </>
      }
    >
      <form id="pm-lens-design" className="pm-form" onSubmit={submit} noValidate>
        <div className="pm-f-row">
          <label className="pm-f">
            <span>{t("adm.pm.lens.category")}</span>
            <span className="pp-seg" role="group" aria-label={t("adm.pm.lens.category")}>
              {CATS.map((c) => (
                <button key={c} type="button" className={form.category === c ? "on" : ""} aria-pressed={form.category === c} disabled={editing} onClick={() => setCategory(c)}>
                  {t(`adm.price.lenses.cat.${c}`)}
                </button>
              ))}
            </span>
            {editing && <small className="pm-f-hint">{t("adm.pm.lens.categoryFixed")}</small>}
            {errText("category")}
          </label>
        </div>
        <div className="pm-f-row">
          <label className="pm-f grow">
            <span>{t("adm.pm.add.labelEs")}</span>
            <input className="pp-input" value={form.label_es} onChange={(e) => set("label_es", e.target.value)} placeholder={t("adm.pm.lens.labelPh")} aria-invalid={Boolean(errors.label_es) || undefined} />
            {errText("label_es")}
          </label>
          <label className="pm-f grow">
            <span>{t("adm.pm.add.labelEn")}</span>
            <input className="pp-input" value={form.label_en} onChange={(e) => set("label_en", e.target.value)} placeholder={t("adm.pm.lens.labelEnPh")} />
          </label>
        </div>
        <label className="pm-sw big">
          <input type="checkbox" role="switch" checked={form.requires_add} onChange={(e) => { setTouchedAdd(true); set("requires_add", e.target.checked); }} />
          <span>{t(form.requires_add ? "adm.pm.lens.addOn" : "adm.pm.lens.addOff")}</span>
        </label>
        {prog && (
          <>
            <div className="pm-f-row">
              <label className="pm-f grow">
                <span>{t("adm.pm.lens.tier")}</span>
                <input className="pp-input" value={form.tier} onChange={(e) => set("tier", e.target.value)} placeholder={t("adm.pm.lens.tierPh")} aria-invalid={Boolean(errors.tier) || undefined} />
                {errText("tier")}
              </label>
            </div>
            <div className="pm-f-row">
              <label className="pm-f grow">
                <span>{t("adm.pm.lens.useEs")}</span>
                <input className="pp-input" value={form.use_es} onChange={(e) => set("use_es", e.target.value)} placeholder={t("adm.pm.lens.usePh")} />
              </label>
              <label className="pm-f grow">
                <span>{t("adm.pm.lens.useEn")}</span>
                <input className="pp-input" value={form.use_en} onChange={(e) => set("use_en", e.target.value)} />
              </label>
            </div>
          </>
        )}
        {!editing && <small className="pm-f-hint">{t("adm.pm.lens.addHint")}</small>}
      </form>
    </Modal>
  );
}
