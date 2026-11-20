// Acordeón de «Reglas y comisiones»: una cabecera de una línea con lo que el
// dueño necesita sin abrirlo — cuántas partidas, el total MENSUAL normalizado y
// cómo se reparte por tienda — y el cuerpo plegable. Se recuerda abierto o
// cerrado por acordeón (localStorage, con respaldo silencioso).
import { useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import HelpTip from "../HelpTip.jsx";
import Icon from "../icons.jsx";
import { store as ls } from "./model.js";

const KEY = "adm.fin.acc.open";

export function useOpenSet(defaults = []) {
  const [open, setOpen] = useState(() => new Set(ls.get(KEY, defaults)));
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      ls.set(KEY, [...next]);
      return next;
    });
  return [open, toggle];
}

/**
 * `split` = [{ code, color, amount }] (lo de cada tienda); `total` en dólares
 * o null (sin total: comisiones en %, ajustes). `actions` va a la derecha de la
 * cabecera y NO pliega al pulsarse.
 */
export default function FinAcc({ id, icon, title, help, count, total, totalHelp, totalLabel, split = [], open, onToggle, actions, children }) {
  const { t, lang } = useLang();
  const m = (v) => money(Number(v) || 0, "usd", lang);
  return (
    <section className={`fin-acc ${open ? "open" : ""}`} aria-labelledby={`fin-acc-${id}`}>
      <header className="fin-acc-h">
        <button type="button" className="fin-acc-toggle" aria-expanded={open} aria-controls={`fin-acc-b-${id}`} id={`fin-acc-${id}`} onClick={() => onToggle(id)}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
          {icon && <Icon name={icon} size={14} />}
          <span className="fin-acc-t">{title}</span>
          {count != null && <span className="fin-count" title={t("adm.fin.acc.count")}>{count}</span>}
        </button>
        {help && <HelpTip topic={help} />}
        {total != null && (
          <span className="fin-acc-total" title={t("adm.fin.acc.totalHint")}>
            <small>{totalLabel || t("adm.fin.acc.monthly")}</small>
            <b>{m(total)}</b>
            {totalHelp && <HelpTip topic={totalHelp} />}
          </span>
        )}
        {split.length > 0 && (
          <span className="fin-split" aria-label={t("adm.fin.acc.split")}>
            {split.map((s) => (
              <span key={s.code} className="fin-split-i" title={`${s.code} · ${m(s.amount)}`}>
                <span className="fin-dot" style={{ background: s.color || "var(--adm-muted)" }} />
                {s.code} <b>{m(s.amount)}</b>
              </span>
            ))}
          </span>
        )}
        {actions && <span className="fin-acc-act">{actions}</span>}
      </header>
      {open && (
        <div className="fin-acc-b" id={`fin-acc-b-${id}`}>
          {children}
        </div>
      )}
    </section>
  );
}
