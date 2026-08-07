import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { useCatalog, matchProduct } from "../data/catalogStore.js";
import { subscribe as onPrices, lensBasePrice, lensPhotoPrice, lensARPrice } from "../admin/priceStore.js";
// Catalog rows (designs/materials/prices/photo/AR) come from the backend via
// useLensCatalog; only the presentation-only bits with no backend counterpart —
// the synthetic "frame only" choice, the swatch hexes and the label picker — stay local.
import { FRAME_ONLY, PHOTO_COLORS, arGroupFor, L } from "../data/lensPricing.js";
import { useLensCatalog } from "../data/lensCatalog.js";
import { useCart } from "../components/CartContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";
import { medusa, USE_MEDUSA } from "../data/medusa.js";
import { createPrescription, ocrPrescription } from "../data/medusaCart.js";
import { materialEdu, arEdu, photoEdu, frameMatEdu } from "../data/lensEducation.js";
import {
  IconReceta, IconMaterial, IconTratamiento, IconMontura,
  IconSencilla, IconBifocal, IconProgresivo,
  IconFotocromatico, IconAr, IconAzul,
  DIAGRAMS,
} from "../components/LensGraphics.jsx";
import GlassesLoader from "../components/GlassesLoader.jsx";

// ── LensGraphics wiring ─────────────────────────────────────────────────────
// Map each catalog option to its LensGraphics icon and to the educational
// diagram(s) that explain it. Codes are the canonical lens-config codes shared
// with the backend (see lensPricing.js), so this mapping is stable whether the
// catalog came from Medusa or the bundled fallback.
const DESIGN_ICON = {
  sv: IconSencilla,
  bifocal: IconBifocal,
  "prog-mid": IconProgresivo,
  "prog-high": IconProgresivo,
};
const designIcon = (id) => (id === "frame-only" ? IconMontura : DESIGN_ICON[id] || IconSencilla);
// Progresivo se muestra como UN solo botón; la gama (Media/Alta) se elige dentro.
const PROG_GROUP = { id: "prog", group: true, cat: "prog", label: { es: "Progresivo", en: "Progressive" } };
// Blue-light AR variants get the screen icon + blue-light diagram; the rest are
// general anti-reflective coatings whose headline benefit is night-driving glare.
const isBlueAr = (id) => id === "ar-blue-protect" || id === "blue-uv-445";
const arIconOf = (id) => (isBlueAr(id) ? IconAzul : IconAr);

// Diagram keys (into LensGraphics.DIAGRAMS) per selected option.
const designDiagKeys = (design) => (design && design.cat === "prog" ? ["progressive", "visionFields"] : []);
const materialDiagKeys = () => ["thickness"];
// Xtractive photochromics behave like real sunglasses in strong sun → also show
// the polarized/glare figure; every photochromic shows the darkening figure.
const photoDiagKeys = (p) => (p && String(p.id).includes("trans-x") ? ["photochromic", "polarized"] : ["photochromic"]);
const arDiagKeys = (id) => (isBlueAr(id) ? ["blueLight"] : ["nightDrive"]);

// Renders one or more educational diagrams (in the existing .zlx-pop) with a
// short bilingual caption resolved through t() (keys live in translations.js).
function DiagHelp({ keys, t }) {
  if (!keys || !keys.length) return null;
  return (
    <div className="zlx-diag-help">
      {keys.map((k) => {
        const Diag = DIAGRAMS[k];
        if (!Diag) return null;
        return (
          <figure key={k} className="zlx-diag-fig">
            <Diag t={t} title={t(`diag.${k}.title`)} />
            <figcaption className="zlx-diag-cap">{t(`diag.${k}.cap`)}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

const fmt = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2);
function range(min, max, step) {
  const out = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
// Rangos acotados a los valores optométricos estándar:
//  SPH  −20.00…+20.00 (0.25)   CYL −6.00…+6.00 (0.25)
//  AXIS 1…180° (entero; "—" = sin cilindro)   ADD +0.75…+3.50 (0.25)
//  PD total 48…80 mm (0.5)     PD monocular 24…40 mm (0.5)
const SPH = range(-20, 20, 0.25).map((v) => ({ v, label: fmt(v) }));
const CYL = range(-6, 6, 0.25).map((v) => ({ v, label: fmt(v) }));
const AXIS = [{ v: 0, label: "—" }, ...range(1, 180, 1).map((v) => ({ v, label: v + "°" }))];
const ADD = range(0.75, 3.5, 0.25).map((v) => ({ v, label: "+" + v.toFixed(2) }));
const PD = range(48, 80, 0.5).map((v) => ({ v, label: v.toFixed(1) }));
// Monocular PD (one value per eye) uses a lower range than the binocular total.
const PD_MONO = range(24, 40, 0.5).map((v) => ({ v, label: v.toFixed(1) }));

// Which piece of advice fits the failure. `ocrPrescription` normalises every
// backend reason into an OcrError code (falling back to one derived from the
// HTTP status when the backend predates error codes), and each code maps to
// copy that tells the customer what to actually DO next. Anything unrecognised
// lands on the generic message rather than leaving the reason blank.
const OCR_ERROR_REASON = {
  file_required: "badFile",
  file_too_large: "tooLarge",
  unsupported_media_type: "badFormat",
  ocr_rate_limited: "rateLimited",
  ocr_unavailable: "unavailable",
  ocr_unreadable: "unreadable",
};
const ocrErrorReason = (code) => OCR_ERROR_REASON[code] || "generic";
// ALTURA DE MONTAJE (fitting/seg height): distancia vertical del borde interior
// inferior de la montura al centro de la pupila. Es OBLIGATORIA en multifocales —
// sin altura no se puede fabricar un progresivo. (Se mide con la montura puesta,
// al 0.5 mm.)  Progresivo: 14–30 mm (típico 18–22).  Bifocal: 10–20 mm (tope del
// segmento al borde del párpado inferior).  Refs: lens.com, optogrid, icarelabs.
const HEIGHT_PROG = range(14, 30, 0.5).map((v) => ({ v, label: v.toFixed(1) }));
const HEIGHT_BIFOCAL = range(10, 20, 0.5).map((v) => ({ v, label: v.toFixed(1) }));

// OCR returns free-form numbers; the pickers only accept values that exist as
// options. Snap to the closest one so a reading of -2.30 lands on -2.25 instead
// of leaving the field blank. Out-of-range values clamp to the nearest end and
// the server-side validation surfaces the warning at the review step.
function nearest(value, options) {
  const v = Number(value);
  if (value == null || Number.isNaN(v)) return null;
  let best = options[0];
  for (const o of options) {
    if (Math.abs(o.v - v) < Math.abs(best.v - v)) best = o;
  }
  return String(best.v);
}

// ── icon-first SVG set (stroke=currentColor, 24 grid) ───────────────────────
const GLYPHS = {
  rx: <><circle cx="7" cy="12" r="4.2" /><circle cx="17" cy="12" r="4.2" /><path d="M11.2 12h1.6" /><path d="M2.8 12h.4M20.8 12h.4" /></>,
  material: <path d="M12 3l4.5 6L12 21 7.5 9z" />,
  treat: <><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" /><circle cx="12" cy="12" r="3" /></>,
  buy: <path d="M6.5 8V6.5a5.5 5.5 0 0111 0V8h2.2l-.9 12.2H5.2L4.3 8z" />,
  check: <path d="M20 6L9 17l-5-5" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5h.01" /></>,
  good: <path d="M20 6L9 17l-5-5" />,
  bad: <path d="M15 9l-6 6M9 9l6 6" />,
  tag: <><path d="M20.5 12.5l-8 8-9-9V3.5h8z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  frame: <><rect x="2" y="8" width="20" height="8.5" rx="3" /><path d="M9 12h6M2 10.5C2 9 3 8 5 8M22 10.5C22 9 21 8 19 8" /></>,
  upload: <><path d="M12 15V4M8 8l4-4 4 4" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></>,
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />,
};
function Ic({ name, className }) {
  return (
    <svg className={className || "zlx-ic"} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

// ── semicircular dial (requirement 7): pick a graded value by drag/tap/keys ──
function ZlxDial({ value, options, onChange, label, flag = "" }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const N = options.length;
  let idx = options.findIndex((o) => String(o.v) === String(value));
  if (idx < 0) idx = 0;
  const CX = 100, CY = 100, R = 80;
  const frac = N > 1 ? idx / (N - 1) : 0;
  const ang = Math.PI * (1 - frac);
  const tx = CX + R * Math.cos(ang);
  const ty = CY - R * Math.sin(ang);
  const dash = `${(frac * 100).toFixed(2)} 100`;

  const pick = useCallback((clientX, clientY) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * 200;
    const vy = ((clientY - r.top) / r.height) * 120;
    let a = Math.atan2(CY - vy, vx - CX);          // upper half → 0..π
    if (a < 0) a = vx < CX ? Math.PI : 0;          // clamp lower half to nearest end
    a = Math.max(0, Math.min(Math.PI, a));
    const f = 1 - a / Math.PI;
    const j = Math.max(0, Math.min(N - 1, Math.round(f * (N - 1))));
    const opt = options[j];
    if (opt && String(opt.v) !== String(value)) onChange(String(opt.v));
  }, [N, options, value, onChange]);

  const step = (d) => {
    const j = Math.max(0, Math.min(N - 1, idx + d));
    onChange(String(options[j].v));
  };

  return (
    <div className={`zlx-dial ${flag}`}>
      <div className="zlx-dial-lbl zlx-dial-lbl-top">{label}</div>
      <svg ref={svgRef} viewBox="0 0 200 120" className={`zlx-dial-svg ${dragging ? "drag" : ""}`}
           role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={N - 1}
           aria-valuenow={idx} aria-valuetext={options[idx]?.label}
           onKeyDown={(e) => {
             if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); step(1); }
             if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); step(-1); }
           }}
           onPointerDown={(e) => { setDragging(true); e.currentTarget.setPointerCapture?.(e.pointerId); pick(e.clientX, e.clientY); }}
           onPointerMove={(e) => { if (dragging) pick(e.clientX, e.clientY); }}
           onPointerUp={() => setDragging(false)}
           onPointerCancel={() => setDragging(false)}>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" className="zlx-dial-track" strokeWidth="12" strokeLinecap="round" />
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" className="zlx-dial-prog" strokeWidth="12" strokeLinecap="round" pathLength="100" strokeDasharray={dash} />
        <circle className="zlx-dial-thumb" cx={tx} cy={ty} r="10" strokeWidth="3" />
        <text x="100" y="88" textAnchor="middle" className="zlx-dial-val">{options[idx]?.label}</text>
      </svg>
    </div>
  );
}

// ── thin picker (requirement 9): shows only 5 values, selected + 2/−2 ────────
function ZlxPicker({ value, options, onChange, label, withEmpty, flag = "" }) {
  const opts = withEmpty ? [{ v: "", label: "—" }, ...options] : options;
  const N = opts.length;
  let i = opts.findIndex((o) => String(o.v) === String(value));
  if (i < 0) i = 0;
  const setBy = (d) => {
    const j = Math.max(0, Math.min(N - 1, i + d));
    onChange(String(opts[j].v));
  };
  let start = Math.max(0, i - 2);
  if (start + 5 > N) start = Math.max(0, N - 5);
  const win = opts.slice(start, start + 5);
  return (
    <div className={`zlx-picker ${flag}`} role="listbox" aria-label={label} tabIndex={0}
         onWheel={(e) => { e.preventDefault(); setBy(e.deltaY > 0 ? 1 : -1); }}
         onKeyDown={(e) => {
           if (e.key === "ArrowDown") { e.preventDefault(); setBy(1); }
           if (e.key === "ArrowUp") { e.preventDefault(); setBy(-1); }
         }}>
      <div className="zlx-picker-lbl">{label}</div>
      <button type="button" className="zlx-picker-step" aria-hidden="true" tabIndex={-1} onClick={() => setBy(-1)} disabled={i <= 0}><Ic name="up" /></button>
      <div className="zlx-picker-win">
        {win.map((o) => (
          <button type="button" key={String(o.v)} role="option" aria-selected={String(o.v) === String(value)}
                  className={`zlx-picker-opt ${String(o.v) === String(value) ? "on" : ""}`}
                  onClick={() => onChange(String(o.v))}>
            {o.label}
          </button>
        ))}
      </div>
      <button type="button" className="zlx-picker-step" aria-hidden="true" tabIndex={-1} onClick={() => setBy(1)} disabled={i >= N - 1}><Ic name="down" /></button>
    </div>
  );
}

// ── compact stepper: bounded up/down arrows, no scroll window, no overflow ────
// Used for AXIS / CYL / PD / ADD (the sphere keeps its semicircle dial). Fixed
// width so several sit side by side without horizontal scrollbars or overlap.
function ZlxStepper({ value, options, onChange, label, withEmpty, flag = "" }) {
  const opts = withEmpty ? [{ v: "", label: "—" }, ...options] : options;
  const N = opts.length;
  let i = opts.findIndex((o) => String(o.v) === String(value));
  if (i < 0) i = 0;
  const setBy = (d) => { const j = Math.max(0, Math.min(N - 1, i + d)); onChange(String(opts[j].v)); };
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className={`zlx-stepper ${flag}`} ref={wrapRef}>
      <div className="zlx-stepper-lbl">{label}</div>
      <div className="zlx-stepper-ctl">
        <button type="button" className="zlx-stepper-btn" aria-label="+" tabIndex={-1}
                onClick={() => setBy(1)} disabled={i >= N - 1}><Ic name="up" /></button>
        {/* Tocar el valor abre la lista COMPLETA (acceso rápido); los +/- afinan */}
        <button type="button" className="zlx-stepper-val" aria-haspopup="listbox" aria-expanded={open}
                aria-label={label} onClick={() => setOpen((o) => !o)}>
          {opts[i]?.label}
        </button>
        <button type="button" className="zlx-stepper-btn" aria-label="−" tabIndex={-1}
                onClick={() => setBy(-1)} disabled={i <= 0}><Ic name="down" /></button>
      </div>
      {open && (
        <ul className="zlx-stepper-list" role="listbox" aria-label={label}>
          {opts.map((o, j) => (
            <li key={String(o.v)}>
              <button type="button" role="option" aria-selected={j === i}
                      ref={j === i ? (el) => { if (el) el.scrollIntoView({ block: "center" }); } : undefined}
                      className={`zlx-stepper-optitem ${j === i ? "on" : ""}`}
                      onClick={() => { onChange(String(o.v)); setOpen(false); }}>
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── popover shell (requirement 3): floats OVER the stage, frame stays visible ─
// `onBack` (optional) shows a ← button so material/treatments feel like steps of
// the SAME window (the customer never feels they left the popup).
function ZlxPop({ title, icon, onClose, onBack, onHelp, closeLabel, backLabel, helpLabel, className, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      {/* transparent catcher: closes on outside click without hiding the frame */}
      <div className="zlx-pop-backdrop" onClick={onClose} />
      <div className={`zlx-pop ${className || ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="zlx-pop-head">
          <b>
            {onBack && (
              <button type="button" className="zlx-pop-back" onClick={onBack} aria-label={backLabel}><Ic name="back" /></button>
            )}
            {icon} {title}
          </b>
          <span className="zlx-pop-head-actions">
            {onHelp && (
              <button type="button" className="zlx-pop-help" onClick={onHelp} aria-label={helpLabel || "?"}><Ic name="info" /></button>
            )}
            <button type="button" className="zlx-pop-close" onClick={onClose} aria-label={closeLabel}><Ic name="close" /></button>
          </span>
        </div>
        <div className="zlx-pop-body">{children}</div>
      </div>
    </>
  );
}

// ── floating info popover: education/diagrams float in their OWN little dialog
// (a "globo") over everything, so the working popup never grows a scrollbar. ──
function ZlxInfoPop({ title, onClose, closeLabel, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="zlx-infopop-backdrop" onClick={onClose} />
      <div className="zlx-infopop" role="dialog" aria-modal="true" aria-label={title}>
        <div className="zlx-infopop-head">
          <b><Ic name="info" /> {title}</b>
          <button type="button" className="zlx-pop-close" onClick={onClose} aria-label={closeLabel}><Ic name="close" /></button>
        </div>
        <div className="zlx-infopop-body">{children}</div>
      </div>
    </>
  );
}

// ── salesman-style education block (requirement 5) ──────────────────────────
function EduBlock({ edu, goodLbl, notLbl }) {
  if (!edu) return null;
  return (
    <div className="zlx-edu">
      <p className="zlx-edu-good"><Ic name="good" /><span><b>{goodLbl}</b> {edu.good}</span></p>
      <p className="zlx-edu-bad"><Ic name="bad" /><span><b>{notLbl}</b> {edu.bad}</span></p>
      {edu.price && <p className="zlx-edu-price"><Ic name="tag" /><span>{edu.price}</span></p>}
    </div>
  );
}

export default function LensProcess() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const { DESIGNS, MATERIALS, BASE, PHOTO, AR } = useLensCatalog();
  const NON_PROG_DESIGNS = DESIGNS.filter((d) => d.cat !== "prog");
  const PROG_GAMAS = DESIGNS.filter((d) => d.cat === "prog");
  const { productBySlug, products, loading } = useCatalog();
  const product = matchProduct(slug, productBySlug, products);
  // Selected frame colour. Seeded from the ?color= link (so clicking a specific
  // swatch on a card lands here), but editable via the thumbnails under the frame.
  const [colorIdx, setColorIdx] = useState(Number(params.get("color") || 0));
  const navigate = useNavigate();
  const { addConfiguredFrame } = useCart();

  const [designId, setDesignId] = useState(null); // "sv" | "bifocal" | ... | "frame-only"
  const [matId, setMatId] = useState(null);
  const [photoId, setPhotoId] = useState(null);   // null = ninguno
  const [arId, setArId] = useState(null);         // null = ninguno
  const [rx, setRx] = useState({ od_sph: "0", od_cyl: "0", od_axis: "0", os_sph: "0", os_cyl: "0", os_axis: "0", pd: "", pd_od: "", pd_os: "", add: "", seg_height: "" });
  const [pop, setPop] = useState(null);           // null | "rx" | "mat" | "treat" | "frame"
  // El campo que falta vive DENTRO del popup de receta: al pulsar el aviso del
  // botón de comprar abrimos ese popup y hacemos scroll/destello sobre la altura,
  // que si no queda invisible con el popup cerrado y el pago parece bloqueado.
  const [seekHeight, setSeekHeight] = useState(false);
  const heightRef = useRef(null);
  const [rxNote, setRxNote] = useState(null);     // aviso del auto-cambio de tipo por la adición (ADD)
  // Ayuda educativa en un GLOBO/popover aparte (NO inline): así la ventana de
  // trabajo no se llena de scroll. Guarda {title, edu, diagKeys} de la opción.
  const [infoPop, setInfoPop] = useState(null);
  // Revisión previa al checkout: al pulsar "Comprar ahora" mostramos el loader y
  // el MISMO resumen antes de pedir los datos del cliente. idle|loading|show.
  const [reviewing, setReviewing] = useState("idle");
  // "flechita" que revela los Transitions dentro del popup de tratamientos.
  const [showTrans, setShowTrans] = useState(false);
  // Confirmación de la receta antes de pasar a materiales (si se modificó algo).
  const [confirmRx, setConfirmRx] = useState(false);
  const [rxDirty, setRxDirty] = useState(false); // ¿se tocó algún valor de la receta?
  // "single" = one total PD, "dual" = one value per eye (FPD/DNP on order forms).
  // Switched automatically when an OCR reading comes back with per-eye values.
  const [pdMode, setPdMode] = useState("single");
  // Fields whose current value came from the OCR and the user has not touched
  // since — used to highlight what still needs checking (a confident model error
  // looks exactly like a value the customer typed). Preserves Dionis's OCR UX.
  const [ocrFields, setOcrFields] = useState(() => new Set());
  // OCR reading of an uploaded prescription photo. `confirmed` gates the buy:
  // extracted values are a model's reading of a health document and must be
  // reviewed by the user before they can be persisted (the backend rejects an
  // unconfirmed OCR prescription).
  const [ocr, setOcr] = useState({
    status: "idle", // idle | loading | done | error
    fileName: null,
    warnings: [],
    fileUrl: null,
    confirmed: false,
  });
  const [pv, setPv] = useState(0);
  useEffect(() => onPrices(() => setPv((v) => v + 1)), []);

  // Al abrir el popup desde el aviso "falta la altura": lleva el campo a la vista
  // y lo destaca un momento. El destello se apaga solo (y al cerrar el popup).
  useEffect(() => {
    if (!seekHeight) return;
    if (pop !== "rx") { setSeekHeight(false); return; }
    const el = heightRef.current;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const id = setTimeout(() => setSeekHeight(false), 2400);
    return () => clearTimeout(id);
  }, [seekHeight, pop]);

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

  const design = designId === "frame-only" ? FRAME_ONLY : (DESIGNS.find((d) => d.id === designId) || null);
  const frameOnly = designId === "frame-only";
  const cat = design && design.cat; // sv | bifocal | prog
  // Multifocales (bifocal/progresivo) requieren ALTURA de montaje para poder
  // fabricarse; el rango depende del tipo (bifocal 10–20, progresivo 14–30).
  const isMulti = cat === "bifocal" || cat === "prog";
  const heightOptions = cat === "bifocal" ? HEIGHT_BIFOCAL : HEIGHT_PROG;

  // Auto-cambio de tipo según la ADICIÓN (ADD), siguiendo la práctica optométrica:
  //   sin ADD → Visión Sencilla   ·   con ADD → multifocal (bifocal/progresivo).
  // (bifocal vs progresivo es elección del paciente: sólo forzamos Sencilla ↔
  //  multifocal y dejamos que elija el formato). Se explica con un aviso.
  // IMPORTANTE: este hook debe ir ANTES del early return `if (!product)`.
  useEffect(() => {
    if (frameOnly || !designId) return;
    const add = parseFloat(rx.add) || 0;
    if (add > 0 && designId === "sv") {
      setDesignId("prog-mid"); setMatId(null);
      setRxNote({ kind: "toMulti" });
    } else if (add <= 0 && (designId === "bifocal" || designId === "prog-mid" || designId === "prog-high")) {
      setDesignId("sv"); setMatId(null);
      setRxNote({ kind: "toSingle" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rx.add]);

  // precios efectivos (override-aware). pv bump re-render on admin edits.
  const basePrice = (dId, mId) => lensBasePrice(dId, mId, (BASE[dId] || {})[mId] ?? 0);
  const photoPriceOf = (p) => (p.price[cat] == null ? null : lensPhotoPrice(p.id, cat, p.price[cat]));
  const arList = design && !frameOnly ? (AR[arGroupFor(design)] || []) : [];
  const arPriceOf = (a) => lensARPrice(a.id, a.price);

  const material = matId ? (MATERIALS.find((m) => m.id === matId) || null) : null;
  const photo = photoId ? PHOTO.find((p) => p.id === photoId) : null;
  const ar = arId ? arList.find((a) => a.id === arId) : null;

  const maxAbs = Math.max(
    Math.abs(parseFloat(rx.od_sph) || 0), Math.abs(parseFloat(rx.os_sph) || 0),
    Math.abs(parseFloat(rx.od_cyl) || 0), Math.abs(parseFloat(rx.os_cyl) || 0)
  );
  const recommendedMat = useMemo(() => {
    if (product?.attributes?.age === "Niños") return MATERIALS.find((m) => m.id === "poly");
    return MATERIALS.find((m) => maxAbs <= m.maxAbs) || MATERIALS[MATERIALS.length - 1];
  }, [maxAbs, product?.attributes?.age, MATERIALS]);
  // Mostramos TODOS los materiales para que el cliente pueda elegir cualquiera;
  // el recomendado según su graduación se resalta con ★ (y el banner de arriba).
  const suitableMats = useMemo(() => MATERIALS, [MATERIALS]);
  // Si la graduación sube y el material elegido deja de ser apto, se deselecciona
  // (evita quedar con un material que ya no aparece en la lista).
  useEffect(() => {
    if (matId && !suitableMats.some((m) => m.id === matId)) setMatId(null);
  }, [suitableMats, matId]);

  // Running total for DISPLAY. Se calcula con los MISMOS valores que las líneas
  // del resumen (montura + material + fotocromático + AR), para que el total y el
  // desglose siempre coincidan y se actualicen al instante con cada selección.
  // El cobro real lo calcula el servidor al añadir al carrito (configured-line);
  // este total es sólo la vista previa.
  const clientTotal = useMemo(() => {
    let x = product?.price || 0;
    // Gate en `material`/`photo`/`ar` (los objetos que muestran las líneas), no en
    // `design`, para que el precio del material se sume aunque cambie el diseño.
    if (!frameOnly && material && matId) x += basePrice(designId, matId);
    if (!frameOnly && photo) { const pp = photoPriceOf(photo); if (pp) x += pp; }
    if (!frameOnly && ar) x += arPriceOf(ar);
    return Math.round(x * 100) / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.price, designId, matId, photoId, arId, frameOnly, material, photo, ar, pv, BASE, PHOTO, AR]);

  // Total mostrado: siempre el cálculo cliente (instantáneo y consistente con el
  // desglose). `serverTotal` se sigue consultando para validación, pero NO se usa
  // para la vista porque quedaba desactualizado al cambiar material/tratamiento.
  const total = clientTotal;

  if (!product) {
    // Deep-link / refresh guard: wait for the startup catalog load to settle
    // before deciding not-found — the visited slug may only exist after it does.
    if (loading) {
      return (
        <div className="section">
          <GlassesLoader />
        </div>
      );
    }
    return <div className="section"><p>{t("notfound")} <Link to="/catalogo">{t("notfound.link")}</Link></p></div>;
  }

  // The OCR reading must be confirmed before it can become a real prescription.
  const awaitingRxConfirm = !frameOnly && ocr.status === "done" && !ocr.confirmed;
  // Ready to buy: a use must be chosen, lenses need a material, and any pending
  // OCR reading must be confirmed first. No "continue" steps — this gates the CTA.
  // La altura es obligatoria en multifocales: sin ella no se puede fabricar.
  const heightMissing = isMulti && !frameOnly && !rx.seg_height;
  const canBuy = !!designId && (frameOnly || !!matId) && !heightMissing && !awaitingRxConfirm && ocr.status !== "loading";
  // Los tratamientos (fotocromático/AR) son OPCIONALES: con la receta y el
  // material del cristal seleccionados el botón de comprar ya se habilita. Si
  // sigue deshabilitado, `buyHint` explica exactamente qué falta (bilingüe).
  const buyHint = canBuy ? null
    : !designId ? t("lens.hint.design")
    : (!frameOnly && !matId) ? t("lens.hint.material")
    : ocr.status === "loading" ? t("lens.upload.reading")
    : awaitingRxConfirm ? t("lens.hint.confirmRx")
    : heightMissing ? t("lens.hint.height")
    : null;
  // El aviso lleva al paso que falta: los campos viven dentro de los popups, así
  // que un texto suelto deja al cliente sin saber dónde tocar (el pago se ve
  // bloqueado sin salida). `null` = nada que abrir (ej. mientras lee el OCR).
  const buyHintGo = !buyHint || ocr.status === "loading" ? null
    : (!frameOnly && !matId && designId) ? () => setPop("mat")
    : heightMissing ? () => { setPop("rx"); setSeekHeight(true); }
    : () => setPop("rx");

  const chooseDesign = (id) => {
    setDesignId(id);
    setMatId(null); setPhotoId(null); setArId(null);
    setRxNote(null); // elección manual → limpia el aviso de auto-cambio
    // Nota: "solo montura" ya NO cierra el popup, para poder rectificar la elección.
  };

  const handleRxUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the user re-pick the same file after an error
    if (!file) return;
    setOcr({ status: "loading", fileName: file.name, warnings: [], fileUrl: null, confirmed: false, reason: null });
    try {
      const res = await ocrPrescription(file);
      const p = res.prescription || {};
      // Per-eye PD when the prescription carries one (FPD/DNP columns), a single
      // total otherwise. Never collapse the two: the point of monocular PD is
      // that the eyes can differ. Preserves Dionis's OCR data contract.
      const dual = p.pd_od != null || p.pd_os != null;
      const picked = {
        od_sph: nearest(p.od?.sph, SPH),
        od_cyl: nearest(p.od?.cyl, CYL),
        od_axis: nearest(p.od?.axis, AXIS),
        os_sph: nearest(p.os?.sph, SPH),
        os_cyl: nearest(p.os?.cyl, CYL),
        os_axis: nearest(p.os?.axis, AXIS),
        add: nearest(p.od?.add ?? p.os?.add, ADD),
        ...(dual
          ? { pd_od: nearest(p.pd_od, PD_MONO), pd_os: nearest(p.pd_os, PD_MONO) }
          : { pd: nearest(p.pd, PD) }),
      };
      setPdMode(dual ? "dual" : "single");
      // Auto-suggest the lens type from the reading and preselect it (unless the
      // user already picked a real lens type): an ADD value means presbyopia →
      // progressive; otherwise single vision. The customer can still change it.
      const hasAdd = picked.add != null && parseFloat(picked.add) > 0;
      const suggested = hasAdd ? "prog-mid" : "sv";
      if (!designId || designId === "frame-only") {
        setDesignId(suggested);
        setMatId(null); setPhotoId(null); setArId(null);
      }
      // Flag exactly the fields the model actually filled, so the review
      // highlight points at what it read rather than at the whole form.
      setOcrFields(new Set(Object.keys(picked).filter((k) => picked[k] != null)));
      // Keep whatever the user already picked for fields the OCR couldn't read.
      setRx((r) => {
        const next = { ...r };
        for (const [k, v] of Object.entries(picked)) if (v != null) next[k] = v;
        return next;
      });
      setRxDirty(true); // la OCR rellenó valores → confirmar la receta antes de materiales
      setOcr({
        status: "done",
        fileName: file.name,
        warnings: res.validation?.warnings || [],
        fileUrl: p.file_url ?? null,
        confirmed: false,
      });
    } catch (err) {
      // Every OCR failure mode is recoverable by typing the values in, so we
      // never block the funnel on it — but "wait and retry", "that file is too
      // big" and "we couldn't read it" are different pieces of advice and
      // deserve different copy. Leaving the values at 0.00 behind a single
      // generic message is what made this look like the read had "worked".
      setOcr({
        status: "error",
        fileName: file.name,
        warnings: [],
        fileUrl: null,
        confirmed: false,
        reason: ocrErrorReason(err?.code),
      });
    }
  };

  const finish = async () => {
    // The cart is server-side. Without Medusa or without a variant there is no way
    // to add a real, server-priced line — surface it instead of silently pretending.
    if (!USE_MEDUSA) { toast({ tone: "info", message: t("cart.noVariant") }); return; }
    if (!color?.variantId) { toast({ tone: "info", message: t("cart.noVariant") }); return; }
    try {
      // Persist the prescription as a health record (PHI) server-side and pass only
      // its id to the cart. Raw Rx values never leave the backend DB.
      let prescriptionId = null;
      if (!frameOnly) {
        const num = (v) => (v === "" || v == null ? null : parseFloat(v));
        const addv = rx.add ? parseFloat(rx.add) : null;
        // Only claim the OCR provenance once the user actually confirmed the
        // reading — the backend rejects an unconfirmed OCR prescription.
        const fromOcr = ocr.status === "done" && ocr.confirmed;
        const rxPayload = {
          od: { sph: num(rx.od_sph) ?? 0, cyl: num(rx.od_cyl) ?? 0, axis: rx.od_axis ? parseInt(rx.od_axis, 10) : null, add: addv, prism: null, base: null },
          os: { sph: num(rx.os_sph) ?? 0, cyl: num(rx.os_cyl) ?? 0, axis: rx.os_axis ? parseInt(rx.os_axis, 10) : null, add: addv, prism: null, base: null },
          // Send whichever form the customer confirmed; sending both would leave
          // the backend guessing which is authoritative.
          pd: pdMode === "dual" ? null : num(rx.pd),
          pd_od: pdMode === "dual" ? num(rx.pd_od) : null,
          pd_os: pdMode === "dual" ? num(rx.pd_os) : null,
          // Altura de montaje (mm). Obligatoria en multifocales. NOTA para la
          // simulación en cara (try-on): esta altura es la que posiciona el tope
          // del segmento (bifocal) o el inicio del corredor (progresivo) sobre el
          // lente respecto al centro de la pupila; el render debe consumirla desde
          // aquí. El backend actual la ignora sin romper — persistir cuando exista
          // la columna. (No se toca el render de Dionis.)
          seg_height: num(rx.seg_height),
          source: fromOcr ? "ocr" : "manual",
          verified_by_user: true,
          file_url: fromOcr ? ocr.fileUrl : null,
        };
        prescriptionId = await createPrescription(rxPayload);
      }
      // Server prices the frame+lens; the client never sends a total.
      await addConfiguredFrame(color.variantId, {
        design_code: frameOnly ? "frame-only" : designId,
        material_code: matId, photo_code: photoId, ar_code: arId,
      }, prescriptionId);
      // "Finalizar compra" goes straight to patient details / delivery / payment.
      navigate("/checkout");
    } catch (e) {
      // A failed add MUST be visible — this is the bug that produced "empty cart
      // at checkout": swallowing the error and navigating away as if it worked.
      toast({ tone: "error", title: t("cart.addError"), message: String(e?.message || e) });
    }
  };
  const setF = (k) => (v) => {
    setRx((r) => ({ ...r, [k]: v }));
    setRxDirty(true); // se modificó la receta → habrá que confirmarla antes de materiales
    // Editing a field is the customer checking it, so it stops being flagged.
    setOcrFields((s) => {
      if (!s.has(k)) return s;
      const next = new Set(s);
      next.delete(k);
      return next;
    });
  };
  // OCR-highlight class for a field the model filled and the user hasn't checked.
  const ocrClass = (k) => (ocrFields.has(k) ? "from-ocr" : "");

  // Validation warnings arrive from the backend as { code, eye, params } so the
  // wording can follow the language the customer picked. Unknown codes fall back
  // to the raw code rather than rendering nothing — a silent gap would hide a
  // real problem with the prescription.
  const rxWarningText = (w) =>
    t(`rx.warn.${w.code}`, { ...(w.params || {}), eye: w.eye ? t(`rx.eye.${w.eye}`) : "" });
  const money = (n) => "$" + Number(n || 0).toFixed(0);
  const closeLabel = t("common.close");

  // Frame material education: first recognized material name gets a quality blurb.
  const frameMats = product.attributes?.material || [];
  const frameEduName = frameMats.find((m) => frameMatEdu(m, lang));
  const frameEdu = frameEduName ? frameMatEdu(frameEduName, lang) : null;

  // ¿Hay receta que mostrar? Mirar SOLO la esfera dejaba invisible una receta
  // legítima: de doce recetas reales verificadas, dos traen esfera en blanco y
  // solo cilindro (astigmatismo puro), y ahí la tabla nunca aparecía aunque los
  // valores estuvieran cargados. Cuenta cualquier dato con contenido clínico.
  const hasRxValue = (v) => v !== "" && v != null && (parseFloat(v) || 0) !== 0;
  const rxSet =
    !frameOnly &&
    (hasRxValue(rx.od_sph) || hasRxValue(rx.os_sph) ||
      hasRxValue(rx.od_cyl) || hasRxValue(rx.os_cyl) ||
      hasRxValue(rx.pd) || hasRxValue(rx.pd_od) || hasRxValue(rx.pd_os) ||
      hasRxValue(rx.add) ||
      ocr.confirmed);
  const eduMatId = matId || (recommendedMat && recommendedMat.id);
  const goodLbl = t("lens.goodFor");
  const notLbl = t("lens.notFor");

  // Abre la ayuda educativa como globo aparte (no inline).
  const openInfo = (title, edu, diagKeys, note) => setInfoPop({ title, edu, diagKeys: diagKeys || [], note: note || null });

  // Agrupa los fotocromáticos por FAMILIA (presentación): en vez de una tarjeta
  // por color con el mismo nombre y precio, se muestra el nombre UNA vez y las
  // bolitas de color debajo para elegir. La familia sale del id (sin el sufijo de
  // color) → funciona igual con el catálogo estático o el de Medusa.
  const COLOR_SUFFIX = /-(grey|brown|green)$/i;
  const photoColorWords = Object.values(PHOTO_COLORS).flatMap((c) => [c.es, c.en]);
  const stripColor = (label) => {
    let s = label;
    for (const w of photoColorWords) s = s.replace(new RegExp("\\s*" + w + "\\b", "i"), "");
    return s.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim() || label;
  };
  const photoGroups = [];
  {
    const byKey = new Map();
    for (const p of PHOTO) {
      const key = String(p.id).replace(COLOR_SUFFIX, "");
      if (!byKey.has(key)) { const g = { key, label: stripColor(L(p.label, lang)), members: [] }; byKey.set(key, g); photoGroups.push(g); }
      byKey.get(key).members.push(p);
    }
  }
  const isTransFamily = (g) => /^trans/i.test(g.key) || /transitions/i.test(g.label);
  const fotoGroups = photoGroups.filter((g) => !isTransFamily(g));
  const transGroups = photoGroups.filter(isTransFamily);
  // Una tarjeta por familia: nombre + precio arriba, bolitas de color debajo.
  const renderPhotoFamily = (g) => {
    const avail = g.members.filter((m) => photoPriceOf(m) != null);
    const priceMember = avail[0] || g.members[0];
    const pp = photoPriceOf(priceMember);
    const famNa = pp == null;
    const selMember = g.members.find((m) => m.id === photoId);
    return (
      <div key={g.key} className={`zlx-choice-row zlx-photofam-row ${selMember ? "sel" : ""} ${famNa ? "na" : ""}`}>
        <div className="zlx-choice zlx-choice-stack zlx-photofam">
          <span className="zlx-choice-top">
            <span className="zlx-choice-main">
              <IconFotocromatico className="zlx-choice-ic" active={!!selMember} />
              <span className="zlx-choice-title">{g.label}</span>
            </span>
            <span className="zlx-choice-price">{famNa ? "—" : `+ ${money(pp)}`}</span>
          </span>
          <span className="zlx-fam-colors">
            {g.members.map((m) => {
              const c = m.colors[0];
              const cNa = photoPriceOf(m) == null;
              const on = photoId === m.id;
              return (
                <button key={m.id} type="button" disabled={cNa}
                        className={`zlx-fam-dot ${on ? "on" : ""} ${cNa ? "na" : ""}`}
                        title={L(PHOTO_COLORS[c], lang)} aria-label={L(PHOTO_COLORS[c], lang)}
                        onClick={() => setPhotoId(on ? null : m.id)}>
                  <i style={{ background: PHOTO_COLORS[c]?.hex }} />
                </button>
              );
            })}
          </span>
        </div>
        <button type="button" className="zlx-use-info" aria-label={t("lens.help")}
                onClick={() => openInfo(g.label, photoEdu(lang), photoDiagKeys(priceMember))}>
          <Ic name="info" />
        </button>
      </div>
    );
  };
  // Comprar ahora → loader breve → resumen de revisión → checkout.
  const startReview = () => { setReviewing("loading"); setTimeout(() => setReviewing("show"), 700); };
  // Al confirmar mantenemos el LOADER visible mientras finish() crea la receta,
  // agrega al carrito y navega — así el cliente ve que algo está pasando y no
  // pulsa "comprar" dos veces (evita PaymentIntents/pedidos duplicados). Si
  // finish() falla (toast), quitamos el loader para que pueda reintentar.
  const confirmReview = async () => {
    setReviewing("loading");
    try { await finish(); } finally { setReviewing((s) => (s === "loading" ? "show" : s)); }
  };

  // Contenido del resumen (lista + receta + medidas), reutilizado en el panel
  // lateral y en la pantalla de revisión previa al checkout. Muestra claramente
  // Colección, color, tratamiento y transitions; y las medidas con DP primero
  // (simétrico) y la ADD debajo.
  // Detalle de la receta (tabla OD/OS + medidas), reutilizable en el resumen y en
  // la ventana de CONFIRMACIÓN previa a materiales.
  const rxDetails = (
    <div className="zlx-summary-rx">
      <div className="zlx-summary-rx-h"><Ic name="check" /> {t("lens.rxValues")}</div>
      <table className="zlx-rx-table">
        <thead><tr><th aria-hidden="true"></th><th>{t("lens.sph")}</th><th>{t("lens.cyl")}</th><th>{t("lens.axis")}</th></tr></thead>
        <tbody>
          <tr><th>{t("lens.right")}</th><td>{fmt(parseFloat(rx.od_sph) || 0)}</td><td>{fmt(parseFloat(rx.od_cyl) || 0)}</td><td>{rx.od_axis && rx.od_axis !== "0" ? rx.od_axis + "°" : "—"}</td></tr>
          <tr><th>{t("lens.left")}</th><td>{fmt(parseFloat(rx.os_sph) || 0)}</td><td>{fmt(parseFloat(rx.os_cyl) || 0)}</td><td>{rx.os_axis && rx.os_axis !== "0" ? rx.os_axis + "°" : "—"}</td></tr>
        </tbody>
      </table>
      {/* Medidas: DP primero y simétrico, ADD y altura debajo */}
      <div className="zlx-meas">
        <div className="zlx-meas-h">{t("lens.measures")}</div>
        <div className="zlx-meas-pd">
          {pdMode === "dual" ? (
            <>
              <div className="zlx-meas-cell"><span>{t("lens.pd.odS")}</span><b>{rx.pd_od || "—"}</b></div>
              <div className="zlx-meas-cell"><span>{t("lens.pd.osS")}</span><b>{rx.pd_os || "—"}</b></div>
            </>
          ) : (
            <div className="zlx-meas-cell zlx-meas-wide"><span>{t("lens.pdS")}</span><b>{rx.pd || "—"}</b></div>
          )}
        </div>
        {design?.add && rx.add && (
          <div className="zlx-meas-add"><span>{t("lens.addLbl")}</span><b>{fmt(parseFloat(rx.add) || 0)}</b></div>
        )}
        {isMulti && (rx.seg_height
          ? <div className="zlx-meas-add"><span>{t("lens.height")}</span><b>{rx.seg_height} mm</b></div>
          : <div className="zlx-meas-add req"><span>{t("lens.height")}</span><b>{t("lens.height.missing")}</b></div>
        )}
      </div>
    </div>
  );

  const summaryInner = (
    <>
      <ul className="zlx-summary-list">
        <li><span>{t("card.frame")}</span><b>${product.price.toFixed(2)}</b></li>
        <li className="zlx-sum-sub"><span>{t("lens.collection")}</span><b>{product.brand}</b></li>
        <li className="zlx-sum-sub"><span>{t("lens.color")}</span><b>{color.name}</b></li>
        {design && <li><span>{t("lens.use")}</span><b>{frameOnly ? t("lens.included") : L(design.label, lang)}</b></li>}
        {material && !frameOnly && <li><span>{t("lens.material")}: {L(material.label, lang)}</span><b>{money(basePrice(designId, matId))}</b></li>}
        {photo && !frameOnly && photoPriceOf(photo) != null && <li><span>{t("lens.transitions")}: {L(photo.label, lang)}</span><b>+ {money(photoPriceOf(photo))}</b></li>}
        {ar && !frameOnly && <li><span>{t("lens.treatment")}: {L(ar.label, lang)}</span><b>+ {money(arPriceOf(ar))}</b></li>}
      </ul>
    </>
  );

  return (
    <div className="zlx">
      <div className="zlx-head">
        <Link to={`/producto/${product.slug}`} className="back">← {t("lens.back")} {product.name}</Link>
      </div>

      <div className="zlx-stage">
        {/* ── floating frame with action buttons ON the image (req 1, 2) ── */}
        {/* IZQUIERDA: el espejuelo grande, protagonista */}
        <div className="zlx-main">
          <div className="zlx-float">
            <div className="zlx-float-inner">
              <img className="zlx-float-img" src={color.image} alt={`${product.name} · ${color.name}`}
                   onError={(e) => { e.currentTarget.style.opacity = 0.3; }} />
            </div>
            {/* nombre + colección + material, todo en una sola línea (imagen 1) */}
            <div className="zlx-float-head">
              <span className="zlx-float-name">{product.name} · {color.name}</span>
              <span className="zlx-float-collection">
                <span className="zlx-k">{t("lens.collection")}:</span> {product.brand}
              </span>
              <button type="button" className="zlx-float-material"
                      onClick={() => setPop(pop === "frame" ? null : "frame")}
                      aria-label={t("lens.frameInfo")}>
                <span className="zlx-k">{t("lens.frameMaterial")}:</span>{" "}
                {frameMats.length ? frameMats.join(" · ") : "—"}
                <Ic name="info" className="zlx-help-dot" />
              </button>
            </div>
            {/* miniaturas de color más grandes; bolita con el nombre del color al pasar el cursor */}
            {product.colors.length > 1 && (
              <div className="zlx-float-colors">
                {product.colors.map((c, i) => (
                  <button key={c.name} type="button"
                          className={`zlx-float-color ${i === colorIdx ? "on" : ""}`}
                          onClick={() => setColorIdx(i)} aria-label={c.name}>
                    <span className="zlx-float-color-inner">
                      <img src={c.image} alt={c.name}
                           onError={(e) => { e.currentTarget.style.opacity = 0.3; }} />
                    </span>
                    <span className="zlx-color-dot" data-name={c.name} tabIndex={0} aria-label={c.name} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* DERECHA: pasos + info + resumen (columna con aire, no invasiva) */}
        <div className="zlx-side">
          <div className="zlx-fabs">
            {/* Sin la altura el paso NO está completo: marcarlo con el visto verde
                hacía creer que la receta estaba lista y el pago bloqueado sin motivo. */}
            <button type="button" className={`zlx-fab zlx-fab-cta ${designId ? "chosen" : "pulse"} ${designId && !heightMissing ? "on" : ""} ${heightMissing ? "warn" : ""} ${pop === "rx" ? "open" : ""}`}
                    onClick={() => { if (pop === "rx") { setPop(null); return; } setPop("rx"); if (heightMissing) setSeekHeight(true); }}>
              <IconReceta className="zlx-ic" />
              <span className="zlx-fab-txt">
                <b>{t("lens.step.rx")}</b>
                <small>{heightMissing ? t("lens.height.missing") : frameOnly ? L(FRAME_ONLY.label, lang) : design ? L(design.label, lang) : t("lens.pickHint")}</small>
              </span>
              {designId && (heightMissing ? <Ic name="info" className="zlx-fab-ok warn" /> : <Ic name="check" className="zlx-fab-ok" />)}
            </button>

            {/* Los pasos "Material" y "Tratamientos" NO se muestran hasta que el
                cliente elige un tipo de lente (receta). Antes salían en gris y
                confundían; ahora aparecen solo cuando ya hay algo seleccionado. */}
            {designId && !frameOnly && (
              <>
                <button type="button" className={`zlx-fab ${matId ? "on" : ""} ${pop === "mat" ? "open" : ""}`}
                        disabled={frameOnly}
                        onClick={() => setPop(pop === "mat" ? null : "mat")}>
                  <IconMaterial className="zlx-ic" />
                  <span className="zlx-fab-txt">
                    <b>{t("lens.material")}</b>
                    <small>{frameOnly ? "—" : material ? L(material.label, lang) : t("lens.pickHint")}</small>
                  </span>
                  {matId && <Ic name="check" className="zlx-fab-ok" />}
                </button>

                <button type="button" className={`zlx-fab ${photo || ar ? "on" : ""} ${pop === "treat" ? "open" : ""}`}
                        disabled={frameOnly || !matId}
                        onClick={() => setPop(pop === "treat" ? null : "treat")}>
                  <IconTratamiento className="zlx-ic" />
                  <span className="zlx-fab-txt">
                    <b>{t("lens.treatBtn")}</b>
                    <small>{frameOnly ? "—" : (photo || ar) ? [photo && L(photo.label, lang), ar && L(ar.label, lang)].filter(Boolean).join(" · ") : t("lens.optional")}</small>
                  </span>
                  {(photo || ar) && <Ic name="check" className="zlx-fab-ok" />}
                </button>
              </>
            )}
          </div>

          {/* ── live summary, always visible beside the frame (req 8, 10) ── */}
          <aside className="zlx-summary">
          <h3 className="zlx-summary-h">
            {t("lens.summary")}
            {(!designId || awaitingRxConfirm) && (
              <span className="zlx-summary-help" tabIndex={0}
                    data-tip={awaitingRxConfirm ? t("lens.confirmRx") : t("lens.needChoice")}
                    aria-label={awaitingRxConfirm ? t("lens.confirmRx") : t("lens.needChoice")}>
                <Ic name="info" />
              </span>
            )}
          </h3>
          {summaryInner}
          <div className="zlx-summary-total"><span>{t("lens.total")}</span><b>${total.toFixed(2)}</b></div>
          <button type="button" className="btn btn-primary zlx-buy" data-sfx="success" disabled={!canBuy} onClick={startReview}>
            <Ic name="buy" /> {t("lens.buy")} · ${total.toFixed(2)}
          </button>
          {buyHint && (buyHintGo
            ? <button type="button" className={`zlx-buy-hint zlx-buy-hint-go ${heightMissing ? "req" : ""}`} onClick={buyHintGo}>
                {buyHint} <Ic name="edit" className="zlx-buy-hint-ic" />
              </button>
            : <p className="zlx-buy-hint">{buyHint}</p>)}
          </aside>
        </div>
      </div>

      {/* ── RECETA popover: solo montura → subir receta → acordeón de tipos → materiales ── */}
      {pop === "rx" && (
        <ZlxPop title={t("lens.q.rx")} icon={<IconReceta className="zlx-ic" />} onClose={() => setPop(null)} closeLabel={closeLabel} className="zlx-pop-rx">
          {/* Subir receta — la OCR sugiere y preselecciona el tipo de lente */}
          {USE_MEDUSA && (
                <div className="zlx-rx-upload">
                  <label className="zlx-upload-box">
                    {/* Visually hidden en vez de `hidden` (display:none): algunos
                        navegadores móviles no abren el selector de archivos si el
                        input está en display:none, aunque esté dentro del label. */}
                    <input type="file" accept="image/*,application/pdf" className="zlx-upload-input"
                           disabled={ocr.status === "loading"} onChange={handleRxUpload} />
                    <Ic name="upload" />
                    <span>{t("lens.upload")}</span>
                    <small>
                      {ocr.status === "loading" ? t("lens.upload.reading")
                        : ocr.fileName ? `${t("lens.upload.file")}: ${ocr.fileName}`
                        : t("lens.upload.sub")}
                    </small>
                  </label>
                  {/* Cómo debe ser la foto. Va ANTES de subirla, no como consejo
                      tras el fallo: casi todas las lecturas que fallan lo hacen
                      por la foto (recortada, con brillo del flash, el papel
                      doblado o un dedo encima de los valores), y para entonces
                      el cliente ya se ha llevado el chasco. Se oculta mientras
                      lee y una vez confirmada la receta, cuando ya no aporta. */}
                  {ocr.status !== "loading" && !ocr.confirmed && (
                    <div className="zlx-rx-tips">
                      <ul>
                        <li>{t("lens.upload.tips.whole")}</li>
                        <li>{t("lens.upload.tips.light")}</li>
                        <li>{t("lens.upload.tips.flat")}</li>
                      </ul>
                    </div>
                  )}
                  {ocr.status === "error" && <p className="rx-ocr-error">{t(`lens.upload.err.${ocr.reason || "generic"}`)}</p>}
                  {ocr.status === "done" && (
                    <div className={`rx-ocr-review ${ocr.confirmed ? "ok" : ""}`}>
                      <b>{ocr.confirmed ? <><Ic name="check" /> {t("lens.upload.confirmed")}</> : t("lens.upload.reviewTitle")}</b>
                      {!ocr.confirmed && <p>{t("lens.upload.reviewBody")}</p>}
                      {!ocr.confirmed && ocrFields.size > 0 && (
                        <p className="rx-ocr-legend"><span className="rx-ocr-swatch" aria-hidden="true" />{t("lens.upload.legend")}</p>
                      )}
                      {ocr.warnings.length > 0 && (
                        <ul className="rx-ocr-warnings">
                          {ocr.warnings.map((w, i) => <li key={`${w.code}-${w.eye ?? ""}-${i}`}>{rxWarningText(w)}</li>)}
                        </ul>
                      )}
                      {!ocr.confirmed && (
                        <button type="button" className="btn btn-outline" onClick={() => setOcr((o) => ({ ...o, confirmed: true }))}>{t("lens.upload.confirm")}</button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 3) Acordeón de tipos — una línea; al seleccionar se abre su formulario.
                     La adición (ADD) puede cambiar el tipo automáticamente (ver aviso). */}
              <div className="zlx-use-sep"><span>{t("lens.q.use")}</span></div>
              {rxNote && (
                <div className="zlx-rx-note" role="status">
                  <Ic name="info" />
                  <span>{rxNote.kind === "toMulti" ? t("lens.switch.multi") : t("lens.switch.single")}</span>
                  <button type="button" className="zlx-rx-note-x" aria-label={closeLabel} onClick={() => setRxNote(null)}>×</button>
                </div>
              )}
              <div className="zlx-use-rows">
                {[FRAME_ONLY, ...NON_PROG_DESIGNS, PROG_GROUP].map((d) => {
                  const isFO = d.id === "frame-only";
                  const isProgGroup = !!d.group;
                  const DIcon = isFO ? IconMontura : designIcon(isProgGroup ? "prog-mid" : d.id);
                  const sel = isProgGroup ? (!!design && design.cat === "prog") : designId === d.id;
                  const hasDiag = !isFO && d.cat === "prog";
                  const fromMin = isProgGroup
                    ? Math.min(...PROG_GAMAS.flatMap((g) => MATERIALS.map((m) => basePrice(g.id, m.id))))
                    : (isFO ? 0 : Math.min(...MATERIALS.map((m) => basePrice(d.id, m.id))));
                  return (
                    <div key={d.id} className={`zlx-use-item ${sel ? "open" : ""}`}>
                      <div className={`zlx-use-row ${sel ? "sel" : ""}`}>
                        <button type="button" className="zlx-use-main" onClick={() => { if (isProgGroup) { if (!sel) chooseDesign("prog-mid"); } else chooseDesign(d.id); }}>
                          <DIcon className="zlx-use-ic" active={sel} />
                          <span className="zlx-use-txt">
                            <b>{L(d.label, lang)}{sel && !isFO && ocr.status === "done" && ocrFields.size > 0 && <em className="zlx-use-sugg">{t("lens.suggested")}</em>}</b>
                            <small>{isFO ? t("lens.included") : `${t("lens.fromPrice")} ${money(fromMin)}`}</small>
                          </span>
                          {sel && <Ic name="check" className="zlx-use-check" />}
                          <span className={`zlx-use-chev ${sel ? "up" : ""}`} aria-hidden="true"><Ic name="down" /></span>
                        </button>
                        {hasDiag && (
                          <button type="button" className="zlx-use-info"
                                  aria-label={t("lens.help")} onClick={() => openInfo(L(d.label, lang), null, designDiagKeys(d))}>
                            <Ic name="info" />
                          </button>
                        )}
                      </div>
                      {sel && isFO && (
                        <div className="zlx-use-fill">
                          <p className="muted small zlx-solo-note">{t("lens.rx.none")}</p>
                          <button type="button" className="btn btn-primary zlx-pop-done" data-sfx="select" onClick={() => setPop(null)}>
                            <Ic name="check" /> {t("lens.done")}
                          </button>
                        </div>
                      )}
                      {sel && !isFO && (
                        <div className="zlx-use-fill">
                          {isProgGroup && (
                            <div className="zlx-gama" role="radiogroup" aria-label={lang === "es" ? "Gama" : "Tier"}>
                              {PROG_GAMAS.map((g) => (
                                <button key={g.id} type="button" role="radio" aria-checked={designId === g.id}
                                        className={`zlx-gama-opt ${designId === g.id ? "on" : ""}`}
                                        onClick={() => setDesignId(g.id)}>
                                  {L(g.label, lang)}
                                </button>
                              ))}
                            </div>
                          )}
                          <p className="muted small">{t("lens.rxDialHint")}</p>
                          <div className="zlx-rx-grid">
                            {[{ eye: "od", label: t("lens.right") }, { eye: "os", label: t("lens.left") }].map(({ eye, label }) => (
                              <div key={eye} className="zlx-rx-eye">
                                <div className="zlx-rx-eye-h">{label}</div>
                                <ZlxDial value={rx[`${eye}_sph`]} options={SPH} onChange={setF(`${eye}_sph`)} label={t("lens.sphS")} flag={ocrClass(`${eye}_sph`)} />
                                <div className="zlx-rx-fields">
                                  <ZlxStepper value={rx[`${eye}_cyl`]} options={CYL} onChange={setF(`${eye}_cyl`)} label={t("lens.cylS")} flag={ocrClass(`${eye}_cyl`)} />
                                  <ZlxStepper value={rx[`${eye}_axis`]} options={AXIS} onChange={setF(`${eye}_axis`)} label={t("lens.axisS")} flag={ocrClass(`${eye}_axis`)} />
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="zlx-rx-pdmode" role="radiogroup" aria-label={t("lens.pd")}>
                            <button type="button" role="radio" aria-checked={pdMode === "single"} className={`zlx-pdmode-opt ${pdMode === "single" ? "on" : ""}`} onClick={() => setPdMode("single")}>{t("lens.pd.single")}</button>
                            <button type="button" role="radio" aria-checked={pdMode === "dual"} className={`zlx-pdmode-opt ${pdMode === "dual" ? "on" : ""}`} onClick={() => setPdMode("dual")}>{t("lens.pd.dual")}</button>
                          </div>
                          <div className="zlx-rx-extra">
                            {pdMode === "dual" ? (
                              <>
                                <ZlxStepper value={rx.pd_od} options={PD_MONO} onChange={setF("pd_od")} label={t("lens.pd.odS")} withEmpty flag={ocrClass("pd_od")} />
                                <ZlxStepper value={rx.pd_os} options={PD_MONO} onChange={setF("pd_os")} label={t("lens.pd.osS")} withEmpty flag={ocrClass("pd_os")} />
                              </>
                            ) : (
                              <ZlxStepper value={rx.pd} options={PD} onChange={setF("pd")} label={t("lens.pdS")} withEmpty flag={ocrClass("pd")} />
                            )}
                            {/* ADD siempre visible: en Visión Sencilla es el disparador del
                                auto-cambio a multifocal; en multifocal es obligatorio. */}
                            <ZlxStepper value={rx.add} options={ADD} onChange={setF("add")} label={t("lens.addS")} withEmpty flag={ocrClass("add")} />
                            {/* ALTURA de montaje: obligatoria en multifocales (bifocal/progresivo) */}
                            {isMulti && (
                              <div ref={heightRef} className={`zlx-height-field ${seekHeight ? "seek" : ""}`}>
                                <ZlxStepper value={rx.seg_height} options={heightOptions} onChange={setF("seg_height")} label={t("lens.heightS")} withEmpty flag={`${ocrClass("seg_height")} ${heightMissing ? "req" : ""}`} />
                              </div>
                            )}
                          </div>
                          {isMulti && (
                            <p className={`zlx-height-note ${heightMissing ? "req" : ""}`}>
                              {heightMissing && <span>{t("lens.height.required")}</span>}
                              <button type="button" className="zlx-height-i" aria-label={t("lens.help")}
                                      onClick={() => openInfo(t("lens.height"), null, ["fittingHeight"], t("lens.height.note"))}><Ic name="info" /></button>
                            </p>
                          )}
                          {/* Botón "Material del lente": primero pide confirmar TODA la
                              receta (ventana única) y de ahí pasa a materiales. */}
                          <button type="button" className="btn btn-primary zlx-pop-done zlx-step-next" data-sfx="select"
                                  onClick={() => setConfirmRx(true)}>
                            <IconMaterial className="zlx-ic" /> {t("lens.material")} <Ic name="down" className="zlx-step-chev" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
        </ZlxPop>
      )}

      {/* ── MATERIAL: paso dentro del MISMO popup (botón atrás), recomendado
             resaltado, lo NO apto en rojo con el porqué, ayuda tras un botón (i) ── */}
      {pop === "mat" && !frameOnly && design && (
        <ZlxPop title={t("lens.material")} icon={<IconMaterial className="zlx-ic" />}
                onClose={() => setPop(null)} onBack={() => setPop("rx")} closeLabel={closeLabel} backLabel={t("lens.back")}
                onHelp={() => openInfo(t("lens.material"), null, materialDiagKeys())} helpLabel={t("lens.help")}
                className="zlx-pop-mat">
          {recommendedMat && (
            <div className="reco">
              <b>{t("lens.recommend")} {L(recommendedMat.label, lang)}</b>
              <span>{t("lens.recommendHint")}</span>
            </div>
          )}
          <div className="zlx-choices zlx-mat-list">
            {suitableMats.map((m) => {
              const isReco = recommendedMat?.id === m.id;
              return (
                <div key={m.id} className={`zlx-choice-row ${matId === m.id ? "sel" : ""}`}>
                  <button type="button" className={`zlx-choice ${matId === m.id ? "sel" : ""}`} onClick={() => { setMatId(m.id); setPop("treat"); }}>
                    <span className="zlx-choice-main">
                      <IconMaterial className="zlx-choice-ic" active={matId === m.id} />
                      <span className="zlx-choice-title">
                        {L(m.label, lang)}
                        {isReco && <span className="reco-badge">★</span>}
                      </span>
                    </span>
                    <span className="zlx-choice-price">{money(basePrice(designId, m.id))}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </ZlxPop>
      )}

      {/* ── TREATMENTS popover: photochromic + AR with education (req 3, 5) ── */}
      {pop === "treat" && !frameOnly && design && (
        <ZlxPop title={t("lens.treatBtn")} icon={<IconTratamiento className="zlx-ic" />} onClose={() => setPop(null)} onBack={() => setPop("mat")} closeLabel={closeLabel} backLabel={t("lens.back")} className="zlx-pop-treat">
          <h4 className="zlx-pop-q">{t("lens.photo")} <span className="lp-opt">{t("lens.optional")}</span></h4>
          <div className="zlx-choices zlx-treat-list">
            <button type="button" className={`zlx-choice ${!photoId ? "sel" : ""}`} onClick={() => setPhotoId(null)}>
              <span className="zlx-choice-main"><span className="zlx-choice-title">{t("lens.none")}</span></span>
              <span className="zlx-choice-price">{t("lens.included")}</span>
            </button>
            {/* Fotocromáticos: una familia, con sus bolitas de color */}
            {fotoGroups.map(renderPhotoFamily)}
          </div>
          {transGroups.length > 0 && (
            <>
              {/* flechita para ir a Transitions */}
              <button type="button" className={`zlx-treat-more ${showTrans ? "open" : ""}`}
                      aria-expanded={showTrans} onClick={() => setShowTrans((s) => !s)}>
                <span>{t("lens.ph.trans")}</span>
                <Ic name={showTrans ? "up" : "down"} className="zlx-treat-more-chev" />
              </button>
              {showTrans && (
                <div className="zlx-choices zlx-treat-list">
                  {transGroups.map(renderPhotoFamily)}
                </div>
              )}
            </>
          )}

          <h4 className="zlx-pop-q">{t("lens.ar")} <span className="lp-opt">{t("lens.optional")}</span></h4>
          <div className="zlx-choices zlx-treat-list">
            <button type="button" className={`zlx-choice ${!arId ? "sel" : ""}`} onClick={() => setArId(null)}>
              <span className="zlx-choice-main"><span className="zlx-choice-title">{t("lens.none")}</span></span>
              <span className="zlx-choice-price">{t("lens.included")}</span>
            </button>
            {arList.map((a) => {
              const AIcon = arIconOf(a.id);
              // antirreflejos: cada uno en UNA sola línea con su globito (i)
              return (
                <div key={a.id} className={`zlx-choice-row ${arId === a.id ? "sel" : ""}`}>
                  <button type="button" className={`zlx-choice ${arId === a.id ? "sel" : ""}`} onClick={() => setArId(a.id)}>
                    <span className="zlx-choice-main">
                      <AIcon className="zlx-choice-ic" active={arId === a.id} />
                      <span className="zlx-choice-title">{L(a.label, lang)}</span>
                    </span>
                    <span className="zlx-choice-price">+ {money(arPriceOf(a))}</span>
                  </button>
                  <button type="button" className="zlx-use-info" aria-label={t("lens.help")}
                          onClick={() => openInfo(L(a.label, lang), arEdu(a.id, lang), arDiagKeys(a.id))}>
                    <Ic name="info" />
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-primary zlx-pop-done" onClick={() => setPop(null)}>
            <Ic name="check" /> {t("lens.done")}
          </button>
        </ZlxPop>
      )}

      {/* ── FRAME quality popover (req 6) ── */}
      {pop === "frame" && (
        <ZlxPop title={t("lens.frameInfo")} icon={<IconMontura className="zlx-ic" />} onClose={() => setPop(null)} closeLabel={closeLabel} className="zlx-pop-frame">
          <div className="zlx-frameinfo-grid open">
            <div><span className="zlx-k">{t("lens.model")}</span><span className="zlx-v">{product.sku}</span></div>
            <div><span className="zlx-k">{t("lens.collection")}</span><span className="zlx-v">{product.brand}</span></div>
            <div><span className="zlx-k">{t("lens.frameMaterial")}</span><span className="zlx-v">{frameMats.length ? frameMats.join(" · ") : "—"}</span></div>
          </div>
          {frameEdu && (
            <div className="zlx-edu">
              <p className="zlx-edu-quality">{frameEdu.quality}</p>
              <p className="zlx-edu-good"><Ic name="good" /><span><b>{goodLbl}</b> {frameEdu.good}</span></p>
              <p className="zlx-edu-bad"><Ic name="bad" /><span><b>{notLbl}</b> {frameEdu.bad}</span></p>
            </div>
          )}
        </ZlxPop>
      )}

      {/* ── Ayuda educativa en globo aparte (no inline): evita scrollbars ── */}
      {infoPop && (
        <ZlxInfoPop title={infoPop.title} onClose={() => setInfoPop(null)} closeLabel={closeLabel}>
          {infoPop.edu && <EduBlock edu={infoPop.edu} goodLbl={goodLbl} notLbl={notLbl} />}
          {infoPop.note && <p className="zlx-infopop-note">{infoPop.note}</p>}
          <DiagHelp keys={infoPop.diagKeys} t={t} />
        </ZlxInfoPop>
      )}

      {/* ── Confirmación ÚNICA de toda la receta, antes de pasar a materiales ── */}
      {confirmRx && (
        <div className="zlx-review-overlay" role="dialog" aria-modal="true" aria-label={t("lens.rx.confirm")}>
          <div className="zlx-review-card">
            <div className="zlx-review-head">
              <b><IconReceta className="zlx-ic" /> {t("lens.rx.confirm")}</b>
              <button type="button" className="zlx-pop-close" onClick={() => setConfirmRx(false)} aria-label={closeLabel}><Ic name="close" /></button>
            </div>
            <p className="zlx-review-sub">{t("lens.rx.confirmSub")}</p>
            <div className="zlx-review-body zlx-rxconfirm-body">{rxDetails}</div>
            <div className="zlx-rxconfirm-actions">
              <button type="button" className="btn btn-outline zlx-rxconfirm-edit" onClick={() => setConfirmRx(false)}>
                <Ic name="edit" /> {t("lens.edit")}
              </button>
              <button type="button" className="btn btn-primary zlx-rxconfirm-go" data-sfx="success"
                      onClick={() => { setConfirmRx(false); setRxDirty(false); setMatId((cur) => cur || (recommendedMat ? recommendedMat.id : cur)); setPop("mat"); }}>
                <Ic name="check" /> {t("lens.rx.confirmGo")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cargando OCR: overlay con loader y mensajes para que el sitio no
          parezca congelado mientras se lee la foto de la receta ── */}
      {ocr.status === "loading" && (
        <div className="zlx-review-overlay" role="dialog" aria-modal="true" aria-label={t("lens.upload.reading")}>
          <div className="zlx-review-card">
            <div className="zlx-review-loading">
              <GlassesLoader messages={["loader.ocrRead", "loader.ocrEyes", "loader.ocrValues", "loader.ocrAlmost"]} />
              <p>{t("lens.upload.reading")}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Revisión previa al checkout: loader → MISMO resumen → datos cliente ── */}
      {reviewing !== "idle" && (
        <div className="zlx-review-overlay" role="dialog" aria-modal="true" aria-label={t("lens.review")}>
          <div className="zlx-review-card">
            {reviewing === "loading" ? (
              <div className="zlx-review-loading"><GlassesLoader /><p>{t("lens.review.prep")}</p></div>
            ) : (
              <>
                <div className="zlx-review-head">
                  <b><IconReceta className="zlx-ic" /> {t("lens.review")}</b>
                  <button type="button" className="zlx-pop-close" onClick={() => setReviewing("idle")} aria-label={closeLabel}><Ic name="close" /></button>
                </div>
                <p className="zlx-review-sub">{t("lens.review.sub")}</p>
                <div className="zlx-review-body">
                  {summaryInner}
                  <div className="zlx-summary-total"><span>{t("lens.total")}</span><b>${total.toFixed(2)}</b></div>
                </div>
                <button type="button" className="btn btn-primary zlx-review-go" data-sfx="success" onClick={confirmReview}>
                  <Ic name="buy" /> {t("lens.review.go")} · ${total.toFixed(2)}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
