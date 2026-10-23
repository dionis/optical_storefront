// Dónde se usa: /vendedor?t=TOKEN — panel público y sencillo de un vendedor:
// su enlace de referido para compartir en redes, cuántas ventas trajo y qué
// comisión lleva. Sin login: el enlace firmado (que le da el dueño desde el
// panel) es la credencial; el dueño puede regenerarlo cuando quiera.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { fetchSellerDashboard } from "../data/referral.js";
import { copyText } from "../admin/adminSellers.js";
import { money as fmtMoney, shortDate, STAGE_BY_KEY, TERMINAL_BY_KEY } from "../admin/adminOrders.js";
import { TENANT } from "../config/tenant.js";
import Icon from "../admin/icons.jsx";
import { SocialLinks, SOURCE_ICON } from "../admin/sellerShared.jsx";
import "../admin/admin.css";

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const RANGES = ["month", "30d", "90d", "all"];
function rangeFrom(k) {
  if (k === "all") return "";
  if (k === "month") { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
  return ymd(Date.now() - ({ "30d": 30, "90d": 90 }[k] || 30) * 864e5);
}

export default function SellerDashboard() {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [params] = useSearchParams();
  const token = params.get("t") || "";
  const [range, setRange] = useState("month");
  const [data, setData] = useState(null);
  const [state, setState] = useState(token ? "loading" : "notoken");
  useEffect(() => { document.title = `${t("vd.title")} · ${TENANT.name}`; }, [t]);
  useEffect(() => {
    if (!token) return undefined;
    let on = true;
    setState("loading");
    fetchSellerDashboard(token, { from: rangeFrom(range) })
      .then((d) => { if (on) { setData(d); setState("ok"); } })
      .catch((e) => { if (on) setState(e.status === 401 ? "badtoken" : "error"); });
    return () => { on = false; };
  }, [token, range]);

  const seller = data?.seller;
  const text = t("adm.sel.shareText", { name: TENANT.name });
  const copy = async (v, label) => toast({ tone: (await copyText(v)) ? "success" : "error", title: label });
  const stageText = (o) => (o.terminal && o.terminal !== "payment_pending" ? t(TERMINAL_BY_KEY[o.terminal]?.label || o.terminal) : t(STAGE_BY_KEY[o.stage]?.label || o.stage));

  return (
    <div className="vd-page" style={{ maxWidth: 1040, margin: "0 auto", padding: "26px 16px 60px", fontFamily: "var(--adm-font)" }}>
      {state === "notoken" || state === "badtoken" ? (
        <div className="adm-card"><div className="adm-empty"><Icon name="lock" size={40} /><b>{t("vd.noAccess")}</b><p>{t("vd.noAccessHint", { name: TENANT.name })}</p><Link to="/" className="btn-sm primary">{t("adm.viewStore")}</Link></div></div>
      ) : state === "error" ? (
        <div className="adm-login-err">{t("vd.error")}</div>
      ) : (
        <>
          <div className="adm-head-row" style={{ marginBottom: 6 }}>
            <div className="sel-head">
              <span className="sel-avatar"><Icon name="sellers" size={20} /></span>
              <div className="sel-name"><b style={{ fontSize: 22, fontFamily: "var(--adm-display)" }}>{seller ? t("vd.hello", { name: seller.name }) : <span className="adm-skel" style={{ display: "inline-block", width: 180, height: 22 }} />}</b><small>{t("vd.sub", { name: TENANT.name })}</small></div>
            </div>
            <div className="adm-range">{RANGES.map((k) => <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{t(`vd.range.${k}`)}</button>)}</div>
          </div>

          {seller && (
            <div className="adm-card" style={{ marginBottom: 16 }}>
              <h3><Icon name="link" size={16} />{t("vd.yourLink")}</h3>
              <p className="adm-sub">{t("vd.linkHint")}</p>
              <div className="sel-link" style={{ fontSize: 14 }}><Icon name="link" size={15} /><code style={{ fontSize: 14 }}>{seller.referral_url}</code><button type="button" className="btn-sm primary" onClick={() => copy(seller.referral_url, t("adm.sel.copied"))}><Icon name="copy" size={14} />{t("adm.sel.copy")}</button></div>
              <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 6px" }}>{t("vd.perNetwork")}</p>
              <SocialLinks seller={seller} text={text} stat={{ by_source: data?.totals?.by_source || [] }} onCopy={copy} big />
              <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}><Icon name="sparkles" size={12} /> {t("vd.codeHint", { code: seller.code })}</p>
            </div>
          )}

          <div className="cost-kpi-row">
            <div className="cost-kpi"><small><Icon name="orders" size={13} />{t("vd.orders")}</small><b>{data?.totals?.orders ?? <span className="adm-skel" style={{ display: "inline-block", width: 40, height: 24 }} />}</b><em>{t(`vd.range.${range}`)}</em></div>
            <div className="cost-kpi"><small><Icon name="dollar" size={13} />{t("vd.sales")}</small><b>{data ? fmtMoney(data.totals.revenue, data.totals.currency_code || "usd", lang) : "…"}</b></div>
            <div className="cost-kpi good"><small><Icon name="percent" size={13} />{t("vd.commission", { pct: seller?.commission_pct ?? "" })}</small><b>{data ? fmtMoney(data.totals.commission, data.totals.currency_code || "usd", lang) : "…"}</b></div>
            <div className="cost-kpi"><small><Icon name="trendUp" size={13} />{t("vd.allTime")}</small><b>{data ? fmtMoney(data.all_time.commission, data.totals.currency_code || "usd", lang) : "…"}</b><em>{data ? t("vd.allTimeSub", { n: data.all_time.orders, amount: fmtMoney(data.all_time.revenue, data.totals.currency_code || "usd", lang) }) : ""}</em></div>
          </div>

          <div className="adm-card">
            <h3><Icon name="sales" size={16} />{t("vd.recent")}</h3>
            {state === "loading" && !data ? <div className="adm-skel-rows"><div className="adm-skel" /><div className="adm-skel" /></div> : (data?.orders || []).length === 0 ? (
              <div className="adm-empty"><Icon name="megaphone" size={36} /><b>{t("vd.noOrders")}</b><p>{t("vd.noOrdersHint")}</p></div>
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table responsive">
                  <thead><tr><th>{t("adm.col.order")}</th><th>{t("adm.col.date")}</th><th>{t("vd.customer")}</th><th className="r">{t("adm.col.items")}</th><th className="r">{t("adm.col.total")}</th><th>{t("adm.ord.colStage")}</th><th className="r">{t("vd.yourCommission")}</th></tr></thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.display_id}>
                        <td data-label={t("adm.col.order")}><b>#{o.display_id}</b></td>
                        <td data-label={t("adm.col.date")}>{shortDate(o.created_at, lang)}</td>
                        <td data-label={t("vd.customer")}>{o.customer || "—"}{o.source && <span className="adm-chip neutral" style={{ marginLeft: 6, fontSize: 10.5 }}><Icon name={SOURCE_ICON[o.source] || "link"} size={11} />{t(`adm.src.${o.source}`) === `adm.src.${o.source}` ? o.source : t(`adm.src.${o.source}`)}</span>}</td>
                        <td data-label={t("adm.col.items")} className="r num">{o.items}</td>
                        <td data-label={t("adm.col.total")} className="r num">{fmtMoney(o.total, o.currency_code, lang)}</td>
                        <td data-label={t("adm.ord.colStage")}><span className={`adm-chip ${o.terminal && o.terminal !== "payment_pending" ? "bad" : o.stage === "delivered" ? "ok" : ""}`}>{stageText(o)}</span></td>
                        <td data-label={t("vd.yourCommission")} className="r num"><b>{fmtMoney(o.commission, o.currency_code, lang)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{t("vd.privacy")}</p>
          </div>
        </>
      )}
    </div>
  );
}
