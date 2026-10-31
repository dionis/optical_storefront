// Dónde se usa: todo el panel (/admin). Ayuda contextual pensada para quien
// nunca ha trabajado en una óptica: un «?» pequeño junto a cada campo o título
// abre un globo de una o dos frases y, desde él, la guía completa en una
// ventana (qué es, cómo se hace, por qué importa, ejemplo, errores frecuentes)
// con la lista de temas relacionados para saltar entre ellos.
//
// El contenido vive en i18n/parts/help.js bajo `adm.help.<tema>.*`; aquí solo
// está el registro de temas por grupo (para la lista de relacionados) y la
// mecánica: popover y modal se pintan por portal en `.adm-help-root`, un nodo
// colgado de `.adm-shell` (hereda los tokens --adm-* y el modo oscuro) o del
// body si el armazón no existe. No hace falta provider: el primer HelpTip
// montado hospeda la ventana y, si se desmonta, la hereda el siguiente.
//
//   <HelpTip topic="pos.rx.sph" />              globo «?» (14px, inline)
//   <HelpTip topic="pos.rx.sph" size={16} />
//   <HelpButton topic="exec.overview" />        botón de texto «Ayuda» para cabeceras
//   openHelp("cash.session")                    abre la guía desde código
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import "./help.css";

/* ───────────────────────── Registro de temas ───────────────────────── */

/** Temas por grupo, en el orden en que se listan en la ventana. */
export const HELP_GROUPS = {
  rx: ["pos.rx.howToRead", "pos.rx.type", "pos.rx.sph", "pos.rx.cyl", "pos.rx.axis", "pos.rx.add", "pos.rx.prism", "pos.rx.base", "pos.rx.pd", "pos.rx.seg", "pos.rx.ocr", "pos.rx.worn"],
  sale: ["pos.step.customer", "pos.step.frame", "pos.ownFrame", "pos.step.lenses", "pos.step.price", "pos.step.payment"],
  exec: ["exec.overview", "exec.period", "exec.storeFilter", "exec.kpi.sales", "exec.kpi.collected", "exec.kpi.balance", "exec.kpi.cost", "exec.kpi.profit", "exec.kpi.margin", "exec.orders", "exec.cash"],
  cash: ["cash.session", "cash.movement", "cash.report"],
  reports: ["statement.what", "salesboard.what", "salesboard.grain"],
  setup: ["stores.color", "team.roles", "posconfig.methods"],
};

const GROUP_OF = {};
for (const [g, list] of Object.entries(HELP_GROUPS)) for (const topic of list) GROUP_OF[topic] = g;

export const HELP_TOPICS = Object.keys(GROUP_OF);
export const helpGroupOf = (topic) => GROUP_OF[topic] || null;
export const hasHelpTopic = (topic) => Boolean(GROUP_OF[topic]);

/* ───────────────────── Estado compartido (sin provider) ───────────────────── */

let openTopic = null;
let returnTo = null; // elemento que recupera el foco al cerrar la ventana
const modalSubs = new Set();
const notify = () => { for (const fn of modalSubs) fn(openTopic); };

/**
 * Abre la guía completa de un tema desde cualquier sitio (hace falta algún
 * HelpTip o HelpButton montado en la página, que es quien hospeda la ventana).
 * `focusBack` es el elemento que recibe el foco al cerrar (por defecto, el activo).
 */
export function openHelp(topic, focusBack) {
  if (!topic) return;
  if (openTopic == null) returnTo = focusBack || (typeof document !== "undefined" ? document.activeElement : null);
  openTopic = topic;
  notify();
}
export function closeHelp() {
  if (openTopic == null) return;
  openTopic = null;
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

/** `t()` devuelve la clave cuando falta: así se sabe si un bloque opcional existe. */
function useHelpText() {
  const { t } = useLang();
  const text = (key) => { const s = t(key); return s === key ? "" : s; };
  const lines = (key) => text(key).split("\n").map((l) => l.trim()).filter(Boolean);
  return { t, text, lines };
}

/** Posición fija del globo junto a su botón, sin salirse de la ventana. */
function placePopover(anchor, pop) {
  if (!anchor || !pop) return { top: 0, left: 0 };
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight, gap = 6, pad = 8;
  let left = Math.min(Math.max(pad, a.left - 8), vw - w - pad);
  let top = a.bottom + gap;
  let above = false;
  if (top + h > vh - pad && a.top - gap - h >= pad) { top = a.top - gap - h; above = true; }
  top = Math.max(pad, Math.min(top, vh - h - pad));
  return { top, left, above, arrow: Math.max(10, Math.min(w - 14, a.left + a.width / 2 - left)) };
}

/* ───────────────────────────── Globo «?» ───────────────────────────── */

function Popover({ topic, anchorRef, onClose }) {
  const { t, text } = useHelpText();
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const title = text(`adm.help.${topic}.title`);
  const short = text(`adm.help.${topic}.short`) || text(`adm.help.${topic}.what`);

  useLayoutEffect(() => {
    const update = () => setPos(placePopover(anchorRef.current, popRef.current));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [topic, anchorRef]);

  useEffect(() => {
    const onDoc = (e) => { if (!popRef.current?.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(true); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("touchstart", onDoc); window.removeEventListener("keydown", onKey, true); };
  }, [onClose, anchorRef]);

  // El botón «Ver guía completa» recibe el foco para que el teclado llegue sin pasar por la página.
  useEffect(() => { popRef.current?.querySelector("button")?.focus({ preventScroll: true }); }, []);

  return (
    <div ref={popRef} className={`adm-help-pop ${pos?.above ? "above" : ""}`} role="dialog" aria-label={title || t("adm.help.ui.button")}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, "--adm-help-arrow": `${pos?.arrow ?? 14}px` }} onClick={(e) => e.stopPropagation()}>
      {title && <b>{title}</b>}
      {short && <span>{short}</span>}
      <button type="button" className="adm-help-more" onClick={() => { onClose(); openHelp(topic, anchorRef.current); }}>
        <Icon name="sparkles" size={13} /> {t("adm.help.ui.more")} <Icon name="arrowRight" size={12} />
      </button>
    </div>
  );
}

/**
 * Botón «?» con globo. `topic` es una clave de HELP_GROUPS; `size` el diámetro
 * (14 por defecto); `inline` lo alinea con el texto que lo rodea (por defecto);
 * `label` sustituye el aria-label (por defecto «Ayuda: <título>»).
 */
export default function HelpTip({ topic, size = 14, inline = true, className = "", label }) {
  const { t, text } = useHelpText();
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const isHost = useHost();
  const node = usePortalNode();

  if (!topic) return null;
  const title = text(`adm.help.${topic}.title`);
  const close = (refocus) => { setOpen(false); if (refocus) btnRef.current?.focus(); };

  return (
    <>
      <button ref={btnRef} type="button" className={`adm-help-btn ${inline ? "inline" : ""} ${open ? "on" : ""} ${className}`.trim()}
        style={{ "--adm-help-size": `${size}px` }} aria-label={label || (title ? `${t("adm.help.ui.button")}: ${title}` : t("adm.help.ui.button"))} aria-expanded={open} aria-haspopup="dialog"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>
        <span aria-hidden="true">?</span>
      </button>
      {open && node && createPortal(<Popover topic={topic} anchorRef={btnRef} onClose={close} />, node)}
      {isHost && node && createPortal(<HelpModalHost />, node)}
    </>
  );
}

/** Botón de texto «Ayuda» para cabeceras de sección: abre la guía completa directamente. */
export function HelpButton({ topic, className = "", children }) {
  const { t } = useLang();
  const isHost = useHost();
  const node = usePortalNode();
  return (
    <>
      <button type="button" className={`adm-help-text ${className}`.trim()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openHelp(topic, e.currentTarget); }}>
        <Icon name="info" size={14} /> {children || t("adm.help.ui.button")}
      </button>
      {isHost && node && createPortal(<HelpModalHost />, node)}
    </>
  );
}

/* ───────────────────────────── Ventana ───────────────────────────── */

function HelpModalHost() {
  const [topic, setTopic] = useState(openTopic);
  useEffect(() => { modalSubs.add(setTopic); setTopic(openTopic); return () => { modalSubs.delete(setTopic); }; }, []);
  if (!topic) return null;
  return <HelpModal topic={topic} onNavigate={openHelp} onClose={closeHelp} />;
}

function Section({ icon, label, children }) {
  return (
    <section className="adm-help-sec">
      <h4><Icon name={icon} size={15} /> {label}</h4>
      {children}
    </section>
  );
}

/**
 * Guía completa de un tema: centrada, 720 px, con la lista de temas del mismo
 * grupo a la izquierda. Cierra con Escape, con el fondo o con el botón;
 * mantiene el foco dentro y lo devuelve a donde estaba.
 */
export function HelpModal({ topic, onNavigate, onClose }) {
  const { t, text, lines } = useHelpText();
  const boxRef = useRef(null);
  const bodyRef = useRef(null);
  const group = helpGroupOf(topic);
  const related = group ? HELP_GROUPS[group] : [topic];
  const title = text(`adm.help.${topic}.title`);
  const what = text(`adm.help.${topic}.what`);
  const how = lines(`adm.help.${topic}.how`);
  const why = text(`adm.help.${topic}.why`);
  const example = text(`adm.help.${topic}.example`);
  const pitfalls = lines(`adm.help.${topic}.pitfalls`);

  // Foco: entra al cerrar-botón, se queda dentro (Tab circular) y vuelve al salir.
  useEffect(() => {
    const prev = returnTo || document.activeElement;
    const box = boxRef.current;
    box?.querySelector(".adm-help-close")?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !box) return;
      const items = Array.from(box.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
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
  useEffect(() => { bodyRef.current?.scrollTo?.({ top: 0 }); }, [topic]);

  return (
    <div className="adm-help-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} className="adm-help-modal" role="dialog" aria-modal="true" aria-labelledby="adm-help-title">
        <header className="adm-help-head">
          <span className="adm-help-kicker"><Icon name="sparkles" size={14} /> {t("adm.help.ui.guide")}{group ? ` · ${t(`adm.help.group.${group}`)}` : ""}</span>
          <h3 id="adm-help-title">{title || topic}</h3>
          <button type="button" className="adm-help-close" aria-label={t("adm.help.ui.close")} onClick={onClose}><Icon name="close" size={16} /></button>
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
          <div ref={bodyRef} className="adm-help-body">
            {what && <Section icon="info" label={t("adm.help.ui.what")}><p>{what}</p></Section>}
            {how.length > 0 && (
              <Section icon="clipboard" label={t("adm.help.ui.how")}>
                <ol>{how.map((l, i) => <li key={i}>{l}</li>)}</ol>
              </Section>
            )}
            {why && <Section icon="zap" label={t("adm.help.ui.why")}><p>{why}</p></Section>}
            {example && <Section icon="eye" label={t("adm.help.ui.example")}><p className="adm-help-example">{example}</p></Section>}
            {pitfalls.length > 0 && (
              <Section icon="alert" label={t("adm.help.ui.pitfalls")}>
                <ul className="adm-help-pitfalls">{pitfalls.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </Section>
            )}
            {!what && !how.length && !why && <p className="muted">{t("adm.help.ui.missing")}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
