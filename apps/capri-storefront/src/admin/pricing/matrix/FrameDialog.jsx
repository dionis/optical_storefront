// Alta y edición de un modelo (montura o estuche) en «Productos y precios».
//   Alta    POST /admin/catalog/frames        (HU-07, + v2: fotos y ficha)
//   Edición POST /admin/catalog/frames/:id    (se abre desde el ⋯ de la fila)
// Lleva exactamente lo que enseña la ficha de la tienda online
// (pages/ProductDetail.jsx vía data/medusaCatalog.js): marca, modelo, SKU,
// colores con su foto, fotos adicionales, medidas (ojo, puente, varilla y, si
// se conocen, A/B/ED/circunferencia), material, forma, estilo, género, edad,
// características y descripción; además el costo y, por tienda, precio y
// descuento. Los valores se guardan como los guarda la sincronización (slugs en
// inglés en `metadata`) y se enseñan con las mismas palabras de la tienda (tv()).
//
// La validación del navegador repite los motivos del servidor para que un error
// obvio no haga el viaje; el servidor tiene la última palabra y su motivo se
// pinta en el campo que toca (o abajo, si no es de un campo).
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import Icon from "../../icons.jsx";
import { createCatalogFrame, fetchCatalogBrands, fetchCatalogFrame, skuKey, updateCatalogFrame } from "../api.js";
import { knownErr } from "./BrandDialog.jsx";
import ImageInput from "./ImageInput.jsx";
import Modal from "./Modal.jsx";
import {
  EXTRA_MEASURES, FRAME_ATTRS, FRAME_FEATURES, MEASURES, frameToForm, rowPrices, slugify, validateFrameForm,
} from "./model.js";

const NEW = "__new";
const FIELD_OF = {
  bad_brand: "brand", bad_sku: "sku", sku_taken: "sku", bad_colors: "colors", color_sold: "colors", variant_sold: "colors",
  bad_measure: "eye_size", bad_value: "cost", bad_image: "images", bad_attribute: "material", bad_description: "description",
};
// The same labels the order's frame sheet uses (data/frameSpecLabels.js).
const ATTR_LABEL = { material: "spec.material", shape: "orders.frameShape", style: "orders.frameStyle", gender: "spec.gender", age_group: "orders.frameAge" };

const emptyForm = (kind, brand) => ({
  kind,
  brandPick: brand?.slug || "",
  brand: brand?.name || "",
  brandSlug: brand?.slug || "",
  model: "",
  sku: "",
  colors: [{ name: "", image: "" }],
  images: [],
  eye_size: "", bridge_size: "", temple_length: "", a: "", b: "", ed: "", circ: "",
  material: "", shape: "", style: "", gender: "", age_group: "",
  features: [],
  description: "",
  cost: "",
  prices: {},
});
const toText = (prices) => Object.fromEntries(Object.entries(prices || {}).map(([sid, p]) => [sid, { price: p.price == null ? "" : String(p.price), discount: p.discount ? String(p.discount) : "" }]));

export default function FrameDialog({ kind = "frame", row = null, presetBrand = null, brands: brandsIn = null, stores = [], groups = [], costAccess = true, onClose, onSaved }) {
  const { t, tv } = useLang();
  const editing = Boolean(row);
  const [brands, setBrands] = useState(brandsIn);
  const [form, setForm] = useState(() => emptyForm(kind, presetBrand));
  const [loadState, setLoadState] = useState(editing ? "loading" : "ok");
  const [initialPrices, setInitialPrices] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverErr, setServerErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [showPrices, setShowPrices] = useState(false);
  const [featureText, setFeatureText] = useState("");

  useEffect(() => {
    if (brandsIn) return undefined;
    let on = true;
    fetchCatalogBrands()
      .then((r) => { if (on) setBrands(r?.brands || []); })
      // Sin la lista se puede seguir: la marca se escribe a mano.
      .catch(() => { if (on) { setBrands([]); setForm((f) => (f.brandPick ? f : { ...f, brandPick: NEW })); } });
    return () => { on = false; };
  }, [brandsIn]);

  const loadModel = () => {
    if (!editing) return;
    setLoadState("loading");
    fetchCatalogFrame(row.product_id || row.key)
      .then((res) => {
        const f = frameToForm(res, row);
        const prices = rowPrices(row, stores);
        setInitialPrices(prices);
        setForm({ ...emptyForm(f.kind), ...f, brandPick: f.brandSlug || "", prices: toText(prices), editing: true });
        setLoadState("ok");
      })
      .catch((e) => setLoadState(e.message || "adm.err.pricing.load_failed"));
  };
  useEffect(loadModel, []); // eslint-disable-line react-hooks/exhaustive-deps

  const takenSkus = useMemo(() => {
    const mine = skuKey(row?.sku);
    return new Set(groups.flatMap((g) => g.rows.map((r) => skuKey(r.sku)).filter((k) => k && k !== mine)));
  }, [groups, row]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setColor = (i, k, v) => setForm((f) => ({ ...f, colors: f.colors.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const setImage = (i, v) => setForm((f) => ({ ...f, images: f.images.map((u, j) => (j === i ? v : u)) }));
  const setPrice = (sid, k, v) => setForm((f) => ({ ...f, prices: { ...f.prices, [sid]: { ...(f.prices[sid] || {}), [k]: v } } }));
  const onBusy = (b) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)));
  const toggleFeature = (name) => set("features", form.features.includes(name) ? form.features.filter((x) => x !== name) : [...form.features, name]);
  const addFeature = () => {
    const v = featureText.trim();
    if (v && !form.features.some((x) => x.toLowerCase() === v.toLowerCase())) set("features", [...form.features, v]);
    setFeatureText("");
  };

  const pickBrand = (v) => {
    if (v === NEW) setForm((f) => ({ ...f, brandPick: NEW, brand: "", brandSlug: "" }));
    else {
      const b = (brands || []).find((x) => x.slug === v);
      setForm((f) => ({ ...f, brandPick: v, brand: b?.name || "", brandSlug: b?.slug || "" }));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || uploads > 0 || loadState !== "ok") return;
    const { errors: errs, body } = validateFrameForm(
      { ...form, brandSlug: form.brandPick === NEW ? slugify(form.brand) : form.brandSlug },
      { takenSkus, stores, initialPrices: editing ? initialPrices : null }
    );
    setErrors(errs);
    setServerErr(null);
    if (Object.keys(errs).some((k) => k.includes(":"))) setShowPrices(true);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const payload = costAccess ? body : { ...body, cost: undefined };
      const res = editing ? await updateCatalogFrame(row.product_id || row.key, payload) : await createCatalogFrame(payload);
      onSaved(res, body, { editing });
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
  const isCase = form.kind === "case";
  const icon = isCase ? "case" : "glasses";
  const title = editing
    ? t(isCase ? "adm.pm.edit.caseTitle" : "adm.pm.edit.frameTitle", { name: row?.title || "" })
    : t(isCase ? "adm.pm.add.caseTitle" : "adm.pm.add.frameTitle");
  // Editing: an empty price shows what the store charges today (brand / rule / band / master).
  const placeholderOf = (sid) => {
    const c = row?.stores?.[sid];
    return c?.price_cents != null && !(c.exact || c.source === "store_exact") ? (Number(c.price_cents) / 100).toFixed(2) : t("adm.pm.add.priceRule");
  };
  const byKind = (k) => (brands || []).filter((b) => (b.kind || "frame") === k);
  const attrOptions = (field) => {
    const opts = Object.entries(FRAME_ATTRS[field]);
    const cur = form[field];
    return cur && !FRAME_ATTRS[field][cur] ? [...opts, [cur, cur]] : opts;
  };

  return (
    <Modal
      wide
      title={title}
      sub={t(editing ? "adm.pm.edit.frameSub" : "adm.pm.add.frameSub")}
      onClose={onClose}
      initialFocus={presetBrand ? "#pm-f-model" : undefined}
      footer={
        <>
          {serverErr && <span className="pm-f-err grow" role="alert"><Icon name="alert" size={13} /> {t(serverErr)}</span>}
          <button type="button" className="btn-sm" onClick={onClose}>{t("adm.pm.cancel")}</button>
          <button type="submit" form="pm-frame" className="btn-sm primary" disabled={busy || uploads > 0 || loadState !== "ok"}>
            <Icon name={editing ? "save" : "plus"} size={14} /> {busy ? t("adm.pm.saving") : uploads > 0 ? t("adm.pm.img.uploading") : t(editing ? "adm.pm.save" : "adm.pm.add.create")}
          </button>
        </>
      }
    >
      {loadState === "loading" && <div className="adm-src-note loading">{t("adm.pm.loading")}</div>}
      {loadState !== "loading" && loadState !== "ok" && (
        <div className="pm-empty">
          <div className="adm-login-err">{t(knownErr(t, loadState, "adm.err.pricing.load_failed"))}</div>
          <button type="button" className="btn-xs" onClick={loadModel}>{t("adm.pm.retry")}</button>
        </div>
      )}
      {loadState === "ok" && (
        <form id="pm-frame" className="pm-form pm-form-2" onSubmit={submit} noValidate>
          <div className="pm-form-col">
            <section className="pm-f-sec">
              <h4><Icon name="tag" size={14} /> {t("adm.pm.sec.identity")}</h4>
              <div className="pm-f-row">
                <div className="pm-f">
                  <span>{t("adm.pm.add.kind")}</span>
                  <span className="pp-seg" role="group" aria-label={t("adm.pm.add.kind")}>
                    {["frame", "case"].map((k) => (
                      <button key={k} type="button" className={form.kind === k ? "on" : ""} aria-pressed={form.kind === k} onClick={() => set("kind", k)}>
                        <Icon name={k === "case" ? "case" : "glasses"} size={14} /> {t(`adm.pm.kind.${k}`)}
                      </button>
                    ))}
                  </span>
                </div>
                <label className="pm-f grow">
                  <span>{t("adm.pm.add.brand")}</span>
                  <select className="pp-input" value={form.brandPick} onChange={(e) => pickBrand(e.target.value)} aria-invalid={Boolean(errors.brand) || undefined} disabled={brands === null}>
                    <option value="">{brands === null ? t("adm.pm.loading") : t(isCase ? "adm.pm.add.caseNoBrand" : "adm.pm.add.brandPick")}</option>
                    {["frame", "case"].map((k) => byKind(k).length > 0 && (
                      <optgroup key={k} label={t(`adm.pm.kindPlural.${k}`)}>
                        {byKind(k).map((b) => <option key={b.slug} value={b.slug}>{b.name}{b.models != null ? ` (${b.models})` : ""}{b.active === false ? ` · ${t("adm.pm.brand.inactiveShort")}` : ""}</option>)}
                      </optgroup>
                    ))}
                    {form.brandPick && form.brandPick !== NEW && !(brands || []).some((b) => b.slug === form.brandPick) && <option value={form.brandPick}>{form.brand || form.brandPick}</option>}
                    <option value={NEW}>{t("adm.pm.add.brandNew")}</option>
                  </select>
                  {form.brandPick !== NEW && errText("brand")}
                </label>
              </div>
              {form.brandPick === NEW && (
                <label className="pm-f">
                  <span>{t("adm.pm.add.brandName")}</span>
                  <input id="pm-f-brand-new" className="pp-input" value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder={t("adm.pm.add.brandNamePh")} aria-invalid={Boolean(errors.brand) || undefined} />
                  {errText("brand")}
                  {form.brand.trim() && <small className="pm-f-hint">{t("adm.pm.add.slug", { slug: slugify(form.brand) })}</small>}
                </label>
              )}
              <div className="pm-f-row">
                <label className="pm-f grow">
                  <span>{t("adm.pm.add.model")}</span>
                  <input id="pm-f-model" className="pp-input" value={form.model} onChange={(e) => set("model", e.target.value)} placeholder={t("adm.pm.add.modelPh")} />
                </label>
                <label className="pm-f mid">
                  <span>{t("adm.pm.col.sku")}</span>
                  <input className="pp-input" value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder={t("adm.pm.add.skuPh")} aria-invalid={Boolean(errors.sku) || undefined} autoCapitalize="characters" />
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
            </section>

            <section className="pm-f-sec">
              <h4><Icon name="palette" size={14} /> {t("adm.pm.add.colors")}</h4>
              {form.colors.map((c, i) => (
                <div className="pm-color" key={c.id || `new-${i}`}>
                  <ImageInput compact value={c.image} onChange={(v) => setColor(i, "image", v)} icon={icon} label={t("adm.pm.add.colorImage")} onBusy={onBusy} />
                  <input className="pp-input pm-color-n" value={c.name} onChange={(e) => setColor(i, "name", e.target.value)} placeholder={t("adm.pm.add.colorPh")} aria-label={t("adm.pm.add.colorName")} aria-invalid={Boolean(errors.colors && !c.name.trim()) || undefined} />
                  {form.colors.length > 1 && (
                    <button type="button" className="btn-xs pm-icon-btn" onClick={() => set("colors", form.colors.filter((_, j) => j !== i))} aria-label={t("adm.pm.add.colorRemove")} title={t(c.id ? "adm.pm.add.colorRemoveSold" : "adm.pm.add.colorRemove")}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              ))}
              <div className="pm-f-row tight">
                <button type="button" className="btn-xs" onClick={() => set("colors", [...form.colors, { name: "", image: "" }])}><Icon name="plus" size={13} /> {t("adm.pm.add.colorAdd")}</button>
                {errText("colors")}
              </div>
            </section>

            <section className="pm-f-sec">
              <h4><Icon name="image" size={14} /> {t("adm.pm.sec.photos")}</h4>
              {form.images.length === 0 && <small className="pm-f-hint">{t("adm.pm.add.photosHint")}</small>}
              <div className="pm-photos">
                {form.images.map((u, i) => (
                  <div className="pm-photo" key={i}>
                    <ImageInput compact value={u} onChange={(v) => setImage(i, v)} icon={icon} label={t("adm.pm.add.photoN", { n: i + 1 })} onBusy={onBusy} />
                    <button type="button" className="btn-xs pm-icon-btn" onClick={() => set("images", form.images.filter((_, j) => j !== i))} aria-label={t("adm.pm.add.photoRemove")} title={t("adm.pm.add.photoRemove")}>
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="pm-f-row tight">
                <button type="button" className="btn-xs" onClick={() => set("images", [...form.images, ""])}><Icon name="imagePlus" size={14} /> {t("adm.pm.add.photoAdd")}</button>
                {errText("images")}
              </div>
            </section>

            {stores.length > 0 && (
              <section className="pm-f-sec is-prices">
                <h4>
                  <button type="button" className="pm-f-toggle" aria-expanded={showPrices || editing} onClick={() => setShowPrices((v) => !v)} disabled={editing}>
                    <Icon name="dollar" size={14} /> {t(editing ? "adm.pm.edit.prices" : "adm.pm.add.prices")}
                    {!editing && <Icon name={showPrices ? "chevronDown" : "chevronRight"} size={13} />}
                  </button>
                </h4>
                {(showPrices || editing) && (
                  <table className="pm-f-grid">
                    <thead><tr><th>{t("adm.pm.store")}</th><th>{t("adm.pm.col.price")}</th><th>{t("adm.pm.col.discount")}</th></tr></thead>
                    <tbody>
                      {stores.map((s) => (
                        <tr key={s.id}>
                          <th scope="row"><span className="pm-dot" style={{ background: s.color }} /> <b>{s.code}</b> <span className="pm-f-sname">{s.name}</span></th>
                          <td>
                            <input className="pp-input pm-num" inputMode="decimal" placeholder={placeholderOf(s.id)} value={form.prices[s.id]?.price ?? ""} onChange={(e) => setPrice(s.id, "price", e.target.value)} aria-label={t("adm.pm.cellPrice", { store: s.code })} aria-invalid={Boolean(errors[`price:${s.id}`]) || undefined} />
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
                {editing && <small className="pm-f-hint">{t("adm.pm.edit.pricesHint")}</small>}
              </section>
            )}
          </div>

          <div className="pm-form-col">
            {!isCase && (
              <section className="pm-f-sec">
                <h4><Icon name="ruler" size={14} /> {t("adm.pm.sec.measures")}</h4>
                <div className="pm-f-row pm-measures">
                  {Object.entries({ ...MEASURES, ...EXTRA_MEASURES }).map(([k, [lo, hi]]) => (
                    <label className="pm-f num" key={k}>
                      <span>{t(`adm.pm.add.${k}`)}</span>
                      <input className="pp-input pm-num" inputMode="decimal" value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={`${lo}–${hi}`} aria-invalid={Boolean(errors[k]) || undefined} />
                      {errText(k)}
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className="pm-f-sec">
              <h4><Icon name="clipboard" size={14} /> {t("adm.pm.sec.sheet")}</h4>
              <div className="pm-f-row pm-attrs">
                {Object.keys(FRAME_ATTRS).filter((k) => !isCase || k === "material").map((k) => (
                  <label className="pm-f" key={k}>
                    <span>{t(ATTR_LABEL[k])}</span>
                    <select className="pp-input" value={form[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={Boolean(errors[k]) || undefined}>
                      <option value="">—</option>
                      {attrOptions(k).map(([slug, es]) => <option key={slug} value={slug}>{tv(es)}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {!isCase && (
                <div className="pm-f">
                  <span>{t("orders.frameFeatures")}</span>
                  <div className="pm-feats">
                    {[...Object.keys(FRAME_FEATURES), ...form.features.filter((f) => !FRAME_FEATURES[f])].map((name) => {
                      const on = form.features.includes(name);
                      return (
                        <button key={name} type="button" className={`pm-feat ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleFeature(name)}>
                          {on && <Icon name="check" size={12} strokeWidth={3} />} {FRAME_FEATURES[name] ? tv(FRAME_FEATURES[name]) : name}
                        </button>
                      );
                    })}
                    <span className="pm-feat-add">
                      <input className="pp-input" value={featureText} onChange={(e) => setFeatureText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFeature(); } }} placeholder={t("adm.pm.attr.featurePh")} aria-label={t("adm.pm.attr.featureAdd")} />
                      <button type="button" className="btn-xs pm-icon-btn" onClick={addFeature} disabled={!featureText.trim()} aria-label={t("adm.pm.attr.featureAdd")} title={t("adm.pm.attr.featureAdd")}><Icon name="plus" size={14} /></button>
                    </span>
                  </div>
                </div>
              )}
              <label className="pm-f">
                <span>{t("adm.pm.attr.description")}</span>
                <textarea className="pp-input pm-desc" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={t("adm.pm.attr.descriptionPh")} maxLength={2000} aria-invalid={Boolean(errors.description) || undefined} />
                {errText("description")}
              </label>
            </section>

          </div>
        </form>
      )}
    </Modal>
  );
}
