// Dónde se usa: GlobalFilterBar.jsx — PRIMERA pieza de la barra fija, y la
// única que sale en TODAS las pestañas del panel. Regla del dueño: «la barra de
// búsqueda puede ser búsqueda de cualquier cosa: pedido, orden, nombre
// paciente, vendedor, tienda, marco de espejuelos… con autocompletado».
//
// Se escribe y la lista aparece sola: antirrebote de 200 ms, mínimo 2 letras y
// resultados AGRUPADOS por tipo, con un icono por tipo (icons.jsx, nunca
// emojis) y un encabezado por grupo.
//
// ── Contrato con el servidor ───────────────────────────────────────────────
//   GET /admin/search?q=<texto>&limit=<n>
//   → { q, groups: [ { kind, items: [ { id, label, sub, amount, store_id,
//                                       extra: { … } } ] } ] }
// Los grupos vacíos NO vienen. `label` es la línea principal y `sub` el
// contexto en gris. El servidor NO dice a qué pestaña ir: ese mapa vive aquí,
// en `destinationFor()`, porque los destinos son del panel y cambian con él.
//
// ── Por qué AbortController ────────────────────────────────────────────────
// El fallo clásico de un autocompletado es pintar la respuesta de «rui» encima
// de la de «ruiz» porque llegó más tarde. Cada búsqueda lleva su
// AbortController; la limpieza del efecto lo aborta en cuanto cambia el texto o
// el componente se desmonta, y la respuesta de un controlador abortado NO se
// pinta nunca. Ojo: `adminGet` (la caché de lecturas del panel) no acepta
// `signal` — el aborto corta el PINTADO, que es el fallo que se ve; la petición
// en vuelo la comparte y la reutiliza `adminCache.js`.
//
// ── Por qué la caché ───────────────────────────────────────────────────────
// `adminGet(..., { ttl })` con TTL corto: volver a teclear algo ya buscado se
// pinta al instante. Además, antes de enseñar «Buscando…» se mira la caché con
// `peek()`: si la respuesta ya está, se pinta en el mismo render y el operador
// no ve un parpadeo de estado de carga.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminGet, queryKey } from "./adminApi.js";
import { peek } from "./adminCache.js";
import { isDemoLogin } from "./adminAuth.js";
import { money } from "./adminOrders.js";
import { useStoreFilter } from "./StoreFilter.jsx";
import "./omni-search.css";

const PATH = "/admin/search";
/** Resultados por grupo que se piden: la lista tiene que caber sin scroll largo. */
const LIMIT = 6;
/** Por debajo de esto no se pide nada: con una letra la respuesta no vale. */
const MIN_CHARS = 2;
/** Antirrebote: lo que se espera entre teclas antes de preguntar al servidor. */
const DEBOUNCE_MS = 200;
/** TTL corto de la caché: fresco para el operador, instantáneo al repetir. */
const TTL_MS = 30_000;

/**
 * Tipos que el panel sabe pintar y ORDEN en que se enseñan (el servidor puede
 * mandarlos en cualquier orden). Un tipo que no esté aquí se pinta al final
 * como `other`, con su propio encabezado, en vez de desaparecer.
 */
const KINDS = ["sale", "order", "patient", "seller", "store", "frame"];
/** Icono por tipo (icons.jsx). Nunca emojis: regla del proyecto. */
const ICON = { sale: "receipt", order: "orders", patient: "user", seller: "sellers", store: "store", frame: "glasses", other: "search" };
/** El tipo tal cual si lo conocemos; si no, `other` (así `t()` siempre resuelve). */
const kindKey = (kind) => (KINDS.includes(kind) ? kind : "other");

/** Quita las claves vacías: una clave de `params` que no viene no cambia nada. */
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/**
 * MAPA tipo → destino. El servidor devuelve datos, no navegación: decidir a
 * dónde se va es del panel. Los destinos son los que el panel YA usa (ver el
 * contrato de `params` en la cabecera de StoreOrders.jsx):
 *
 *   sale / order  → Pedidos de tienda con la ficha de esa venta/pedido abierta
 *                   (`order`), fijando su tienda si la respuesta la trae.
 *   patient       → Pedidos de tienda filtrada por su nombre (o su teléfono,
 *                   si no hay nombre): el chip «Buscar: … ×» queda a la vista.
 *   seller        → Pedidos de tienda filtrada por su código: chip «Vendedor: DAN ×».
 *                   (Sellers.jsx todavía ignora `params.seller`, así que mandar
 *                   ahí no abriría su panel: los pedidos SÍ se filtran.)
 *   store         → NO navega: fija la tienda en el filtro GLOBAL, que es lo
 *                   que de verdad quiere quien busca una tienda, y además es
 *                   instantáneo (sin salto ni recarga).
 *   frame         → «Productos y precios» con `q` = el SKU: la matriz
 *                   (pricing/PriceMatrix.jsx) arranca filtrada por ese texto.
 *   lo demás      → Pedidos de tienda con el texto de la opción como búsqueda:
 *                   un tipo nuevo del servidor nunca deja el clic muerto.
 *
 * `{ store }` sin `tab` significa «solo fija el filtro, no te muevas».
 */
export function destinationFor(kind, item, { patientFiles = false } = {}) {
  const x = item || {};
  const extra = x.extra || {};
  switch (kind) {
    case "sale":
    case "order":
      return { tab: "storeorders", params: clean({ order: extra.order_id || x.id, store: x.store_id }) };
    case "patient":
      // Quien puede abrir fichas va a la del paciente (Pacientes); el resto, a sus ventas.
      if (patientFiles && x.id) return { tab: "patients", params: { patient: x.id } };
      return { tab: "storeorders", params: clean({ q: x.label || extra.phone, store: x.store_id }) };
    case "seller":
      // Su ficha, no sus pedidos: quien busca a una persona quiere ver cómo va.
      return { tab: "sellers", params: clean({ seller: extra.code || x.id, store: x.store_id }) };
    case "store":
      return { store: x.id };
    case "frame":
      // El catálogo abierto por ese modelo, no el catálogo entero.
      return { tab: "products", params: clean({ q: extra.sku || x.label }) };
    default:
      return { tab: "storeorders", params: clean({ q: x.label }) };
  }
}

/**
 * Salto SIN `go`. Mientras AdminShell no baje su `go(tab, params)` hasta la
 * barra, la única forma de llegar a una pestaña con parámetros es la URL:
 * AdminDashboard lee `tab`, `sub`, `order`, `stage`, `seller`, `q` y `approval`
 * de la dirección al montar (`navFromUrl`), así que escribirla y navegar hace
 * exactamente el mismo salto — con el coste de recargar la página. Con `go`
 * disponible esto no se usa.
 */
function hardGo(tab, params) {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  [...u.searchParams.keys()].forEach((k) => u.searchParams.delete(k));
  u.searchParams.set("tab", tab);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v));
  window.location.assign(u.toString());
}

/** El Mac escribe ⌘K; el resto, Ctrl K. Solo cambia la etiqueta del atajo. */
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

/**
 * Buscador global. `me` es para el filtro de tienda (elegir una tienda la fija);
 * `go(tab, params)` es el salto del panel — opcional: sin él se navega por URL.
 */
export default function OmniSearch({ me = null, go = null }) {
  const { t, lang } = useLang();
  const sf = useStoreFilter(me);
  const demo = isDemoLogin();
  const uid = useId();
  const listId = `${uid}-list`;

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState(null); // null = todavía nada pedido
  const [state, setState] = useState("idle"); // idle | typing | ok | error
  const [active, setActive] = useState(0);
  const [nonce, setNonce] = useState(0); // «Volver a intentar» sin cambiar el texto

  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const key = q.trim();
  const short = key.length > 0 && key.length < MIN_CHARS;

  // ── La búsqueda ──────────────────────────────────────────────────────────
  // Un solo efecto: antirrebote + caché + aborto. La limpieza cancela las dos
  // cosas (el temporizador y el pintado), así que no hay forma de que una
  // respuesta vieja gane a una nueva.
  useEffect(() => {
    if (demo || key.length < MIN_CHARS) { setGroups(null); setState("idle"); return undefined; }
    const url = queryKey(PATH, { q: key, limit: LIMIT });
    const cached = peek(url);
    // Ya buscado: se pinta en este mismo render (sin «Buscando…») y se refresca
    // por detrás si está pasado de TTL — eso lo hace `adminGet` solo.
    if (cached) { setGroups(cached.groups || []); setState("ok"); }
    else { setGroups(null); setState("typing"); }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      adminGet(PATH, { query: { q: key, limit: LIMIT }, ttl: TTL_MS })
        .then((data) => {
          if (ac.signal.aborted) return;
          setGroups(Array.isArray(data?.groups) ? data.groups : []);
          setState("ok");
        })
        .catch(() => { if (!ac.signal.aborted) { setGroups(null); setState("error"); } });
    }, cached ? 0 : DEBOUNCE_MS);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [key, demo, nonce]);

  // ── Lista plana para el teclado ──────────────────────────────────────────
  // Los encabezados no son opciones: las flechas se mueven solo por resultados,
  // y `ordered` deja los tipos en el orden de KINDS (más los nuevos al final).
  const ordered = useMemo(() => {
    const list = (groups || []).filter((g) => g && Array.isArray(g.items) && g.items.length);
    const rank = (g) => { const i = KINDS.indexOf(g.kind); return i === -1 ? KINDS.length : i; };
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [groups]);
  // Una sola lista de filas a pintar (encabezado o resultado) con el índice
  // plano YA calculado: nada de contadores mutados durante el render.
  const rows = useMemo(() => {
    const out = [];
    let n = 0;
    for (const g of ordered) {
      out.push({ type: "head", kind: g.kind });
      for (const item of g.items) { out.push({ type: "opt", kind: g.kind, item, idx: n }); n += 1; }
    }
    return out;
  }, [ordered]);
  const flat = useMemo(() => rows.filter((r) => r.type === "opt"), [rows]);
  useEffect(() => { setActive(0); }, [flat.length, key]);
  // La opción activa se mantiene a la vista cuando la lista hace scroll (igual que StoreFilter).
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const close = useCallback((focus = true) => { setOpen(false); if (focus) inputRef.current?.focus(); }, []);

  // Fuera de la caja (clic o toque) se cierra, como el selector de tienda.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); };
  }, [open, close]);

  // Atajo del panel. A propósito Ctrl/⌘+K y NO «/»: la barra superior ya usa
  // «/» para el buscador de precios (AdminShell → prop `find`) y dos manejadores
  // peleándose por la misma tecla es un fallo que solo se ve en esa pestaña.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.metaKey || e.ctrlKey) || String(e.key).toLowerCase() !== "k") return;
      e.preventDefault();
      setOpen(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Elegir un resultado SIEMPRE hace algo: fija la tienda o salta a su pantalla. */
  const choose = (entry) => {
    if (!entry) return;
    const patientFiles = !me || me.is_admin !== false || me.role === "supervisor" || me.role === "manager";
    const dest = destinationFor(entry.kind, entry.item, { patientFiles });
    setOpen(false);
    if (dest.store) { sf.setStoreId(dest.store); return; }
    if (typeof go === "function") go(dest.tab, dest.params);
    else hardGo(dest.tab, dest.params);
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (open) close(); else { setQ(""); } return; }
    if (e.key === "Tab") { close(false); return; }
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); setOpen(true); }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((i) => (flat.length ? Math.min(i + 1, flat.length - 1) : 0)); break;
      case "ArrowUp": e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); break;
      case "Home": if (flat.length) { e.preventDefault(); setActive(0); } break;
      case "End": if (flat.length) { e.preventDefault(); setActive(flat.length - 1); } break;
      case "Enter": e.preventDefault(); choose(flat[active]); break;
      default: break;
    }
  };

  const kbd = t(isMac() ? "adm.omni.kbd.mac" : "adm.omni.kbd.other");
  const activeId = open && flat[active] ? `${uid}-o-${active}` : undefined;
  // El importe solo se pinta cuando es un número (el contrato lo manda en
  // dólares, como el resto de la analítica del panel); cualquier otra cosa se
  // enseña tal cual antes que inventar un formato.
  const amountOf = (item) => (typeof item.amount === "number" ? money(item.amount, "usd", lang) : item.amount ? String(item.amount) : "");

  return (
    <div className={`adm-omni ${open ? "open" : ""}`} ref={rootRef} onKeyDown={onKey} role="search" aria-label={t("adm.omni.aria")}>
      <div className="adm-omni-box">
        <Icon name="search" size={15} className="adm-omni-ico" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          autoComplete="off"
          spellCheck="false"
          className="adm-omni-input"
          value={q}
          placeholder={t("adm.omni.placeholder")}
          aria-label={t("adm.omni.label")}
          title={t("adm.omni.title")}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
        />
        {q
          ? <button type="button" className="adm-omni-x" onClick={() => { setQ(""); inputRef.current?.focus(); }} title={t("adm.omni.clear")} aria-label={t("adm.omni.clear")}><Icon name="close" size={13} /></button>
          : <kbd className="adm-omni-kbd" title={t("adm.omni.shortcut", { keys: kbd })}>{kbd}</kbd>}
      </div>

      {open && (
        <div className="adm-omni-pop">
          {/* Cerrar a mano: en móvil el desplegable ocupa la pantalla y el clic
              fuera no tiene dónde caer. */}
          <button type="button" className="adm-omni-done" onClick={() => close()} title={t("adm.omni.close")} aria-label={t("adm.omni.close")}>
            <Icon name="close" size={15} />
          </button>

          {/* Caja vacía: el apunte de qué se puede buscar (y el mínimo de letras). */}
          {!key && !demo && (
            <div className="adm-omni-note">
              <b>{t("adm.omni.hint.title")}</b>
              <p>{t("adm.omni.hint.body")}</p>
            </div>
          )}
          {short && !demo && <div className="adm-omni-note"><p>{t("adm.omni.min", { n: MIN_CHARS })}</p></div>}
          {demo && (
            <div className="adm-omni-note">
              <b>{t("adm.omni.demo")}</b>
              <p>{t("adm.omni.demoHint")}</p>
            </div>
          )}
          {state === "typing" && <div className="adm-omni-note busy" role="status"><Icon name="refresh" size={14} /><p>{t("adm.omni.searching")}</p></div>}
          {state === "error" && (
            <div className="adm-omni-note bad" role="status">
              <b><Icon name="alert" size={14} /> {t("adm.omni.error")}</b>
              <p>{t("adm.omni.errorHint")}</p>
              <button type="button" className="btn-xs" onClick={() => setNonce((n) => n + 1)}>{t("adm.omni.retry")}</button>
            </div>
          )}
          {state === "ok" && !flat.length && (
            <div className="adm-omni-note" role="status">
              <b>{t("adm.omni.empty", { q: key })}</b>
              <p>{t("adm.omni.emptyHint")}</p>
            </div>
          )}

          {/* Un `listbox` plano: los encabezados son `presentation` para que las
              flechas y `aria-activedescendant` solo vean resultados. */}
          {Boolean(flat.length) && (
            <ul id={listId} ref={listRef} role="listbox" aria-label={t("adm.omni.listAria")} className="adm-omni-list">
              {rows.map((r) => {
                const gk = kindKey(r.kind);
                if (r.type === "head") {
                  return (
                    <li key={`h-${r.kind}`} role="presentation" className="adm-omni-head">
                      <Icon name={ICON[gk]} size={13} />
                      <span>{t(`adm.omni.group.${gk}`)}</span>
                    </li>
                  );
                }
                const amt = amountOf(r.item);
                return (
                  <li
                    key={`${r.kind}-${r.item.id ?? r.idx}`}
                    id={`${uid}-o-${r.idx}`}
                    data-i={r.idx}
                    role="option"
                    aria-selected={r.idx === active}
                    className={`adm-omni-opt ${r.idx === active ? "active" : ""}`}
                    title={t(`adm.omni.go.${gk}`)}
                    onMouseEnter={() => setActive(r.idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(r)}
                  >
                    <Icon name={ICON[gk]} size={14} className="adm-omni-opt-ico" />
                    <span className="adm-omni-txt">
                      <b>{r.item.label}</b>
                      {r.item.sub && <small>{r.item.sub}</small>}
                    </span>
                    {amt && <span className="adm-omni-amt">{amt}</span>}
                    <Icon name="arrowRight" size={13} className="adm-omni-go" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
