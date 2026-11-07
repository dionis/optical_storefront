// Dónde se usa: todo el panel (/admin). Ayuda contextual pensada para quien
// nunca ha trabajado en una óptica: un «?» pequeño junto a cada campo, título
// o indicador abre DIRECTAMENTE una ventana delante de la pantalla, con el
// fondo desenfocado (decisión del dueño, 7-nov-2026: el globo pequeño no
// cabía la explicación de cómo se calcula una cifra). La ventana dice:
//   título · resumen · qué es / cómo se calcula · fórmula (bloque monoespaciado)
//   · ejemplo con números · dónde se usa · cómo se hace · por qué importa ·
//   errores frecuentes, con la lista de temas relacionados para saltar entre ellos.
//
// El contenido vive en i18n/parts/help.js (y en las partes de cada módulo) bajo
// `adm.help.<tema>.<campo>`; campos: title, short, what, formula, example,
// usedIn, how, why, pitfalls (los de varias líneas van separados por "\n").
// Aquí solo está el registro de temas por grupo y la mecánica: la ventana se
// pinta por portal en `.adm-help-root`, un nodo colgado de `.adm-shell` (hereda
// los tokens --adm-* y el modo oscuro) o del body si el armazón no existe. No
// hace falta provider: el primer HelpTip montado hospeda la ventana y, si se
// desmonta, la hereda el siguiente.
//
//   <HelpTip topic="pos.rx.sph" />              «?» (14px, inline) → ventana del tema
//   <HelpTip topic="pos.rx.sph" size={16} />
//   <HelpTip title={t("…")} body={t("…")} formula="A = B − C" example={t("…")} usedIn={t("…")} />
//                                               texto propio, ya traducido por quien llama
//                                               (con `topic` además, lo propio manda y el
//                                               tema rellena lo que falte)
//   <HelpTip variant="info" … />                mismo comportamiento con el icono «i»
//   <HelpButton topic="exec.overview" />        botón de texto «Ayuda» para cabeceras
//   openHelp("cash.session")                    abre la guía desde código
//   openHelp({ title, body, formula }, el)      ídem con texto propio
import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import "./help.css";
import "./help-modal.css";

/* ───────────────────────── Registro de temas ───────────────────────── */

/** Temas por grupo, en el orden en que se listan en la ventana. */
export const HELP_GROUPS = {
  rx: ["pos.rx.howToRead", "pos.rx.type", "pos.rx.sph", "pos.rx.cyl", "pos.rx.axis", "pos.rx.add", "pos.rx.prism", "pos.rx.base", "pos.rx.pd", "pos.rx.seg", "pos.rx.ocr", "pos.rx.worn"],
  sale: ["pos.step.customer", "pos.step.frame", "pos.ownFrame", "pos.step.lenses", "pos.step.price", "pos.step.payment"],
  exec: ["exec.overview", "exec.period", "exec.storeFilter", "exec.kpi.sales", "exec.kpi.collected", "exec.kpi.balance", "exec.kpi.cost", "exec.kpi.profit", "exec.kpi.margin", "exec.orders", "exec.cash", "exec.sellers.quota", "exec.sellers.avgProfit", "exec.sellers.commission", "backlog.street", "backlog.overdue"],
  cost: ["cost.paid", "cost.net", "cost.cost", "cost.profit", "cost.target", "cost.incomplete", "cost.split", "cost.materials", "cost.percent", "cost.deductions", "cost.commission", "cost.marginChart"],
  cash: ["cash.session", "cash.movement", "cash.report", "cash.close"],
  reports: ["statement.what", "salesboard.what", "salesboard.grain", "pending.what", "storestatus.what"],
  pricing: ["price.rule", "price.override", "price.lensMatrix", "price.photo", "price.ar", "price.progressive", "price.storeVariation", "price.commission", "price.costToggle", "price.tax"],
  setup: ["stores.color", "team.roles", "posconfig.methods"],
};

/**
 * Variantes de un tema para quien no ve costos (el Ejecutivo elige una u otra
 * según `costs.view`): ocupan el sitio de su tema en la lista de relacionados,
 * nunca salen las dos (antes «Panel ejecutivo» aparecía dos veces).
 */
const VARIANT_OF = { "exec.overviewPlain": "exec.overview", "exec.ordersPlain": "exec.orders" };

const GROUP_OF = {};
for (const [g, list] of Object.entries(HELP_GROUPS)) for (const topic of list) GROUP_OF[topic] = g;
for (const [variant, base] of Object.entries(VARIANT_OF)) GROUP_OF[variant] = GROUP_OF[base];

export const HELP_TOPICS = Object.keys(GROUP_OF);
export const helpGroupOf = (topic) => GROUP_OF[topic] || null;
export const hasHelpTopic = (topic) => Boolean(GROUP_OF[topic]);

/* ───────────────────── Estado compartido (sin provider) ───────────────────── */

// Lo abierto: `{ topic, custom }` — `topic` es una clave de HELP_GROUPS (o
// cualquier tema con textos en el diccionario) y `custom` el texto propio que
// pasó quien llama ({ title, body, formula, example, usedIn }, ya traducido).
let openEntry = null;
let returnTo = null; // elemento que recupera el foco al cerrar la ventana
const modalSubs = new Set();
const notify = () => { for (const fn of modalSubs) fn(openEntry); };

const CUSTOM_KEYS = ["title", "body", "formula", "example", "usedIn"];
const customOf = (src) => {
  if (!src) return null;
  const out = {};
  for (const k of CUSTOM_KEYS) if (src[k] != null && src[k] !== "") out[k] = src[k];
  return Object.keys(out).length ? out : null;
};

/**
 * Abre la ventana desde cualquier sitio (hace falta algún HelpTip o HelpButton
 * montado en la página, que es quien la hospeda). `what` es un tema
 * ("cash.session") o un objeto `{ topic?, title?, body?, formula?, example?, usedIn? }`.
 * `focusBack` es el elemento que recibe el foco al cerrar (por defecto, el activo).
 */
export function openHelp(what, focusBack) {
  if (!what) return;
  const entry = typeof what === "string" ? { topic: what, custom: null } : { topic: what.topic || null, custom: customOf(what) };
  if (!entry.topic && !entry.custom) return;
  if (openEntry == null) returnTo = focusBack || (typeof document !== "undefined" ? document.activeElement : null);
  openEntry = entry;
  notify();
}
export function closeHelp() {
  if (openEntry == null) return;
  openEntry = null;
  notify();
}

// El primer HelpTip montado hospeda la ventana (así hereda LanguageContext);
// al desmontarse, la cede al siguiente de la lista.
const hosts = new Set();
let host = null;
function adoptHost(entry) {
  hosts.add(entry);
  if (!host) { host = entry; entry.bump(); }
}
function releaseHost(entry) {
  hosts.delete(entry);
  if (host !== entry) return;
  host = hosts.values().next().value || null;
  host?.bump();
}

let container = null;
/** Nodo del portal: dentro de `.adm-shell` para heredar tokens y modo oscuro; si no, en el body. */
function getContainer() {
  if (typeof document === "undefined") return null;
  const shell = document.querySelector(".adm-shell");
  const wanted = shell || document.body;
  if (container && container.isConnected && container.parentNode === wanted) return container;
  if (container && container.isConnected) container.remove();
  container = document.createElement("div");
  container.className = "adm-help-root";
  wanted.appendChild(container);
  return container;
}

/* ───────────────────────────── Utilidades ───────────────────────────── */

/** Nodo del portal, resuelto tras montar (durante el render el armazón puede no estar aún en el DOM). */
function usePortalNode() {
  const [node, setNode] = useState(null);
  useEffect(() => { setNode(getContainer()); }, []);
  return node;
}

/** Registra este componente como posible anfitrión de la ventana de ayuda. */
function useHost() {
  const [, bump] = useReducer((x) => x + 1, 0);
  const entryRef = useRef(null);
  if (!entryRef.current) entryRef.current = { bump };
  useEffect(() => { const e = entryRef.current; adoptHost(e); return () => releaseHost(e); }, []);
  return host === entryRef.current;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const splitLines = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);
// Las guías antiguas metían la fórmula como un paso más («Fórmula: …»): con
// el bloque propio de fórmula esa línea sobraría repetida.
const FORMULA_STEP = /^(f[óo]rmula|formula)\s*:/i;

/** `t()` devuelve la clave cuando falta: así se sabe si un bloque opcional existe. */
function useHelpText() {
  const { t } = useLang();
  const text = (key) => { const s = t(key); return s === key ? "" : s; };
  return { t, text };
}

/* ───────────────────────────── Botón «?» ───────────────────────────── */

/**
 * Botón «?» que abre la ventana de ayuda. `topic` es una clave de HELP_GROUPS;
 * `title`/`body`/`formula`/`example`/`usedIn` son texto propio (ya traducido)
 * que manda sobre el del tema; `size` el diámetro (14 por defecto); `inline`
 * lo alinea con el texto que lo rodea (por defecto); `label` sustituye el
 * aria-label (por defecto «Ayuda: <título>»); `variant="info"` pinta el icono
 * «i» de los antiguos globos de tarjeta (InfoTip) con la misma ventana.
 */
export default function HelpTip({ topic, size = 14, inline = true, className = "", label, title, body, formula, example, usedIn, variant = "help" }) {
  const { t, text } = useHelpText();
  const btnRef = useRef(null);
  const isHost = useHost();
  const node = usePortalNode();
  const custom = customOf({ title, body, formula, example, usedIn });
  // Abierta ESTA ayuda: el botón lo anuncia (aria-expanded) y se marca.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e) => setOpen(Boolean(e && e.source === btnRef.current));
    modalSubs.add(on);
    return () => { modalSubs.delete(on); };
  }, []);

  if (!topic && !custom) return null;
  const heading = custom?.title || (topic ? text(`adm.help.${topic}.title`) : "");
  const onOpen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openHelp({ topic, ...(custom || {}) }, btnRef.current);
    if (openEntry) { openEntry.source = btnRef.current; notify(); }
  };
  const aria = label || (heading ? `${t("adm.help.ui.button")}: ${heading}` : t("adm.help.ui.button"));

  return (
    <>
      {variant === "info" ? (
        <button ref={btnRef} type="button" className={`adm-tip-btn adm-help-info ${open ? "on" : ""} ${className}`.trim()} aria-label={aria} aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>
          <Icon name="info" size={size > 14 ? size : 14} />
        </button>
      ) : (
        <button ref={btnRef} type="button" className={`adm-help-btn ${inline ? "inline" : ""} ${open ? "on" : ""} ${className}`.trim()}
          style={{ "--adm-help-size": `${size}px` }} aria-label={aria} aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>
          <span aria-hidden="true">?</span>
        </button>
      )}
      {isHost && node && createPortal(<HelpModalHost />, node)}
    </>
  );
}

/** Botón de texto «Ayuda» para cabeceras de sección: abre la ventana directamente. */
export function HelpButton({ topic, className = "", children, title, body, formula, example, usedIn }) {
  const { t } = useLang();
  const isHost = useHost();
  const node = usePortalNode();
  return (
    <>
      <button type="button" className={`adm-help-text ${className}`.trim()} aria-haspopup="dialog"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openHelp({ topic, title, body, formula, example, usedIn }, e.currentTarget); }}>
        <Icon name="info" size={14} /> {children || t("adm.help.ui.button")}
      </button>
      {isHost && node && createPortal(<HelpModalHost />, node)}
    </>
  );
}

/* ───────────────────────────── Ventana ───────────────────────────── */

function HelpModalHost() {
  const [entry, setEntry] = useState(openEntry);
  useEffect(() => {
    const on = (e) => setEntry(e ? { ...e } : null);
    modalSubs.add(on);
    on(openEntry);
    return () => { modalSubs.delete(on); };
  }, []);
  if (!entry) return null;
  return <HelpModal topic={entry.topic} custom={entry.custom} onNavigate={(k) => openHelp(k)} onClose={closeHelp} />;
}

function Section({ icon, label, className = "", children }) {
  return (
    <section className={`adm-help-sec ${className}`.trim()}>
      <h4><Icon name={icon} size={15} /> {label}</h4>
      {children}
    </section>
  );
}

/**
 * La ventana: centrada (720 px) en escritorio y tablet apaisada; hoja de
 * ancho completo que sube desde abajo en móvil y tablet vertical. Fondo
 * oscurecido y desenfocado. Cierra con Escape, con el fondo o con el botón;
 * mantiene el foco dentro (Tab circular) y lo devuelve a quien la abrió.
 */
export function HelpModal({ topic, custom = null, onNavigate, onClose }) {
  const { t, text } = useHelpText();
  const boxRef = useRef(null);
  const bodyRef = useRef(null);
  const group = topic ? helpGroupOf(topic) : null;
  // Un texto propio no tiene temas hermanos: la lista solo sale con un tema registrado y sin texto propio.
  const related = group && !custom ? HELP_GROUPS[group].map((k) => (VARIANT_OF[topic] === k ? topic : k)) : [];
  const tk = (f) => (topic ? text(`adm.help.${topic}.${f}`) : "");
  const title = custom?.title || tk("title");
  const short = custom?.body && !tk("what") ? "" : tk("short");
  const what = custom?.body || tk("what");
  const formula = custom?.formula || tk("formula");
  const example = custom?.example || tk("example");
  const usedIn = splitLines(custom?.usedIn || tk("usedIn"));
  const how = splitLines(tk("how")).filter((l) => !(formula && FORMULA_STEP.test(l)));
  const why = tk("why");
  const pitfalls = splitLines(tk("pitfalls"));
  const empty = !what && !formula && !how.length && !why && !example;
  const titleId = "adm-help-title";

  // Foco: entra al botón de cerrar, se queda dentro (Tab circular) y vuelve al salir.
  useEffect(() => {
    const prev = returnTo || document.activeElement;
    const box = boxRef.current;
    box?.querySelector(".adm-help-close")?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !box) return;
      const items = Array.from(box.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      if (prev && typeof prev.focus === "function" && prev.isConnected) prev.focus({ preventScroll: true });
      returnTo = null;
    };
  }, [onClose]);

  // Al saltar de tema, el texto vuelve arriba.
  useEffect(() => { bodyRef.current?.scrollTo?.({ top: 0 }); }, [topic, custom]);

  return (
    <div className="adm-help-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} className={`adm-help-modal ${related.length > 1 ? "has-nav" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="adm-help-grip" aria-hidden="true" />
        <header className="adm-help-head">
          <span className="adm-help-kicker"><Icon name="sparkles" size={14} /> {t("adm.help.ui.guide")}{group ? ` · ${t(`adm.help.group.${group}`)}` : ""}</span>
          <h3 id={titleId}>{title || t("adm.help.ui.button")}</h3>
          {short && <p className="adm-help-lead">{short}</p>}
          <button type="button" className="adm-help-close" aria-label={t("adm.help.ui.close")} onClick={onClose}><Icon name="close" size={18} /></button>
        </header>
        <div className="adm-help-grid">
          {related.length > 1 && (
            <nav className="adm-help-nav" aria-label={t("adm.help.ui.related")}>
              <small>{t("adm.help.ui.related")}</small>
              <ul>
                {related.map((k) => (
                  <li key={k}>
                    <button type="button" className={k === topic ? "on" : ""} aria-current={k === topic ? "page" : undefined} onClick={() => onNavigate(k)}>{text(`adm.help.${k}.title`) || k}</button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div ref={bodyRef} className="adm-help-body" tabIndex={-1}>
            {what && <Section icon="info" label={t(formula ? "adm.help.ui.whatCalc" : "adm.help.ui.what")}><p>{what}</p></Section>}
            {formula && (
              <Section icon="percent" label={t("adm.help.ui.formula")} className="adm-help-formula-sec">
                <pre className="adm-help-formula"><code>{formula}</code></pre>
              </Section>
            )}
            {example && <Section icon="eye" label={t("adm.help.ui.example")}><p className="adm-help-example">{example}</p></Section>}
            {usedIn.length > 0 && (
              <Section icon="layers" label={t("adm.help.ui.usedIn")}>
                <ul className="adm-help-used">{usedIn.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </Section>
            )}
            {how.length > 0 && (
              <Section icon="clipboard" label={t("adm.help.ui.how")}>
                <ol>{how.map((l, i) => <li key={i}>{l}</li>)}</ol>
              </Section>
            )}
            {why && <Section icon="zap" label={t("adm.help.ui.why")}><p>{why}</p></Section>}
            {pitfalls.length > 0 && (
              <Section icon="alert" label={t("adm.help.ui.pitfalls")}>
                <ul className="adm-help-pitfalls">{pitfalls.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </Section>
            )}
            {empty && <p className="muted">{t("adm.help.ui.missing")}</p>}
          </div>
        </div>
        <footer className="adm-help-foot">
          <button type="button" className="btn-sm primary" onClick={onClose}>{t("adm.help.ui.gotIt")}</button>
        </footer>
      </div>
    </div>
  );
}
