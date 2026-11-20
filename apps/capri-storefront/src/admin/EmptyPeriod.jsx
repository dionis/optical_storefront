// Dónde se usa: cualquier pantalla del panel con cifras por período cuando el
// período activo no trae NADA (Ejecutivo, Pedidos de tienda, Caja, Estado de
// cuenta, Panel de ventas, Vendedores…).
//
//   import EmptyPeriod from "./EmptyPeriod.jsx";
//   <EmptyPeriod kind="sales" />          // kind: "sales" | "cash" | "orders"
//   <EmptyPeriod kind="cash" compact />   // una línea, para dentro de un acordeón
//
// Por qué existe: «Mes» es 1→hoy, así que el día 1 de cada mes el período es un
// solo día y todo sale a cero aunque el mes pasado esté lleno de ventas (igual
// los lunes con «Semana» y cada 1 de enero). Una tabla vacía sin explicación se
// lee como «el panel está roto» — el dueño ya lo creyó una vez. Así que el aviso
// dice QUÉ período se está mirando, con sus fechas, y ofrece un botón por cada
// período alternativo (`alternativePeriodsOf`, periodStore.js) que al pulsarlo
// fija el período GLOBAL. Pulsar uno es una elección de una persona, así que va
// con `{ explicit: true }`: a partir de ahí el panel no vuelve a cambiarlo solo.
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { alternativePeriodsOf, usePeriodFilter } from "./periodStore.js";
import "./empty-period.css";

// Qué se está mirando → icono y copy. Mismos iconos que la sección de la que
// cuelga cada cifra (icons.jsx, nunca emojis).
const KINDS = {
  sales: { icon: "sales", title: "adm.period.empty.sales", sub: "adm.period.empty.salesSub" },
  cash: { icon: "wallet", title: "adm.period.empty.cash", sub: "adm.period.empty.cashSub" },
  orders: { icon: "orders", title: "adm.period.empty.orders", sub: "adm.period.empty.ordersSub" },
};

/** "2026-11-01" → «1 nov» («1 nov 2025» si es de otro año), en el idioma elegido. */
function shortDay(day, lang) {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d
    .toLocaleDateString(lang === "en" ? "en-US" : "es-ES", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })
    .replace(/\.$/, "");
}

export default function EmptyPeriod({ kind = "sales", compact = false }) {
  const { t, lang } = useLang();
  const { period, from, to, setPeriod, label } = usePeriodFilter();
  // Un `kind` desconocido no deja la pantalla sin explicación: cae en ventas.
  const cfg = KINDS[kind] || KINDS.sales;
  const alts = alternativePeriodsOf(period);
  // El período EN PALABRAS («Este mes», o las dos fechas si es un rango a mano):
  // el operador tiene que poder relacionar el vacío con lo que eligió arriba.
  const current = t("adm.period.empty.current", { period: label(t) });
  const dates = from === to ? shortDay(from, lang) : t("adm.period.empty.dates", { from: shortDay(from, lang), to: shortDay(to, lang) });

  const jumps = alts.map((p) => (
    <button
      key={p}
      type="button"
      className="btn-xs ep-jump"
      title={t("adm.period.empty.goTo", { period: t(`adm.ex.period.${p}`) })}
      aria-label={t("adm.period.empty.goTo", { period: t(`adm.ex.period.${p}`) })}
      onClick={() => setPeriod(p, { explicit: true })}
    >
      {t(`adm.ex.per.${p}`)}
    </button>
  ));

  // Compacta: una sola línea, para que quepa en la cabecera de un acordeón sin
  // empujar el resto de la pantalla.
  if (compact) {
    return (
      <div className="ep ep-compact" role="note" aria-label={t("adm.period.empty.aria")}>
        <Icon name={cfg.icon} size={15} className="ep-ico" />
        <span className="ep-line">
          <b>{t(cfg.title)}</b>
          <span className="ep-dim">{dates}</span>
        </span>
        {jumps.length > 0 && <span className="ep-jumps">{jumps}</span>}
      </div>
    );
  }

  return (
    <div className="ep" role="note" aria-label={t("adm.period.empty.aria")}>
      <span className="ep-badge">
        <Icon name={cfg.icon} size={22} />
      </span>
      <b className="ep-title">{t(cfg.title)}</b>
      <p className="ep-sub">{t(cfg.sub)}</p>
      <p className="ep-period">
        <span>{current}</span>
        <span className="ep-dim">{dates}</span>
      </p>
      {jumps.length > 0 ? (
        <>
          <small className="ep-try">{t("adm.period.empty.try")}</small>
          <div className="ep-jumps">{jumps}</div>
        </>
      ) : (
        // «Año» no tiene a dónde saltar: al menos se dice dónde se cambia.
        <small className="ep-try">{t("adm.period.empty.noAlt")}</small>
      )}
    </div>
  );
}
