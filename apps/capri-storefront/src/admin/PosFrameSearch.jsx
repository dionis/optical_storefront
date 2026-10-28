// Dónde se usa: paso «Montura» de Nueva venta (PosSale.jsx). Autocompletado del
// catálogo de la tienda: al escribir se despliega la lista de modelos que
// coinciden, con miniatura, nombre y precio; si el modelo tiene varios colores
// se elige el color (con su foto). Un código exacto escaneado se añade solo.
import { useEffect, useId, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { searchProducts } from "./posApi.js";

const MIN_CHARS = 2;

/** Resalta en el nombre lo que se escribió (sin distinguir mayúsculas). */
function Highlight({ text, term }) {
  const q = term.trim();
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

function Thumb({ src, size = "md" }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className={`pos-ac-thumb ${size} noimg`}><Icon name="glasses" size={size === "sm" ? 14 : 20} /></span>;
  return <img className={`pos-ac-thumb ${size}`} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

/** Variante cuyo SKU o código de barras es exactamente lo escrito (lo que manda un lector). */
function exactVariant(hits, term) {
  const q = term.trim().toLowerCase();
  for (const p of hits) {
    const v = p.variants.find((x) => [x.sku, x.barcode].some((c) => c && c.toLowerCase() === q));
    if (v) return { p, v };
  }
  return null;
}

/** `onOpenChange(bool)`: la tarjeta que lo contiene sube por encima de la barra Atrás/Siguiente mientras la lista está abierta. */
export default function PosFrameSearch({ storeId, money, onAdd, onOpenChange }) {
  const { t } = useLang();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState([]);
  const [state, setState] = useState("idle"); // idle | loading | ok | error
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Modelo cuyo selector de color está abierto.
  const [expanded, setExpanded] = useState(null);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();

  // Espera corta para no consultar en cada tecla; descarta respuestas viejas.
  useEffect(() => {
    const q = term.trim();
    if (!storeId || q.length < MIN_CHARS) { setHits([]); setState("idle"); return undefined; }
    let live = true;
    setState("loading");
    const h = setTimeout(() => {
      searchProducts(storeId, q)
        .then((r) => { if (live) { setHits(r.products || []); setState("ok"); setActive(0); setExpanded(null); } })
        .catch(() => { if (live) { setHits([]); setState("error"); } });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [term, storeId]);

  // Clic fuera: se cierra la lista.
  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const add = (p, v) => {
    if (p.price == null) return;
    onAdd(p, v);
    setTerm(""); setHits([]); setExpanded(null); setOpen(false);
    inputRef.current?.focus();
  };
  // Un solo color: se añade; varios: se abre su selector.
  const pick = (p) => {
    if (p.price == null) return;
    if (p.variants.length === 1) add(p, p.variants[0]);
    else setExpanded((x) => (x === p.product_id ? null : p.product_id));
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Escape") { if (expanded) setExpanded(null); else setOpen(false); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const exact = exactVariant(hits, term);
      if (exact) add(exact.p, exact.v);
      else if (hits[active]) pick(hits[active]);
    }
  };

  const showList = open && term.trim().length >= MIN_CHARS;
  useEffect(() => { onOpenChange?.(showList); }, [showList]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onOpenChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pos-ac" ref={boxRef}>
      <label className="pos-search">
        <Icon name="barcode" size={16} />
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("adm.pos.frame.search")}
          aria-label={t("adm.pos.frame.search")}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoFocus
        />
        {state === "loading" && <span className="pos-ac-spin" aria-hidden="true" />}
        {term && <button type="button" className="pos-ac-clear" onClick={() => { setTerm(""); inputRef.current?.focus(); }} aria-label={t("adm.pos.frame.clear")} title={t("adm.pos.frame.clear")}><Icon name="close" size={14} /></button>}
      </label>

      {showList && (
        <div className="pos-ac-pop">
          {state === "loading" && !hits.length && <div className="pos-ac-note">{t("adm.pos.frame.searching")}</div>}
          {state === "error" && <div className="pos-ac-note">{t("adm.pos.frame.searchFailed")}</div>}
          {state === "ok" && !hits.length && <div className="pos-ac-note">{t("adm.pos.frame.noResults", { q: term.trim() })}</div>}
          {hits.length > 0 && (
            <ul id={listId} role="listbox" className="pos-ac-list">
              {hits.map((p, i) => {
                const unpriced = p.price == null;
                const many = p.variants.length > 1;
                return (
                  <li key={p.product_id} id={`${listId}-${i}`} role="option" aria-selected={i === active} aria-disabled={unpriced}
                    className={`pos-ac-item ${i === active ? "on" : ""} ${unpriced ? "off" : ""}`}
                    onMouseEnter={() => setActive(i)}>
                    <button type="button" className="pos-ac-row" disabled={unpriced} onClick={() => pick(p)}>
                      <Thumb src={p.thumbnail} />
                      <span className="pos-ac-main">
                        <b><Highlight text={p.title} term={term} /></b>
                        <small className="muted">
                          {many ? t("adm.pos.frame.colors", { n: p.variants.length }) : p.variants[0]?.title || p.variants[0]?.sku || ""}
                        </small>
                      </span>
                      <span className="pos-ac-price">{unpriced ? t("adm.pos.frame.noPrice") : money(p.price)}</span>
                      {!unpriced && <Icon name={many ? (expanded === p.product_id ? "chevronUp" : "chevronDown") : "plus"} size={14} />}
                    </button>
                    {expanded === p.product_id && (
                      <div className="pos-ac-variants">
                        {p.variants.map((v) => (
                          <button key={v.id} type="button" className="pos-ac-variant" onClick={() => add(p, v)}>
                            <Thumb src={v.image || p.thumbnail} size="sm" />
                            <span>{v.title || v.sku || t("adm.pos.frame.add")}</span>
                          </button>
                        ))}
                      </div>
                    )}
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
