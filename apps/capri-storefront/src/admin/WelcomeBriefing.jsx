// Dónde se usa: AdminDashboard.jsx, en cada recarga del navegador (no al cambiar
// de pestaña dentro del panel). Tarjeta flotante arriba del panel — nunca un
// modal que bloquee — con cómo arranca el día de quien entra:
//  · vendedor: SUS ventas de hoy, la semana y el mes, comisión del mes, caja y
//    pedidos listos para entregar (GET /admin/sales-analytics/me, lo puede
//    llamar cualquier rol);
//  · los demás (dueño, superadmin, supervisor, encargado): todo lo suyo hoy /
//    semana / mes y una línea por tienda con su color (tres lecturas de
//    GET /admin/sales-analytics/breakdown?by=establishment, que el servidor
//    acota a sus tiendas), más descuentos por aprobar y cajas abiertas.
// Pinta esqueletos mientras carga y «Omitir» solo la oculta en esta carga.
// Props: `me` (GET /admin/team/me), `onDone`, `go` (opcional: «Nueva venta» → POS).
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminFetch } from "./adminApi.js";
import { money } from "./adminOrders.js";
import { listApprovals } from "./posApi.js";
import { useStoreFilter } from "./StoreFilter.jsx";
import { WEB_STORE, defaultColorForStore } from "./useStoreTheme.js";
import "./screens.css";

const PERIODS = ["today", "week", "month"];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Hoy, lunes de esta semana y día 1 del mes, en la fecha local del navegador. */
function periodRanges() {
  const now = new Date();
  const today = ymd(now);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return { today: { from: today, to: today }, week: { from: ymd(monday), to: today }, month: { from: `${today.slice(0, 8)}01`, to: today } };
}

const isSeller = (me) => me?.is_admin === false && me?.role === "seller";

/** El vendedor: sus propias cifras del panel «Mi panel». */
async function loadSeller() {
  const d = await adminFetch("/admin/sales-analytics/me");
  return {
    periods: { today: d.today, week: d.week, month: d.month },
    commission: d.commission?.amount ?? null,
    ready: (d.ready || []).length,
    cashOpen: d.workplace ? (d.workplace.cash_open ? 1 : 0) : null,
    workplace: d.workplace?.store || null,
  };
}

/** Los demás: totales y por tienda en una sola lectura por periodo. */
async function loadBusiness() {
  const r = periodRanges();
  const rows = await Promise.all(PERIODS.map((k) => adminFetch(`/admin/sales-analytics/breakdown?by=establishment&from=${r[k].from}&to=${r[k].to}`).then((x) => x.rows || [])));
  const periods = {};
  const byStore = new Map();
  PERIODS.forEach((k, i) => {
    periods[k] = rows[i].reduce((a, x) => ({ total: a.total + x.total, count: a.count + x.count }), { total: 0, count: 0 });
    for (const x of rows[i]) {
      const key = x.key || "none";
      const cur = byStore.get(key) || { key, today: 0, week: 0, month: 0 };
      cur[k] = x.total;
      byStore.set(key, cur);
    }
  });
  return { periods, stores: [...byStore.values()].sort((a, b) => b.month - a.month) };
}

/** Pendientes baratos: descuentos por aprobar y cajas abiertas (ambas rutas las ve cualquier rol). */
async function loadExtras() {
  const [a, c] = await Promise.allSettled([listApprovals("pending"), adminFetch("/admin/pos/cash-sessions")]);
  return {
    approvals: a.status === "fulfilled" ? (a.value?.approvals || []).length : null,
    cashOpen: c.status === "fulfilled" ? (c.value?.sessions || []).filter((s) => !s.closed_at).length : null,
  };
}

const Skel = ({ w = "70%" }) => <span className="adm-skel" style={{ width: w }} aria-hidden="true" />;

export default function WelcomeBriefing({ me, onDone, go }) {
  const { t, lang } = useLang();
  const seller = isSeller(me);
  const { store, stores } = useStoreFilter(me);
  const [data, setData] = useState(null);
  const [extras, setExtras] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let on = true;
    (seller ? loadSeller() : loadBusiness()).then((d) => on && setData(d)).catch(() => on && setFailed(true));
    if (!seller) loadExtras().then((x) => on && setExtras(x)).catch(() => {});
    return () => { on = false; };
  }, [me?.id, seller]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayName = me?.display_name || me?.first_name || String(me?.email || "").split("@")[0];
  const initials = displayName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const m = (v) => money(v ?? 0, "usd", lang);
  const roleLabel = me?.role ? t(`adm.team.role.${me.role}`) : "";

  // Nombre y color de cada tienda del desglose: las del tema (con color) o la online.
  const storeInfo = useMemo(() => {
    const map = new Map(stores.map((s) => [s.id, { name: `${s.code ? `${s.code} · ` : ""}${s.name}`, color: s.color || defaultColorForStore(s.name) }]));
    map.set(WEB_STORE.id, { name: t("adm.theme.online"), color: WEB_STORE.color });
    return map;
  }, [stores, t]);
  const where = seller ? (data?.workplace ? `${data.workplace.code} · ${data.workplace.name}` : store ? `${store.code} · ${store.name}` : "") : store ? (store.online ? t("adm.theme.online") : `${store.code} · ${store.name}`) : t("adm.theme.allStores");
  const whereColor = store ? store.color || defaultColorForStore(store.name) : null;

  const approvals = seller ? null : extras?.approvals;
  const cashOpen = seller ? data?.cashOpen : extras?.cashOpen;

  const skip = () => onDone?.();
  const newSale = () => { go?.("pos"); onDone?.(); };

  return (
    <div className="wb-wrap" role="region" aria-label={t("adm.wb.sub")}>
      <div className="wb-card">
        <button type="button" className="wb-close" onClick={skip} aria-label={t("adm.wb.close")} title={t("adm.wb.close")}><Icon name="close" size={16} /></button>
        <div className="wb-head">
          <span className="wb-avatar">{me?.photo_url ? <img src={me.photo_url} alt="" /> : initials}</span>
          <div className="wb-who">
            <h2>{t("adm.wb.greeting", { name: displayName })}</h2>
            <small>
              {roleLabel && <span>{roleLabel}</span>}
              {where && <span><i className="dot" style={{ background: whereColor || "var(--adm-muted)" }} /> {where}</span>}
              {me?.seller_code && <span className="adm-team-tag code">{me.seller_code}</span>}
            </small>
          </div>
        </div>

        <p className="wb-scope">{seller ? t("adm.wb.mine") : t("adm.wb.business")} · {t("adm.wb.sub")}</p>
        <div className="wb-kpis">
          {PERIODS.map((k) => {
            const p = data?.periods?.[k];
            return (
              <div key={k} className={`wb-kpi ${k === "today" ? "hero" : ""}`}>
                <small>{t(`adm.my.${k}`)}</small>
                {p ? <b>{m(p.total)}</b> : failed ? <b>—</b> : <Skel />}
                {p ? <span>{t("adm.wb.sales", { n: p.count })}</span> : <span>&nbsp;</span>}
              </div>
            );
          })}
        </div>

        {!seller && (
          <div>
            <p className="wb-scope">{t("adm.wb.byStore")}</p>
            <ul className="wb-stores">
              {!data && !failed && [0, 1].map((i) => <li key={i} className="wb-store"><span className="name"><Skel w="60%" /></span><b><Skel w="100%" /></b><b><Skel w="100%" /></b><b><Skel w="100%" /></b></li>)}
              {data?.stores?.map((s) => {
                const info = storeInfo.get(s.key);
                return (
                  <li key={s.key} className="wb-store">
                    <span className="name"><i className="dot" style={{ background: info?.color || "var(--adm-muted)" }} />{info?.name || s.key}</span>
                    <b className="hero" title={t("adm.my.today")}>{m(s.today)}</b>
                    <b title={t("adm.my.week")}>{m(s.week)}</b>
                    <b title={t("adm.my.month")}>{m(s.month)}</b>
                  </li>
                );
              })}
              {data && !data.stores?.length && <li className="wb-store muted">{t("adm.wb.noStoreSales")}</li>}
            </ul>
          </div>
        )}

        {failed && <p className="wb-err">{t("adm.wb.error")}</p>}
        <div className="wb-pills">
          {seller && data?.commission != null && <span className="wb-pill gold"><Icon name="percent" size={12} /> {t("adm.wb.commission")}: {m(data.commission)}</span>}
          {seller && data && data.ready > 0 && <button type="button" className={`wb-pill ${go ? "click" : ""}`} onClick={() => { go?.("possales"); onDone?.(); }}><Icon name="hand" size={12} /> {t("adm.wb.ready", { n: data.ready })}</button>}
          {approvals != null && approvals > 0 && <button type="button" className={`wb-pill warn ${go ? "click" : ""}`} onClick={() => { go?.("approvals"); onDone?.(); }}><Icon name="alert" size={12} /> {t("adm.wb.approvals", { n: approvals })}</button>}
          {cashOpen != null && (seller
            ? <span className={`wb-pill ${cashOpen ? "ok" : ""}`}><Icon name="wallet" size={12} /> {t(cashOpen ? "adm.wb.cashOne" : "adm.wb.cashClosed")}</span>
            : cashOpen > 0 && <button type="button" className={`wb-pill ok ${go ? "click" : ""}`} onClick={() => { go?.("cash"); onDone?.(); }}><Icon name="wallet" size={12} /> {t("adm.wb.cashOpen", { n: cashOpen })}</button>)}
        </div>

        <div className="wb-foot">
          <button type="button" className="btn-sm ghost" onClick={skip}>{t("adm.wb.skip")}</button>
          {go && <button type="button" className="btn-sm" onClick={newSale}><Icon name="plus" size={14} /> {t("adm.wb.newSale")}</button>}
          <button type="button" className="btn-sm primary" onClick={skip}>{t("adm.wb.start")} <Icon name="chevronRight" size={14} /></button>
        </div>
      </div>
    </div>
  );
}

/**
 * Antes: «ya se mostró en esta pestaña» (sessionStorage). Ahora el resumen sale
 * en CADA recarga del navegador, así que siempre es falso; AdminDashboard puede
 * dejar de llamarlo (`useState(() => !demo && me)`).
 */
export function briefingShown() {
  return false;
}
