// Añadir un MATERIAL a un diseño de lente (una fila nueva del diseño en la
// matriz): POST /admin/pricing/lens-designs/:code/cells. Se elige un material
// de la lista maestra o se crea uno nuevo; acabado stock o tallado digital (el
// progresivo siempre es digital); precio base y costo de laboratorio. Los
// precios por tienda y los descuentos son luego casillas de la matriz.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import Icon from "../../icons.jsx";
import { addLensCell, fetchLensMaterials } from "../api.js";
import { knownErr } from "./BrandDialog.jsx";
import Modal from "./Modal.jsx";
import { parseInput } from "./model.js";

const NEW = "__new__";

export default function LensCellDialog({ group, costAccess = true, onClose, onSaved }) {
  const { t, lang } = useLang();
  const category = group?.design?.category || "sv";
  const prog = category === "prog";
  const [materials, setMaterials] = useState(null);
  const [form, setForm] = useState({ material: "", label_es: "", label_en: "", finish: prog ? "digital" : "stock", price: "", cost: "" });
  const [errors, setErrors] = useState({});
  const [serverErr, setServerErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    fetchLensMaterials().then((r) => setMaterials(r.materials || [])).catch(() => setMaterials([]));
  }, []);
  // Lo que el diseño ya tiene con ese acabado no se ofrece otra vez.
  const taken = useMemo(() => new Set((group?.rows || []).filter((r) => r.available !== false && r.finish === form.finish).map((r) => r.material_code)), [group, form.finish]);
  const options = (materials || []).filter((m) => !taken.has(m.code));
  const nameOf = (m) => (lang === "en" ? m.label_en || m.label_es : m.label_es || m.label_en) || m.code;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const errs = {};
    const isNew = form.material === NEW;
    if (!form.material) errs.material = "bad_material";
    if (isNew && !form.label_es.trim() && !form.label_en.trim()) errs.label_es = "bad_label";
    const price = parseInput(form.price);
    if (price == null || price === undefined || price < 0) errs.price = "bad_value";
    const cost = parseInput(form.cost);
    if (cost === undefined || (cost != null && cost < 0)) errs.cost = "bad_value";
    setErrors(errs);
    setServerErr(null);
    if (Object.keys(errs).length) return;
    const body = {
      ...(isNew ? { new_material: { label_es: form.label_es.trim(), label_en: form.label_en.trim() } } : { material_code: form.material }),
      finish: prog ? "digital" : form.finish,
      price,
      ...(costAccess && cost != null ? { cost } : {}),
    };
    setBusy(true);
    try {
      const res = await addLensCell(group.key, body);
      onSaved(res, body);
    } catch (err) {
      const k = String(err.message || "adm.err.pricing.save_failed");
      setServerErr(knownErr(t, k));
    } finally {
      setBusy(false);
    }
  };
  const errText = (field) => (errors[field] ? <small className="pm-f-err">{t(`adm.err.pricing.${errors[field]}`)}</small> : null);
  const label = lang === "en" ? group?.label_en || group?.label : group?.label;

  return (
    <Modal
      title={t("adm.pm.lens.cellTitle", { name: label })}
      sub={t("adm.pm.lens.cellSub")}
      onClose={onClose}
      footer={
        <>
          {serverErr && <span className="pm-f-err grow" role="alert"><Icon name="alert" size={13} /> {t(serverErr)}</span>}
          <button type="button" className="btn-sm" onClick={onClose}>{t("adm.pm.cancel")}</button>
          <button type="submit" form="pm-lens-cell" className="btn-sm primary" disabled={busy || materials === null}>
            <Icon name="plus" size={14} /> {busy ? t("adm.pm.saving") : t("adm.pm.lens.cellCreate")}
          </button>
        </>
      }
    >
      <form id="pm-lens-cell" className="pm-form" onSubmit={submit} noValidate>
        <div className="pm-f-row">
          <label className="pm-f grow">
            <span>{t("adm.pm.lens.material")}</span>
            <select className="pp-input" value={form.material} onChange={(e) => set("material", e.target.value)} aria-invalid={Boolean(errors.material) || undefined} disabled={materials === null}>
              <option value="">{materials === null ? t("adm.pm.loading") : t("adm.pm.lens.pickMaterial")}</option>
              {options.map((m) => <option key={m.code} value={m.code}>{nameOf(m)}</option>)}
              <option value={NEW}>{t("adm.pm.lens.newMaterial")}</option>
            </select>
            {errText("material")}
          </label>
          {!prog && (
            <label className="pm-f">
              <span>{t("adm.pm.lens.finish")}</span>
              <span className="pp-seg" role="group" aria-label={t("adm.pm.lens.finish")}>
                {["stock", "digital"].map((f) => (
                  <button key={f} type="button" className={form.finish === f ? "on" : ""} aria-pressed={form.finish === f} onClick={() => set("finish", f)}>
                    {t(`adm.price.lens.finish.${f}`)}
                  </button>
                ))}
              </span>
            </label>
          )}
        </div>
        {form.material === NEW && (
          <div className="pm-f-row">
            <label className="pm-f grow">
              <span>{t("adm.pm.add.labelEs")}</span>
              <input className="pp-input" value={form.label_es} onChange={(e) => set("label_es", e.target.value)} placeholder={t("adm.pm.lens.materialPh")} aria-invalid={Boolean(errors.label_es) || undefined} />
              {errText("label_es")}
            </label>
            <label className="pm-f grow">
              <span>{t("adm.pm.add.labelEn")}</span>
              <input className="pp-input" value={form.label_en} onChange={(e) => set("label_en", e.target.value)} placeholder={t("adm.pm.lens.materialPh")} />
            </label>
          </div>
        )}
        <div className="pm-f-row">
          {costAccess && (
            <label className="pm-f num">
              <span>{t("adm.pm.col.cost")}</span>
              <input className="pp-input pm-num" inputMode="decimal" value={form.cost} onChange={(e) => set("cost", e.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.cost) || undefined} />
              {errText("cost")}
            </label>
          )}
          <label className="pm-f num">
            <span>{t("adm.pm.add.salePrice")}</span>
            <input className="pp-input pm-num" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.price) || undefined} />
            {errText("price")}
          </label>
        </div>
        <small className="pm-f-hint">{t(prog ? "adm.pm.lens.cellHintProg" : "adm.pm.lens.cellHint")}</small>
      </form>
    </Modal>
  );
}
