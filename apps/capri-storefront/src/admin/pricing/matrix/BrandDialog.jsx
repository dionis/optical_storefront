// Marca o colección en «Productos y precios» (v2, registro `catalog_brand`).
// Alta: nombre, tipo (monturas / estuches) y logo (subir, arrastrar, cámara o
// enlace) → POST /admin/catalog/brands; al crearla, el mismo diálogo ofrece
// «Añadir el primer modelo», que abre el alta de modelo con la marca elegida.
// Edición (desde el ⋯ de la cabecera): renombrar, cambiar el logo, activar o
// desactivar → POST /admin/catalog/brands/:slug. El tipo no se cambia al
// editar: sus modelos ya son monturas o estuches.
import { useState } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import Icon from "../../icons.jsx";
import { createCatalogBrand, updateCatalogBrand } from "../api.js";
import ImageInput from "./ImageInput.jsx";
import Modal from "./Modal.jsx";
import { BrandLogo } from "./Media.jsx";
import { slugify, validateBrandForm } from "./model.js";

const FIELD_OF = { bad_brand: "name", brand_taken: "name", slug_taken: "name", bad_image: "logo_url" };

/** A reason key that exists in the dictionary, else the generic one. */
export const knownErr = (t, k, fallback = "adm.err.pricing.save_failed") => (k && t(k) !== k ? k : fallback);

export default function BrandDialog({ brand = null, kind = "frame", takenSlugs = new Set(), onClose, onSaved, onAddFirst }) {
  const { t } = useLang();
  const editing = Boolean(brand);
  const [form, setForm] = useState(() => ({
    name: brand?.name || "",
    kind: brand?.kind || kind,
    logo_url: brand?.logo_url || "",
    active: brand ? brand.active !== false : true,
  }));
  const [errors, setErrors] = useState({});
  const [serverErr, setServerErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [created, setCreated] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy || uploading) return;
    const { errors: errs, body } = validateBrandForm(form, { takenSlugs, editing });
    setErrors(errs);
    setServerErr(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = editing ? await updateCatalogBrand(brand.slug, body) : await createCatalogBrand(body);
      const saved = res?.brand || { ...(brand || {}), ...body, slug: brand?.slug || slugify(body.name), models: brand?.models ?? 0 };
      onSaved?.(saved, { created: !editing });
      if (editing) onClose();
      else setCreated(saved);
    } catch (err) {
      const k = String(err.message || "adm.err.pricing.save_failed");
      const reason = k.replace("adm.err.pricing.", "");
      if (FIELD_OF[reason]) setErrors({ [FIELD_OF[reason]]: reason });
      setServerErr(knownErr(t, k));
    } finally {
      setBusy(false);
    }
  };
  const errText = (field) => (errors[field] ? <small className="pm-f-err">{t(knownErr(t, `adm.err.pricing.${errors[field]}`, "adm.err.pricing.bad_value"))}</small> : null);

  if (created) {
    return (
      <Modal
        title={t("adm.pm.brand.createdTitle")}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn-sm" onClick={onClose}>{t("adm.pm.brand.done")}</button>
            <button type="button" className="btn-sm primary" onClick={() => onAddFirst?.(created)}>
              <Icon name="plus" size={14} /> {t("adm.pm.brand.addFirst")}
            </button>
          </>
        }
      >
        <div className="pm-done">
          <BrandLogo src={created.logo_url} name={created.name} slug={created.slug} className="lg" />
          <div>
            <b>{created.name}</b>
            <p>{t(created.kind === "case" ? "adm.pm.brand.createdCase" : "adm.pm.brand.createdFrame")}</p>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t(editing ? "adm.pm.brand.editTitle" : "adm.pm.add.brandTitle")}
      sub={t(editing ? "adm.pm.brand.editSub" : "adm.pm.brand.newSub")}
      onClose={onClose}
      footer={
        <>
          {serverErr && <span className="pm-f-err grow" role="alert"><Icon name="alert" size={13} /> {t(serverErr)}</span>}
          <button type="button" className="btn-sm" onClick={onClose}>{t("adm.pm.cancel")}</button>
          <button type="submit" form="pm-brand" className="btn-sm primary" disabled={busy || uploading}>
            <Icon name={editing ? "save" : "plus"} size={14} /> {busy ? t("adm.pm.saving") : uploading ? t("adm.pm.img.uploading") : t(editing ? "adm.pm.save" : "adm.pm.add.create")}
          </button>
        </>
      }
    >
      <form id="pm-brand" className="pm-form" onSubmit={submit} noValidate>
        <div className="pm-f-row">
          <label className="pm-f grow">
            <span>{t("adm.pm.brand.name")}</span>
            <input className="pp-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("adm.pm.add.brandNamePh")} aria-invalid={Boolean(errors.name) || undefined} maxLength={60} />
            {errText("name")}
            {!editing && form.name.trim() && <small className="pm-f-hint">{t("adm.pm.add.slug", { slug: slugify(form.name) })}</small>}
          </label>
          <div className="pm-f">
            <span>{t("adm.pm.add.kind")}</span>
            <span className="pp-seg" role="group" aria-label={t("adm.pm.add.kind")}>
              {["frame", "case"].map((k) => (
                <button key={k} type="button" className={form.kind === k ? "on" : ""} aria-pressed={form.kind === k} disabled={editing} onClick={() => set("kind", k)}>
                  <Icon name={k === "case" ? "case" : "glasses"} size={14} /> {t(`adm.pm.kindPlural.${k}`)}
                </button>
              ))}
            </span>
          </div>
        </div>
        <div className="pm-f">
          <span>{t("adm.pm.brand.logo")}</span>
          <ImageInput value={form.logo_url} onChange={(v) => set("logo_url", v)} variant="logo" name={form.name} label={t("adm.pm.brand.logo")} onBusy={setUploading} invalid={Boolean(errors.logo_url)} />
          {errText("logo_url")}
        </div>
        {editing && (
          <label className="pm-sw big">
            <input type="checkbox" role="switch" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
            <span>{t(form.active ? "adm.pm.brand.active" : "adm.pm.brand.inactive")}</span>
          </label>
        )}
      </form>
    </Modal>
  );
}
