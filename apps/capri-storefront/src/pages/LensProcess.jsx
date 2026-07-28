import { useMemo, useState, useEffect } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { useCatalog } from "../data/catalogStore.js";
import { subscribe as onPrices, lensBasePrice, lensPhotoPrice, lensARPrice } from "../admin/priceStore.js";
import {
  DESIGNS, FRAME_ONLY, MATERIALS, BASE, PHOTO, PHOTO_COLORS,
  arListFor, designById, materialById, L,
} from "../data/lensPricing.js";
import { useCart } from "../components/CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";
import { medusa, USE_MEDUSA } from "../data/medusa.js";
import { addConfiguredFrame, createPrescription } from "../data/medusaCart.js";

const fmt = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2);
function range(min, max, step) {
  const out = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
const SPH = range(-20, 12, 0.25).map((v) => ({ v, label: fmt(v) }));
const CYL = range(-6, 6, 0.25).map((v) => ({ v, label: fmt(v) }));
const AXIS = range(0, 180, 1).map((v) => ({ v, label: v === 0 ? "—" : v + "°" }));
const ADD = range(0.75, 3.5, 0.25).map((v) => ({ v, label: "+" + v.toFixed(2) }));
const PD = range(50, 76, 0.5).map((v) => ({ v, label: v.toFixed(1) }));

function SelectCell({ value, onChange, options }) {
  return (
    <select className="rx-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}
function Field({ label, value, onChange, options, t, withEmpty }) {
  return (
    <label className="rx-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {withEmpty && <option value="">{t("lens.select")}</option>}
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </label>
  );
}

export default function LensProcess() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { t, lang } = useLang();
  const { productBySlug } = useCatalog();
  const product = productBySlug[slug];
  const colorIdx = Number(params.get("color") || 0);
  const navigate = useNavigate();
  const { addItem } = useCart();

  const STEPS = [t("lens.step.use"), t("lens.step.rx"), t("lens.step.lens"), t("lens.step.summary")];
  const [step, setStep] = useState(0);
  const [designId, setDesignId] = useState(null); // "sv" | "bifocal" | ... | "frame-only"
  const [matId, setMatId] = useState(null);
  const [photoId, setPhotoId] = useState(null); // null = ninguno
  const [arId, setArId] = useState(null);        // null = ninguno
  const [rx, setRx] = useState({ od_sph: "0", od_cyl: "0", od_axis: "0", os_sph: "0", os_cyl: "0", os_axis: "0", pd: "", add: "" });
  const [uploaded, setUploaded] = useState(null);
  const [pv, setPv] = useState(0);
  useEffect(() => onPrices(() => setPv((v) => v + 1)), []);

  // Server-side quote (Medusa path): the backend is the single source of truth for
  // lens pricing. Recomputed on every selection change; the total sent to the cart
  // is the one the server returns. Amounts convert dollars↔cents at this boundary.
  const [serverTotal, setServerTotal] = useState(null);
  useEffect(() => {
    if (!USE_MEDUSA || !product || !designId) { setServerTotal(null); return; }
    let cancelled = false;
    const selection = {
      design_code: designId === "frame-only" ? "frame-only" : designId,
      material_code: matId, photo_code: photoId, ar_code: arId,
    };
    medusa.client
      .fetch("/store/lens-config/quote", {
        method: "POST",
        body: { frame_price_cents: Math.round((product.price || 0) * 100), selection },
      })
      .then((r) => { if (!cancelled) setServerTotal((r.quote?.total_cents || 0) / 100); })
      .catch(() => { if (!cancelled) setServerTotal(null); });
    return () => { cancelled = true; };
  }, [designId, matId, photoId, arId, product]);

  // NOTE: all hooks must run before the early return below — under Medusa the
  // product loads asynchronously (undefined on first render), so a conditional
  // return before these useMemos would change the hook count and crash React.
  const color = product ? (product.colors[colorIdx] || product.colors[0]) : null;

  const design = designId === "frame-only" ? FRAME_ONLY : designById(designId);
  const frameOnly = designId === "frame-only";
  const cat = design && design.cat; // sv | bifocal | prog

  // precios efectivos (override-aware). pv bump re-render on admin edits.
  const basePrice = (dId, mId) => lensBasePrice(dId, mId, (BASE[dId] || {})[mId] ?? 0);
  const photoPriceOf = (p) => (p.price[cat] == null ? null : lensPhotoPrice(p.id, cat, p.price[cat]));
  const arList = design && !frameOnly ? arListFor(design) : [];
  const arPriceOf = (a) => lensARPrice(a.id, a.price);

  const material = matId ? materialById(matId) : null;
  const photo = photoId ? PHOTO.find((p) => p.id === photoId) : null;
  const ar = arId ? arList.find((a) => a.id === arId) : null;

  const maxAbs = Math.max(
    Math.abs(parseFloat(rx.od_sph) || 0), Math.abs(parseFloat(rx.os_sph) || 0),
    Math.abs(parseFloat(rx.od_cyl) || 0), Math.abs(parseFloat(rx.os_cyl) || 0)
  );
  const recommendedMat = useMemo(() => {
    if (product?.attributes?.age === "Niños") return MATERIALS.find((m) => m.id === "poly");
    return MATERIALS.find((m) => maxAbs <= m.maxAbs) || MATERIALS[MATERIALS.length - 1];
  }, [maxAbs, product?.attributes?.age]);

  const clientTotal = useMemo(() => {
    let x = product?.price || 0;
    if (design && !frameOnly && matId) x += basePrice(designId, matId);
    if (!frameOnly && photo) { const pp = photoPriceOf(photo); if (pp) x += pp; }
    if (!frameOnly && ar) x += arPriceOf(ar);
    return Math.round(x * 100) / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.price, designId, matId, photoId, arId, frameOnly, pv]);

  // Effective total: server-computed under Medusa (authoritative), else client-side.
  const total = USE_MEDUSA && serverTotal != null ? serverTotal : clientTotal;

  if (!product) return <div className="section"><p>{t("notfound")} <Link to="/catalogo">{t("notfound.link")}</Link></p></div>;

  const canNext =
    (step === 0 && designId) ||
    step === 1 ||
    (step === 2 && (frameOnly || matId)) ||
    step === 3;

  const finish = async () => {
    // Keep the local cart for the header UI badge.
    addItem({
      sku: product.sku, name: product.name, color: color.name,
      design: designId, material: matId, photo: photoId, ar: arId, total,
    });
    // Medusa path: add the configured frame (server-priced) and go to checkout.
    if (USE_MEDUSA && color?.variantId) {
      try {
        // Persist the prescription as a health record (PHI) server-side and pass
        // only its id to the cart. Raw Rx values never leave the backend DB.
        let prescriptionId = null;
        if (!frameOnly) {
          const num = (v) => (v === "" || v == null ? null : parseFloat(v));
          const addv = rx.add ? parseFloat(rx.add) : null;
          const rxPayload = {
            od: { sph: num(rx.od_sph) ?? 0, cyl: num(rx.od_cyl) ?? 0, axis: rx.od_axis ? parseInt(rx.od_axis, 10) : null, add: addv, prism: null, base: null },
            os: { sph: num(rx.os_sph) ?? 0, cyl: num(rx.os_cyl) ?? 0, axis: rx.os_axis ? parseInt(rx.os_axis, 10) : null, add: addv, prism: null, base: null },
            pd: num(rx.pd), pd_od: null, pd_os: null,
            source: "manual", verified_by_user: true, file_url: null,
          };
          try { prescriptionId = await createPrescription(rxPayload); } catch { /* non-blocking */ }
        }
        await addConfiguredFrame(color.variantId, {
          design_code: frameOnly ? "frame-only" : designId,
          material_code: matId, photo_code: photoId, ar_code: arId,
        }, prescriptionId);
        navigate("/checkout");
        return;
      } catch (e) { /* fall back to the local flow below */ }
    }
    alert(t("lens.added"));
    navigate(`/producto/${product.slug}`);
  };
  const setF = (k) => (v) => setRx((r) => ({ ...r, [k]: v }));
  const money = (n) => "$" + Number(n).toFixed(0);

  return (
    <div className="lens">
      <div className="lens-head">
        <Link to={`/producto/${product.slug}`} className="back">← {t("lens.back")} {product.name}</Link>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`stepdot ${i === step ? "on" : ""} ${i < step ? "done" : ""}`} onClick={() => i < step && setStep(i)}>
              <span>{i < step ? "✓" : i + 1}</span>{s}
            </div>
          ))}
        </div>
      </div>

      <div className="lens-grid">
        <div className="lens-body">
          {/* STEP 0 — diseño / uso */}
          {step === 0 && (
            <div>
              <h2>{t("lens.q.use")}</h2>
              <div className="opt-grid">
                {DESIGNS.map((d) => (
                  <button key={d.id} className={`opt-card ${designId === d.id ? "sel" : ""}`}
                          onClick={() => { setDesignId(d.id); setMatId(null); setPhotoId(null); setArId(null); }}>
                    <b>{L(d.label, lang)}</b>
                    <small>{t("lens.designHint")}</small>
                    <span className="opt-price">{t("lens.fromPrice")} {money(Math.min(...MATERIALS.map((m) => basePrice(d.id, m.id))))}</span>
                  </button>
                ))}
                <button className={`opt-card ${designId === "frame-only" ? "sel" : ""}`}
                        onClick={() => { setDesignId("frame-only"); setMatId(null); setPhotoId(null); setArId(null); }}>
                  <b>{L(FRAME_ONLY.label, lang)}</b><small>{t("lens.frameOnlyDesc")}</small>
                  <span className="opt-price">{t("lens.included")}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 1 — receta */}
          {step === 1 && (
            <div>
              <h2>{t("lens.q.rx")}</h2>
              {frameOnly ? (
                <p className="muted">{t("lens.rx.none")}</p>
              ) : (
                <>
                  <div className="rx-upload">
                    <label className="upload-box">
                      <input type="file" accept="image/*,application/pdf" hidden
                             onChange={(e) => setUploaded(e.target.files?.[0]?.name || null)} />
                      <span>📤 {t("lens.upload")}</span>
                      <small>{uploaded ? `${t("lens.upload.file")}: ${uploaded}` : t("lens.upload.sub")}</small>
                    </label>
                    <span className="or">{t("lens.or")}</span>
                  </div>
                  <p className="muted small">{t("lens.rxHelp")}</p>
                  <table className="rx-table">
                    <thead><tr><th></th><th>ESF / SPH</th><th>CIL / CYL</th><th>EJE / AXIS</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>{t("lens.right")}</td>
                        <td><SelectCell value={rx.od_sph} onChange={setF("od_sph")} options={SPH} /></td>
                        <td><SelectCell value={rx.od_cyl} onChange={setF("od_cyl")} options={CYL} /></td>
                        <td><SelectCell value={rx.od_axis} onChange={setF("od_axis")} options={AXIS} /></td>
                      </tr>
                      <tr>
                        <td>{t("lens.left")}</td>
                        <td><SelectCell value={rx.os_sph} onChange={setF("os_sph")} options={SPH} /></td>
                        <td><SelectCell value={rx.os_cyl} onChange={setF("os_cyl")} options={CYL} /></td>
                        <td><SelectCell value={rx.os_axis} onChange={setF("os_axis")} options={AXIS} /></td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="rx-extra">
                    <Field label={t("lens.pd")} value={rx.pd} onChange={setF("pd")} options={PD} t={t} withEmpty />
                    {design?.add && <Field label={t("lens.addLbl")} value={rx.add} onChange={setF("add")} options={ADD} t={t} withEmpty />}
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 2 — material + fotocromático + antirreflejo */}
          {step === 2 && (
            <div>
              <h2>{frameOnly ? t("lens.frameOnlyTitle") : t("lens.q.lens")}</h2>
              {frameOnly ? (
                <p className="muted">{t("lens.frameOnlyDesc")}</p>
              ) : (
                <>
                  {recommendedMat && (
                    <div className="reco">
                      <b>💡 {t("lens.recommend")} {L(recommendedMat.label, lang)}</b>
                      <span>{t("lens.recommendHint")}</span>
                    </div>
                  )}
                  <h3 className="lp-h">{t("lens.material")}</h3>
                  <div className="opt-list">
                    {MATERIALS.map((m) => (
                      <label key={m.id} className={`choice ${matId === m.id ? "sel" : ""}`}>
                        <input type="radio" name="lensmat" checked={matId === m.id} onChange={() => setMatId(m.id)} />
                        <span className="choice-main">
                          <span className="choice-title">
                            {L(m.label, lang)}
                            {recommendedMat?.id === m.id && <span className="reco-badge">★</span>}
                          </span>
                          <small className="choice-desc">{L(m.desc, lang)}</small>
                        </span>
                        <span className="choice-price">{money(basePrice(designId, m.id))}</span>
                      </label>
                    ))}
                  </div>

                  <h3 className="lp-h">{t("lens.photo")} <span className="lp-opt">{t("lens.optional")}</span></h3>
                  <div className="opt-list">
                    <label className={`choice ${!photoId ? "sel" : ""}`}>
                      <input type="radio" name="photo" checked={!photoId} onChange={() => setPhotoId(null)} />
                      <span className="choice-main"><span className="choice-title">{t("lens.none")}</span></span>
                      <span className="choice-price">{t("lens.included")}</span>
                    </label>
                    {PHOTO.map((p) => {
                      const pp = photoPriceOf(p);
                      const na = pp == null;
                      return (
                        <label key={p.id} className={`choice ${photoId === p.id ? "sel" : ""} ${na ? "na" : ""}`}>
                          <input type="radio" name="photo" disabled={na} checked={photoId === p.id} onChange={() => setPhotoId(p.id)} />
                          <span className="choice-main">
                            <span className="choice-title">
                              {L(p.label, lang)}
                              {p.colors.map((c) => <i key={c} className="lp-dot" title={L(PHOTO_COLORS[c], lang)} style={{ background: PHOTO_COLORS[c]?.hex }} />)}
                            </span>
                          </span>
                          <span className="choice-price">{na ? "—" : `+ ${money(pp)}`}</span>
                        </label>
                      );
                    })}
                  </div>

                  <h3 className="lp-h">{t("lens.ar")} <span className="lp-opt">{t("lens.optional")}</span></h3>
                  <div className="opt-list">
                    <label className={`choice ${!arId ? "sel" : ""}`}>
                      <input type="radio" name="ar" checked={!arId} onChange={() => setArId(null)} />
                      <span className="choice-main"><span className="choice-title">{t("lens.none")}</span></span>
                      <span className="choice-price">{t("lens.included")}</span>
                    </label>
                    {arList.map((a) => (
                      <label key={a.id} className={`choice ${arId === a.id ? "sel" : ""}`}>
                        <input type="radio" name="ar" checked={arId === a.id} onChange={() => setArId(a.id)} />
                        <span className="choice-main"><span className="choice-title">{L(a.label, lang)}</span></span>
                        <span className="choice-price">+ {money(arPriceOf(a))}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3 — resumen */}
          {step === 3 && (
            <div>
              <h2>{t("lens.summary")}</h2>
              <ul className="summary">
                <li><span>{t("card.frame")} {product.name} · {color.name}</span><b>${product.price.toFixed(2)}</b></li>
                {design && <li><span>{t("lens.use")}: {L(design.label, lang)}</span><b>{frameOnly ? t("lens.included") : ""}</b></li>}
                {material && !frameOnly && <li><span>{t("lens.material")}: {L(material.label, lang)}</span><b>{money(basePrice(designId, matId))}</b></li>}
                {photo && !frameOnly && photoPriceOf(photo) != null && <li><span>{L(photo.label, lang)}</span><b>+ {money(photoPriceOf(photo))}</b></li>}
                {ar && !frameOnly && <li><span>{L(ar.label, lang)}</span><b>+ {money(arPriceOf(ar))}</b></li>}
                {!frameOnly && <li><span>{t("lens.q.rx")}: OD {fmt(parseFloat(rx.od_sph) || 0)} / OS {fmt(parseFloat(rx.os_sph) || 0)}</span><b>✓</b></li>}
              </ul>
              <p className="muted small">{t("lens.note")}</p>
            </div>
          )}
        </div>

        <aside className="lens-side">
          <img src={color.image} alt={product.name} onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
          <div className="lens-side-name">{product.name} · {color.name}</div>
          <div className="lens-side-total"><span>{t("lens.total")}</span><b>${total.toFixed(2)}</b></div>
          <div className="lens-nav">
            {step > 0 && <button className="btn btn-outline" onClick={() => setStep((s) => s - 1)}>{t("lens.back2")}</button>}
            {step < 3 ? (
              <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>{t("lens.continue")}</button>
            ) : (
              <button className="btn btn-primary" onClick={finish}>{t("lens.addCart")}</button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
