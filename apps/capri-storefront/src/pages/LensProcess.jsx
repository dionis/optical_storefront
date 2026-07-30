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

/* ───────────────────────── Iconografía (línea, estilo Zeelool) ───────────────────────── */
const S = { width: 30, height: 30, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" };
const IconSV = () => (<svg {...S}><path d="M3 17l5-7 4 5 3-4 6 6" /><path d="M3 20h18" /></svg>);
const IconProg = () => (<svg {...S}><path d="M3 16l4-5 3 4 3-5 4 6" /><path d="M3 19h18" /><path d="M3 12l4-4 3 3" opacity=".5" /></svg>);
const IconBifocal = () => (<svg {...S}><path d="M3 15l5-6 4 5 3-3 6 5" /><path d="M3 12h18" /><path d="M3 19h18" /></svg>);
const IconReading = () => (<svg {...S}><path d="M12 6c-2-1.5-5-1.5-8 0v12c3-1.5 6-1.5 8 0 2-1.5 5-1.5 8 0V6c-3-1.5-6-1.5-8 0z" /><path d="M12 6v12" /></svg>);
const IconFrame = () => (<svg {...S}><circle cx="7" cy="14" r="3.2" /><circle cx="17" cy="14" r="3.2" /><path d="M10.2 13h3.6" /><path d="M3.8 12l1.2-2h2M20.2 12l-1.2-2h-2" /></svg>);
const IconScan = () => (<svg {...S}><rect x="3" y="7" width="18" height="13" rx="2.5" /><circle cx="12" cy="13.5" r="3.4" /><path d="M8 7l1.5-2h5L16 7" /></svg>);
const IconFill = () => (<svg {...S}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h5M8 12h8M8 16h6" /><path d="M15.5 6.5l2.2 2.2-4 4H11.5v-2.2z" /></svg>);
const IconStandard = () => (<svg {...S}><circle cx="12" cy="12" r="8.2" /><path d="M8 9c1.5 2 4 3 8 2.6" opacity=".6" /></svg>);
const IconBlue = () => (<svg {...S}><circle cx="12" cy="12" r="8.2" /><path d="M12 5c3.6.7 6 3.6 6 7s-2.4 6.3-6 7c2-2 3-4.4 3-7s-1-5-3-7z" /><path d="M6 8l1 1M6.5 15l1-.6" opacity=".6" /></svg>);
const IconPhoto = () => (<svg {...S}><circle cx="12" cy="12" r="8.2" /><path d="M12 3.8v16.4a8.2 8.2 0 000-16.4z" fill="currentColor" opacity=".85" stroke="none" /><path d="M12 3.8a8.2 8.2 0 000 16.4" /></svg>);
const IconAR = () => (<svg {...S}><path d="M12 3l7 2.5v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10v-5z" /><path d="M9 12l2 2 4-4" /></svg>);
const IconIndex = () => (<svg {...S}><path d="M6 4c4 3 4 13 0 16M18 4c-4 3-4 13 0 16" /><path d="M6 4h12M6 20h12" /></svg>);
const IconHelp = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 113.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01" strokeLinecap="round" /></svg>);

const designIcon = (id) => {
  if (id === "sv") return <IconSV />;
  if (id === "bifocal") return <IconBifocal />;
  if (id === "prog-mid" || id === "prog-high") return <IconProg />;
  if (id === "frame-only") return <IconFrame />;
  return <IconReading />;
};

/* ───────────────────────── Selects de receta ───────────────────────── */
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

/* Familias de fotocromáticos (agrupadas como los desplegables de Zeelool) */
const PHOTO_FAMILIES = [
  { key: "photo",   label: { es: "Fotocromático",         en: "Photochromic" },        ids: ["photo-grey", "photo-brown"] },
  { key: "trans-s", label: { es: "Transitions Gen S",     en: "Transitions Gen S" },   ids: ["trans-s-grey", "trans-s-brown", "trans-s-green"] },
  { key: "trans-x", label: { es: "Transitions XTRActive", en: "Transitions XTRActive" }, ids: ["trans-x-grey", "trans-x-brown"] },
];

export default function LensProcess() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { t, lang } = useLang();
  const { productBySlug } = useCatalog();
  const product = productBySlug[slug];
  const colorIdx = Number(params.get("color") || 0);
  const navigate = useNavigate();
  const { addItem } = useCart();

  const [step, setStep] = useState(0);
  const [designId, setDesignId] = useState(null);
  const [rxMethod, setRxMethod] = useState(null); // "scan" | "fill"
  const [matId, setMatId] = useState(null);
  const [photoId, setPhotoId] = useState(null);
  const [arId, setArId] = useState(null);
  const [rx, setRx] = useState({ od_sph: "0", od_cyl: "0", od_axis: "0", os_sph: "0", os_cyl: "0", os_axis: "0", pd: "", add: "" });
  const [uploaded, setUploaded] = useState(null);
  const [openFam, setOpenFam] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pv, setPv] = useState(0);
  useEffect(() => onPrices(() => setPv((v) => v + 1)), []);

  if (!product) return <div className="section"><p>{t("notfound")} <Link to="/catalogo">{t("notfound.link")}</Link></p></div>;
  const color = product.colors[colorIdx] || product.colors[0];

  const frameOnly = designId === "frame-only";
  const design = frameOnly ? FRAME_ONLY : designById(designId);
  const cat = design && design.cat;

  const basePrice = (dId, mId) => lensBasePrice(dId, mId, (BASE[dId] || {})[mId] ?? 0);
  const photoPriceOf = (p) => (p.price[cat] == null ? null : lensPhotoPrice(p.id, cat, p.price[cat]));
  const arList = design && !frameOnly ? arListFor(design) : [];
  const arPriceOf = (a) => lensARPrice(a.id, a.price);
  const minDesignPrice = (dId) => Math.min(...MATERIALS.map((m) => basePrice(dId, m.id)));

  const material = matId ? materialById(matId) : null;
  const photo = photoId ? PHOTO.find((p) => p.id === photoId) : null;
  const ar = arId ? arList.find((a) => a.id === arId) : null;

  const maxAbs = Math.max(
    Math.abs(parseFloat(rx.od_sph) || 0), Math.abs(parseFloat(rx.os_sph) || 0),
    Math.abs(parseFloat(rx.od_cyl) || 0), Math.abs(parseFloat(rx.os_cyl) || 0)
  );
  const recommendedMat = useMemo(() => {
    if (product.attributes.age === "Niños") return MATERIALS.find((m) => m.id === "poly");
    return MATERIALS.find((m) => maxAbs <= m.maxAbs) || MATERIALS[MATERIALS.length - 1];
  }, [maxAbs, product.attributes.age]);

  const total = useMemo(() => {
    let x = product.price;
    if (design && !frameOnly && matId) x += basePrice(designId, matId);
    if (!frameOnly && photo) { const pp = photoPriceOf(photo); if (pp) x += pp; }
    if (!frameOnly && ar) x += arPriceOf(ar);
    return Math.round(x * 100) / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.price, designId, matId, photoId, arId, frameOnly, pv]);

  // Flujo dinámico (Zeelool): tipo → método → receta → tratamiento → índice.
  // "Solo montura" salta todo lo de lentes.
  const stepKeys = frameOnly ? ["type"] : ["type", "rxmethod", "rx", "treatment", "index"];
  const key = stepKeys[Math.min(step, stepKeys.length - 1)];
  const isLast = step >= stepKeys.length - 1;

  const canNext =
    (key === "type" && designId) ||
    (key === "rxmethod" && rxMethod) ||
    (key === "rx") ||
    (key === "treatment") ||
    (key === "index" && matId);

  const money = (n) => "$" + Number(n).toFixed(2);

  const goNext = () => {
    if (key === "rx" && rxMethod === "fill") { setShowConfirm(true); return; } // Zeelool: modal de confirmación
    if (isLast) return finish();
    setStep((s) => s + 1);
  };
  const confirmRx = () => { setShowConfirm(false); setStep((s) => s + 1); };

  const finish = () => {
    addItem({
      sku: product.sku, name: product.name, color: color.name,
      design: designId, material: matId, photo: photoId, ar: arId, total,
    });
    navigate(`/producto/${product.slug}`);
  };
  const setF = (k) => (v) => setRx((r) => ({ ...r, [k]: v }));

  const progress = ((step + 1) / stepKeys.length) * 100;
  const stepTitle = {
    type: t("lens.q.use"), rxmethod: t("lens.rxmethod.title"), rx: t("lens.q.rx"),
    treatment: t("lens.treatment.title"), index: t("lens.index.title"),
  }[key];

  return (
    <div className="zl">
      {/* ───────── Panel izquierdo: montura + resumen + subtotal ───────── */}
      <aside className="zl-preview">
        <div className="zl-preview-img">
          <img src={color.image} alt={product.name} onError={(e) => { e.currentTarget.style.opacity = 0.3; }} />
        </div>
        <dl className="zl-recap">
          <div><dt>{t("card.frame")}</dt><dd>{product.name} · {color.name}<b>{money(product.price)}</b></dd></div>
          {design && <div><dt>{t("lens.use")}</dt><dd>{L(design.label, lang)}</dd></div>}
          {!frameOnly && rxMethod && <div><dt>{t("lens.q.rx")}</dt><dd>{rxMethod === "scan" ? t("lens.rxmethod.scan") : `OD ${fmt(parseFloat(rx.od_sph) || 0)} · OS ${fmt(parseFloat(rx.os_sph) || 0)}`}</dd></div>}
          {photo && !frameOnly && photoPriceOf(photo) != null && <div><dt>{t("lens.photo")}</dt><dd>{L(photo.label, lang)}<b>+{money(photoPriceOf(photo))}</b></dd></div>}
          {ar && !frameOnly && <div><dt>{t("lens.ar")}</dt><dd>{L(ar.label, lang)}<b>+{money(arPriceOf(ar))}</b></dd></div>}
          {material && !frameOnly && <div><dt>{t("lens.material")}</dt><dd>{L(material.label, lang)}<b>{money(basePrice(designId, matId))}</b></dd></div>}
        </dl>
        <div className="zl-subtotal"><span>{t("lens.total")}</span><b>{money(total)}</b></div>
      </aside>

      {/* ───────── Panel derecho: wizard ───────── */}
      <section className="zl-panel">
        <div className="zl-progress"><i style={{ width: `${progress}%` }} /></div>
        <div className="zl-top">
          {step > 0
            ? <button className="zl-back" onClick={() => setStep((s) => s - 1)}>‹ {t("lens.back2")}</button>
            : <span />}
          <Link to={`/producto/${product.slug}`} className="zl-close" aria-label={t("lens.back")}>✕</Link>
        </div>

        <div className="zl-scroll">
          <div className="zl-title-row">
            <h2>{stepTitle}</h2>
            {key === "type" && <span className="zl-help"><IconHelp /> {t("lens.learnUse")}</span>}
            {key === "rx" && <span className="zl-help"><IconHelp /> {t("lens.rxHelp.link")}</span>}
          </div>

          {/* STEP: tipo de receta */}
          {key === "type" && (
            <div className="zl-cards">
              {[...DESIGNS, FRAME_ONLY].map((d) => {
                const sel = designId === d.id;
                return (
                  <button key={d.id} className={`zl-card ${sel ? "sel" : ""}`}
                          onClick={() => { setDesignId(d.id); setMatId(null); setPhotoId(null); setArId(null); }}>
                    <span className="zl-card-ic">{designIcon(d.id)}</span>
                    <span className="zl-card-main">
                      <b>{L(d.label, lang)}</b>
                      <small>{t(`lens.desc.${d.id}`)}</small>
                    </span>
                    <span className="zl-card-price">{d.id === "frame-only" ? t("lens.included") : `${t("lens.fromPrice")} ${money(minDesignPrice(d.id))}`}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* STEP: cómo añadir receta */}
          {key === "rxmethod" && (
            <>
              <div className="zl-cards">
                <button className={`zl-card ${rxMethod === "scan" ? "sel" : ""}`} onClick={() => setRxMethod("scan")}>
                  <span className="zl-card-ic"><IconScan /></span>
                  <span className="zl-card-main"><b>{t("lens.rxmethod.scan")}</b><small>{t("lens.rxmethod.scan.sub")}</small></span>
                </button>
                <button className={`zl-card ${rxMethod === "fill" ? "sel" : ""}`} onClick={() => setRxMethod("fill")}>
                  <span className="zl-card-ic"><IconFill /></span>
                  <span className="zl-card-main"><b>{t("lens.rxmethod.fill")}</b><small>{t("lens.rxmethod.fill.sub")}</small></span>
                </button>
              </div>
              <p className="zl-signin">{t("lens.rxmethod.saved")} <Link to="/cuenta">{t("auth.account")}</Link></p>
            </>
          )}

          {/* STEP: ingresar receta */}
          {key === "rx" && (
            <div>
              <div className="zl-banner">{t("lens.rx.sph")}</div>
              {rxMethod === "scan" ? (
                <div className="rx-upload">
                  <label className="upload-box">
                    <input type="file" accept="image/*,application/pdf" hidden
                           onChange={(e) => setUploaded(e.target.files?.[0]?.name || null)} />
                    <span>📤 {t("lens.upload")}</span>
                    <small>{uploaded ? `${t("lens.upload.file")}: ${uploaded}` : t("lens.upload.sub")}</small>
                  </label>
                </div>
              ) : (
                <>
                  <table className="rx-table">
                    <thead><tr><th></th><th>SPH</th><th>CYL</th><th>AXIS</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>{t("lens.right")}<small>OD</small></td>
                        <td><SelectCell value={rx.od_sph} onChange={setF("od_sph")} options={SPH} /></td>
                        <td><SelectCell value={rx.od_cyl} onChange={setF("od_cyl")} options={CYL} /></td>
                        <td><SelectCell value={rx.od_axis} onChange={setF("od_axis")} options={AXIS} /></td>
                      </tr>
                      <tr>
                        <td>{t("lens.left")}<small>OS</small></td>
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
              <p className="zl-chat">{t("lens.rx.verify")} <Link to="/catalogo">{t("chat.soon")}</Link></p>
            </div>
          )}

          {/* STEP: tratamiento (fotocromático + antirreflejo) */}
          {key === "treatment" && (
            <div>
              {/* Fotocromático / Transitions */}
              <h3 className="zl-sub">{t("lens.photo")} <span className="zl-optional">{t("lens.optional")}</span></h3>
              <div className="zl-cards">
                <button className={`zl-card ${!photoId ? "sel" : ""}`} onClick={() => setPhotoId(null)}>
                  <span className="zl-card-ic"><IconStandard /></span>
                  <span className="zl-card-main"><b>{t("lens.transparent")}</b><small>{t("lens.transparent.sub")}</small></span>
                  <span className="zl-card-price">{t("lens.included")}</span>
                </button>
                {PHOTO_FAMILIES.map((fam) => {
                  const items = PHOTO.filter((p) => fam.ids.includes(p.id) && photoPriceOf(p) != null);
                  if (!items.length) return null;
                  const open = openFam === fam.key;
                  const famMin = Math.min(...items.map((p) => photoPriceOf(p)));
                  return (
                    <div key={fam.key} className={`zl-fam ${open ? "open" : ""}`}>
                      <button className={`zl-card ${items.some((p) => p.id === photoId) ? "sel" : ""}`} onClick={() => setOpenFam(open ? null : fam.key)}>
                        <span className="zl-card-ic"><IconPhoto /></span>
                        <span className="zl-card-main"><b>{L(fam.label, lang)}</b><small>{t("lens.photo.sub")}</small></span>
                        <span className="zl-card-price">{t("lens.fromPrice")} +{money(famMin)} <i className="zl-chev">{open ? "▲" : "▼"}</i></span>
                      </button>
                      {open && (
                        <div className="zl-fam-body">
                          {items.map((p) => (
                            <button key={p.id} className={`zl-variant ${photoId === p.id ? "sel" : ""}`} onClick={() => setPhotoId(p.id)}>
                              <span className="zl-variant-main">
                                {L(p.label, lang)}
                                <span className="zl-dots">{p.colors.map((c) => <i key={c} title={L(PHOTO_COLORS[c], lang)} style={{ background: PHOTO_COLORS[c]?.hex }} />)}</span>
                              </span>
                              <b>+{money(photoPriceOf(p))}</b>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Antirreflejo */}
              <h3 className="zl-sub">{t("lens.ar")} <span className="zl-optional">{t("lens.optional")}</span></h3>
              <div className="zl-cards">
                <button className={`zl-card ${!arId ? "sel" : ""}`} onClick={() => setArId(null)}>
                  <span className="zl-card-ic"><IconAR /></span>
                  <span className="zl-card-main"><b>{t("lens.none")}</b><small>{t("lens.ar.basic")}</small></span>
                  <span className="zl-card-price">{t("lens.included")}</span>
                </button>
                {arList.map((a) => {
                  const blue = a.id.includes("blue") || a.id.includes("uv");
                  return (
                    <button key={a.id} className={`zl-card ${arId === a.id ? "sel" : ""}`} onClick={() => setArId(a.id)}>
                      <span className="zl-card-ic">{blue ? <IconBlue /> : <IconAR />}</span>
                      <span className="zl-card-main"><b>{L(a.label, lang)}</b><small>{blue ? t("lens.ar.blueSub") : t("lens.ar.sub")}</small></span>
                      <span className="zl-card-price">+{money(arPriceOf(a))}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP: índice / grosor */}
          {key === "index" && (
            <div>
              <div className="zl-banner">{t("lens.index.coatings")}</div>
              <div className="zl-cards">
                {MATERIALS.map((m) => {
                  const reco = recommendedMat?.id === m.id;
                  return (
                    <button key={m.id} className={`zl-card zl-card-lg ${matId === m.id ? "sel" : ""}`} onClick={() => setMatId(m.id)}>
                      <span className="zl-card-ic"><IconIndex /></span>
                      <span className="zl-card-main">
                        <b>{L(m.label, lang)} {reco && <span className="zl-badge">{t("lens.recommended")}</span>}</b>
                        <ul className="zl-specs">
                          <li>{L(m.desc, lang)}</li>
                          <li>{t("lens.index.rx")} ±{m.maxAbs === 99 ? "20" : m.maxAbs.toFixed(2)}</li>
                        </ul>
                      </span>
                      <span className="zl-card-price">{money(basePrice(designId, m.id))}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* footer del panel: navegación */}
        <div className="zl-foot">
          <div className="zl-foot-total"><span>{t("lens.total")}</span><b>{money(total)}</b></div>
          <button className="btn btn-primary zl-next" disabled={!canNext} onClick={goNext}>
            {isLast ? t("lens.addCart") : t("lens.continue")}
          </button>
        </div>
      </section>

      {/* Modal de confirmación de receta (Zeelool) */}
      {showConfirm && (
        <div className="zl-modal-bg" onClick={() => setShowConfirm(false)}>
          <div className="zl-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("lens.confirm.title")}</h3>
            <table className="rx-table">
              <thead><tr><th></th><th>SPH</th><th>CYL</th><th>AXIS</th>{design?.add && <th>ADD</th>}</tr></thead>
              <tbody>
                <tr><td>OD</td><td>{fmt(parseFloat(rx.od_sph) || 0)}</td><td>{fmt(parseFloat(rx.od_cyl) || 0)}</td><td>{rx.od_axis || "—"}</td>{design?.add && <td>{rx.add ? "+" + rx.add : "—"}</td>}</tr>
                <tr><td>OS</td><td>{fmt(parseFloat(rx.os_sph) || 0)}</td><td>{fmt(parseFloat(rx.os_cyl) || 0)}</td><td>{rx.os_axis || "—"}</td>{design?.add && <td>{rx.add ? "+" + rx.add : "—"}</td>}</tr>
                <tr><td>PD</td><td colSpan={design?.add ? 4 : 3}>{rx.pd || "—"}</td></tr>
              </tbody>
            </table>
            <div className="zl-modal-actions">
              <button className="btn btn-outline" onClick={() => setShowConfirm(false)}>{t("lens.confirm.edit")}</button>
              <button className="btn btn-primary" onClick={confirmRx}>{t("lens.confirm.ok")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
