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
} from "./posApi.js";
import SaleDocuments from "./SaleDocuments.jsx";
import PosFrameSearch from "./PosFrameSearch.jsx";
import PosFramePhoto from "./PosFramePhoto.jsx";
import PosFrameCard, { frameLineFields } from "./PosFrameCard.jsx";
import { setActiveStore } from "./useStoreTheme.js";
import AdminFrameCard from "./AdminFrameCard.jsx";
import { useCatalog } from "../data/catalogStore.js";
import FieldError from "../components/FieldError.jsx";
import PosSaleSummary, { PosRunningTotal } from "./PosSaleSummary.jsx";
import { customerProblems, emailProblem, LIMITS, paymentProblem, phoneProblem, typedEmail, typedPhone, typedZip } from "../data/fieldRules.js";
import "./pos.css";
import RxForm from "./PosRx.jsx";
import HelpTip from "./HelpTip.jsx";
import { EMPTY_RX, EYE_FIELDS, binocularPd, inferType, normalizeField, splitPd, validateRx } from "./rxRules.js";

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
const EMPTY_OWN = { open: false, description: "", photo: null };
// Móvil o tablet: en un ordenador `capture` no abre la cámara, solo repetiría el selector de archivos.
const hasTouchCamera = () => window.matchMedia?.("(pointer: coarse)").matches === true;
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

/** Receta del formulario → forma que espera el servidor (números o null). El tipo
 *  (monofocal/multifocal) no viaja: el servidor lo deduce de la adición.
 *  `verified` es si una persona revisó los valores: una receta tecleada a mano
 *  siempre lo está; una leída de la foto solo cuando el vendedor pulsó
 *  «Confirmar» (antes se mandaba `true` siempre y el servidor no podía
 *  distinguirlas; ahora rechaza una lectura OCR sin confirmar: `rx_unconfirmed`). */
function toRx(form, source = "manual", verified = true) {
  const eye = (e) => ({ sph: num(e.sph), cyl: num(e.cyl), axis: num(e.axis), add: num(e.add), prism: num(e.prism), base: e.base || null });
  const pd_od = num(form.pd_od); const pd_os = num(form.pd_os);
  const pd = binocularPd(form) ?? (pd_od == null && pd_os == null ? num(form.pd) : null);
  return { od: eye(form.od), os: eye(form.os), pd, pd_od, pd_os, seg_height: num(form.seg_height), source, verified_by_user: verified === true, file_url: form.file_url || null };
}
/** Receta guardada (o leída de la foto) → formulario, ya con el formato de la hoja. */
const fromRx = (rx) => {
  const eye = (e) => Object.fromEntries(EYE_FIELDS.map((k) => [k, k === "base" ? (e?.base || "") : e?.[k] == null ? "" : normalizeField(k, e[k]) || String(e[k])]));
  const form = { ...EMPTY_RX, od: eye(rx?.od), os: eye(rx?.os), ...splitPd(rx), pd: rx?.pd == null ? "" : String(rx.pd), seg_height: rx?.seg_height == null ? "" : normalizeField("seg_height", rx.seg_height), rx_date: "", file_url: rx?.file_url || "" };
  return { ...form, type: inferType(form) };
};
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
          {line.kind === "frame" && <option value="frame-only">{t("adm.pos.lens.frameOnly")}</option>}
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
  const catalog = useAdminLensCatalog(storeId);
  const [terminalId, setTerminalId] = useState("");
  const [step, setStep] = useState(0);
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
  const [result, setResult] = useState(null);
  const idem = useRef(null);

  useEffect(() => {
    posContext()
      .then((c) => {
        setCtx(c);
        const saved = read("pos_store");
        const s = c.stores.find((x) => x.id === saved) || c.stores[0];
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
  const addOwn = () => {
    if (!own.description.trim()) { toast({ tone: "error", title: t("adm.pos.own.needDescription") }); return; }
    setLines([{ key: `own-${Date.now()}`, kind: "own_frame", variant_id: null, title: own.description, description: own.description, photo: own.photo, selection: { design_code: "sv", material_code: null, photo_code: null, ar_code: null, finish: "stock" } }]);
    setOwn(EMPTY_OWN);
  };
  const onOwnPhoto = async (e) => {
    const f = e.target.files?.[0];
    // Sin esto, volver a elegir el mismo archivo no dispara onChange.
    e.target.value = "";
    if (!f) return;
    try { setOwn((o) => ({ ...o, photo: null })); const url = await photoDataUrl(f); setOwn((o) => ({ ...o, photo: url })); } catch (err) { toast({ tone: "error", title: t(err.message) }); }
  };
  const onOcr = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
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
      const fits = d === "frame-only" ? l.kind === "frame" : catalog.DESIGNS.some((x) => x.id === d && (multi ? x.cat !== "sv" : x.cat === "sv"));
      if (fits && !(l.kind === "frame" && d === "frame-only" && l.touched !== true && !noRx)) return l;
      const first = catalog.DESIGNS.find((x) => (multi ? x.cat === "prog" : x.cat === "sv"));
      const power = maxPower(rxNew);
      const mat = catalog.MATERIALS.find((m) => power <= m.maxAbs) || catalog.MATERIALS[catalog.MATERIALS.length - 1];
      return { ...l, touched: true, selection: { design_code: first?.id || "sv", material_code: mat?.id || null, photo_code: null, ar_code: null, finish: finishFor(catalog, first?.id || "sv") } };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const apiLines = () => lines.map((l) => ({ kind: l.kind, variant_id: l.variant_id, selection: l.selection, description: l.description || null, photo: l.photo || null }));
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
      setResult({ ...r.sale, optical_change: r.sale.optical_change || q?.optical_change || null });
      setStep(STEPS.indexOf("done"));
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const reset = () => {
    idem.current = null;
    setStep(0); setTouched({}); setShowCustErrors(false); setCustomer(EMPTY_CUSTOMER); setCustomerId(null); setCustInfo(null); setWears(null);
    setLines([]); setNoRx(false); setRxNew(EMPTY_RX); setRxWorn(EMPTY_RX); setOcr({ status: "idle", confirmed: true });
    setWorn({ source: "previous_rx", dateMode: "exact", date: "", months: "" });
    setDiscount(""); setQ(null); setQStatus("idle"); setApproval(null); setReason("");
    setDup({ phone: null, email: null }); dupDismissed.current = { phone: new Set(), email: new Set() };
    setPayments([EMPTY_PAYMENT]); setDelivery("pickup"); setNotifyEmail(true); setReceiptDetail(false); setResult(null);
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
    <div className="adm-section pos">
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

      {stepName !== "done" && (
        <ol className="pos-steps">
          {STEPS.slice(0, -1).map((s, i) => (
            <li key={s} className={i === step ? "on" : i < step ? "ok" : ""}>
              <button type="button" disabled={i > step} onClick={() => setStep(i)}>{i + 1}. {t(`adm.pos.step.${s}`)}</button>
              {i === step && STEP_HELP[s] && <HelpTip topic={STEP_HELP[s]} />}
            </li>
          ))}
        </ol>
      )}

      {stepName !== "done" && step >= QUOTE_FROM && (
        <PosRunningTotal quote={q?.quote || null} status={qStatus} lines={lines} catalog={catalog} money={m} beforeLenses={step < RX_FROM} />
      )}

      <div className={`adm-card pos-card ${frameListOpen ? "ac-open" : ""}`}>
        {stepName === "customer" && (
          <>
            <label className="pos-search">
              <Icon name="search" size={16} />
              <input maxLength={80} value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder={t("adm.pos.cust.search")} aria-label={t("adm.pos.cust.search")} />
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
            {customerId && (
              <div className="pos-picked">
                <Icon name="user" size={14} /> {t("adm.pos.cust.existing")}
                {custInfo?.sales?.length ? ` · ${t("adm.pos.cust.purchases", { n: custInfo.sales.length })}` : ""}
                <button type="button" className="btn-xs" onClick={newCustomer}>{t("adm.pos.cust.new")}</button>
              </div>
            )}
            <div className="pos-form">
              <label>{t("adm.pos.cust.first")}<input maxLength={LIMITS.name} value={customer.first_name} onChange={setC("first_name")} autoComplete="off" {...custField("first_name").props} /><FieldError error={custField("first_name").problem} /></label>
              <label>{t("adm.pos.cust.last")}<input maxLength={LIMITS.name} value={customer.last_name} onChange={setC("last_name")} autoComplete="off" {...custField("last_name").props} /><FieldError error={custField("last_name").problem} /></label>
              <label>{t("adm.pos.cust.email")}<input type="email" maxLength={LIMITS.email} value={customer.email} onChange={setC("email", typedEmail)} autoComplete="off" {...custField("email").props} /><FieldError error={custField("email").problem} /></label>
              <label>{t("adm.pos.cust.phone")}<input type="tel" inputMode="tel" maxLength={LIMITS.phone} value={customer.phone} onChange={setC("phone", typedPhone)} autoComplete="off" {...custField("phone").props} /><FieldError error={custField("phone").problem} /></label>
              <label>
                <span className="pos-birth-lbl">
                  {t("adm.pos.cust.birth")}
                  {/* La edad ya calculada, al lado: el dato con el que de verdad se trabaja. */}
                  {ageFrom(customer.birth_date) !== null && <b className="pos-age">{t("adm.pos.cust.age", { n: ageFrom(customer.birth_date) })}</b>}
                </span>
                <input type="date" max={new Date().toISOString().slice(0, 10)} value={customer.birth_date} onChange={setC("birth_date")} {...custField("birth_date").props} />
                <FieldError error={custField("birth_date").problem} />
              </label>
            </div>
            <details className="pos-address" ref={addressRef}>
              <summary>{t("adm.pos.cust.address")}</summary>
              <div className="pos-form">
                <label>{t("adm.pos.cust.address1")}<AddressInput maxLength={LIMITS.street} value={customer.address_1} onChange={setC("address_1")} {...custField("address_1").props} onPick={(p) => setCustomer((c) => ({ ...c, address_1: p.area ? "" : p.address_1 || c.address_1, city: p.city || c.city, province: p.state || c.province, postal_code: p.postal_code || c.postal_code }))} /><FieldError error={custField("address_1").problem} /></label>
                <label>{t("adm.pos.cust.city")}<input maxLength={LIMITS.city} value={customer.city} onChange={setC("city")} {...custField("city").props} /><FieldError error={custField("city").problem} /></label>
                <label>{t("adm.pos.cust.state")}<input maxLength={LIMITS.state} value={customer.province} onChange={setC("province")} {...custField("province").props} /><FieldError error={custField("province").problem} /></label>
                <label>{t("adm.pos.cust.zip")}<AddressInput mode="zip" inputMode="numeric" maxLength={LIMITS.zip} value={customer.postal_code} onChange={setC("postal_code", typedZip)} {...custField("postal_code").props} onPick={(p) => setCustomer((c) => ({ ...c, city: p.city || c.city, province: p.state || c.province, postal_code: p.postal_code || c.postal_code }))} /><FieldError error={custField("postal_code").problem} /></label>
              </div>
            </details>
            <fieldset className="pos-wears">
              <legend>{t("adm.pos.cust.wears")}</legend>
              <label><input type="radio" checked={wears === true} onChange={() => setWears(true)} /> {t("adm.pos.yes")}</label>
              <label><input type="radio" checked={wears === false} onChange={() => setWears(false)} /> {t("adm.pos.no")}</label>
              <FieldError error={showCustErrors && wears === null ? "val.wears" : null} />
            </fieldset>
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
                {!own.open && <PosFrameSearch storeId={store?.id} money={m} onAdd={addFrame} onOpenChange={setFrameListOpen} onView={viewFrame} />}
                <button type="button" className="btn-sm" onClick={() => setOwn((o) => ({ ...o, open: !o.open }))}>
                  <Icon name={own.open ? "barcode" : "camera"} size={14} /> {t(own.open ? "adm.pos.own.useStock" : "adm.pos.own.add")}
                </button>
                <HelpTip topic="pos.ownFrame" />
                {own.open && (
                  <div className="pos-own">
                    <label>{t("adm.pos.own.description")}<input maxLength={160} value={own.description} onChange={(e) => setOwn((o) => ({ ...o, description: e.target.value }))} placeholder={t("adm.pos.own.placeholder")} /></label>
                    <div className="pos-own-photo">
                      {hasTouchCamera() && (
                        <label className="pos-file">
                          <Icon name="camera" size={16} /> {own.photo ? t("adm.pos.own.retake") : t("adm.pos.own.photo")}
                          <input type="file" accept="image/*" capture="environment" onChange={onOwnPhoto} />
                        </label>
                      )}
                      <label className="pos-file">
                        <Icon name="upload" size={16} /> {t("adm.pos.own.file")}
                        <input type="file" accept="image/*" onChange={onOwnPhoto} />
                      </label>
                    </div>
                    {own.photo && <img className="pos-own-img" src={own.photo} alt={t("adm.pos.own.tag")} />}
                    <small className="muted">{t("adm.pos.own.hint")}</small>
                    <button type="button" className="btn-sm primary" onClick={addOwn}>{t("adm.pos.own.save")}</button>
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
                <li key={l.key}>
                  <PosFramePhoto line={l} />
                  <span><b>{t("adm.pos.own.tag")}</b> <small className="muted">{l.description}</small></span>
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
              <>
                <div className="pos-rx-head">
                  <h3>{t("adm.pos.rx.new")}</h3>
                  {/* Dos entradas: la cámara del móvil o tablet, o un archivo (foto o PDF) ya guardado. */}
                  <div className="pos-rx-ocr">
                    {hasTouchCamera() && (
                      <label className="pos-file">
                        <Icon name="camera" size={16} /> {ocr.status === "loading" ? t("adm.pos.rx.reading") : t("adm.pos.rx.takePhoto")}
                        <input type="file" accept="image/*" capture="environment" onChange={onOcr} disabled={ocr.status === "loading"} />
                      </label>
                    )}
                    <label className="pos-file">
                      <Icon name="upload" size={16} /> {ocr.status === "loading" ? t("adm.pos.rx.reading") : t("adm.pos.rx.upload")}
                      <input type="file" accept="image/*,application/pdf" onChange={onOcr} disabled={ocr.status === "loading"} />
                    </label>
                    <HelpTip topic="pos.rx.ocr" />
                  </div>
                </div>
                {ocr.status === "done" && !ocr.confirmed && (
                  <div className="pos-ocr">
                    {t("adm.pos.rx.review")}
                    <button type="button" className="btn-xs primary" onClick={() => setOcr((o) => ({ ...o, confirmed: true }))}>{t("adm.pos.rx.confirm")}</button>
                  </div>
                )}
                <RxForm mode="new" idp="new" value={rxNew} onChange={setRxNew} type={rxNew.type} errors={rxCheck.errors} warnings={rxCheck.warnings}
                  showErrors={rxFilled(rxNew)} source={ocr.status === "done" ? "ocr" : "manual"} disabled={ocr.status === "loading"} />
                {wears && (
                  <div className="pos-worn-summary">
                    <span><b>{t("adm.pos.rx.worn")}</b> · {t("adm.pos.worn.takenInStep1")}</span>
                    <small className="muted">{wornSummary}</small>
                    <button type="button" className="btn-xs" onClick={() => setStep(0)}><Icon name="edit" size={12} /> {t("adm.pos.worn.edit")}</button>
                  </div>
                )}
              </>
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
                  <b>{l.kind === "own_frame" ? `${t("adm.pos.own.tag")} · ${l.description}` : `${l.title} · ${l.variant_title || ""}`}</b>
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
                        <td data-label={t("adm.pos.price.item")}>{l.kind === "own_frame" ? t("adm.pos.own.tag") : l.title}{l.variant_title ? ` · ${l.variant_title}` : ""}{l.below_minimum && <small className="pos-flag"> {t("adm.pos.price.belowMin")}</small>}</td>
                        <td data-label={t("adm.pos.price.list")}>{m(l.list)}</td>
                        <td data-label={t("adm.pos.price.tax")}>{l.tax_amount ? m(l.tax_amount) : "—"}</td>
                        <td data-label={t("adm.pos.price.total")}><b>{m(l.unit_price)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pos-discount">
                  <label><span>{t("adm.pos.price.discount")}<HelpTip topic="pos.step.price" /></span><input inputMode="decimal" maxLength={5} value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></label>
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
                        <input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("adm.pos.approval.reason")} aria-label={t("adm.pos.approval.reason")} />
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
                  <input inputMode="decimal" maxLength={LIMITS.amount} value={p.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") })} placeholder={t("adm.pos.pay.amount")} aria-label={t("adm.pos.pay.amount")} />
                  <button type="button" className="btn-xs" onClick={() => set({ amount: centsText(toCents(total) - othersCents) })}>{t("adm.pos.pay.rest")}</button>
                  {meth?.reference_fields?.map((f) => (
                    <input key={f.key} maxLength={f.key === "last4" ? 4 : 80} inputMode={f.key === "last4" ? "numeric" : undefined} value={p.details[f.key] || ""} onChange={(e) => set({ details: { ...p.details, [f.key]: f.key === "last4" ? e.target.value.replace(/\D/g, "") : e.target.value } })}
                      placeholder={`${meth.builtin ? t(`adm.pos.ref.${f.key}`) : (lang === "en" && f.label_en) || f.label || f.key}${f.required ? " *" : ""}`}
                      aria-label={meth.builtin ? t(`adm.pos.ref.${f.key}`) : f.label || f.key} />
                  ))}
                  {meth?.counts_as_cash && (
                    <>
                      <input inputMode="decimal" maxLength={LIMITS.amount} value={p.details.tendered || ""} onChange={(e) => set({ details: { ...p.details, tendered: e.target.value.replace(/[^\d.]/g, "") } })} placeholder={t("adm.pos.pay.tendered")} aria-label={t("adm.pos.pay.tendered")} />
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
            <OpticalChange change={result.optical_change} />
            <SaleDocuments saleId={result.id} printer={terminal?.printer} />
            <button type="button" className="btn-sm primary" onClick={reset}><Icon name="plus" size={14} /> {t("adm.pos.done.new")}</button>
          </div>
        )}
      </div>

      {stepName !== "done" && (
        <div className="pos-nav">
          <button type="button" className="btn-sm" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}><Icon name="chevronLeft" size={14} /> {t("adm.pos.back")}</button>
          {stepName === "payment" ? (
            <button type="button" className="btn-sm primary big" disabled={!canNext() || busy} onClick={confirmSale}>
              {busy ? t("adm.pos.confirming") : t("adm.pos.confirm", { total: m(total) })}
            </button>
          ) : (
            <button type="button" className={`btn-sm primary ${canNext() ? "" : "is-blocked"}`} disabled={stepName !== "customer" && !canNext()} onClick={next}>{t("adm.pos.next")} <Icon name="chevronRight" size={14} /></button>
          )}
        </div>
      )}
      {terminal && <p className="muted pos-foot">{terminal.code} · {me?.email || ""}</p>}
      {cardProduct && <AdminFrameCard product={cardProduct} onClose={() => setCardProduct(null)} />}
    </div>
  );
}
