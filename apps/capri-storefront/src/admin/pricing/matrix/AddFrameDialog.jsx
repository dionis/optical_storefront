// Alta de una montura o un estuche desde «Productos y precios» (HU-07):
// POST /admin/catalog/frames. Una marca nueva no es otro formulario: es una
// marca que todavía no existe escrita en el mismo campo — existe en cuanto
// tiene un modelo. «+ Marca/colección» abre este mismo diálogo con «nueva
// marca» elegida y el foco en su nombre.
//
// La validación del navegador repite los motivos del servidor (bad_brand,
// bad_sku, sku_taken, bad_colors, bad_measure, bad_value) para que un error
// obvio no haga el viaje; el servidor tiene la última palabra y su motivo se
// pinta en el campo que toca.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import Icon from "../../icons.jsx";
import { createCatalogFrame, fetchCatalogBrands, skuKey } from "../api.js";
import Modal from "./Modal.jsx";
import { MEASURES, slugify, validateFrameForm } from "./model.js";

const NEW = "__new";
const FIELD_OF = { bad_brand: "brand", bad_sku: "sku", sku_taken: "sku", bad_colors: "colors", bad_measure: "eye_size", bad_value: "cost" };

export default function AddFrameDialog({ kind = "frame", newBrand = false, stores = [], groups = [], costAccess = true, onClose, onCreated }) {
  const { t } = useLang();
  const [brands, setBrands] = useState(null);
  const [form, setForm] = useState(() => ({
    kind,
    brandPick: newBrand ? NEW : "",
    brand: "",
    brandSlug: "",
    model: "",
    sku: "",
    colors: [{ name: "", image: "" }],
    eye_size: "",
    bridge_size: "",
    temple_length: "",
    cost: "",
    prices: {},
  }));
  const [errors, setErrors] = useState({});
  const [serverErr, setServerErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPrices, setShowPrices] = useState(false);

  useEffect(() => {
    let on = true;
    fetchCatalogBrands()
      .then((r) => { if (on) setBrands(r?.brands || []); })
      // Sin la lista se puede seguir: la marca se escribe a mano.
      .catch(() => { if (on) { setBrands([]); setForm((f) => (f.brandPick ? f : { ...f, brandPick: NEW })); } });
    return () => { on = false; };
  }, []);

  const takenSkus = useMemo(() => new Set(groups.flatMap((g) => g.rows.map((r) => skuKey(r.sku)).filter(Boolean))), [groups]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setColor = (i, k, v) => setForm((f) => ({ ...f, colors: f.colors.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const setPrice = (sid, k, v) => setForm((f) => ({ ...f, prices: { ...f.prices, [sid]: { ...(f.prices[sid] || {}), [k]: v } } }));

  const pickBrand = (v) => {
    if (v === NEW) setForm((f) => ({ ...f, brandPick: NEW, brand: "", brandSlug: "" }));
    else {
      const b = (brands || []).find((x) => x.slug === v);
      setForm((f) => ({ ...f, brandPick: v, brand: b?.name || "", brandSlug: b?.slug || "" }));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const { errors: errs, body } = validateFrameForm(
      { ...form, brandSlug: form.brandPick === NEW ? slugify(form.brand) : form.brandSlug },
      { takenSkus, stores }
    );
    setErrors(errs);
    setServerErr(null);
    if (Object.keys(errs).some((k) => k.includes(":"))) setShowPrices(true);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await createCatalogFrame(costAccess ? body : { ...body, cost: undefined });
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
  const isCase = form.kind === "case";
  const title = newBrand ? t("adm.pm.add.brandTitle") : t(isCase ? "adm.pm.add.caseTitle" : "adm.pm.add.frameTitle");

  return (
    <Modal
      title={title}
      sub={t("adm.pm.add.frameSub")}
      onClose={onClose}
      initialFocus={newBrand ? "#pm-f-brand-new" : undefined}
      footer={
        <>
          {serverErr && <span className="pm-f-err grow" role="alert"><Icon name="alert" size={13} /> {t(serverErr)}</span>}
          <button type="button" className="btn-sm" onClick={onClose}>{t("adm.pm.cancel")}</button>
          <button type="submit" form="pm-add-frame" className="btn-sm primary" disabled={busy}>
            <Icon name="plus" size={14} /> {busy ? t("adm.pm.saving") : t("adm.pm.add.create")}
          </button>
        </>
      }
    >
      <form id="pm-add-frame" className="pm-form" onSubmit={submit} noValidate>
        <div className="pm-f-row">
          <label className="pm-f">
            <span>{t("adm.pm.add.kind")}</span>
            <span className="pp-seg">
              {["frame", "case"].map((k) => (
                <button key={k} type="button" className={form.kind === k ? "on" : ""} onClick={() => set("kind", k)}>
                  <Icon name={k === "case" ? "box" : "glasses"} size={13} /> {t(`adm.pm.kind.${k}`)}
                </button>
              ))}
            </span>
          </label>
        </div>

        <div className="pm-f-row">
          <label className="pm-f grow">
            <span>{t("adm.pm.add.brand")}</span>
            <select className="pp-input" value={form.brandPick} onChange={(e) => pickBrand(e.target.value)} aria-invalid={Boolean(errors.brand) || undefined} disabled={brands === null}>
              <option value="">{brands === null ? t("adm.pm.loading") : t(form.kind === "case" ? "adm.pm.add.caseNoBrand" : "adm.pm.add.brandPick")}</option>
              {(brands || []).map((b) => <option key={b.slug} value={b.slug}>{b.name} ({b.models})</option>)}
              <option value={NEW}>{t("adm.pm.add.brandNew")}</option>
            </select>
            {form.brandPick !== NEW && errText("brand")}
          </label>
          {form.brandPick === NEW && (
            <label className="pm-f grow">
              <span>{t("adm.pm.add.brandName")}</span>
              <input id="pm-f-brand-new" className="pp-input" value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder={t("adm.pm.add.brandNamePh")} aria-invalid={Boolean(errors.brand) || undefined} />
              {errText("brand")}
              {form.brand.trim() && <small className="pm-f-hint">{t("adm.pm.add.slug", { slug: slugify(form.brand) })}</small>}
            </label>
          )}
        </div>

        <div className="pm-f-row">
          <label className="pm-f grow">
            <span>{t("adm.pm.add.model")}</span>
            <input className="pp-input" value={form.model} onChange={(e) => set("model", e.target.value)} placeholder={t("adm.pm.add.modelPh")} />
          </label>
          <label className="pm-f">
            <span>{t("adm.pm.col.sku")}</span>
            <input className="pp-input" value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder={t("adm.pm.add.skuPh")} aria-invalid={Boolean(errors.sku) || undefined} />
            {errText("sku")}
          </label>
          {costAccess && (
            <label className="pm-f num">
              <span>{t("adm.pm.col.cost")}</span>
              <input className="pp-input pm-num" inputMode="decimal" value={form.cost} onChange={(e) => set("cost", e.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.cost) || undefined} />
              {errText("cost")}
            </label>
          )}
        </div>

        <fieldset className="pm-f-set">
          <legend>{t("adm.pm.add.colors")}</legend>
          {form.colors.map((c, i) => (
            <div className="pm-f-row tight" key={i}>
              <input className="pp-input pm-f-cname" value={c.name} onChange={(e) => setColor(i, "name", e.target.value)} placeholder={t("adm.pm.add.colorPh")} aria-label={t("adm.pm.add.colorName")} />
              <input className="pp-input grow" value={c.image} onChange={(e) => setColor(i, "image", e.target.value)} placeholder={t("adm.pm.add.imagePh")} aria-label={t("adm.pm.add.colorImage")} />
              {form.colors.length > 1 && (
                <button type="button" className="btn-xs" onClick={() => set("colors", form.colors.filter((_, j) => j !== i))} aria-label={t("adm.pm.add.colorRemove")} title={t("adm.pm.add.colorRemove")}>
                  <Icon name="trash" size={12} />
                </button>
              )}
            </div>
          ))}
          <div className="pm-f-row tight">
            <button type="button" className="btn-xs" onClick={() => set("colors", [...form.colors, { name: "", image: "" }])}><Icon name="plus" size={12} /> {t("adm.pm.add.colorAdd")}</button>
            {errText("colors")}
          </div>
        </fieldset>

        {!isCase && (
          <div className="pm-f-row">
            {Object.entries(MEASURES).map(([k, [lo, hi]]) => (
              <label className="pm-f num" key={k}>
                <span>{t(`adm.pm.add.${k}`)}</span>
                <input className="pp-input pm-num" inputMode="decimal" value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={`${lo}–${hi}`} aria-invalid={Boolean(errors[k]) || undefined} />
                {errText(k)}
              </label>
            ))}
          </div>
        )}

        {stores.length > 0 && (
          <fieldset className="pm-f-set">
            <legend>
              <button type="button" className="pm-f-toggle" aria-expanded={showPrices} onClick={() => setShowPrices((v) => !v)}>
                <Icon name={showPrices ? "chevronDown" : "chevronRight"} size={13} /> {t("adm.pm.add.prices")}
              </button>
            </legend>
            {showPrices && (
              <table className="pm-f-grid">
                <thead><tr><th>{t("adm.pm.store")}</th><th>{t("adm.pm.col.price")}</th><th>{t("adm.pm.col.discount")}</th></tr></thead>
                <tbody>
                  {stores.map((s) => (
                    <tr key={s.id}>
                      <th scope="row"><span className="pm-dot" style={{ background: s.color }} /> {s.code} · {s.name}</th>
                      <td>
                        <input className="pp-input pm-num" inputMode="decimal" placeholder={t("adm.pm.add.priceRule")} value={form.prices[s.id]?.price ?? ""} onChange={(e) => setPrice(s.id, "price", e.target.value)} aria-label={t("adm.pm.cellPrice", { store: s.code })} aria-invalid={Boolean(errors[`price:${s.id}`]) || undefined} />
                      </td>
                      <td>
                        <input className="pp-input pm-num" inputMode="decimal" placeholder="0" value={form.prices[s.id]?.discount ?? ""} onChange={(e) => setPrice(s.id, "discount", e.target.value)} aria-label={t("adm.pm.cellDiscount", { store: s.code })} aria-invalid={Boolean(errors[`discount:${s.id}`]) || undefined} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {Object.keys(errors).some((k) => k.startsWith("price:") || k.startsWith("discount:")) && (
              <small className="pm-f-err">{t(Object.keys(errors).some((k) => k.startsWith("discount:")) ? "adm.err.pricing.discount_range" : "adm.err.pricing.bad_value")}</small>
            )}
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
