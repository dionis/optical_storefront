// Dónde se usa: al añadir un costo — «Resultado por tienda» (StoreCosts.jsx)
// y «Reglas y comisiones» (pricing/CostsSection.jsx). El nombre del costo se
// autocompleta con los costos que ya existen en cualquier tienda (dueño,
// 17-nov-2026: «cuando se agrega un costo debe tener autocompletado según los
// costos que ya se hayan hecho, de tal manera que se puedan poner los mismos
// costos en todas las tiendas»). Elegir uno copia sus datos (categoría, tipo,
// importe, frecuencia, proveedor…) en la fila nueva; la persona elige la
// tienda y ajusta lo que difiera.
import { useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { money } from "./adminOrders.js";

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Los costos que ya existen, agrupados por nombre: el más reciente da los datos
 * y se dice en qué tiendas está y por cuánto. Pura: exportada para las pruebas.
 */
export function costSuggestions(items, storeCode = () => "") {
  const groups = new Map();
  for (const it of items || []) {
    const key = norm(it.description);
    if (!key) continue;
    const g = groups.get(key) || { key, uses: [], latest: null };
    g.uses.push({ store: it.establishment_id ? storeCode(it.establishment_id) || "?" : null, amount: Number(it.amount) || 0 });
    if (!g.latest || String(it.created_at || it.starts_on || "") > String(g.latest.created_at || g.latest.starts_on || "")) g.latest = it;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.uses.length - a.uses.length || a.key.localeCompare(b.key));
}

/** Los datos de un costo existente que pasan a uno nuevo (nunca su id, su tienda ni su comprobante). */
export function fieldsFrom(it) {
  return {
    description: it.description || "",
    kind: it.kind,
    category: it.category,
    ...(it.tax_category ? { tax_category: it.tax_category } : {}),
    amount: it.amount === undefined || it.amount === null ? "" : String(it.amount),
    frequency: it.frequency || "monthly",
    amortize_months: it.amortize_months ?? "",
    per_sale: it.per_sale === true,
    vendor: it.vendor || "",
    notes: it.notes || "",
  };
}

export default function CostNameInput({ value, onChange, onPick, items, storeCode, placeholder, ariaLabel, className = "", inputClassName = "", maxLength = 160, autoFocus = false }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const blurT = useRef(null);
  const all = useMemo(() => costSuggestions(items, storeCode), [items, storeCode]);
  const q = norm(value);
  const list = useMemo(() => (q ? all.filter((g) => g.key.includes(q) && g.key !== q) : all).slice(0, 8), [all, q]);
  const m = (v) => money(v, "usd", lang);
  const pick = (g) => { setOpen(false); onPick?.(fieldsFrom(g.latest), g); };
  // «Op1 $2,500.00 · Op2 $2,300.00» (las repetidas, una vez con ×N).
  const where = (g) => {
    const seen = new Map();
    for (const u of g.uses) { const k = `${u.store || t("adm.cst.shared")} ${m(u.amount)}`; seen.set(k, (seen.get(k) || 0) + 1); }
    return [...seen].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(" · ");
  };

  return (
    <span className={`cst-ac ${className}`}>
      <input
        className={inputClassName}
        value={value}
        maxLength={maxLength}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open && list.length > 0}
        role="combobox"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => { clearTimeout(blurT.current); setOpen(true); }}
        onBlur={() => { blurT.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={(e) => {
          if (!open || !list.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setHi((h) => Math.min(list.length - 1, h + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === "Enter" && list[hi]) { e.preventDefault(); e.stopPropagation(); pick(list[hi]); }
          else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
        }}
      />
      {open && list.length > 0 && (
        <ul className="cst-ac-list" role="listbox">
          <li className="cst-ac-head" aria-hidden="true">{t("adm.cst.suggest")}</li>
          {list.map((g, i) => (
            <li key={g.key} role="option" aria-selected={i === hi}>
              <button type="button" className={i === hi ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(g)}>
                <b>{g.latest.description}</b>
                <small>{g.latest.per_sale ? t("adm.cst.perSale") : t(`adm.costs2.freq.${g.latest.frequency || "monthly"}`)} · {where(g)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
