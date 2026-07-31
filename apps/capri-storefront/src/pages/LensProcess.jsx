import { useMemo, useState, useEffect } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { useCatalog } from "../data/catalogStore.js";
import { subscribe as onPrices, lensBasePrice, lensPhotoPrice, lensARPrice } from "../admin/priceStore.js";
import {
  DESIGNS, FRAME_ONLY, MATERIALS, BASE, PHOTO, PHOTO_COLORS,
  arListFor, designById, materialById, L, glassesTypeOf,
} from "../data/lensPricing.js";
import { useCart } from "../components/CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

/* ───────────── Iconografía a dos tonos (azul línea + acento rojo) ───────────── */
const RED = "#FD0E3F";
const svg = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
const IconSV = () => (<svg {...svg}><path d="M1.8 12S5.4 6 12 6s10.2 6 10.2 6-3.6 6-10.2 6S1.8 12 1.8 12z" /><circle cx="12" cy="12" r="2.6" stroke={RED} /></svg>);
const IconBifocal = () => (<svg {...svg}><circle cx="12" cy="12" r="8.4" /><path d="M4.2 14.6h15.6" stroke={RED} /></svg>);
const IconProg = () => (<svg {...svg}><circle cx="12" cy="12" r="8.4" /><path d="M5 9.5h14" opacity=".45" /><path d="M6 12.5h12" opacity=".65" /><path d="M7.5 15.5h9" stroke={RED} /></svg>);
const IconFrame = () => (<svg {...svg}><rect x="2.2" y="9" width="8" height="6.4" rx="3.2" /><rect x="13.8" y="9" width="8" height="6.4" rx="3.2" /><path d="M10.2 11.5h3.6" stroke={RED} /><path d="M2.2 10.5l-1-1.5M21.8 10.5l1-1.5" /></svg>);
const IconScan = () => (<svg {...svg}><path d="M3 8V5.5A1.5 1.5 0 014.5 4H7M17 4h2.5A1.5 1.5 0 0121 5.5V8M21 16v2.5a1.5 1.5 0 01-1.5 1.5H17M7 20H4.5A1.5 1.5 0 013 18.5V16" /><circle cx="12" cy="12" r="3.1" stroke={RED} /></svg>);
const IconFill = () => (<svg {...svg}><path d="M6 3h8l4 4v9a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z" /><path d="M8 12h4M8 15.5h6" /><path d="M17.4 8.4l2.2 2.2-4.6 4.6-2.6.4.4-2.6z" stroke={RED} /></svg>);
const IconClear = () => (<svg {...svg}><circle cx="12" cy="12" r="8.4" /><path d="M7.5 9.5c2 2.2 5.4 2.6 8.5 1.3" opacity=".5" /></svg>);
const IconPhoto = () => (<svg {...svg}><circle cx="12" cy="12" r="8.4" /><path d="M12 3.6a8.4 8.4 0 000 16.8z" fill="currentColor" stroke="none" opacity=".9" /><path d="M18.5 7l1.2-1.2M20 12h1.6M18.5 17l1.2 1.2" stroke={RED} strokeWidth="1.3" /></svg>);
const IconBlue = () => (<svg {...svg}><rect x="3" y="4.5" width="18" height="12" rx="1.8" /><path d="M8.5 20h7M12 16.5V20" /><path d="M12 7.4l1.3 2.7 2.9.3-2.2 2 .6 2.9L12 14l-2.6 1.3.6-2.9-2.2-2 2.9-.3z" stroke={RED} strokeWidth="1.2" /></svg>);
const IconAR = () => (<svg {...svg}><path d="M12 2.6l7.4 2.6v5.2c0 4.6-3.1 8.4-7.4 10.4-4.3-2-7.4-5.8-7.4-10.4V5.2z" /><path d="M8.6 12l2.3 2.3 4.5-4.6" stroke={RED} /></svg>);
const IconIndex = () => (<svg {...svg}><path d="M7 4C3.4 7 3.4 17 7 20M17 4c3.6 3 3.6 13 0 16" /><path d="M7 4h10M7 20h10" /><path d="M12 8v8" stroke={RED} strokeWidth="1.3" /></svg>);
const IconHelp = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 113.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01" strokeLinecap="round" /></svg>);
const Spinner = () => (<svg className="zl-spin" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 3a9 9 0 109 9" /></svg>);

const designIcon = (id) => id === "sv" ? <IconSV /> : id === "bifocal" ? <IconBifocal />
  : (id === "prog-mid" || id === "prog-high") ? <IconProg /> : id === "frame-only" ? <IconFrame /> : <IconSV />;

const IconSun = () => (<svg {...svg}><circle cx="12" cy="12" r="4.2" stroke={RED} /><path d="M12 2.4v2.4M12 19.2v2.4M4.4 4.4l1.7 1.7M17.9 17.9l1.7 1.7M2.4 12h2.4M19.2 12h2.4M4.4 19.6l1.7-1.7M17.9 6.1l1.7-1.7" /></svg>);
// Icono para el "tipo de gafas" que se muestra en vivo bajo la montura.
const glassesTypeIcon = (icon) => icon === "sun" ? <IconSun /> : icon === "photo" ? <IconPhoto /> : <IconClear />;

/* ───────────── Selects de receta ───────────── */
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
const PDHALF = range(25, 38, 0.5).map((v) => ({ v, label: v.toFixed(1) }));

const qStep = (v, lo, hi, step) => {
  if (v == null || isNaN(v)) return null;
  let n = Math.round(Number(v) / step) * step;
  n = Math.max(lo, Math.min(hi, n));
  return String(Math.round(n * 100) / 100);
};

function SelectCell({ value, onChange, options, disabled, title }) {
  return (
    <select className={"rx-select" + (disabled ? " is-off" : "")} value={value} disabled={disabled} title={disabled ? title : undefined}
      onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}
function Field({ label, value, onChange, options, t, withEmpty, hint }) {
  return (
    <label className="rx-field">
      <span>{label}{hint && <i className="rx-hint">{hint}</i>}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {withEmpty && <option value="">{t("lens.select")}</option>}
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </label>
  );
}

// Familias fotocromáticas con explicación DIFERENCIADORA (no todas dicen lo mismo):
// cada una aclara qué la distingue y para quién conviene.
const PHOTO_FAMILIES = [
  { key: "photo", label: { es: "Fotocromático", en: "Photochromic" }, ids: ["photo-grey", "photo-brown"],
    desc: { es: "La opción económica. Se oscurecen al sol y se aclaran adentro, pero tardan un poco más y aclaran menos con calor.",
            en: "The budget option. Darken in the sun and clear indoors, but change a bit slower and stay slightly tinted in heat." } },
  { key: "trans-s", label: { es: "Transitions Gen S", en: "Transitions Gen S" }, ids: ["trans-s-grey", "trans-s-brown", "trans-s-green"],
    desc: { es: "Marca Transitions: cambian rápido y quedan totalmente claros en interior. La opción equilibrada para el día a día.",
            en: "Transitions brand: change fast and go fully clear indoors. The balanced everyday choice." } },
  { key: "trans-x", label: { es: "Transitions XTRActive", en: "Transitions XTRActive" }, ids: ["trans-x-grey", "trans-x-brown"],
    desc: { es: "Los más oscuros, incluso con calor, y se activan algo dentro del auto. Para quien pasa mucho tiempo al aire libre o maneja.",
            en: "The darkest, even in heat, and activate a little inside the car. For lots of outdoor time or driving." } },
];
// Diseños multifocales (se ofrecen solo si la receta trae ADD).
const MULTI_IDS = ["bifocal", "prog-mid", "prog-high"];
const RECOMMENDED_MULTI = "prog-mid";

const MEDUSA_URL = (import.meta.env && import.meta.env.VITE_MEDUSA_URL) ? String(import.meta.env.VITE_MEDUSA_URL).replace(/\/$/, "") : "";
// Llamamos al backend vía proxy MISMO ORIGEN (/medusa) para evitar CORS del navegador.
// El proxy lo resuelve Vite en dev y Vercel (rewrite) en prod. Si no hay backend, vacío.
const MEDUSA_BASE = MEDUSA_URL ? "/medusa" : "";
const PK = (import.meta.env && import.meta.env.VITE_MEDUSA_PUBLISHABLE_KEY) || "";

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
  const [rxMethod, setRxMethod] = useState(null); // "scan" | "fill" | null
  const [matId, setMatId] = useState(null);
  const [photoId, setPhotoId] = useState(null);
  const [arId, setArId] = useState(null);
  const [rx, setRx] = useState({ od_sph: "0", od_cyl: "0", od_axis: "0", os_sph: "0", os_cyl: "0", os_axis: "0", pd: "", pd_od: "", pd_os: "", add: "" });
  const [twoPd, setTwoPd] = useState(false);
  const [ocr, setOcr] = useState({ status: "idle", file: null, msg: "" }); // idle|loading|done|error
  const [openFam, setOpenFam] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pv, setPv] = useState(0);
  useEffect(() => onPrices(() => setPv((v) => v + 1)), []);

  // Header visible: medimos su alto para los offsets sticky (no perder el menú).
  useEffect(() => {
    const setH = () => {
      const h = document.querySelector(".header")?.offsetHeight || 104;
      document.documentElement.style.setProperty("--zl-hh", h + "px");
    };
    setH();
    window.addEventListener("resize", setH);
    return () => window.removeEventListener("resize", setH);
  }, []);

  if (!product) return <div className="section"><p>{t("notfound")} <Link to="/catalogo">{t("notfound.link")}</Link></p></div>;
  const color = product.colors[colorIdx] || product.colors[0];

  const frameOnly = designId === "frame-only";
  const hasRx = rxMethod === "scan" || rxMethod === "fill";
  const rxReady = rxMethod === "fill" || ocr.status === "done";
  const addVal = parseFloat(rx.add) || 0;
  const isMulti = hasRx && addVal > 0;

  // AXIS solo aplica si hay cilindro (CYL≠0). Si no, se deshabilita el campo.
  const odAxisOff = (parseFloat(rx.od_cyl) || 0) === 0;
  const osAxisOff = (parseFloat(rx.os_cyl) || 0) === 0;
  // Tipo de gafas VISIBLE (comunes / todos los momentos / sol) según el foto elegido.
  const glassesType = frameOnly ? null : glassesTypeOf(photoId);

  const design = frameOnly ? FRAME_ONLY : designById(designId);
  const cat = design && design.cat;

  const basePrice = (dId, mId) => lensBasePrice(dId, mId, (BASE[dId] || {})[mId] ?? 0);
  const photoPriceOf = (p) => (cat && p.price[cat] != null ? lensPhotoPrice(p.id, cat, p.price[cat]) : null);
  const arList = design && !frameOnly ? arListFor(design) : [];
  const arPriceOf = (a) => lensARPrice(a.id, a.price);
  const minDesignPrice = (dId) => Math.min(...MATERIALS.map((m) => basePrice(dId, m.id)));
  const sortedMats = useMemo(() => designId && !frameOnly
    ? [...MATERIALS].sort((a, b) => basePrice(designId, a.id) - basePrice(designId, b.id)) : MATERIALS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [designId, frameOnly, pv]);
  const matBase = designId && !frameOnly ? minDesignPrice(designId) : 0;

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

  // ── Flujo NUEVO: receta primero; el diseño se deduce de la receta ──
  //   1) receta (escanear / manual / sin graduación)
  //   2) datos de la receta  → auto: sin ADD = Visión Sencilla; con ADD = multifocal
  //   3) [solo multifocal] elegir Bifocal / Progresivo Media / Alta
  //   4) tratamiento   5) índice
  const stepKeys = frameOnly
    ? ["rxmethod"]
    : isMulti
      ? ["rxmethod", "rx", "design", "treatment", "index"]
      : ["rxmethod", "rx", "treatment", "index"];
  const key = stepKeys[Math.min(step, stepKeys.length - 1)];
  const isLast = step >= stepKeys.length - 1;

  const canNext =
    (key === "rxmethod" && (hasRx || frameOnly)) ||
    (key === "rx" && rxReady) ||
    (key === "design" && MULTI_IDS.includes(designId)) ||
    (key === "treatment") ||
    (key === "index" && matId);

  const money = (n) => "$" + Number(n).toFixed(2);
  const setF = (k) => (v) => setRx((r) => ({ ...r, [k]: v }));

  // ── OCR: subir imagen → detectar receta ──
  async function handleOcr(file) {
    if (!file) return;
    setOcr({ status: "loading", file: file.name, msg: "" });
    try {
      if (!MEDUSA_BASE) throw new Error("no-backend");
      const fd = new FormData();
      fd.append("file", file);
      const headers = {};
      if (PK) headers["x-publishable-api-key"] = PK;
      const res = await fetch(`${MEDUSA_BASE}/store/prescriptions/ocr`, { method: "POST", body: fd, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.fallback) { const e = new Error(data.error || "fallback"); e.fallback = !!data.fallback; throw e; }
      const od = data.od || {}, os = data.os || {};
      const pdOd = qStep(data.pd_od, 25, 38, 0.5);
      const pdOs = qStep(data.pd_os, 25, 38, 0.5);
      setRx((r) => ({
        ...r,
        od_sph: qStep(od.sph, -20, 12, 0.25) ?? "0",
        od_cyl: qStep(od.cyl, -6, 6, 0.25) ?? "0",
        od_axis: od.axis != null ? String(Math.max(0, Math.min(180, Math.round(od.axis)))) : "0",
        os_sph: qStep(os.sph, -20, 12, 0.25) ?? "0",
        os_cyl: qStep(os.cyl, -6, 6, 0.25) ?? "0",
        os_axis: os.axis != null ? String(Math.max(0, Math.min(180, Math.round(os.axis)))) : "0",
        pd: qStep(data.pd, 50, 76, 0.5) ?? r.pd,
        pd_od: pdOd ?? "",
        pd_os: pdOs ?? "",
        add: qStep(od.add ?? os.add, 0.75, 3.5, 0.25) ?? "",
      }));
      if (pdOd && pdOs) setTwoPd(true);
      setOcr({ status: "done", file: file.name, msg: "" });
    } catch (e) {
      // Sin lector disponible (backend sin API key) → pasamos a manual con aviso claro.
      setRxMethod("fill");
      setOcr({ status: "error", file: file?.name || "", msg: e.fallback ? "disabled" : "read" });
    }
  }

  const goNext = () => {
    if (key === "rx" && rxReady) { setShowConfirm(true); return; }
    if (isLast) return finish();
    setStep((s) => s + 1);
  };
  const confirmRx = () => {
    setShowConfirm(false);
    // AUTO: el sistema fija el diseño según la receta.
    if (addVal > 0) {
      if (!MULTI_IDS.includes(designId)) setDesignId(RECOMMENDED_MULTI); // multifocal → refina luego
    } else {
      setDesignId("sv"); // sin ADD → Visión Sencilla automática
    }
    setStep((s) => s + 1);
  };

  const finish = () => {
    // Desglose LEGIBLE del lente (etiqueta + precio) — se guarda en el carrito y
    // luego en la orden, para que cliente y admin vean EXACTAMENTE lo mismo.
    const specs = [];
    if (!frameOnly && material) specs.push({ label: `${L(design.label, lang)} · ${L(material.label, lang)}`, price: basePrice(designId, matId) });
    if (!frameOnly && photo && photoPriceOf(photo) != null) specs.push({ label: L(photo.label, lang), price: photoPriceOf(photo) });
    if (!frameOnly && ar) specs.push({ label: L(ar.label, lang), price: arPriceOf(ar) });
    // Receta guardada con el artículo (se conserva en la orden y en el perfil).
    const rxSnapshot = frameOnly ? null : {
      od: { sph: rx.od_sph, cyl: rx.od_cyl, axis: odAxisOff ? "" : rx.od_axis },
      os: { sph: rx.os_sph, cyl: rx.os_cyl, axis: osAxisOff ? "" : rx.os_axis },
      pd: twoPd ? "" : rx.pd, pd_od: twoPd ? rx.pd_od : "", pd_os: twoPd ? rx.pd_os : "",
      add: isMulti ? rx.add : "", twoPd,
    };
    addItem({
      sku: product.sku, name: product.name, color: color.name,
      brand: product.brand || product.brand_slug || "—",   // para analítica de marcas del admin
      design: frameOnly ? "frame-only" : designId, material: matId, photo: photoId, ar: arId,
      glassesType: glassesType ? glassesType.key : "frame",
      glassesLabel: glassesType ? glassesType.label : FRAME_ONLY.label,
      rx: rxSnapshot,
      specs, total,
    });
    navigate(`/producto/${product.slug}`);
  };

  const progress = ((step + 1) / stepKeys.length) * 100;
  const stepTitle = {
    rxmethod: t("lens.rxmethod.title"), rx: t("lens.q.rx"),
    design: t("lens.design.title"), treatment: t("lens.treatment.title"), index: t("lens.index.title"),
  }[key];

  const designLabel = frameOnly ? L(FRAME_ONLY.label, lang) : designId ? L(designById(designId)?.label, lang) : "";

  return (
    <div className="zl">
      {/* ───────── Izquierda: montura + resumen + subtotal ───────── */}
      <aside className="zl-preview">
        <div className="zl-preview-img"><img src={color.image} alt={product.name} onError={(e) => { e.currentTarget.style.opacity = 0.3; }} /></div>

        {/* Tipo de gafas EN VIVO: el cliente ve claramente qué está mandando a hacer. */}
        {glassesType && (
          <div className={`zl-gtype gt-${glassesType.key}`} style={{ "--gt": glassesType.hex }}>
            <span className="zl-gtype-ic">{glassesTypeIcon(glassesType.icon)}</span>
            <span className="zl-gtype-tx"><b>{L(glassesType.label, lang)}</b><small>{L(glassesType.hint, lang)}</small></span>
          </div>
        )}
        {frameOnly && (
          <div className="zl-gtype gt-frame"><span className="zl-gtype-ic"><IconFrame /></span><span className="zl-gtype-tx"><b>{L(FRAME_ONLY.label, lang)}</b><small>{t("lens.desc.frame-only")}</small></span></div>
        )}

        <dl className="zl-recap">
          <div><dt>{t("card.frame")}</dt><dd>{product.name} · {color.name}<b>{money(product.price)}</b></dd></div>
          {!frameOnly && rxReady && <div><dt>{t("lens.q.rx")}</dt><dd>OD {fmt(parseFloat(rx.od_sph) || 0)} · OS {fmt(parseFloat(rx.os_sph) || 0)}{isMulti ? ` · ADD +${rx.add}` : ""}</dd></div>}
          {designLabel && (designId || frameOnly) && <div><dt>{t("lens.use")}</dt><dd>{designLabel}</dd></div>}
          {photo && !frameOnly && photoPriceOf(photo) != null && <div><dt>{t("lens.photo")}</dt><dd>{L(photo.label, lang)}<b>+{money(photoPriceOf(photo))}</b></dd></div>}
          {ar && !frameOnly && <div><dt>{t("lens.ar")}</dt><dd>{L(ar.label, lang)}<b>+{money(arPriceOf(ar))}</b></dd></div>}
          {material && !frameOnly && <div><dt>{t("lens.material")}</dt><dd>{L(material.label, lang)}<b>{money(basePrice(designId, matId))}</b></dd></div>}
        </dl>

        {/* Explicación detallada, en vivo, de lo que se va seleccionando. */}
        {!frameOnly && (design || material || photo || ar) && (
          <div className="zl-detail">
            <div className="zl-detail-h">{t("lens.detail.title")}</div>
            <ul>
              {design && <li><span>{L(design.label, lang)}</span>{t(`lens.desc.${design.id}`)}</li>}
              {material && <li><span>{L(material.label, lang)}</span>{L(material.desc, lang)}</li>}
              {photo && photoPriceOf(photo) != null && <li><span>{L(photo.label, lang)}</span>{L(PHOTO_FAMILIES.find((f) => f.ids.includes(photo.id))?.desc, lang)}</li>}
              {ar && <li><span>{L(ar.label, lang)}</span>{L(ar.desc, lang)}</li>}
            </ul>
          </div>
        )}

        <div className="zl-subtotal"><span>{t("lens.total")}</span><b>{money(total)}</b></div>
      </aside>

      {/* ───────── Derecha: wizard ───────── */}
      <section className="zl-panel">
        <div className="zl-phead">
          <div className="zl-progress"><i style={{ width: `${progress}%` }} /></div>
          <div className="zl-top">
            {step > 0 ? <button className="zl-back" onClick={() => setStep((s) => s - 1)}>‹ {t("lens.back2")}</button> : <span />}
            <Link to={`/producto/${product.slug}`} className="zl-close" aria-label={t("lens.back")}>✕</Link>
          </div>
          <div className="zl-title-row">
            <h2>{stepTitle}</h2>
            {key === "rx" && <span className="zl-help"><IconHelp /> {t("lens.rxHelp.link")}</span>}
          </div>
        </div>

        <div className="zl-scroll">
          {/* STEP 1: receta (escanear / manual / sin graduación) */}
          {key === "rxmethod" && (
            <>
              <div className="zl-cards">
                <button className={`zl-card ${rxMethod === "scan" ? "sel" : ""}`} onClick={() => { setRxMethod("scan"); setDesignId(null); setOcr({ status: "idle", file: null, msg: "" }); }}>
                  <span className="zl-card-ic"><IconScan /></span>
                  <span className="zl-card-main"><b>{t("lens.rxmethod.scan")}</b><small>{t("lens.rxmethod.scan.sub")}</small></span>
                </button>
                <button className={`zl-card ${rxMethod === "fill" ? "sel" : ""}`} onClick={() => { setRxMethod("fill"); setDesignId(null); }}>
                  <span className="zl-card-ic"><IconFill /></span>
                  <span className="zl-card-main"><b>{t("lens.rxmethod.fill")}</b><small>{t("lens.rxmethod.fill.sub")}</small></span>
                </button>
                <button className={`zl-card ${frameOnly ? "sel" : ""}`} onClick={() => { setDesignId("frame-only"); setRxMethod(null); setMatId(null); setPhotoId(null); setArId(null); }}>
                  <span className="zl-card-ic"><IconFrame /></span>
                  <span className="zl-card-main"><b>{t("lens.rxmethod.none")}</b><small>{t("lens.rxmethod.none.sub")}</small></span>
                  <span className="zl-card-price zl-inc">{t("lens.included")}</span>
                </button>
              </div>
              <p className="zl-signin">{t("lens.rxmethod.saved")} <Link to="/cuenta">{t("auth.account")}</Link></p>
            </>
          )}

          {/* STEP 2: ingresar receta (siempre con ADD para deducir multifocal) */}
          {key === "rx" && (
            <div>
              <div className="zl-banner">{t("lens.rx.sph")}</div>

              {rxMethod === "scan" && ocr.status !== "done" && (
                ocr.status === "loading" ? (
                  <div className="zl-ocr-loading"><Spinner /><b>{t("lens.ocr.loading")}</b><small>{ocr.file}</small></div>
                ) : (
                  <label className="zl-upload">
                    <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => handleOcr(e.target.files?.[0])} />
                    <span className="zl-upload-ic"><IconScan /></span>
                    <b>{t("lens.upload")}</b>
                    <small>{t("lens.upload.sub")}</small>
                  </label>
                )
              )}

              {rxReady && (
                <>
                  {ocr.status === "done" && <div className="zl-detected">✓ {t("lens.ocr.detected")}</div>}
                  {ocr.status === "error" && <div className="zl-ocr-error">{ocr.msg === "disabled" ? t("lens.ocr.disabled") : t("lens.ocr.error")}</div>}
                  <table className="rx-table">
                    <thead><tr><th></th><th>SPH</th><th>CYL</th><th>AXIS</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>{t("lens.right")}<small>OD</small></td>
                        <td><SelectCell value={rx.od_sph} onChange={setF("od_sph")} options={SPH} /></td>
                        <td><SelectCell value={rx.od_cyl} onChange={setF("od_cyl")} options={CYL} /></td>
                        <td><SelectCell value={odAxisOff ? "0" : rx.od_axis} onChange={setF("od_axis")} options={AXIS} disabled={odAxisOff} title={t("lens.axis.off")} /></td>
                      </tr>
                      <tr>
                        <td>{t("lens.left")}<small>OS</small></td>
                        <td><SelectCell value={rx.os_sph} onChange={setF("os_sph")} options={SPH} /></td>
                        <td><SelectCell value={rx.os_cyl} onChange={setF("os_cyl")} options={CYL} /></td>
                        <td><SelectCell value={osAxisOff ? "0" : rx.os_axis} onChange={setF("os_axis")} options={AXIS} disabled={osAxisOff} title={t("lens.axis.off")} /></td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="rx-extra">
                    {!twoPd
                      ? <Field label={t("lens.pd")} value={rx.pd} onChange={setF("pd")} options={PD} t={t} withEmpty />
                      : (<>
                          <Field label={`${t("lens.pd")} OD`} value={rx.pd_od} onChange={setF("pd_od")} options={PDHALF} t={t} withEmpty />
                          <Field label={`${t("lens.pd")} OS`} value={rx.pd_os} onChange={setF("pd_os")} options={PDHALF} t={t} withEmpty />
                        </>)}
                    <Field label={t("lens.addLbl")} value={rx.add} onChange={setF("add")} options={ADD} t={t} withEmpty hint={t("lens.add.hint")} />
                  </div>
                  <label className="zl-check"><input type="checkbox" checked={twoPd} onChange={(e) => setTwoPd(e.target.checked)} /> {t("lens.pd.two")}</label>
                  {(odAxisOff || osAxisOff) && <div className="zl-fieldnote">ⓘ {t("lens.axis.note")}</div>}
                  <div className="zl-auto">{isMulti ? t("lens.auto.multi") : t("lens.auto.sv")}</div>
                  <p className="zl-chat">{t("lens.rx.verify")} <Link to="/catalogo">{t("chat.soon")}</Link></p>
                </>
              )}
            </div>
          )}

          {/* STEP 3: tipo multifocal (solo si hay ADD) */}
          {key === "design" && (
            <div>
              <div className="zl-banner">{t("lens.design.note")}</div>
              <div className="zl-cards">
                {MULTI_IDS.map((id) => {
                  const d = designById(id);
                  const reco = id === RECOMMENDED_MULTI;
                  return (
                    <button key={id} className={`zl-card ${designId === id ? "sel" : ""}`} onClick={() => setDesignId(id)}>
                      <span className="zl-card-ic">{designIcon(id)}</span>
                      <span className="zl-card-main"><b>{L(d.label, lang)} {reco && <span className="zl-badge">{t("lens.recommended")}</span>}</b><small>{t(`lens.desc.${id}`)}</small></span>
                      <span className="zl-card-price">{t("lens.fromPrice")} {money(minDesignPrice(id))}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 4: tratamiento */}
          {key === "treatment" && (
            <div>
              <h3 className="zl-sub">{t("lens.photo")} <span className="zl-optional">{t("lens.optional")}</span></h3>
              <div className="zl-cards">
                <button className={`zl-card ${!photoId ? "sel" : ""}`} onClick={() => setPhotoId(null)}>
                  <span className="zl-card-ic"><IconClear /></span>
                  <span className="zl-card-main"><b>{t("lens.transparent")}</b><small>{t("lens.transparent.sub")}</small></span>
                  <span className="zl-card-price zl-inc">{t("lens.included")}</span>
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
                        <span className="zl-card-main"><b>{L(fam.label, lang)}</b><small>{L(fam.desc, lang)}</small></span>
                        <span className="zl-card-price">{t("lens.fromPrice")} +{money(famMin)} <i className="zl-chev">{open ? "▲" : "▼"}</i></span>
                      </button>
                      {open && (
                        <div className="zl-fam-body">
                          {items.map((p) => {
                            const col = PHOTO_COLORS[p.colors[0]];
                            return (
                              <button key={p.id} className={`zl-variant ${photoId === p.id ? "sel" : ""}`} onClick={() => setPhotoId(p.id)}>
                                <span className="zl-variant-main">
                                  <span className="zl-variant-lbl">{L(p.label, lang)}<span className="zl-dots">{p.colors.map((c) => <i key={c} title={L(PHOTO_COLORS[c], lang)} style={{ background: PHOTO_COLORS[c]?.hex }} />)}</span></span>
                                  {col?.note && <small className="zl-variant-note">{L(col.note, lang)}</small>}
                                </span>
                                <b>+{money(photoPriceOf(p))}</b>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <h3 className="zl-sub">{t("lens.ar")} <span className="zl-optional">{t("lens.optional")}</span></h3>
              <div className="zl-cards">
                <button className={`zl-card ${!arId ? "sel" : ""}`} onClick={() => setArId(null)}>
                  <span className="zl-card-ic"><IconAR /></span>
                  <span className="zl-card-main"><b>{t("lens.none")}</b><small>{t("lens.ar.basic")}</small></span>
                  <span className="zl-card-price zl-inc">{t("lens.included")}</span>
                </button>
                {arList.map((a) => {
                  const blue = a.id.includes("blue") || a.id.includes("uv");
                  return (
                    <button key={a.id} className={`zl-card ${arId === a.id ? "sel" : ""}`} onClick={() => setArId(a.id)}>
                      <span className="zl-card-ic">{blue ? <IconBlue /> : <IconAR />}</span>
                      <span className="zl-card-main"><b>{L(a.label, lang)}</b><small>{L(a.desc, lang) || (blue ? t("lens.ar.blueSub") : t("lens.ar.sub"))}</small></span>
                      <span className="zl-card-price">+{money(arPriceOf(a))}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 5: índice / grosor */}
          {key === "index" && (
            <div>
              <div className="zl-banner ok">{t("lens.index.coatings")}</div>
              <div className="zl-cards">
                {sortedMats.map((m) => {
                  const price = basePrice(designId, m.id);
                  const delta = Math.round((price - matBase) * 100) / 100;
                  const reco = recommendedMat?.id === m.id;
                  // No apto: la graduación supera el máximo recomendado del material.
                  const unfit = maxAbs > m.maxAbs;
                  return (
                    <button key={m.id} disabled={unfit} className={`zl-card zl-card-lg ${matId === m.id ? "sel" : ""} ${unfit ? "is-off" : ""}`} onClick={() => !unfit && setMatId(m.id)}>
                      <span className="zl-card-ic"><IconIndex /></span>
                      <span className="zl-card-main">
                        <b>{L(m.label, lang)} {reco && !unfit && <span className="zl-badge">{t("lens.recommended")}</span>}{unfit && <span className="zl-badge off">{t("lens.notFit")}</span>}</b>
                        <ul className="zl-specs"><li>{L(m.desc, lang)}</li><li>{t("lens.index.rx")} ±{m.maxAbs === 99 ? "20" : m.maxAbs.toFixed(2)}</li></ul>
                      </span>
                      <span className={`zl-card-price ${delta === 0 ? "zl-inc" : ""}`}>{delta === 0 ? t("lens.included") : `+${money(delta)}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="zl-foot">
          <div className="zl-foot-total"><span>{t("lens.total")}</span><b>{money(total)}</b></div>
          <button className="btn btn-primary zl-next" disabled={!canNext} onClick={goNext}>{isLast ? t("lens.addCart") : t("lens.continue")}</button>
        </div>
      </section>

      {/* Modal de confirmación de receta */}
      {showConfirm && (
        <div className="zl-modal-bg" onClick={() => setShowConfirm(false)}>
          <div className="zl-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("lens.confirm.title")}</h3>
            <p className="zl-modal-sub">{isMulti ? t("lens.auto.multi") : t("lens.auto.sv")}</p>
            <table className="rx-table view">
              <thead><tr><th></th><th>SPH</th><th>CYL</th><th>AXIS</th>{isMulti && <th>ADD</th>}</tr></thead>
              <tbody>
                <tr><td>OD<small>{t("lens.right")}</small></td><td>{fmt(parseFloat(rx.od_sph) || 0)}</td><td>{fmt(parseFloat(rx.od_cyl) || 0)}</td><td>{rx.od_axis && rx.od_axis !== "0" ? rx.od_axis + "°" : "—"}</td>{isMulti && <td>{rx.add ? "+" + rx.add : "—"}</td>}</tr>
                <tr><td>OS<small>{t("lens.left")}</small></td><td>{fmt(parseFloat(rx.os_sph) || 0)}</td><td>{fmt(parseFloat(rx.os_cyl) || 0)}</td><td>{rx.os_axis && rx.os_axis !== "0" ? rx.os_axis + "°" : "—"}</td>{isMulti && <td>{rx.add ? "+" + rx.add : "—"}</td>}</tr>
                <tr><td>PD</td><td colSpan={isMulti ? 4 : 3}>{twoPd ? `${rx.pd_od || "—"} / ${rx.pd_os || "—"}` : (rx.pd || "—")}</td></tr>
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
