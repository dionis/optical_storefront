// Dónde se usa: arriba del Ejecutivo (ExecutiveHub.jsx), antes de la tira de
// KPI del período. Es la respuesta al problema del dueño: «el Ejecutivo da
// ceros el día 1 del mes aunque haya veinte pedidos atascados en el laboratorio
// desde octubre». La tira de KPI mide FLUJO (lo vendido en el período elegido) y
// eso está bien; esta franja mide SALDO VIVO —lo que hay pendiente AHORA, venga
// de cuando venga— y por eso NO sigue el período de la barra. Sí sigue el filtro
// de tienda (useStoreFilter), que es la misma pregunta hecha sobre otra tienda.
//
// Una sola lectura: GET /admin/pos/start-map?store= (backend lib/start-map.ts),
// la misma que ya usa WelcomeBriefing.jsx, ya acotada por rol en el SERVIDOR
// (un vendedor recibe sus cifras y los saldos de su tienda). Aquí no se decide
// ningún permiso: se pinta lo que llega. Campos consumidos: `pending`
// (in_lab.count/cents, to_deliver.count/balance_cents, on_street.count/cents,
// overdue_balances.count/cents, approvals, open_tills), `periods.yesterday` y
// `periods.today` (sales_cents, count) y `pending_truncated`.
//
// Cada cifra es un botón con el mismo contrato `go(tab, params)` de
// WelcomeBriefing, y con sus mismos destinos: laboratorio y por entregar →
// pedidos de la tienda; dinero en la calle y atrasados → cobros pendientes; por
// aprobar → aprobaciones; cajas abiertas → caja; ayer y hoy → el Ejecutivo con
// ese período (lo único que mueve la barra, y a propósito).
//
// Nada de ceros inútiles: un cero se pinta apagado y sin reclamar atención, y si
// TODO está en cero la franja se reduce a una línea tranquila que lo dice (es
// información buena, no un error) con las ventas de ayer y hoy al lado, que son
// las dos cifras que el dueño nombró. Esqueletos mientras carga; si la llamada
// falla, las cifras quedan en «—» y los botones siguen llevando a su pantalla.
//
//   <BacklogStrip me={me} go={go} />
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminGet } from "./adminApi.js";
import { money } from "./adminOrders.js";
import HelpTip from "./HelpTip.jsx";
import { navGroupsFor, tabsOf } from "./AdminShell.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import "./backlog-strip.css";

/** Un minuto: al volver a la pestaña la franja se pinta al instante y se refresca por detrás. */
const STRIP_TTL = 60_000;

const cents = (c) => (Number(c) || 0) / 100;

/** Esqueleto de una celda mientras no hay respuesta. */
const Skel = ({ w = "60%" }) => <span className="adm-skel bl-skel" style={{ width: w }} aria-hidden="true" />;

/**
 * Celda de la franja: icono, etiqueta, cifra y una línea de contexto, todo en
 * un botón. `help` es el tema de HelpTip y va en la esquina, FUERA del botón,
 * porque un botón no puede contener otro (igual que la tarjeta KPI del
 * Ejecutivo). `zero` la apaga: un cero no debe reclamar atención.
 */
function Cell({ icon, label, value, sub, tone = "", zero = false, loading = false, failed = false, help, hint, onClick }) {
  const { t } = useLang();
  return (
    <div className={`bl-cell ${tone} ${zero ? "zero" : ""} ${help ? "has-help" : ""}`.replace(/\s+/g, " ").trim()}>
      <button type="button" className="bl-go" onClick={onClick} title={hint || undefined}
        aria-label={t("adm.bl.cellAria", { label, value: failed ? "—" : value })}>
        <Icon name={icon} size={15} className="bl-ico" />
        <span className="bl-txt">
          <small>{label}</small>
          {loading ? <Skel /> : (
            <span className="bl-fig">
              <b>{failed ? "—" : value}</b>
              {!failed && sub && <i>{sub}</i>}
            </span>
          )}
        </span>
        <Icon name="chevronRight" size={12} className="bl-chev" />
      </button>
      {help && <HelpTip topic={help} size={12} className="bl-help" />}
    </div>
  );
}

export default function BacklogStrip({ me, go }) {
  const { t, lang } = useLang();
  const { storeId, isAll } = useStoreFilter(me);
  const tabs = useMemo(() => tabsOf(navGroupsFor(me)), [me]);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  // La tienda activa del panel («all» = sin parámetro, como hace `param()`) es
  // el único motivo para volver a leer. El período NO entra aquí.
  const storeQ = isAll ? "" : storeId;
  useEffect(() => {
    let on = true;
    setFailed(false);
    adminGet("/admin/pos/start-map", { query: { store: storeQ }, ttl: STRIP_TTL })
      .then((d) => { if (on) setData(d); })
      .catch(() => { if (on) setFailed(true); });
    return () => { on = false; };
  }, [storeQ]);

  const loading = !data && !failed;
  // Normalizado a prueba de huecos: esta franja va ENCIMA de todo el Ejecutivo,
  // así que una respuesta incompleta no puede ser lo que tumbe la pantalla.
  const pend = useMemo(() => {
    const p = data?.pending;
    if (!p) return null;
    const b = (x) => ({ count: Number(x?.count) || 0, cents: Number(x?.cents) || 0, balance_cents: Number(x?.balance_cents) || 0 });
    return { in_lab: b(p.in_lab), to_deliver: b(p.to_deliver), on_street: b(p.on_street), overdue_balances: b(p.overdue_balances), approvals: Number(p.approvals) || 0, open_tills: Number(p.open_tills) || 0 };
  }, [data]);
  const m = (c) => money(cents(c), "usd", lang);

  // Destinos: la primera pestaña que el rol tiene (AdminShell.navGroupsFor),
  // como en WelcomeBriefing; `go()` cae en la primera suya si no existe.
  const first = (...keys) => keys.find((k) => tabs.includes(k)) || tabs[0];
  const toLab = (stage) => go?.(first("storeorders", "possales", "mysales"), { stage });
  const toBalances = (overdue) => go?.(first("pendingbalances", "possales", "mysales"), overdue ? { overdue: 1 } : {});
  const toApprovals = () => go?.(first("approvals", "pos"), {});
  const toCash = () => go?.("cash", {});
  const toSales = (period) => go?.(first("exec", "mysales"), { period });

  // Ventas de ayer y de hoy: referencia inmediata, siempre a la vista (son las
  // dos que el dueño nombró), también cuando no hay nada pendiente.
  const sale = (k) => {
    const f = data?.periods?.[k];
    return { value: f ? m(f.sales_cents) : "—", sub: f ? t("adm.bl.sales", { n: f.count }) : "", zero: Boolean(f) && !f.count };
  };
  const yd = sale("yesterday");
  const td = sale("today");

  // Todo en cero = no hay NADA pendiente. Es información buena: la franja se
  // reduce a una línea tranquila en vez de seis ceros pidiendo atención.
  const allClear = Boolean(pend) && !pend.in_lab.count && !pend.to_deliver.count && !pend.on_street.count
    && !pend.overdue_balances.count && !pend.approvals && !pend.open_tills;

  const tag = (
    <span className="bl-tag" title={t("adm.bl.tagHint")}>
      <Icon name="zap" size={12} /> {t("adm.bl.tag")}
    </span>
  );

  if (allClear) {
    return (
      <div className="bl-strip clear adm-noprint" role="group" aria-label={t("adm.bl.aria")}>
        {tag}
        <span className="bl-clear"><Icon name="checkCircle" size={14} /> {t("adm.bl.clear")}</span>
        <span className="bl-minis">
          <button type="button" className={`bl-mini ${yd.zero ? "zero" : ""}`} onClick={() => toSales("yesterday")} title={t("adm.bl.h.yesterday")}>
            <small>{t("adm.bl.yesterday")}</small> <b>{yd.value}</b>
          </button>
          <button type="button" className={`bl-mini ${td.zero ? "zero" : ""}`} onClick={() => toSales("today")} title={t("adm.bl.h.today")}>
            <small>{t("adm.bl.today")}</small> <b>{td.value}</b>
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className={`bl-strip adm-noprint ${loading ? "busy" : ""}`} role="group" aria-label={t("adm.bl.aria")} aria-busy={loading || undefined}>
      {tag}
      {/* Rejilla, no una fila que se desborda: así las dos filas quedan
          parejas en vez de dejar una celda suelta ocupando todo el ancho. */}
      <div className="bl-cells">
      <Cell icon="lab" label={t("adm.bl.inLab")} hint={t("adm.bl.h.inLab")} loading={loading} failed={!pend}
        value={pend ? String(pend.in_lab.count) : "—"} tone={pend?.in_lab.count ? "info" : ""} zero={Boolean(pend) && !pend.in_lab.count}
        sub={pend ? (pend.in_lab.count ? t("adm.bl.worth", { v: m(pend.in_lab.cents) }) : t("adm.bl.none")) : ""}
        onClick={() => toLab("in_lab")} />

      <Cell icon="truck" label={t("adm.bl.toDeliver")} hint={t("adm.bl.h.toDeliver")} loading={loading} failed={!pend}
        value={pend ? String(pend.to_deliver.count) : "—"} tone={pend?.to_deliver.count ? "info" : ""} zero={Boolean(pend) && !pend.to_deliver.count}
        sub={pend ? (pend.to_deliver.count ? t("adm.bl.toCollect", { v: m(pend.to_deliver.balance_cents) }) : t("adm.bl.none")) : ""}
        onClick={() => toLab("ready")} />

      {/* Los atrasados destacan más que el resto: son lo primero del día. */}
      <Cell icon="alert" label={t("adm.bl.overdue")} hint={t("adm.bl.h.overdue")} loading={loading} failed={!pend} help="backlog.overdue"
        value={pend ? m(pend.overdue_balances.cents) : "—"} tone={pend?.overdue_balances.count ? "bad" : ""} zero={Boolean(pend) && !pend.overdue_balances.count}
        sub={pend ? (pend.overdue_balances.count ? t("adm.bl.balances", { n: pend.overdue_balances.count }) : t("adm.bl.none")) : ""}
        onClick={() => toBalances(true)} />

      <Cell icon="dollar" label={t("adm.bl.onStreet")} hint={t("adm.bl.h.onStreet")} loading={loading} failed={!pend} help="backlog.street"
        value={pend ? m(pend.on_street.cents) : "—"} tone={pend?.on_street.count ? "warn" : ""} zero={Boolean(pend) && !pend.on_street.count}
        sub={pend ? (pend.on_street.count ? t("adm.bl.balances", { n: pend.on_street.count }) : t("adm.bl.none")) : ""}
        onClick={() => toBalances(false)} />

      <Cell icon="hand" label={t("adm.bl.toApprove")} hint={t("adm.bl.h.toApprove")} loading={loading} failed={!pend}
        value={pend ? String(pend.approvals) : "—"} tone={pend?.approvals ? "warn" : ""} zero={Boolean(pend) && !pend.approvals}
        sub={pend ? (pend.approvals ? t("adm.bl.requests", { n: pend.approvals }) : t("adm.bl.none")) : ""}
        onClick={toApprovals} />

      <Cell icon="wallet" label={t("adm.bl.openTills")} hint={t("adm.bl.h.openTills")} loading={loading} failed={!pend}
        value={pend ? String(pend.open_tills) : "—"} tone={pend?.open_tills ? "warn" : ""} zero={Boolean(pend) && !pend.open_tills}
        sub={pend ? (pend.open_tills ? t("adm.bl.tills", { n: pend.open_tills }) : t("adm.bl.cashClosed")) : ""}
        onClick={toCash} />

      {/* Referencia, no pendiente: separadas por una línea para que se lean aparte. */}
      <Cell icon="history" label={t("adm.bl.yesterday")} hint={t("adm.bl.h.yesterday")} loading={loading} failed={!data} tone="ref"
        value={yd.value} sub={yd.sub} zero={yd.zero} onClick={() => toSales("yesterday")} />

      <Cell icon="sales" label={t("adm.bl.today")} hint={t("adm.bl.h.today")} loading={loading} failed={!data} tone="ref"
        value={td.value} sub={td.sub} zero={td.zero} onClick={() => toSales("today")} />
      </div>

      {failed && <span className="bl-note err">{t("adm.bl.error")}</span>}
      {data?.pending_truncated && <span className="bl-note">{t("adm.bl.partial")}</span>}
    </div>
  );
}
