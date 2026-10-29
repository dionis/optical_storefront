// Dónde se usa: pestaña «Estado de tienda» de /admin — la visión general de UNA
// tienda ahora mismo, para el dueño, los superadmin (cualquier tienda) y el
// supervisor y el encargado (las suyas; arrancan aquí). Ventas de hoy contra
// ayer, semana y mes; quién vende; cada punto de venta con su caja; lo que
// espera a alguien; las últimas ventas y los avisos. Solo lectura: cada
// acción vive en su pestaña y aquí se llega con un clic. Backend:
// GET /admin/store-status (lib/store-status.ts).
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { money, shortDate } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";

const STORE_KEY = "adm_store_status";
const readStore = () => { try { return localStorage.getItem(STORE_KEY) || ""; } catch { return ""; } };
const writeStore = (v) => { try { localStorage.setItem(STORE_KEY, v); } catch { /* sin almacenamiento: no se recuerda */ } };

function pctDelta(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

const timeOf = (iso, lang) => new Date(iso).toLocaleTimeString(lang === "en" ? "en-US" : "es", { hour: "2-digit", minute: "2-digit" });

export default function StoreStatus({ go, tabs = [] }) {
  const { t, lang } = useLang();
  const [storeId, setStoreId] = useState(readStore);
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const can = (tab) => tabs.includes(tab);
  const link = (tab, params) => (go && can(tab) ? () => go(tab, params) : undefined);

  const load = (id = storeId) => {
    setState("loading");
    adminFetch("/admin/store-status", { query: id ? { store: id } : {} })
      .then((r) => { setData(r); setState("ok"); })
      .catch((e) => {
        // La tienda recordada ya no está en su alcance: se vuelve a la primera.
        if (id && (e?.reason === "store_not_found" || e?.reason === "forbidden_store")) { writeStore(""); setStoreId(""); load(""); return; }
        setState("error");
      });
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (id) => { setStoreId(id); writeStore(id); load(id); };

  const m = (v) => money(v, "usd", lang);
  if (state === "loading" && !data) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (state === "error" && !data) {
    return <div className="adm-section"><div className="adm-demo-banner">{t("adm.ss.loadFailed")}</div><button className="btn-sm" onClick={() => load()}>{t("adm.ss.retry")}</button></div>;
  }
  if (!data?.status) return <div className="adm-section"><div className="adm-empty"><Icon name="store" size={36} /><b>{t("adm.pos.noStores")}</b></div></div>;

  const s = data.status;
  const dToday = pctDelta(s.today.total, s.yesterday.total);
  const openRegisters = s.tills.filter((x) => x.register).length;
  const activeTills = s.tills.filter((x) => x.is_active).length;
  const p = s.pending;

  return (
    <div className="adm-section ss">
      <div className="adm-head-row">
        <div>
          <h2>{t("adm.tab.storestatus")}</h2>
          <p className="adm-sub ss-sub">{t("adm.ss.sub")}</p>
        </div>
        <div className="ss-tools">
          {data.stores.length > 1 ? (
            <select className="adm-input" value={s.store.id} onChange={(e) => pick(e.target.value)} aria-label={t("adm.pos.store")} title={t("adm.pos.store")}>
              {data.stores.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
            </select>
          ) : <span className="adm-team-tag"><Icon name="store" size={12} /> {s.store.code} · {s.store.name}</span>}
          <button type="button" className="btn-xs" onClick={() => load(s.store.id)} disabled={state === "loading"} aria-label={t("adm.my.refresh")} title={t("adm.my.refresh")}><Icon name="refresh" size={13} /></button>
        </div>
      </div>

      {/* Lo que necesita atención, lo más urgente primero. */}
      {s.attention.length > 0 ? (
        <div className="ss-attention">
          {s.attention.map((a, i) => {
            const target = { approvals_pending: "approvals", voids_requested: "possales", ready_to_hand: "possales", register_open_long: "cash", till_without_register: "cash", no_active_till: "stores", counter_seller_inactive: "sellers" }[a.kind];
            const onClick = link(target);
            return (
              <button type="button" key={`${a.kind}-${a.ref || i}`} className={`ss-alert ${a.tone}`} onClick={onClick} disabled={!onClick}>
                <Icon name={a.tone === "info" ? "info" : "alert"} size={14} />
                <span>{t(`adm.ss.att.${a.kind}`, { n: a.n, ref: a.ref || "" })}</span>
                {onClick && <Icon name="chevronRight" size={14} />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="ss-allgood"><Icon name="checkCircle" size={16} /> {t("adm.ss.allGood")}</div>
      )}

      <div className="my-periods">
        <button type="button" className="my-period hero" onClick={link("salesboard")} disabled={!link("salesboard")}>
          <small>{t("adm.my.today")}</small>
          <b>{m(s.today.total)}</b>
          <span>
            {t("adm.my.periodSub", { n: s.today.count, avg: m(s.today.avg_ticket) })}
            {dToday !== null && <> · <em className={dToday >= 0 ? "up" : "down"}>{t("adm.ss.vsYesterday", { pct: `${dToday > 0 ? "+" : ""}${dToday}` })}</em></>}
          </span>
        </button>
        {["week", "month"].map((k) => (
          <button type="button" key={k} className="my-period" onClick={link("salesboard")} disabled={!link("salesboard")}>
            <small>{t(`adm.my.${k}`)}</small>
            <b>{m(s[k].total)}</b>
            <span className="muted">{t("adm.my.periodSub", { n: s[k].count, avg: m(s[k].avg_ticket) })}</span>
          </button>
        ))}
      </div>

      <div className="ss-pending">
        {[
          { k: "approvals", n: p.approvals, icon: "hand", tab: "approvals" },
          { k: "voids", n: p.voids, icon: "alert", tab: "possales" },
          { k: "ready", n: p.ready.length, icon: "box", tab: "possales" },
          { k: "balance", n: p.with_balance.count, icon: "dollar", tab: "possales", extra: m(p.with_balance.amount) },
          { k: "insurance", n: p.insurance_claims, icon: "receipt", tab: "possales", extra: m(s.insurance_due) },
        ].map((x) => (
          <button type="button" key={x.k} className={`ss-pend ${x.n ? "on" : ""}`} onClick={link(x.tab)} disabled={!link(x.tab)}>
            <Icon name={x.icon} size={16} />
            <b>{x.n}</b>
            <small>{t(`adm.ss.pend.${x.k}`)}</small>
            {x.extra && x.n > 0 && <em>{x.extra}</em>}
          </button>
        ))}
      </div>

      <div className="my-grid">
        <div className="adm-card">
          <h3>
            <Icon name="receipt" size={16} /> {t("adm.ss.tills")}
            <span className="muted ss-h-note">{t("adm.ss.tillsNote", { open: openRegisters, active: activeTills })}</span>
          </h3>
          {!s.tills.length ? <div className="adm-nodata">{t("adm.stores.tills.empty")}</div> : (
            <ul className="ss-list">
              {s.tills.map((x) => (
                <li key={x.id} className={x.is_active ? "" : "off"}>
                  <span className="ss-list-main">
                    <b>{x.code}{x.name ? ` · ${x.name}` : ""}</b>
                    <small className="muted">
                      {x.sellers.length ? x.sellers.map((v) => v.code).join(", ") : t("adm.ss.noSellers")}
                    </small>
                  </span>
                  {!x.is_active ? <span className="adm-chip bad">{t("adm.stores.tills.status.inactive")}</span>
                    : x.register ? (
                      <span className="ss-reg">
                        <span className="adm-chip ok"><Icon name="wallet" size={11} />{t("adm.ss.regOpen", { time: timeOf(x.register.opened_at, lang) })}</span>
                        <small className="muted">{t("adm.ss.expected", { v: m(x.register.expected) })}</small>
                      </span>
                    ) : <span className="adm-chip neutral"><Icon name="wallet" size={11} />{t("adm.my.cashClosed")}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="ss-card-links">
            {link("cash") && <button type="button" className="btn-xs" onClick={link("cash")}>{t("adm.tab.cash")} <Icon name="arrowRight" size={12} /></button>}
            {link("stores") && <button type="button" className="btn-xs" onClick={link("stores")}>{t("adm.ss.manageTills")} <Icon name="arrowRight" size={12} /></button>}
          </div>
        </div>

        <div className="adm-card">
          <h3><Icon name="sellers" size={16} /> {t("adm.ss.sellersToday")}</h3>
          {!s.sellers.length ? <div className="adm-nodata">{t("adm.ss.noSellersStore")}</div> : (
            <ul className="ss-list">
              {s.sellers.map((v) => (
                <li key={v.id} className={v.active ? "" : "off"}>
                  <span className="ss-list-main">
                    <b>{v.name} <span className="sel-code">{v.code}</span></b>
                    <small className="muted">
                      {[v.terminal_code, v.has_user ? t("adm.sel.counterUser") : t("adm.ss.referralOnly"), v.active ? null : t("adm.stores.tills.status.inactive")].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                  <span className="ss-num"><b>{m(v.today_total)}</b><small className="muted">{t("adm.ss.salesN", { n: v.today_count })}</small></span>
                </li>
              ))}
            </ul>
          )}
          {link("sellers") && <div className="ss-card-links"><button type="button" className="btn-xs" onClick={link("sellers")}>{t("adm.tab.sellers")} <Icon name="arrowRight" size={12} /></button></div>}
        </div>
      </div>

      <div className="my-grid">
        <div className="adm-card">
          <h3><Icon name="receipt" size={16} /> {t("adm.ss.recent")}</h3>
          {!s.recent.length ? <div className="adm-nodata">{t("adm.ss.noRecent")}</div> : (
            <ul className="my-recent">
              {s.recent.map((r) => (
                <li key={r.id}>
                  <span className="my-recent-main">
                    <b>{r.number}</b>
                    <small className="muted">{[shortDate(r.created_at, lang), timeOf(r.created_at, lang), r.seller_code, r.terminal_code].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className="my-recent-tags">
                    {r.status === "voided" && <span className="adm-chip bad">{t("adm.my.voided")}</span>}
                    {r.status !== "voided" && r.balance > 0 && <span className="adm-chip neutral">{t("adm.my.toCollect", { v: m(r.balance) })}</span>}
                    {r.status !== "voided" && r.delivered && <span className="adm-chip ok">{t("adm.my.delivered")}</span>}
                  </span>
                  <b className="my-recent-total">{m(r.total)}</b>
                </li>
              ))}
            </ul>
          )}
          {link("possales") && s.recent.length > 0 && <button type="button" className="btn-xs" onClick={link("possales")}>{t("adm.my.seeAll")} <Icon name="arrowRight" size={12} /></button>}
        </div>

        <div className="adm-card">
          <h3><Icon name="hand" size={16} /> {t("adm.my.ready", { n: p.ready.length })}</h3>
          {!p.ready.length ? <div className="adm-nodata">{t("adm.my.noneReady")}</div> : (
            <ul className="pos-lines">
              {p.ready.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <Icon name="hand" size={16} />
                  <span><b>{r.number}</b>{r.seller_code ? ` · ${r.seller_code}` : ""} · {t(`adm.my.stage.${r.stage}`)}{r.balance > 0 ? ` · ${t("adm.my.toCollect", { v: m(r.balance) })}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted ss-foot">{t("adm.ss.balanceFoot", { v: m(s.balance_due) })}</p>
        </div>
      </div>
    </div>
  );
}
