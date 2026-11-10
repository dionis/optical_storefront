// Dónde se usa: pestaña «Nueva venta» de /admin — el punto de venta de cada
// tienda, pensado para tablet o móvil en el mostrador. Sigue los pasos del
// documento acordado: cliente → montura → receta → lentes → precio y
// descuento → pago → confirmación. Todos los importes los calcula el servidor
// (POST /admin/pos/quote y /sales): esta pantalla solo elige y enseña.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { defaultFinishFor, useAdminLensCatalog } from "../data/lensCatalog.js";
import { FRAME_ONLY, PHOTO_COLORS, arGroupFor } from "../data/lensPricing.js";
import AddressInput from "./AddressInput.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import {
  createSale,
  fetchApproval,
  fetchCustomer,
  methodName,
  newIdempotencyKey,
  ocrPrescription,
  photoDataUrl,
  posContext,
  quote as fetchQuote,
  requestApproval,
  searchCustomers,
  setWearingPhoto,
} from "./posApi.js";
import SaleDocuments from "./SaleDocuments.jsx";
import PosFrameSearch from "./PosFrameSearch.jsx";
import PosFramePhoto from "./PosFramePhoto.jsx";
import { WearingCaptureCard } from "./WearingPhoto.jsx";
import "./pos-frame-modes.css";
import PosCapture from "./PosCapture.jsx";
import PosFrameCard, { frameLineFields } from "./PosFrameCard.jsx";
import { setActiveStore } from "./useStoreTheme.js";
import AdminFrameCard from "./AdminFrameCard.jsx";
import { useCatalog } from "../data/catalogStore.js";
import FieldError from "../components/FieldError.jsx";
import PosSaleSummary, { PosRunningTotal } from "./PosSaleSummary.jsx";
import { birthMax, customerProblems, emailProblem, LIMITS, paymentProblem, phoneProblem, typedEmail, typedPhone, typedZip } from "../data/fieldRules.js";
import "./pos.css";
import "./pos-tablet.css";
import RxForm from "./PosRx.jsx";
import HelpTip from "./HelpTip.jsx";
import { EMPTY_RX, fromRx, inferType, toRx, validateRx } from "./rxRules.js";
import { promoOf } from "./pricing/promo.js";
import "./pricing/promo.css";

const STEPS = ["customer", "frame", "rx", "lenses", "price", "payment", "done"];
// Tema de ayuda (HelpTip) de cada paso; la receta tiene los suyos en la cuadrícula.
const STEP_HELP = { customer: "pos.step.customer", frame: "pos.step.frame", rx: "pos.rx.howToRead", lenses: "pos.step.lenses", price: "pos.step.price", payment: "pos.step.payment" };
/**
 * Edad cumplida a partir de la fecha de nacimiento ("YYYY-MM-DD"), o null si
 * falta, no se entiende o es futura. Se pinta al lado del campo porque quien
 * atiende razona en años, no en fechas: la edad decide si una graduación es
 * verosímil (presbicia a partir de los 40) y si la montura es de niño.
 */
export function ageFrom(birth, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birth || ""))) return null;
  const d = new Date(`${birth}T00:00:00`);
  if (Number.isNaN(d.getTime()) || d > today) return null;
  let age = today.getFullYear() - d.getFullYear();
  const beforeBirthday = today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

const EMPTY_CUSTOMER = { first_name: "", last_name: "", email: "", phone: "", birth_date: "", address_1: "", city: "", province: "", postal_code: "" };
const EMPTY_WORN_FRAME = { lens_width: "", bridge: "", temple: "", lens_height: "", total_width: "", condition: "good" };
const EMPTY_OWN = { brand: "", model: "", color: "", eye_size: "", bridge: "", temple: "", description: "", photo: null, price: "" };
/**
 * De dónde sale la montura (decisión del dueño, 9-nov-2026):
 *  - `catalog`: del catálogo (se busca) → se cobra al precio de la lista;
 *  - `store`:   de la tienda pero fuera del catálogo → se describe y se cobra al precio que se escribe;
 *  - `own`:     la trae el paciente → se describe y NO se cobra.
 */
const FRAME_MODES = [
  { key: "catalog", icon: "barcode" },
  { key: "store", icon: "store" },
  { key: "own", icon: "user" },
];
/** Mismos límites de precio que el servidor (STORE_FRAME_PRICE en lib/pos.ts). */
const STORE_PRICE_MAX = 5000;
const storePriceBad = (v) => { const s = String(v ?? "").trim(); if (!s) return false; const n = Number(s.replace(/[$,\s]/g, "")); return !Number.isFinite(n) || n <= 0 || n > STORE_PRICE_MAX; };
/** Medidas impresas en la varilla (mm): ancho del lente – puente – largo de la varilla. Mismos límites que el servidor (OWN_FRAME_RANGES). */
const OWN_SIZE = { eye_size: [30, 75, "52"], bridge: [10, 30, "18"], temple: [100, 165, "140"] };
const ownSizeBad = (k, v) => { if (String(v ?? "").trim() === "") return false; const n = Number(String(v).replace(",", ".")); return !Number.isFinite(n) || n < OWN_SIZE[k][0] || n > OWN_SIZE[k][1]; };
/** «Ray-Ban RB5154 · Negro · 51-21-145 — nota», como lo resume el servidor (ownFrameSummary). */
const ownTitle = (o) => {
  const size = String(o.eye_size || "").trim() ? [o.eye_size, o.bridge, o.temple].map((v) => String(v || "").trim()).filter(Boolean).join("-") : "";
  const auto = [[o.brand, o.model].map((v) => v.trim()).filter(Boolean).join(" "), o.color.trim(), size].filter(Boolean).join(" · ");
  const note = o.description.trim();
  return auto && note ? `${auto} — ${note}` : auto || note;
};
/**
 * Teclado en pantalla (tablet): mide cuánto tapa el teclado con visualViewport
 * y lo publica como `--pos-kb` en la raíz del POS, más la clase `kb-open`. La
 * barra Atrás/Siguiente, pegada abajo, sube por encima del teclado (iOS Safari
 * y Android Chrome no encogen el viewport de diseño al abrirlo) y la cabecera
 * pegajosa se compacta para dejar sitio a la cuadrícula de la receta.
 */
function useKeyboardInset(ref) {
  useEffect(() => {
    const el = ref.current;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!el || !vv) return undefined;
    let raf = 0;
    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        el.style.setProperty("--pos-kb", `${kb}px`);
        el.classList.toggle("kb-open", kb > 120);
      });
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => { cancelAnimationFrame(raf); vv.removeEventListener("resize", apply); vv.removeEventListener("scroll", apply); };
  }, [ref]);
}
const EMPTY_PAYMENT = { method_code: "", amount: null, details: {} };
const toCents = (v) => Math.round((Number(v) || 0) * 100);
const centsText = (c) => (c > 0 ? (c / 100).toFixed(2) : "");

/**
 * `amount: null` = nadie lo ha tocado: la primera fila así propone lo que falta
 * por cobrar del total del servidor. Lo que se escribe a mano se respeta.
 */
function withSuggestedAmounts(payments, total) {
  let rest = toCents(total) - payments.reduce((sum, p) => sum + (p.amount === null ? 0 : toCents(p.amount)), 0);
  return payments.map((p) => {
    if (p.amount !== null) return { ...p, suggested: false };
    const amount = centsText(rest);
    rest = 0;
    return { ...p, amount, suggested: true };
  });
}
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* noop */ } };
const num = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
/** Solo los dígitos de un teléfono; los últimos 10 identifican el número con o sin «+1» (misma regla que el servidor). */
const phoneKey = (v) => String(v ?? "").replace(/\D/g, "").slice(-10);
const emailKey = (v) => String(v ?? "").trim().toLowerCase();
/** Un teléfono se busca cuando ya tiene forma de número completo: 10 dígitos o más y pasa la validación del campo. */
const phoneComplete = (v) => phoneProblem(v) === null && String(v ?? "").replace(/\D/g, "").length >= 10;
/** La cotización se vuelve a pedir desde el paso Montura; la receta se manda desde Lentes, cuando ya está cerrada. */
const QUOTE_FROM = STEPS.indexOf("frame");
const RX_FROM = STEPS.indexOf("lenses");

const rxFilled = (f) => num(f.od.sph) !== null && num(f.os.sph) !== null;
const maxPower = (f) => Math.max(...["od", "os"].flatMap((e) => [Math.abs(num(f[e].sph) || 0), Math.abs(num(f[e].cyl) || 0)]));
const isMulti = (f) => (f.type || inferType(f)) === "multifocal";

/** Cambio por ojo (solo pantalla: nunca va en recibos, correos ni la hoja). */
function OpticalChange({ change }) {
  const { t } = useLang();
  if (!change) return null;
  const fmt = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}`);
  return (
    <div className={`pos-change ${change.significant ? "warn" : ""}`}>
      <b>{t("adm.pos.change.title")}</b>
      <table>
        <thead><tr><th />{["sph", "cyl", "axis", "add", "se"].map((k) => <th key={k}>{t(`adm.pos.change.${k}`)}</th>)}</tr></thead>
        <tbody>
          {["od", "os"].map((eye) => (
            <tr key={eye} className={change[eye].significant ? "sig" : ""}>
              <th scope="row">{t(`adm.pos.rx.${eye}`)}</th>
              <td>{fmt(change[eye].sph)}</td><td>{fmt(change[eye].cyl)}</td>
              <td>{change[eye].axis == null ? "—" : `${change[eye].axis}°`}</td>
              <td>{fmt(change[eye].add)}</td><td>{fmt(change[eye].se)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <small>
        {change.months_since_worn == null ? t("adm.pos.change.noDate") : t("adm.pos.change.months", { n: change.months_since_worn })}
        {" · "}{change.significant ? t("adm.pos.change.significant") : t("adm.pos.change.small")}
      </small>
    </div>
  );
}

/** Acabado con el que arranca una línea: stock salvo en progresivos, que son siempre digitales (lib/lens-finish.ts en el servidor). */
const finishFor = (catalog, designId) => (designId === "frame-only" ? null : defaultFinishFor(catalog.DESIGNS.find((d) => d.id === designId)?.cat));

/**
 * Combinaciones de un toque para la montura que trae el cliente (línea
 * `own_frame`): se derivan del catálogo cargado y solo se ofrecen las que
 * encajan con el tipo de receta (misma regla que el selector: monofocal →
 * visión sencilla; multifocal → bifocal o progresivo) y tienen precio en su
 * acabado por defecto. Rellenan `selection`; el selector de abajo sigue
 * editable. No calculan importes: el total lo da el servidor.
 */
export function lensPresets(catalog, rxForm) {
  const { DESIGNS, MATERIALS, PHOTO, AR, FINISHES } = catalog;
  const multi = isMulti(rxForm);
  const power = maxPower(rxForm);
  const recommended = MATERIALS.find((m) => power <= m.maxAbs) || MATERIALS[MATERIALS.length - 1];
  const firstOf = (cat) => DESIGNS.find((d) => d.cat === cat) || null;
  const priced = (design, material) => Boolean(design && material && FINISHES?.[design.id]?.[material.id]?.[defaultFinishFor(design.cat)] != null);
  // El material recomendado; si ese diseño no lo tiene con precio, el primero que sí (de más fino a más grueso no: en orden de lista).
  const materialFor = (design) => (priced(design, recommended) ? recommended : MATERIALS.find((m) => priced(design, m)) || null);
  const build = (id, design, extra = {}) => {
    const material = materialFor(design);
    if (!design || !material) return null;
    return { id, selection: { design_code: design.id, material_code: material.id, photo_code: null, ar_code: null, finish: defaultFinishFor(design.cat), ...extra } };
  };
  const sv = firstOf("sv"); const bif = firstOf("bifocal"); const prog = firstOf("prog");
  const arSv = (AR[arGroupFor(sv)] || [])[0]; const arProg = (AR[arGroupFor(prog)] || [])[0];
  const photoSv = PHOTO.find((p) => p.price && p.price.sv != null);
  const list = multi
    ? [build("bifocal", bif), build("prog", prog), arProg && build("prog_ar", prog, { ar_code: arProg.id })]
    : [build("sv_basic", sv), arSv && build("sv_ar", sv, { ar_code: arSv.id }), photoSv && build("sv_photo", sv, { photo_code: photoSv.id })];
  return list.filter(Boolean);
}

function LensPresets({ line, onChange, catalog, rxForm }) {
  const { t } = useLang();
  const presets = lensPresets(catalog, rxForm);
  if (!presets.length) return null;
  const sel = line.selection;
  const active = (p) => ["design_code", "material_code", "photo_code", "ar_code"].every((k) => (sel[k] || null) === (p.selection[k] || null)) && (sel.finish || finishFor(catalog, sel.design_code)) === p.selection.finish;
  return (
    <div className="pos-presets" role="group" aria-label={t("adm.pos.preset.title")}>
      <span className="pos-presets-ttl"><Icon name="sparkles" size={14} /> {t("adm.pos.preset.title")}</span>
      <div className="pos-presets-row">
        {presets.map((p) => (
          <button key={p.id} type="button" className={active(p) ? "on" : ""} aria-pressed={active(p)} onClick={() => onChange({ ...line, touched: true, selection: { ...sel, ...p.selection } })}>
            {t(`adm.pos.preset.${p.id}`)}
          </button>
        ))}
      </div>
      <small className="muted">{t("adm.pos.preset.hint")}</small>
    </div>
  );
}

/** Diseño, material y tratamientos de una línea, con las mismas reglas que el asistente web. */
function LensPicker({ line, onChange, catalog, rxForm, noRx }) {
  const { t, lang } = useLang();
  const { DESIGNS, MATERIALS, PHOTO, AR, FINISHES } = catalog;
  const L = (o) => (o ? o[lang] ?? o.es : "");
  const sel = line.selection;
  const design = sel.design_code === "frame-only" ? FRAME_ONLY : DESIGNS.find((d) => d.id === sel.design_code) || null;
  const cat = design?.cat;
  const power = maxPower(rxForm);
  const recommended = MATERIALS.find((m) => power <= m.maxAbs) || MATERIALS[MATERIALS.length - 1];
  const photos = PHOTO.filter((p) => cat && p.price && p.price[cat] != null);
  const ars = design && sel.design_code !== "frame-only" ? AR[arGroupFor(design)] || [] : [];
  const set = (patch) => onChange({ ...line, selection: { ...sel, ...patch } });
  // Filtro por tipo de receta: monofocal → solo visión sencilla; multifocal → bifocal o progresivo.
  const designs = noRx ? [] : DESIGNS.filter((d) => (isMulti(rxForm) ? d.cat !== "sv" : d.cat === "sv"));
  // Stock o tallado digital: solo donde el diseño admite los dos (visión
  // sencilla y bifocal). Un acabado sin precio en la lista se ve pero no se
  // elige: el servidor lo rechazaría con `finish_unavailable`.
  const priced = (sel.material_code && FINISHES?.[sel.design_code]?.[sel.material_code]) || { stock: null, digital: null };
  const finishOptions = cat && cat !== "prog" ? ["stock", "digital"] : [];
  const finish = sel.finish || finishFor(catalog, sel.design_code);
  return (
    <div className="pos-lens">
      <label>
        <span>{t("adm.pos.lens.design")}<HelpTip topic="pos.step.lenses" /></span>
        <select value={sel.design_code} onChange={(e) => set({ design_code: e.target.value, material_code: e.target.value === "frame-only" ? null : sel.material_code || recommended?.id, photo_code: null, ar_code: null, finish: finishFor(catalog, e.target.value) })}>
          {line.kind !== "own_frame" && <option value="frame-only">{t("adm.pos.lens.frameOnly")}</option>}
          {designs.map((d) => <option key={d.id} value={d.id}>{L(d.label)}</option>)}
        </select>
      </label>
      {sel.design_code !== "frame-only" && (
        <>
          <label>
            <span>{t("adm.pos.lens.material")}<HelpTip topic="pos.step.lenses" /></span>
            <select
              value={sel.material_code || ""}
              onChange={(e) => {
                const material_code = e.target.value || null;
                // Un material sin precio para el acabado elegido vuelve a stock, que es lo que la lista siempre tiene.
                const cell = material_code && FINISHES?.[sel.design_code]?.[material_code];
                const keep = !cell || finishOptions.length === 0 || cell[finish] != null;
                set({ material_code, ...(keep ? {} : { finish: "stock" }) });
              }}
            >
              <option value="">—</option>
              {MATERIALS.map((m) => <option key={m.id} value={m.id}>{L(m.label)}{m.id === recommended?.id ? " ★" : ""}</option>)}
            </select>
          </label>
          <label>
            <span>{t("adm.pos.lens.finish")}<HelpTip topic="pos.step.lenses" /></span>
            {finishOptions.length ? (
              <div className="pos-rx-type" role="radiogroup" aria-label={t("adm.pos.lens.finish")}>
                {finishOptions.map((f) => {
                  const unpriced = sel.material_code ? priced[f] == null : false;
                  return (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={finish === f}
                      className={finish === f ? "on" : ""}
                      disabled={unpriced}
                      title={unpriced ? t("adm.pos.lens.finishUnpriced") : undefined}
                      onClick={() => set({ finish: f })}
                    >
                      {t(`adm.pos.lens.finish.${f}`)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="pos-picked" title={t("adm.pos.lens.finishProg")}>{t("adm.pos.lens.finish.digital")}</span>
            )}
          </label>
          <label>
            <span>{t("adm.pos.lens.photo")}<HelpTip topic="pos.step.lenses" /></span>
            <select value={sel.photo_code || ""} onChange={(e) => set({ photo_code: e.target.value || null })}>
              <option value="">{t("adm.pos.lens.none")}</option>
              {photos.map((p) => <option key={p.id} value={p.id}>{L(p.label)} · {p.colors.map((c) => PHOTO_COLORS[c]?.[lang] || c).join("/")}</option>)}
            </select>
          </label>
          <label>
            <span>{t("adm.pos.lens.ar")}<HelpTip topic="pos.step.lenses" /></span>
            <select value={sel.ar_code || ""} onChange={(e) => set({ ar_code: e.target.value || null })}>
              <option value="">{t("adm.pos.lens.none")}</option>
              {ars.map((a) => <option key={a.id} value={a.id}>{L(a.label)}</option>)}
            </select>
          </label>
        </>
      )}
      {sel.design_code !== "frame-only" && recommended && <small className="muted">{t("adm.pos.lens.recommended", { m: L(recommended.label) })}</small>}
    </div>
  );
}

export default function PosSale({ me }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [ctx, setCtx] = useState(null);
  const [ctxError, setCtxError] = useState(null);
  const [storeId, setStoreId] = useState("");
  // The lens list of the store being sold in (GET /admin/pos/lens-matrix): the
  // owner's cells and finishes, at that store's prices. Until it arrives, or
  // if it fails, the bundled list — and the lens step says so (`catalog.live`).
  // Solo con la tienda ya decidida: antes se pedía la lista maestra y luego la de la tienda, una detrás de otra.
  const catalog = useAdminLensCatalog(storeId, { enabled: Boolean(storeId) });
  const [terminalId, setTerminalId] = useState("");
  const [step, setStep] = useState(0);
  const rootRef = useRef(null);
  useKeyboardInset(rootRef);
  // Cada paso empieza arriba: en la tablet el botón Siguiente queda al final de un formulario largo.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    const top = rootRef.current?.getBoundingClientRect().top;
    if (top != null && top < 0) window.scrollBy({ top: top - 8, behavior: "smooth" });
  }, [step]);
  const [busy, setBusy] = useState(false);

  // 1 · cliente
  const [custQ, setCustQ] = useState("");
  const [custHits, setCustHits] = useState([]);
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [touched, setTouched] = useState({});
  const [showCustErrors, setShowCustErrors] = useState(false);
  const addressRef = useRef(null);
  const [customerId, setCustomerId] = useState(null);
  const [custInfo, setCustInfo] = useState(null);
  const [wears, setWears] = useState(null);
  // HU-18: cliente ya registrado con ese teléfono o correo, y lo que se descartó («es otra persona») por valor.
  const [dup, setDup] = useState({ phone: null, email: null });
  const dupDismissed = useRef({ phone: new Set(), email: new Set() });
  const dupSeq = useRef({ phone: 0, email: 0 });
  // 2 · monturas
  const [lines, setLines] = useState([]);
  const [frameListOpen, setFrameListOpen] = useState(false);
  const [own, setOwn] = useState(EMPTY_OWN);
  const [frameMode, setFrameMode] = useState("catalog");
  // Se intentó añadir (o avanzar) con la montura escrita a mano incompleta: lo que falta se marca en rojo.
  const [ownTried, setOwnTried] = useState(false);
  const [cardProduct, setCardProduct] = useState(null);
  const { products: catProducts = [], cases: catCases = [] } = useCatalog();
  // Ficha completa de una montura (AdminFrameCard) desde el buscador, o null si el catálogo local no la tiene.
  const frameCardOf = (productId) => catProducts.find((x) => x.medusaId === productId) || catCases.find((x) => x.medusaId === productId) || null;
  const viewFrame = (p) => { const full = frameCardOf(p.product_id); if (full) setCardProduct(full); };
  // 3 · receta
  const [noRx, setNoRx] = useState(false);
  const [rxNew, setRxNew] = useState(EMPTY_RX);
  const [ocr, setOcr] = useState({ status: "idle", confirmed: true });
  const [rxWorn, setRxWorn] = useState(EMPTY_RX);
  const [worn, setWorn] = useState({ source: "previous_rx", dateMode: "exact", date: "", months: "" });
  const [wornFrame, setWornFrame] = useState(EMPTY_WORN_FRAME);
  // 5 · precio
  const [discount, setDiscount] = useState("");
  const [q, setQ] = useState(null);
  // "idle" | "loading" | "ok" | "error": estado de la última cotización; en error se conserva `q` para la franja.
  const [qStatus, setQStatus] = useState("idle");
  const quoteSeq = useRef(0);
  const quoteErr = useRef(null);
  const [approval, setApproval] = useState(null);
  const [reason, setReason] = useState("");
  // 6 · pago
  const [payments, setPayments] = useState([EMPTY_PAYMENT]);
  const [delivery, setDelivery] = useState("pickup");
  const [notifyEmail, setNotifyEmail] = useState(true);
  // Foto y receta en el correo: se decide en cada venta, nunca se recuerda.
  const [receiptDetail, setReceiptDetail] = useState(false);
  // Foto del paciente con la montura puesta (opcional, se queda en la tienda; WearingPhoto.jsx).
  const [wear, setWear] = useState({ consent: false, photo: null });
  const [wearSaved, setWearSaved] = useState(null);
  const [result, setResult] = useState(null);
  const idem = useRef(null);

  useEffect(() => {
    posContext()
      .then((c) => {
        setCtx(c);
        // The store picked in the panel's global filter wins over the last one
        // sold in: opening the POS must not move the global picker back.
        const picked = read("adm_active_store");
        const saved = read("pos_store");
        const s = c.stores.find((x) => x.id === picked) || c.stores.find((x) => x.id === saved) || c.stores[0];
        if (s) setStoreId(s.id);
      })
      .catch((e) => setCtxError(e.message));
  }, []);
  const store = ctx?.stores.find((s) => s.id === storeId) || null;
  useEffect(() => {
    if (!store) return;
    write("pos_store", store.id);
    setActiveStore(store.id); // el panel toma los colores de la tienda en la que se vende
    const saved = read(`pos_terminal:${store.id}`);
    setTerminalId((store.terminals.find((x) => x.id === saved) || store.terminals[0])?.id || "");
  }, [store]);
  useEffect(() => { if (store && terminalId) write(`pos_terminal:${store.id}`, terminalId); }, [store, terminalId]);
  // The global store filter drives the POS too. Mid-sale the store is locked
  // (prices and stock are that store's): the filter snaps back, with a word why.
  const liveRef = useRef({ ctx: null, storeId: "", step: 0 });
  liveRef.current = { ctx, storeId, step };
  useEffect(() => {
    const onPick = (e) => {
      const { ctx: c, storeId: cur, step: st } = liveRef.current;
      if (!c || !cur) return;
      const id = e?.detail || null;
      if (id === cur) return;
      const target = id ? c.stores.find((x) => x.id === id) : null;
      const midSale = st > 0 && STEPS[st] !== "done";
      if (target && !midSale) { setStoreId(target.id); return; }
      const here = c.stores.find((x) => x.id === cur);
      toast({ tone: "info", title: t(midSale ? "adm.pos.storeLocked" : "adm.pos.storeNeeded", { store: here ? here.code : "" }) });
      setTimeout(() => setActiveStore(cur), 0);
    };
    window.addEventListener("adm:active-store", onPick);
    return () => window.removeEventListener("adm:active-store", onPick);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const terminal = store?.terminals.find((x) => x.id === terminalId) || null;
  const methods = useMemo(() => (ctx?.payment_methods || []).filter((m) => store?.payment_methods.includes(m.code)), [ctx, store]);

  // Búsquedas con espera corta para no consultar en cada tecla.
  useEffect(() => {
    if (custQ.trim().length < 2) { setCustHits([]); return undefined; }
    const h = setTimeout(() => searchCustomers(custQ).then((r) => setCustHits(r.customers || [])).catch(() => setCustHits([])), 300);
    return () => clearTimeout(h);
  }, [custQ]);

  // HU-18: al escribir un teléfono completo (o un correo válido) de un cliente
  // NUEVO se consulta la misma búsqueda del buscador; si hay un registrado con
  // ese número (últimos 10 dígitos) o ese correo, se avisa sin bloquear.
  const lookupDup = (kind, value, key, matches) => {
    const seq = ++dupSeq.current[kind];
    if (customerId || !key || dupDismissed.current[kind].has(key)) { setDup((d) => (d[kind] ? { ...d, [kind]: null } : d)); return undefined; }
    const h = setTimeout(() => {
      searchCustomers(value)
        .then((r) => {
          if (seq !== dupSeq.current[kind]) return; // llegó tarde: ya se escribió otra cosa
          const hit = (r.customers || []).find(matches) || null;
          setDup((d) => ({ ...d, [kind]: hit ? { key, hit } : null }));
        })
        .catch(() => { if (seq === dupSeq.current[kind]) setDup((d) => ({ ...d, [kind]: null })); });
    }, 400);
    return () => clearTimeout(h);
  };
  useEffect(() => lookupDup("phone", customer.phone.trim(), phoneComplete(customer.phone) ? phoneKey(customer.phone) : "", (c) => phoneKey(c.phone) === phoneKey(customer.phone)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customer.phone, customerId]);
  useEffect(() => lookupDup("email", customer.email.trim(), emailProblem(customer.email, true) === null ? emailKey(customer.email) : "", (c) => emailKey(c.email) === emailKey(customer.email)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customer.email, customerId]);
  const dismissDup = (kind) => { if (dup[kind]) dupDismissed.current[kind].add(dup[kind].key); setDup((d) => ({ ...d, [kind]: null })); };
  // Un mismo cliente que coincide por teléfono y por correo se avisa una vez.
  const dupNotices = ["phone", "email"].filter((k, i, all) => dup[k] && !(i > 0 && dup[all[0]]?.hit?.id === dup[k].hit.id));

  const pickCustomer = async (c) => {
    setDup({ phone: null, email: null });
    setCustomerId(c.id);
    setCustomer({ ...EMPTY_CUSTOMER, first_name: c.first_name || "", last_name: c.last_name || "", email: c.email || "", phone: c.phone || "", birth_date: c.birth_date || "" });
    setCustHits([]); setCustQ("");
    try {
      const info = await fetchCustomer(c.id);
      setCustInfo(info);
      // HU-120: lo último que se le hizo se propone como la graduación que usa hoy.
      if (info.last_prescription) {
        setRxWorn({ ...fromRx(info.last_prescription) });
        setWorn((w) => ({ ...w, source: "prior_sale", dateMode: info.last_prescription.rx_date ? "exact" : "approx", date: info.last_prescription.rx_date || info.last_prescription.created_at.slice(0, 10) }));
      }
    } catch { setCustInfo(null); }
  };
  const newCustomer = () => { setCustomerId(null); setCustInfo(null); setCustomer(EMPTY_CUSTOMER); setTouched({}); setShowCustErrors(false); };

  const addFrame = (p, v) => {
    setLines([{ key: `${v.id}-${Date.now()}`, kind: "frame", variant_id: v.id, ...frameLineFields(p, v), selection: { design_code: "frame-only", material_code: null, photo_code: null, ar_code: null, finish: null } }]);
    setOwn(EMPTY_OWN);
  };
  // Qué le falta a la montura escrita a mano (obligatorio: marca o modelo —o una nota, la del paciente—; y el precio, la de la tienda).
  const ownProblems = {
    name: frameMode === "store" ? !own.brand.trim() && !own.model.trim() : !own.brand.trim() && !own.model.trim() && !own.description.trim(),
    size: Object.keys(OWN_SIZE).some((k) => ownSizeBad(k, own[k])),
    price: frameMode === "store" && (!String(own.price).trim() || storePriceBad(own.price)),
  };
  const nameBad = ownTried && ownProblems.name;
  const priceBad = (ownTried && ownProblems.price) || storePriceBad(own.price);
  // La montura escrita a mano: la del paciente (no se cobra) o una de la tienda fuera del catálogo (se cobra).
  const addOwn = () => {
    const store = frameMode === "store";
    const title = ownTitle(own);
    const p = ownProblems;
    if (p.name || p.size || p.price) {
      // En rojo lo que falta, y el foco en el primer campo a corregir.
      setOwnTried(true);
      toast({ tone: "error", title: t(p.name ? (store ? "adm.err.pos.store_frame_needs_name" : "adm.pos.own.needDescription") : p.price ? "adm.err.pos.bad_store_frame_price" : "adm.err.pos.bad_own_frame") });
      requestAnimationFrame(() => { const el = document.querySelector('.pos-own [aria-invalid="true"]'); el?.scrollIntoView({ block: "center" }); el?.focus(); });
      return false;
    }
    const specs = { brand: own.brand.trim(), model: own.model.trim(), color: own.color.trim(), eye_size: own.eye_size.trim(), bridge: own.bridge.trim(), temple: own.temple.trim() };
    const base = { variant_id: null, title, description: own.description.trim(), own_frame: specs, photo: own.photo };
    setLines([store
      ? { key: `store-${Date.now()}`, kind: "store_frame", ...base, store_price: Number(String(own.price).replace(/[$,\s]/g, "")), selection: { design_code: "frame-only", material_code: null, photo_code: null, ar_code: null, finish: null } }
      : { key: `own-${Date.now()}`, kind: "own_frame", ...base, selection: { design_code: "sv", material_code: null, photo_code: null, ar_code: null, finish: "stock" } }]);
    setOwn(EMPTY_OWN);
    setOwnTried(false);
    return true;
  };
  // Reciben el archivo ya elegido (PosCapture vacía el input para que repetir la misma foto dispare otra vez).
  const onOwnPhoto = async (f) => {
    if (!f) return;
    try { setOwn((o) => ({ ...o, photo: null })); const url = await photoDataUrl(f); setOwn((o) => ({ ...o, photo: url })); } catch (err) { toast({ tone: "error", title: t(err.message) }); }
  };
  const onOcr = async (f) => {
    if (!f) return;
    setOcr({ status: "loading", confirmed: false });
    try {
      const r = await ocrPrescription(f);
      // El tipo sale de lo leído: con adición es multifocal.
      setRxNew({ ...fromRx(r.prescription), rx_date: rxNew.rx_date });
      setOcr({ status: "done", confirmed: false });
    } catch (err) {
      setOcr({ status: "error", confirmed: true });
      toast({ tone: "error", title: t(err.message) });
    }
  };

  // Al entrar en Lentes, cada línea arranca con un diseño coherente con la receta.
  useEffect(() => {
    if (STEPS[step] !== "lenses") return;
    setLines((ls) => ls.map((l) => {
      if (noRx) return { ...l, selection: { design_code: "frame-only", material_code: null, photo_code: null, ar_code: null, finish: null } };
      const multi = isMulti(rxNew);
      const d = l.selection.design_code;
      const fits = d === "frame-only" ? l.kind !== "own_frame" : catalog.DESIGNS.some((x) => x.id === d && (multi ? x.cat !== "sv" : x.cat === "sv"));
      if (fits && !(l.kind !== "own_frame" && d === "frame-only" && l.touched !== true && !noRx)) return l;
      const first = catalog.DESIGNS.find((x) => (multi ? x.cat === "prog" : x.cat === "sv"));
      const power = maxPower(rxNew);
      const mat = catalog.MATERIALS.find((m) => power <= m.maxAbs) || catalog.MATERIALS[catalog.MATERIALS.length - 1];
      return { ...l, touched: true, selection: { design_code: first?.id || "sv", material_code: mat?.id || null, photo_code: null, ar_code: null, finish: finishFor(catalog, first?.id || "sv") } };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const apiLines = () => lines.map((l) => ({ kind: l.kind, variant_id: l.variant_id, selection: l.selection, description: l.description || null, photo: l.photo || null, ...(l.kind === "own_frame" ? { own_frame: l.own_frame || null } : {}), ...(l.kind === "store_frame" ? { store_frame: { ...(l.own_frame || {}), price: l.store_price } } : {}) }));
  const wornBody = () => (wears && !noRx ? {
    rx: toRx(rxWorn),
    worn_source: worn.source,
    ...(worn.dateMode === "approx" ? { approx_months_ago: Number(worn.months) || 0 } : { rx_date: worn.date || null }),
    frame_measures: Object.values(wornFrame).some((v) => v && v !== "good") ? {
      lens_width: num(wornFrame.lens_width), bridge: num(wornFrame.bridge),
      temple: num(wornFrame.temple), lens_height: num(wornFrame.lens_height),
      total_width: num(wornFrame.total_width), condition: wornFrame.condition,
    } : null,
  } : null);
  // Leída de la foto → `ocr` y verificada solo si el vendedor confirmó la lectura.
  const newBody = () => (noRx ? null : { rx: toRx(rxNew, ocr.status === "done" ? "ocr" : "manual", ocr.status !== "done" || ocr.confirmed === true), rx_date: rxNew.rx_date || null });

  // Cotización en curso: se pide al servidor desde que hay montura (paso
  // Montura) y cada vez que cambia algo que afecta al precio, con una espera
  // corta. La receta viaja desde Lentes (ya cerrada), que es lo que decide
  // `rx_check` y el cambio óptico en Precio. El cuerpo serializado es la
  // dependencia: dos renders con la misma venta no vuelven a preguntar.
  const withRx = step >= RX_FROM && !noRx && rxFilled(rxNew);
  // Una línea con lente pero sin material (la montura del cliente antes de
  // Lentes, o el material quitado) no tiene precio posible: no se pregunta.
  const quotable = lines.every((l) => l.selection.design_code === "frame-only" || l.selection.material_code);
  const quoteBody = useMemo(() => (store && lines.length && quotable && step >= QUOTE_FROM && STEPS[step] !== "done"
    ? JSON.stringify({ store: store.id, lines: apiLines().map((l) => ({ ...l, photo: null })), discount_pct: discount || 0, prescription: withRx ? newBody() : null, worn: withRx ? wornBody() : null })
    : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store?.id, lines, discount, quotable && step >= QUOTE_FROM && STEPS[step] !== "done", withRx, withRx && rxNew, withRx && rxWorn, withRx && worn, withRx && wornFrame, withRx && wears, withRx && ocr.status]);
  useEffect(() => {
    if (!quoteBody) { quoteSeq.current += 1; setQ(null); setQStatus("idle"); return undefined; }
    const seq = ++quoteSeq.current;
    setQStatus("loading");
    const h = setTimeout(() => {
      fetchQuote(JSON.parse(quoteBody))
        .then((r) => { if (seq !== quoteSeq.current) return; setQ(r); setQStatus("ok"); quoteErr.current = null; })
        .catch((err) => {
          if (seq !== quoteSeq.current) return; // respuesta vieja: ya hay otra en camino
          setQStatus("error");
          // Se avisa donde el precio es lo que se mira (Lentes en adelante) y una sola vez por motivo:
          // en Montura una línea a medio elegir todavía no es un error de nadie.
          if (step >= RX_FROM && quoteErr.current !== err.message) toast({ tone: "error", title: t(err.message) });
          quoteErr.current = err.message;
        });
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteBody]);
  // Un descuento distinto invalida la aprobación pedida para el anterior.
  useEffect(() => { setApproval(null); }, [discount, lines]);

  // La caja espera la decisión del dueño o un superadmin consultando cada pocos segundos.
  useEffect(() => {
    if (!approval || approval.status !== "pending") return undefined;
    const h = setInterval(async () => {
      try {
        const r = await fetchApproval(approval.id);
        setApproval(r.approval);
        if (r.approval.status === "approved") toast({ tone: "success", title: t("adm.pos.approval.approved") });
        if (r.approval.status === "rejected") toast({ tone: "error", title: t("adm.pos.approval.rejected") });
      } catch { /* sigue esperando */ }
    }, 6000);
    return () => clearInterval(h);
  }, [approval, t, toast]);

  const askApproval = async () => {
    setBusy(true);
    try {
      const r = await requestApproval({ store: store.id, terminal_id: terminalId, lines: apiLines().map((l) => ({ ...l, photo: null })), discount_pct: discount || 0, reason });
      setApproval(r.approval);
      toast({ tone: "success", title: t("adm.pos.approval.sent", { n: r.notified }) });
    } catch (err) { toast({ tone: "error", title: t(err.message) }); } finally { setBusy(false); }
  };

  const total = q?.quote?.total ?? 0;
  const payRows = useMemo(() => withSuggestedAmounts(payments, total), [payments, total]);
  // Una fila sugerida sin forma de pago aún no es un error: no se ha empezado a rellenar.
  const rowProblem = (p) => (p.suggested && !p.method_code ? null : paymentProblem(p, methods.find((x) => x.code === p.method_code)));
  const payState = useMemo(() => {
    const byCode = new Map(methods.map((m) => [m.code, m]));
    let paid = 0; let ins = 0;
    for (const p of payRows) {
      const m = byCode.get(p.method_code);
      const a = Number(p.amount) || 0;
      if (!m || a <= 0) continue;
      if (m.kind === "insurance" || m.receivable) ins += a; else paid += a;
    }
    return { paid: Math.round(paid * 100) / 100, ins: Math.round(ins * 100) / 100, balance: Math.round((total - paid - ins) * 100) / 100 };
  }, [payRows, methods, total]);

  // Lo que usa hoy: graduación de ambos ojos, dentro de rango, y cuándo se la hicieron.
  const wornCheck = validateRx(rxWorn, rxWorn.type, { mode: "worn" });
  const wornReady = rxFilled(rxWorn) && wornCheck.ok && (worn.dateMode === "approx" ? worn.months !== "" : Boolean(worn.date));
  // Receta nueva: el servidor es la última palabra, pero lo que el laboratorio no corta no sale de aquí.
  const rxCheck = validateRx(rxNew, rxNew.type, { mode: "new" });
  const fmtEye = (e) => [e.sph, e.cyl && `${e.cyl}×${e.axis || "—"}`, e.add && `ADD ${e.add}`].filter(Boolean).join(" ");
  // Formato de moneda del panel. Va ANTES de `frameCards`: ese `.map` se evalúa
  // en cada render en cuanto la venta tiene una montura, así que declararlo
  // más abajo dejaba `m` en zona muerta temporal y la pantalla entera
  // reventaba (ReferenceError) justo al elegir el color de la montura.
  const m = (v) => money(v, "usd", lang);
  // La montura que se está vendiendo, siempre a la vista en los pasos siguientes.
  const frameCards = lines.filter((l) => l.kind === "frame").map((l) => <PosFrameCard key={l.key} frame={l} money={m} compact />);
  const wornSummary = wornReady ? `${t("adm.pos.rx.od")} ${fmtEye(rxWorn.od)} · ${t("adm.pos.rx.os")} ${fmtEye(rxWorn.os)}` : t("adm.pos.worn.missing");
  const custProblems = customerProblems(customer, { requireAddress: delivery === "ship" });
  const canNext = () => {
    switch (STEPS[step]) {
      case "customer": return Object.keys(customerProblems(customer)).length === 0 && wears !== null
        && (!wears || wornReady);
      case "frame": return lines.length > 0;
      case "rx":
        if (noRx) return !lines.some((l) => l.kind === "own_frame");
        if (!rxFilled(rxNew) || !rxCheck.ok || (ocr.status === "done" && !ocr.confirmed)) return false;
        return true;
      case "lenses": return lines.every((l) => l.selection.design_code === "frame-only" || l.selection.material_code)
        && (!lines.some((l) => { const d = catalog.DESIGNS.find((x) => x.id === l.selection.design_code); return d && d.cat !== "sv"; }) || num(rxNew.seg_height) !== null);
      case "price": return Boolean(q) && qStatus !== "error" && (!q.needs_approval || approval?.status === "approved") && q.rx_check?.fulfillable !== false;
      case "payment": return payState.balance >= 0
        && (total <= 0 || payState.paid + payState.ins > 0)
        && !payRows.some(rowProblem)
        && (delivery === "pickup" || Object.keys(custProblems).length === 0);
      default: return false;
    }
  };

  // Bloqueado en el primer paso: en vez de un botón mudo, marca qué falta y lleva hasta ahí.
  const next = () => {
    if (canNext()) { setShowCustErrors(false); setStep((s) => s + 1); return; }
    // Montura escrita a mano sin «Añadir»: Siguiente la añade si está completa, o marca en rojo lo que falta.
    if (stepName === "frame" && !lines.length) {
      if (frameMode !== "catalog") { if (addOwn()) setStep((s) => s + 1); }
      else setOwnTried(true);
      return;
    }
    if (stepName !== "customer") return;
    setShowCustErrors(true);
    const fields = Object.keys(customerProblems(customer));
    if (fields.some((k) => ["address_1", "city", "state", "postal_code"].includes(k)) && addressRef.current) addressRef.current.open = true;
    requestAnimationFrame(() => document.querySelector('.pos-card [aria-invalid="true"]')?.focus());
  };

  const confirmSale = async () => {
    if (busy) return;
    setBusy(true);
    if (!idem.current) idem.current = newIdempotencyKey();
    try {
      const r = await createSale({
        store: store.id,
        terminal_id: terminalId,
        customer_id: customerId,
        customer: {
          first_name: customer.first_name, last_name: customer.last_name, email: customer.email, phone: customer.phone, birth_date: customer.birth_date,
          address: customer.address_1 ? { address_1: customer.address_1, city: customer.city, province: customer.province, postal_code: customer.postal_code } : null,
        },
        lines: apiLines(),
        discount_pct: discount || 0,
        approval_id: approval?.status === "approved" ? approval.id : null,
        payments: payRows.filter((p) => p.method_code && Number(p.amount) > 0).map(({ method_code, amount, details }) => ({ method_code, amount, details })),
        prescriptions: { new: newBody(), worn: wornBody() },
        delivery,
        notify_email: notifyEmail,
        receipt_detail: notifyEmail && receiptDetail,
        idempotency_key: idem.current,
      });
      // Las fotos de la montura escrita a mano se quedan en esta pantalla: si el
      // servidor no pudo guardarlas, el recibo de ahora las imprime igual.
      setResult({ ...r.sale, optical_change: r.sale.optical_change || q?.optical_change || null, frame_photos: lines.map((l) => (l.kind !== "frame" ? l.photo || null : null)) });
      setStep(STEPS.indexOf("done"));
      // La foto con la montura va aparte, una vez registrada la venta: si falla, la venta queda y se añade desde su ficha.
      if (wear.consent && wear.photo && r.sale?.id) {
        setWearSaved("saving");
        setWearingPhoto(r.sale.id, wear.photo)
          .then(() => setWearSaved("saved"))
          .catch(() => { setWearSaved("failed"); toast({ tone: "error", title: t("adm.wear.saleNoPhoto") }); });
      }
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const reset = () => {
    idem.current = null;
    setStep(0); setTouched({}); setShowCustErrors(false); setCustomer(EMPTY_CUSTOMER); setCustomerId(null); setCustInfo(null); setWears(null);
    setLines([]); setOwn(EMPTY_OWN); setFrameMode("catalog"); setOwnTried(false); setNoRx(false); setRxNew(EMPTY_RX); setRxWorn(EMPTY_RX); setOcr({ status: "idle", confirmed: true });
    setWorn({ source: "previous_rx", dateMode: "exact", date: "", months: "" });
    setDiscount(""); setQ(null); setQStatus("idle"); setApproval(null); setReason("");
    setDup({ phone: null, email: null }); dupDismissed.current = { phone: new Set(), email: new Set() };
    setPayments([EMPTY_PAYMENT]); setDelivery("pickup"); setNotifyEmail(true); setReceiptDetail(false); setResult(null);
    setWear({ consent: false, photo: null }); setWearSaved(null);
  };

  if (ctxError) return <div className="adm-section"><div className="adm-demo-banner">{t(ctxError)}</div></div>;
  if (!ctx) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (ctx.seller_block) return <div className="adm-section"><div className="adm-empty"><Icon name="lock" size={36} /><b>{t(`adm.err.pos.${ctx.seller_block}`)}</b><p>{t("adm.pos.sellerBlockHint")}</p></div></div>;
  if (!ctx.stores.length) return <div className="adm-section"><div className="adm-empty"><Icon name="store" size={36} /><b>{t("adm.pos.noStores")}</b></div></div>;

  const setC = (k, typed = (v) => v) => (e) => setCustomer((c) => ({ ...c, [k]: typed(e.target.value) }));
  // Un error se enseña al salir del campo, o de golpe al intentar avanzar: no mientras se escribe.
  const custField = (k) => {
    const problem = (showCustErrors || touched[k]) ? custProblems[k] || (k === "province" ? custProblems.state : null) : null;
    return { problem, props: { name: k, "aria-invalid": problem ? true : undefined, onBlur: () => setTouched((x) => ({ ...x, [k]: true })) } };
  };
  const stepName = STEPS[step];

  return (
    <div className="adm-section pos" ref={rootRef}>
      <div className="adm-head-row pos-head">
        <h2>{t("adm.tab.pos")}</h2>
        <div className="pos-where">
          {/* Un vendedor tiene tienda y punto de venta fijos: se muestran, no se eligen. */}
          {ctx.stores.length > 1 ? (
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={step > 0 && stepName !== "done"} aria-label={t("adm.pos.store")} title={t("adm.pos.store")}>
              {ctx.stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          ) : store && <span className="adm-team-tag" title={t("adm.pos.store")}><Icon name="store" size={12} /> {store.code} · {store.name}</span>}
          {(store?.terminals.length || 0) > 1 ? (
            <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)} aria-label={t("adm.pos.terminal")} title={t("adm.pos.terminal")}>
              {store?.terminals.map((x) => <option key={x.id} value={x.id}>{x.code}{x.name ? ` · ${x.name}` : ""}</option>)}
            </select>
          ) : terminal && <span className="adm-team-tag" title={t("adm.pos.terminal")}><Icon name="receipt" size={12} /> {terminal.code}{terminal.name ? ` · ${terminal.name}` : ""}</span>}
          {ctx.seller_code && <span className="adm-team-tag code" title={t("adm.profile.f.seller_code")}>{ctx.seller_code}</span>}
        </div>
      </div>

      {/* Cabecera pegajosa: pasos + total en curso, siempre a la vista (también con el teclado abierto, compactada). */}
      {stepName !== "done" && (
        <div className="pos-sticky">
          <ol className="pos-steps" aria-label={t("adm.pos.steps.label")} style={{ "--pos-steps": STEPS.length - 1 }}>
            {STEPS.slice(0, -1).map((s, i) => (
              <li key={s} className={i === step ? "on" : i < step ? "ok" : ""}>
                <button type="button" className="pos-step-btn" disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
                  aria-label={`${t("adm.pos.steps.of", { n: i + 1, total: STEPS.length - 1 })}: ${t(`adm.pos.step.${s}`)}`}>
                  <span className="pos-step-n" aria-hidden="true">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
                  <span className="pos-step-txt">{t(`adm.pos.step.${s}`)}</span>
                </button>
                {i === step && STEP_HELP[s] && <HelpTip topic={STEP_HELP[s]} size={16} />}
              </li>
            ))}
          </ol>
          {step >= QUOTE_FROM && (
            <PosRunningTotal quote={q?.quote || null} status={qStatus} lines={lines} catalog={catalog} money={m} beforeLenses={step < RX_FROM} />
          )}
        </div>
      )}

      <div className={`adm-card pos-card ${frameListOpen ? "ac-open" : ""}`}>
        {stepName === "customer" && (
          <>
            <div className="pos-cust-grid">
            <div className="pos-cust-main">
            <label className="pos-search">
              <Icon name="search" size={16} />
              <input type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={80} value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder={t("adm.pos.cust.search")} aria-label={t("adm.pos.cust.search")} />
            </label>
            {custHits.length > 0 && (
              <ul className="pos-hits">
                {custHits.map((c) => (
                  <li key={c.id}><button type="button" onClick={() => pickCustomer(c)}>
                    <b>{[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email}</b>
                    <small className="muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</small>
                  </button></li>
                ))}
              </ul>
            )}
            {!customerId && dupNotices.map((k) => {
              const c = dup[k].hit;
              const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || c.phone || "";
              return (
                <div key={k} className="pos-dup" role="status">
                  <Icon name="info" size={15} />
                  <span>{t(`adm.pos.dup.${k}`, { name })}<small className="muted">{[k === "phone" ? c.email : c.phone].filter(Boolean).join("")}</small></span>
                  <span className="pos-dup-actions">
                    <button type="button" className="btn-xs primary" onClick={() => pickCustomer(c)}><Icon name="user" size={12} /> {t("adm.pos.dup.use")}</button>
                    <button type="button" className="btn-xs" onClick={() => dismissDup(k)}>{t("adm.pos.dup.other")}</button>
                  </span>
                </div>
              );
            })}
            <div className="pos-form">
              <label>{t("adm.pos.cust.first")}<input maxLength={LIMITS.name} value={customer.first_name} onChange={setC("first_name")} autoComplete="off" autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="next" {...custField("first_name").props} /><FieldError error={custField("first_name").problem} /></label>
              <label>{t("adm.pos.cust.last")}<input maxLength={LIMITS.name} value={customer.last_name} onChange={setC("last_name")} autoComplete="off" autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="next" {...custField("last_name").props} /><FieldError error={custField("last_name").problem} /></label>
              <label>{t("adm.pos.cust.email")}<input type="email" inputMode="email" maxLength={LIMITS.email} value={customer.email} onChange={setC("email", typedEmail)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" {...custField("email").props} /><FieldError error={custField("email").problem} /></label>
              <label>{t("adm.pos.cust.phone")}<input type="tel" inputMode="tel" maxLength={LIMITS.phone} value={customer.phone} onChange={setC("phone", typedPhone)} autoComplete="off" enterKeyHint="next" {...custField("phone").props} /><FieldError error={custField("phone").problem} /></label>
              <label>
                <span className="pos-birth-lbl">
                  {t("adm.pos.cust.birth")}
                  {/* La edad ya calculada, al lado: el dato con el que de verdad se trabaja. */}
                  {ageFrom(customer.birth_date) !== null && <b className="pos-age">{t("adm.pos.cust.age", { n: ageFrom(customer.birth_date) })}</b>}
                </span>
                <input type="date" autoComplete="off" max={birthMax()} value={customer.birth_date} onChange={setC("birth_date")} {...custField("birth_date").props} />
                <FieldError error={custField("birth_date").problem} />
              </label>
            </div>
            </div>
            <div className="pos-cust-side">
              {customerId && (
                <div className="pos-picked">
                  <Icon name="user" size={14} /> {t("adm.pos.cust.existing")}
                  {custInfo?.sales?.length ? ` · ${t("adm.pos.cust.purchases", { n: custInfo.sales.length })}` : ""}
                  <button type="button" className="btn-xs" onClick={newCustomer}>{t("adm.pos.cust.new")}</button>
                </div>
              )}
            <details className="pos-address" ref={addressRef}>
              <summary>{t("adm.pos.cust.address")}</summary>
              <div className="pos-form">
                <label>{t("adm.pos.cust.address1")}<AddressInput maxLength={LIMITS.street} value={customer.address_1} onChange={setC("address_1")} {...custField("address_1").props} onPick={(p) => setCustomer((c) => ({ ...c, address_1: p.area ? "" : p.address_1 || c.address_1, city: p.city || c.city, province: p.state || c.province, postal_code: p.postal_code || c.postal_code }))} /><FieldError error={custField("address_1").problem} /></label>
                <label>{t("adm.pos.cust.city")}<input maxLength={LIMITS.city} value={customer.city} onChange={setC("city")} autoComplete="off" autoCapitalize="words" enterKeyHint="next" {...custField("city").props} /><FieldError error={custField("city").problem} /></label>
                <label>{t("adm.pos.cust.state")}<input maxLength={LIMITS.state} value={customer.province} onChange={setC("province")} autoComplete="off" autoCapitalize="characters" enterKeyHint="next" {...custField("province").props} /><FieldError error={custField("province").problem} /></label>
                <label>{t("adm.pos.cust.zip")}<AddressInput mode="zip" inputMode="numeric" maxLength={LIMITS.zip} value={customer.postal_code} onChange={setC("postal_code", typedZip)} {...custField("postal_code").props} onPick={(p) => setCustomer((c) => ({ ...c, city: p.city || c.city, province: p.state || c.province, postal_code: p.postal_code || c.postal_code }))} /><FieldError error={custField("postal_code").problem} /></label>
              </div>
            </details>
            <fieldset className="pos-wears">
              <legend>{t("adm.pos.cust.wears")}</legend>
              <label><input type="radio" checked={wears === true} onChange={() => setWears(true)} /> {t("adm.pos.yes")}</label>
              <label><input type="radio" checked={wears === false} onChange={() => setWears(false)} /> {t("adm.pos.no")}</label>
              <FieldError error={showCustErrors && wears === null ? "val.wears" : null} />
            </fieldset>
            </div>
            </div>
            {/* Usa espejuelos: se mide lo que usa hoy aquí mismo, para compararlo con la receta nueva
                y ver si la vista ha empeorado (aviso de cambio óptico en Precio y en el recibo). */}
            {wears && (
              <div className="pos-worn-now">
                <p className="adm-sub">{t("adm.pos.worn.hint")}</p>
                <h3>{t("adm.pos.rx.worn")}<HelpTip topic="pos.rx.worn" /></h3>
                {custInfo?.last_prescription && <small className="muted">{t("adm.pos.rx.proposed")}</small>}
                {/* Misma cuadrícula que la receta nueva; aquí la altura no es obligatoria (el lensómetro no la da). */}
                <RxForm mode="worn" idp="worn" value={rxWorn} onChange={setRxWorn} type={rxWorn.type} errors={wornCheck.errors} warnings={wornCheck.warnings}
                  showErrors={showCustErrors || rxFilled(rxWorn)} showMissingDate={showCustErrors} worn={worn} onWornChange={setWorn} wornFrame={wornFrame} onWornFrameChange={setWornFrame} history={custInfo?.history || []} />
              </div>
            )}
          </>
        )}

        {stepName === "frame" && (
          <>
            {/* Una sola montura por venta: del inventario o la del cliente. Elegida una, las dos vías se cierran hasta quitarla. */}
            {lines.length === 0 ? (
              <>
                {/* ¿De dónde sale la montura? Tres formas, una sola montura por venta. */}
                <p className="pos-frame-mode-title">{t("adm.pos.fm.label")}<HelpTip topic="pos.ownFrame" /></p>
                <div className="pos-frame-mode" role="radiogroup" aria-label={t("adm.pos.fm.label")}>
                  {FRAME_MODES.map((fm) => (
                    <button key={fm.key} type="button" role="radio" aria-checked={frameMode === fm.key} className={frameMode === fm.key ? "on" : ""} onClick={() => { setFrameMode(fm.key); setOwnTried(false); }}>
                      <Icon name={fm.icon} size={18} />
                      <span><b>{t(`adm.pos.fm.${fm.key}`)}</b><small>{t(`adm.pos.fm.${fm.key}.hint`)}</small></span>
                    </button>
                  ))}
                </div>
                {frameMode === "catalog" && ownTried && <div className="pos-frame-missing" role="alert"><Icon name="alert" size={15} /> {t("adm.pos.fm.pickFirst")}</div>}
                {frameMode === "catalog" && <PosFrameSearch storeId={store?.id} money={m} onAdd={addFrame} onOpenChange={setFrameListOpen} onView={viewFrame} />}
                {frameMode !== "catalog" && (
                  <div className={`pos-own ${frameMode === "store" ? "is-store" : ""}`}>
                    {/* Marca, modelo, color y las 3 medidas de la varilla (ancho del lente – puente – varilla) para el laboratorio. */}
                    <div className="pos-own-grid">
                      <label className={nameBad ? "err" : ""}><span>{t("adm.pos.own.brand")}{frameMode === "store" && <i className="pos-req"> *</i>}</span><input maxLength={60} aria-invalid={nameBad || undefined} value={own.brand} onChange={(e) => setOwn((o) => ({ ...o, brand: e.target.value }))} placeholder={t("adm.pos.own.brandPh")} autoCapitalize="words" enterKeyHint="next" /></label>
                      <label className={nameBad ? "err" : ""}>{t("adm.pos.own.model")}<input maxLength={60} aria-invalid={nameBad || undefined} value={own.model} onChange={(e) => setOwn((o) => ({ ...o, model: e.target.value }))} placeholder={t("adm.pos.own.modelPh")} autoCapitalize="characters" enterKeyHint="next" /></label>
                      <label>{t("adm.pos.own.color")}<input maxLength={40} value={own.color} onChange={(e) => setOwn((o) => ({ ...o, color: e.target.value }))} placeholder={t("adm.pos.own.colorPh")} autoCapitalize="sentences" enterKeyHint="next" /></label>
                    </div>
                    {nameBad && <small className="field-err pos-own-err" role="alert">{t(frameMode === "store" ? "adm.err.pos.store_frame_needs_name" : "adm.pos.own.needDescription")}</small>}
                    <fieldset className="pos-own-size">
                      <legend>{t("adm.pos.own.size")} <small className="muted">{t("adm.pos.own.sizeHint")}</small></legend>
                      {Object.keys(OWN_SIZE).map((k) => (
                        <label key={k} className={ownSizeBad(k, own[k]) ? "err" : ""}>
                          {t(`adm.pos.own.${k}`)}
                          <span className="pos-own-mm">
                            <input inputMode="decimal" maxLength={5} value={own[k]} placeholder={OWN_SIZE[k][2]} aria-invalid={ownSizeBad(k, own[k]) || undefined}
                              onChange={(e) => setOwn((o) => ({ ...o, [k]: e.target.value.replace(/[^\d.,]/g, "") }))} enterKeyHint="next" />
                            <small>mm</small>
                          </span>
                          {ownSizeBad(k, own[k]) && <small className="field-err" role="alert">{t("adm.pos.own.range", { min: OWN_SIZE[k][0], max: OWN_SIZE[k][1] })}</small>}
                        </label>
                      ))}
                    </fieldset>
                    {frameMode === "store" && (
                      <label className={`pos-store-price ${priceBad ? "err" : ""}`}>
                        <span>{t("adm.pos.store.price")}<i className="pos-req"> *</i></span>
                        <span className="pos-money-in"><b>$</b>
                          <input inputMode="decimal" maxLength={9} value={own.price} placeholder="0.00" aria-invalid={priceBad || undefined}
                            onChange={(e) => setOwn((o) => ({ ...o, price: e.target.value.replace(/[^\d.]/g, "") }))} enterKeyHint="done" />
                        </span>
                        {storePriceBad(own.price) ? <small className="field-err" role="alert">{t("adm.pos.store.priceRange", { max: STORE_PRICE_MAX })}</small> : priceBad ? <small className="field-err" role="alert">{t("adm.pos.store.priceMissing")}</small> : <small className="muted">{t("adm.pos.store.priceHint")}</small>}
                      </label>
                    )}
                    <label>{t("adm.pos.own.notes")}<input maxLength={160} value={own.description} onChange={(e) => setOwn((o) => ({ ...o, description: e.target.value }))} placeholder={t(frameMode === "store" ? "adm.pos.store.notesPh" : "adm.pos.own.placeholder")} autoCapitalize="sentences" enterKeyHint="done" /></label>
                    {/* Cámara trasera o galería; vista previa con «Repetir foto». La foto se reduce en photoDataUrl (imagePrep). */}
                    {frameMode === "store" && <span className="pos-store-photo-title">{t("adm.pos.store.photoTitle")}</span>}
                    <PosCapture onFile={onOwnPhoto} preview={own.photo} cameraLabel={t("adm.pos.own.photo")} fileLabel={t("adm.pos.own.file")}
                      onClear={() => setOwn((o) => ({ ...o, photo: null }))} previewAlt={t("adm.pos.own.tag")} />
                    <small className="muted">{t(frameMode === "store" ? "adm.pos.store.hint" : "adm.pos.own.hint")}</small>
                    <button type="button" className="btn-sm primary" onClick={addOwn}>{t(frameMode === "store" ? "adm.pos.store.save" : "adm.pos.own.save")}</button>
                  </div>
                )}
              </>
            ) : <small className="muted">{t("adm.pos.frame.onlyOne")}</small>}
            <ul className="pos-lines">
              {lines.map((l) => l.kind === "frame" ? (
                <li key={l.key} className="pos-line-card">
                  <PosFrameCard frame={l} money={m} onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    onChangeColor={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, variant_id: v.id, variant_title: v.title, color: v.color ?? v.title, sku: v.sku ?? null, barcode: v.barcode ?? null, image: v.image || x.images?.[0] || null } : x)))} />
                </li>
              ) : (
                <li key={l.key} className={l.kind === "store_frame" ? "is-store" : ""}>
                  <PosFramePhoto line={l} />
                  <span>
                    <b>{t(l.kind === "store_frame" ? "adm.pos.store.tag" : "adm.pos.own.tag")}</b> <small className="muted">{l.title || l.description}</small>
                    <small className={`pos-frame-charge ${l.kind === "store_frame" ? "paid" : "free"}`}>{l.kind === "store_frame" ? t("adm.pos.store.charged", { v: m(l.store_price) }) : t("adm.pos.own.notCharged")}</small>
                  </span>
                  <button type="button" className="btn-xs warn" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t("adm.pos.remove")} title={t("adm.pos.remove")}><Icon name="trash" size={12} /></button>
                </li>
              ))}
            </ul>
          </>
        )}

        {stepName === "rx" && (
          <>
            {frameCards}
            <label className="pos-check">
              <input type="checkbox" checked={noRx} onChange={(e) => setNoRx(e.target.checked)} /> {t("adm.pos.rx.none")}
            </label>
            {noRx && lines.some((l) => l.kind === "own_frame") && <div className="adm-demo-banner">{t("adm.err.pos.own_frame_needs_lenses")}</div>}
            {!noRx && (
              <div className="pos-rx-layout">
                {/* Apaisada: la receta a la izquierda y la foto (con su vista previa) a la derecha; vertical: la foto primero. */}
                <aside className="pos-rx-aside">
                  <div className="pos-rx-ocr">
                    {/* Dos entradas: la cámara de la tablet o una foto/PDF ya guardado (galería o archivos). */}
                    <PosCapture onFile={onOcr} accept="image/*,application/pdf" busy={ocr.status === "loading"} busyLabel={t("adm.pos.rx.reading")}
                      cameraLabel={t("adm.pos.rx.takePhoto")} fileLabel={t("adm.pos.rx.upload")} previewAlt={t("adm.pos.cap.preview")} />
                    <HelpTip topic="pos.rx.ocr" size={16} />
                  </div>
                  {wears && (
                    <div className="pos-worn-summary">
                      <span><b>{t("adm.pos.rx.worn")}</b> · {t("adm.pos.worn.takenInStep1")}</span>
                      <small className="muted">{wornSummary}</small>
                      <button type="button" className="btn-xs" onClick={() => setStep(0)}><Icon name="edit" size={12} /> {t("adm.pos.worn.edit")}</button>
                    </div>
                  )}
                </aside>
                <div className="pos-rx-main">
                  <div className="pos-rx-head">
                    <h3>{t("adm.pos.rx.new")}</h3>
                  </div>
                  {ocr.status === "done" && !ocr.confirmed && (
                    <div className="pos-ocr">
                      {t("adm.pos.rx.review")}
                      <button type="button" className="btn-xs primary" onClick={() => setOcr((o) => ({ ...o, confirmed: true }))}>{t("adm.pos.rx.confirm")}</button>
                    </div>
                  )}
                  <RxForm mode="new" idp="new" value={rxNew} onChange={setRxNew} type={rxNew.type} errors={rxCheck.errors} warnings={rxCheck.warnings}
                    showErrors={rxFilled(rxNew)} source={ocr.status === "done" ? "ocr" : "manual"} disabled={ocr.status === "loading"} />
                </div>
              </div>
            )}
          </>
        )}

        {stepName === "lenses" && (
          <>
          <ul className="pos-lens-lines">
            {lines.map((l) => (
              <li key={l.key}>
                <div className="pos-lens-head">
                  <PosFramePhoto line={l} size="md" />
                  <b>{l.kind === "frame" ? `${l.title} · ${l.variant_title || ""}` : `${t(l.kind === "store_frame" ? "adm.pos.store.tag" : "adm.pos.own.tag")} · ${l.title || l.description}`}</b>
                </div>
                {l.kind === "own_frame" && !noRx && <LensPresets line={l} catalog={catalog} rxForm={rxNew} onChange={(nl) => setLines((ls) => ls.map((x) => (x.key === l.key ? nl : x)))} />}
                <LensPicker line={l} catalog={catalog} rxForm={rxNew} noRx={noRx} onChange={(nl) => setLines((ls) => ls.map((x) => (x.key === l.key ? nl : x)))} />
              </li>
            ))}
            {!noRx && isMulti(rxNew) && num(rxNew.seg_height) === null && <div className="adm-demo-banner">{t("adm.pos.lens.needSeg")}</div>}
          </ul>
          {!catalog.live && <small className="muted pos-lens-offline" title={t("adm.pos.lens.offlineListHint")}>{t("adm.pos.lens.offlineList")}</small>}
          </>
        )}

        {stepName === "price" && (
          <>
            {frameCards}
            {!q && <div className={`adm-src-note ${qStatus === "error" ? "" : "loading"}`}>{t(qStatus === "error" ? "adm.pos.flow.pending" : "adm.ord.loading")}</div>}
            {q && qStatus === "error" && <div className="adm-demo-banner"><Icon name="alert" size={14} /> {t("adm.pos.flow.stale")}</div>}
            {q && (
              <>
                <table className="adm-table responsive pos-quote">
                  <thead><tr><th>{t("adm.pos.price.item")}</th><th>{t("adm.pos.price.list")}</th><th>{t("adm.pos.price.tax")}</th><th>{t("adm.pos.price.total")}</th></tr></thead>
                  <tbody>
                    {q.quote.lines.map((l, i) => (
                      <tr key={i} className={l.below_minimum ? "warn" : ""}>
                        <td data-label={t("adm.pos.price.item")}>{l.kind === "own_frame" ? t("adm.pos.own.tag") : l.kind === "store_frame" ? `${t("adm.pos.store.tag")} · ${l.title}` : l.title}{l.variant_title ? ` · ${l.variant_title}` : ""}{l.below_minimum && <small className="pos-flag"> {t("adm.pos.price.belowMin")}</small>}{promoOf(l) && <small className="pos-sum-promo pos-promo-line">{t("adm.pm.promoBefore")} <s>{m(promoOf(l).before)}</s> · {t("adm.pm.promoTag", { pct: promoOf(l).pct })}</small>}</td>
                        <td data-label={t("adm.pos.price.list")}>{m(l.list)}</td>
                        <td data-label={t("adm.pos.price.tax")}>{l.tax_amount ? m(l.tax_amount) : "—"}</td>
                        <td data-label={t("adm.pos.price.total")}><b>{m(l.unit_price)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pos-discount">
                  <label><span>{t("adm.pos.price.discount")}<HelpTip topic="pos.step.price" /></span><input inputMode="decimal" enterKeyHint="done" autoComplete="off" maxLength={5} value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></label>
                  <small className="muted">{ctx.discount_limit_pct == null ? t("adm.pos.price.noLimit") : t("adm.pos.price.limit", { n: ctx.discount_limit_pct })}</small>
                </div>
                <dl className="pos-totals">
                  <dt>{t("adm.pos.price.listTotal")}</dt><dd>{m(q.quote.list_cents / 100)}</dd>
                  {q.quote.discount_cents > 0 && <><dt>{t("adm.pos.price.discountAmt", { n: q.quote.discount_pct })}</dt><dd>−{m(q.quote.discount_cents / 100)}</dd></>}
                  {q.quote.tax_cents > 0 && <><dt>{t("adm.pos.price.tax")}</dt><dd>{m(q.quote.tax_cents / 100)}</dd></>}
                  <dt className="big">{t("adm.pos.price.total")}</dt><dd className="big">{m(q.quote.total)}</dd>
                </dl>
                {q.rx_check?.fulfillable === false && <div className="adm-demo-banner">{t("adm.err.pos.invalid_prescription")}</div>}
                <OpticalChange change={q.optical_change} />
                {q.needs_approval && (
                  <div className="pos-approval">
                    <b><Icon name="lock" size={14} /> {q.quote.below_minimum ? t("adm.pos.approval.belowMin") : t("adm.pos.approval.needed")}</b>
                    {!approval && (
                      <>
                        <input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("adm.pos.approval.reason")} aria-label={t("adm.pos.approval.reason")} autoCapitalize="sentences" enterKeyHint="send" />
                        <button type="button" className="btn-sm primary" disabled={busy} onClick={askApproval}>{t("adm.pos.approval.ask")}</button>
                      </>
                    )}
                    {approval && <span className={`pos-appr ${approval.status}`}>{t(`adm.pos.approval.status.${approval.status}`)}</span>}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {stepName === "payment" && q && (
          <>
            <PosSaleSummary customer={customer} customerId={customerId} quote={q.quote} lines={lines} catalog={catalog} rx={rxNew} noRx={noRx} approval={approval} delivery={delivery} notifyEmail={notifyEmail} receiptDetail={receiptDetail} store={store} terminal={terminal} sellerCode={ctx.seller_code} money={m} onEdit={(s) => setStep(STEPS.indexOf(s))} />
            <dl className="pos-totals">
              <dt className="big">{t("adm.pos.price.total")}</dt><dd className="big">{m(total)}</dd>
            </dl>
            {payRows.map((p, i) => {
              const meth = methods.find((x) => x.code === p.method_code);
              const othersCents = payRows.reduce((sum, x, j) => sum + (j === i || x.suggested ? 0 : toCents(x.amount)), 0);
              const set = (patch) => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const tendered = Number(p.details.tendered) || 0;
              return (
                <div key={i} className="pos-pay">
                  <select value={p.method_code} onChange={(e) => set({ method_code: e.target.value, details: {} })} aria-label={t("adm.pos.pay.method")} title={t("adm.pos.pay.method")}>
                    <option value="">{t("adm.pos.pay.method")}</option>
                    {methods.map((x) => <option key={x.code} value={x.code}>{methodName(x, t, lang)}</option>)}
                  </select>
                  <input inputMode="decimal" autoComplete="off" enterKeyHint="done" maxLength={LIMITS.amount} value={p.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") })} placeholder={t("adm.pos.pay.amount")} aria-label={t("adm.pos.pay.amount")} />
                  <button type="button" className="btn-xs" onClick={() => set({ amount: centsText(toCents(total) - othersCents) })}>{t("adm.pos.pay.rest")}</button>
                  {meth?.reference_fields?.map((f) => (
                    <input key={f.key} maxLength={f.key === "last4" ? 4 : 80} inputMode={f.key === "last4" ? "numeric" : undefined} autoComplete="off" autoCorrect="off" spellCheck={false} value={p.details[f.key] || ""} onChange={(e) => set({ details: { ...p.details, [f.key]: f.key === "last4" ? e.target.value.replace(/\D/g, "") : e.target.value } })}
                      placeholder={`${meth.builtin ? t(`adm.pos.ref.${f.key}`) : (lang === "en" && f.label_en) || f.label || f.key}${f.required ? " *" : ""}`}
                      aria-label={meth.builtin ? t(`adm.pos.ref.${f.key}`) : f.label || f.key} />
                  ))}
                  {meth?.counts_as_cash && (
                    <>
                      <input inputMode="decimal" autoComplete="off" enterKeyHint="done" maxLength={LIMITS.amount} value={p.details.tendered || ""} onChange={(e) => set({ details: { ...p.details, tendered: e.target.value.replace(/[^\d.]/g, "") } })} placeholder={t("adm.pos.pay.tendered")} aria-label={t("adm.pos.pay.tendered")} />
                      {tendered > 0 && <small className="pos-change-due">{t("adm.pos.pay.change", { v: m(Math.max(0, tendered - (Number(p.amount) || 0))) })}</small>}
                    </>
                  )}
                  <FieldError error={rowProblem(p)} />
                  {p.suggested && p.amount && <small className="muted pos-pay-note">{t("adm.pos.pay.suggested")}</small>}
                  {payments.length > 1 && <button type="button" className="btn-xs warn" onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))} aria-label={t("adm.pos.remove")} title={t("adm.pos.remove")}><Icon name="trash" size={12} /></button>}
                </div>
              );
            })}
            {payments.length < 6 && <button type="button" className="btn-sm" onClick={() => setPayments((ps) => [...ps, EMPTY_PAYMENT])}><Icon name="plus" size={14} /> {t("adm.pos.pay.another")}</button>}
            <dl className="pos-totals">
              <dt>{t("adm.pos.pay.paid")}</dt><dd>{m(payState.paid)}</dd>
              {payState.ins > 0 && <><dt>{t("adm.pos.pay.insurance")}</dt><dd>{m(payState.ins)}</dd></>}
              <dt className="big">{t("adm.pos.pay.balance")}<HelpTip topic="pos.step.payment" /></dt><dd className={`big ${payState.balance < 0 ? "neg" : ""}`}>{m(payState.balance)}</dd>
            </dl>
            {payState.balance < 0 && <div className="adm-demo-banner">{t("adm.err.pos.overpaid")}</div>}
            <fieldset className="pos-wears">
              <legend>{t("adm.pos.pay.delivery")}</legend>
              <label><input type="radio" checked={delivery === "pickup"} onChange={() => setDelivery("pickup")} /> {t("adm.pos.pay.pickup")}</label>
              <label><input type="radio" checked={delivery === "ship"} onChange={() => setDelivery("ship")} /> {t("adm.pos.pay.ship")}</label>
            </fieldset>
            {delivery === "ship" && !(customer.address_1 && customer.city && customer.postal_code) && <div className="adm-demo-banner">{t("adm.err.pos.address_required_to_ship")}</div>}
            <WearingCaptureCard value={wear} onChange={setWear} busy={busy} />
            <label className="pos-check"><input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} /> {t("adm.pos.pay.notify")}</label>
            {notifyEmail && (
              <div className="pos-receipt-detail">
                <label className="pos-check"><input type="checkbox" checked={receiptDetail} onChange={(e) => setReceiptDetail(e.target.checked)} /> {t("adm.pos.pay.notifyDetail")}</label>
                <small className="muted">{t(receiptDetail ? "adm.pos.pay.notifyDetailOn" : "adm.pos.pay.notifySimple")}</small>
              </div>
            )}
          </>
        )}

        {stepName === "done" && result && (
          <div className="pos-done">
            <Icon name="checkCircle" size={40} />
            <h3>{t("adm.pos.done.title", { n: result.number })}</h3>
            <dl className="pos-totals">
              <dt>{t("adm.pos.price.total")}</dt><dd>{m(result.total)}</dd>
              <dt>{t("adm.pos.pay.paid")}</dt><dd>{m(result.paid)}</dd>
              {result.insurance > 0 && <><dt>{t("adm.pos.pay.insurance")}</dt><dd>{m(result.insurance)}</dd></>}
              <dt className="big">{t("adm.pos.pay.balance")}</dt><dd className="big">{m(result.balance)}</dd>
              {result.tray && <><dt>{t("adm.pos.done.tray")}</dt><dd><b>{result.tray}</b></dd></>}
              {result.rx_number && <><dt>{t("adm.pos.done.rx")}</dt><dd>{result.rx_number}</dd></>}
              {result.promised_on && <><dt>{t("adm.pos.done.promised")}</dt><dd>{result.promised_on}</dd></>}
            </dl>
            {wearSaved && (
              <p className={`pos-wear-status ${wearSaved}`}>
                <Icon name={wearSaved === "failed" ? "alert" : wearSaved === "saved" ? "camera" : "clock"} size={14} />{" "}
                {t(wearSaved === "failed" ? "adm.wear.saleNoPhoto" : wearSaved === "saved" ? "adm.wear.saved" : "adm.wear.saving")}
              </p>
            )}
            {result.frame_photo_failed && (
              <p className="pos-wear-status failed">
                <Icon name="alert" size={14} /> {t("adm.pos.own.photoNotSaved")}
              </p>
            )}
            <OpticalChange change={result.optical_change} />
            <SaleDocuments saleId={result.id} printer={terminal?.printer} localPhotos={result.frame_photos} />
            <button type="button" className="btn-sm primary" onClick={reset}><Icon name="plus" size={14} /> {t("adm.pos.done.new")}</button>
          </div>
        )}
      </div>

      {stepName !== "done" && (
        <div className="pos-nav pos-nav-sticky">
          <button type="button" className="btn-sm" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}><Icon name="chevronLeft" size={14} /> {t("adm.pos.back")}</button>
          {stepName === "payment" ? (
            <button type="button" className="btn-sm primary big" disabled={!canNext() || busy} onClick={confirmSale}>
              {busy ? t("adm.pos.confirming") : t("adm.pos.confirm", { total: m(total) })}
            </button>
          ) : (
            <button type="button" className={`btn-sm primary ${canNext() ? "" : "is-blocked"}`} disabled={stepName !== "customer" && !(stepName === "frame" && !lines.length) && !canNext()} onClick={next}>{t("adm.pos.next")} <Icon name="chevronRight" size={14} /></button>
          )}
        </div>
      )}
      {terminal && <p className="muted pos-foot">{terminal.code} · {me?.email || ""}</p>}
      {cardProduct && <AdminFrameCard product={cardProduct} onClose={() => setCardProduct(null)} />}
    </div>
  );
}
