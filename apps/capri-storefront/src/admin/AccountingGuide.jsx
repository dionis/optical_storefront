// Dónde se usa: «Productos y precios» → «Reglas y comisiones» → botón «Guía
// contable» (PricingPanel.jsx).
//
// El dueño (13-nov-2026): «debe quedar siempre claro un ejemplo de la
// contabilidad, cómo se cobraría cada rúbrica […] hay elementos que no se
// entienden: cómo se cobraría el costo fijo, variable, los costos compartidos
// […] cómo se vería cada cosa de estas en un vector fiscal». Es una ventana,
// siempre a un clic, con cinco vistas cortas:
//
//   1. Cada partida    de quién es, cada cuánto, cómo entra al mes y dónde cae.
//   2. Un mes          una tienda de ejemplo, línea por línea, con la cuenta
//                      escrita al lado de cada cifra.
//   3. Vector fiscal   las mismas cifras ordenadas por renglón del Schedule C
//                      y del Form 1120-S.
//   4. Pedido online   un pedido de la tienda online: 3 × costo, lentes, la
//                      entrega de $30 y lo que queda.
//   5. Tus números     el resultado de ESTE mes de la tienda elegida, en el
//                      mismo orden que el ejemplo.
//
// Los números del ejemplo se CALCULAN (finance/guideExample.js) con las mismas
// reglas del libro; aquí solo se pintan. Es orientación para el dueño, no
// asesoría fiscal: lo dice el pie.
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { money } from "./adminOrders.js";
import Icon from "./icons.jsx";
import { guideMonth, guideOrder } from "./finance/guideExample.js";
import { store as ls } from "./finance/model.js";
import Modal from "./pricing/matrix/Modal.jsx";

const TABS = ["kinds", "month", "vector", "order", "mine"];
/** Las partidas, en el orden en que bajan por el estado de resultados. */
const KINDS = [
  { id: "sale", tone: "in", c: "1", s: "1a" },
  { id: "salesTax", tone: "out", c: "—", s: "—" },
  { id: "delivery", tone: "in", c: "1", s: "1a" },
  { id: "cogs", tone: "cost", c: "4", s: "2" },
  { id: "cardFee", tone: "var", c: "27a", s: "19" },
  { id: "commission", tone: "var", c: "10 · 26", s: "19 · 8" },
  { id: "perSale", tone: "var", c: "22 · 27a", s: "19" },
  { id: "variable", tone: "var", c: "22", s: "19" },
  { id: "fixed", tone: "fix", c: "20b · 25 · 26", s: "11 · 19 · 8" },
  { id: "shared", tone: "fix", c: "18 · 17 · 8", s: "19 · 16" },
  { id: "taxes", tone: "fix", c: "23", s: "12" },
];
const FREQS = ["daily", "weekly", "biweekly", "monthly", "quarterly", "annual", "oneTime", "perSale"];

export default function AccountingGuide({ pnl = null, month = "", scopeLabel = "", onClose }) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState(() => { const v = ls.get("adm.fin.guide.tab", "kinds"); return TABS.includes(v) ? v : "kinds"; });
  const pick = (k) => { setTab(k); ls.set("adm.fin.guide.tab", k); };
  const m = (v) => money(Number(v) || 0, "usd", lang);
  const neg = (v) => `(${m(Math.abs(Number(v) || 0))})`;
  const g = guideMonth();
  const o = guideOrder();
  const item = (k) => g.items.find((i) => i.key === k);

  /** Una línea de la cuenta: signo, concepto, cómo se calcula, importe. */
  const Row = ({ sign = "", label, how, value, cls = "", tag }) => (
    <div className={`ag-row ${cls}`} role="row">
      <span className="ag-sign" aria-hidden="true">{sign}</span>
      <span className="ag-what" role="cell"><b>{label}</b>{tag && <span className={`ag-tag ${tag}`}>{t(`adm.fin.g.tag.${tag}`)}</span>}{how && <small>{how}</small>}</span>
      <span className="ag-val" role="cell">{value}</span>
    </div>
  );

  const monthRows = (
    <div className="ag-table" role="table" aria-label={t("adm.fin.g.tab.month")}>
      <Row sign="+" label={t("adm.fin.g.m.net")} how={t("adm.fin.g.m.netHow", { n: g.ex.sales })} value={m(g.ex.net)} cls="b" />
      <Row sign="·" label={t("adm.fin.g.m.salesTax")} how={t("adm.fin.g.m.salesTaxHow", { rate: g.ex.taxRatePct, base: m(g.ex.taxable) })} value={m(g.salesTax)} cls="aside" tag="notIncome" />
      <Row sign="−" label={t("adm.fin.g.m.cogs")} how={t("adm.fin.g.m.cogsHow", { frames: m(g.ex.cogs.frames), lenses: m(g.ex.cogs.lenses), lab: m(g.ex.cogs.lab) })} value={neg(g.cogs)} tag="cogs" />
      <Row sign="=" label={t("adm.fin.g.m.gross")} how={t("adm.fin.g.m.pctOfSales", { pct: g.grossPct })} value={m(g.grossProfit)} cls="sub" />
      <Row sign="−" label={t("adm.fin.g.m.cardFees")} how={t("adm.fin.g.m.cardFeesHow")} value={neg(g.ex.cardFees)} tag="variable" />
      <Row sign="−" label={t("adm.fin.g.m.commissions")} how={t("adm.fin.g.m.commissionsHow", { pct: g.ex.commissionPct, net: m(g.ex.net) })} value={neg(g.commissions)} tag="variable" />
      <Row sign="−" label={t("adm.fin.g.m.packaging")} how={t("adm.fin.g.m.packagingHow", { amount: m(item("packaging").amount), n: g.ex.sales })} value={neg(item("packaging").charged)} tag="perSale" />
      <Row sign="−" label={t("adm.fin.g.m.supplies")} how={t("adm.fin.g.m.suppliesHow", { amount: m(item("supplies").amount) })} value={neg(item("supplies").charged)} tag="variable" />
      <Row sign="=" label={t("adm.fin.g.m.contribution")} how={t("adm.fin.g.m.contributionHow", { pct: g.contributionPct })} value={m(g.contribution)} cls="sub" />
      <Row sign="−" label={t("adm.fin.g.m.rent")} how={t("adm.fin.g.m.rentHow", { amount: m(item("rent").amount) })} value={neg(item("rent").charged)} tag="fixed" />
      <Row sign="−" label={t("adm.fin.g.m.cleaning")} how={t("adm.fin.g.m.cleaningHow", { amount: m(item("cleaning").amount) })} value={neg(item("cleaning").charged)} tag="fixed" />
      <Row sign="−" label={t("adm.fin.g.m.insurance")} how={t("adm.fin.g.m.insuranceHow", { amount: m(item("insurance").amount) })} value={neg(item("insurance").charged)} tag="fixed" />
      <Row sign="−" label={t("adm.fin.g.m.license")} how={t("adm.fin.g.m.licenseHow", { amount: m(item("license").amount) })} value={neg(item("license").charged)} tag="taxes" />
      <Row sign="−" label={t("adm.fin.g.m.software")} how={t("adm.fin.g.m.softwareHow", { amount: m(item("software").amount), n: g.ex.chainStores, pct: g.ex.chainSharePct })} value={neg(item("software").charged)} tag="shared" />
      <Row sign="=" label={t("adm.fin.g.m.result")} how={t("adm.fin.g.m.resultHow")} value={m(g.result)} cls="fin" />
      <Row sign="" label={t("adm.fin.g.m.breakEven")} how={t("adm.fin.g.m.breakEvenHow", { fixed: m(g.fixed), pct: g.contributionPct })} value={m(g.breakEven)} cls="aside" />
    </div>
  );

  const fiscalLabel = (l) => (l.expense ? (l.key === "card_fees" ? t("adm.fin.st.l.opex.card_fees") : l.key === "commissions" ? t("adm.fin.st.l.opex.commissions") : t(`adm.fin.tax.${l.key}`)) : t(`adm.fin.g.v.${l.key}`));

  const mine = pnl ? [
    { k: "net_sales", sign: "+", v: m(pnl.net_sales), cls: "b" },
    ...(Number(pnl.shipping_income) ? [{ k: "shipping_income", sign: "+", v: m(pnl.shipping_income) }] : []),
    { k: "cogs", sign: "−", v: neg(pnl.cogs) },
    { k: "payment_fees", sign: "−", v: neg(pnl.payment_fees) },
    { k: "commissions", sign: "−", v: neg(pnl.commissions) },
    { k: "variable_manual", sign: "−", v: neg(pnl.variable_manual) },
    { k: "contribution", sign: "=", v: m(pnl.contribution), cls: "sub", how: pnl.contribution_pct == null ? "" : t("adm.fin.g.m.pctOfSales", { pct: pnl.contribution_pct }) },
    { k: "fixed", sign: "−", v: neg(pnl.fixed) },
    { k: "shared", sign: "−", v: neg(pnl.shared) },
    { k: "result", sign: "=", v: Number(pnl.result) < 0 ? neg(pnl.result) : m(pnl.result), cls: `fin ${Number(pnl.result) < 0 ? "neg" : ""}` },
    { k: "break_even", sign: "", v: pnl.break_even == null ? "—" : m(pnl.break_even), cls: "aside" },
  ] : [];

  return (
    <Modal
      wide
      title={t("adm.fin.g.title")}
      sub={t("adm.fin.g.sub")}
      onClose={onClose}
      initialFocus=".ag-tab.on"
      footer={(
        <>
          <span className="grow ag-foot"><Icon name="info" size={12} /> {t("adm.fin.g.disclaimer")}</span>
          <button type="button" className="btn-sm primary" onClick={onClose}>{t("adm.fin.g.close")}</button>
        </>
      )}
    >
      <div className="ag">
        <div className="ag-tabs" role="tablist" aria-label={t("adm.fin.g.title")}>
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ag-tab ${tab === k ? "on" : ""}`} onClick={() => pick(k)}>{t(`adm.fin.g.tab.${k}`)}</button>
          ))}
        </div>

        {tab === "kinds" && (
          <section className="ag-sec" role="tabpanel">
            <p className="ag-lead">{t("adm.fin.g.kinds.lead")}</p>
            <div className="ag-kinds">
              {KINDS.map((k) => (
                <article key={k.id} className={`ag-kind ${k.tone}`}>
                  <h4>{t(`adm.fin.g.k.${k.id}.name`)}<span className={`ag-tag ${k.tone}`}>{t(`adm.fin.g.tone.${k.tone}`)}</span></h4>
                  <dl>
                    <div><dt>{t("adm.fin.g.col.who")}</dt><dd>{t(`adm.fin.g.k.${k.id}.who`)}</dd></div>
                    <div><dt>{t("adm.fin.g.col.when")}</dt><dd>{t(`adm.fin.g.k.${k.id}.when`)}</dd></div>
                    <div><dt>{t("adm.fin.g.col.how")}</dt><dd>{t(`adm.fin.g.k.${k.id}.how`)}</dd></div>
                    <div><dt>{t("adm.fin.g.col.where")}</dt><dd>{t(`adm.fin.g.k.${k.id}.where`)} <span className="ag-line">Sch. C {k.c} · 1120-S {k.s}</span></dd></div>
                  </dl>
                </article>
              ))}
            </div>
            <h4 className="ag-h">{t("adm.fin.g.freq.title")}</h4>
            <p className="ag-lead">{t("adm.fin.g.freq.lead")}</p>
            <div className="ag-freqs">
              {FREQS.map((f) => (
                <div key={f} className="ag-freq"><b>{t(`adm.fin.g.freq.${f}`)}</b><span>{t(`adm.fin.g.freq.${f}How`)}</span></div>
              ))}
            </div>
          </section>
        )}

        {tab === "month" && (
          <section className="ag-sec" role="tabpanel">
            <p className="ag-lead">{t("adm.fin.g.month.lead", { n: g.ex.sales, net: m(g.ex.net), stores: g.ex.chainStores })}</p>
            {monthRows}
            <p className="ag-note"><Icon name="info" size={12} /> {t("adm.fin.g.month.note")}</p>
          </section>
        )}

        {tab === "vector" && (
          <section className="ag-sec" role="tabpanel">
            <p className="ag-lead">{t("adm.fin.g.vector.lead")}</p>
            <div className="ag-vector" aria-hidden="true">
              {g.fiscal.map((l) => (
                <span key={l.key} className={`ag-cell ${l.strong ? "b" : ""} ${l.final ? "fin" : ""}`}>
                  <small>{l.schedule_c}</small>
                  <b>{l.minus ? neg(l.amount) : m(l.amount)}</b>
                  <em>{fiscalLabel(l)}</em>
                </span>
              ))}
            </div>
            <div className="ag-ftable" role="table" aria-label={t("adm.fin.g.tab.vector")}>
              <div className="ag-frow head" role="row">
                <span role="columnheader">{t("adm.fin.g.vector.line")}</span>
                <span role="columnheader">Schedule C</span>
                <span role="columnheader">1120-S</span>
                <span role="columnheader" className="num">{t("adm.fin.g.vector.amount")}</span>
              </div>
              {g.fiscal.map((l) => (
                <div key={l.key} className={`ag-frow ${l.strong ? "b" : ""} ${l.final ? "fin" : ""} ${l.expense ? "lv2" : ""}`} role="row">
                  <span role="cell">{fiscalLabel(l)}</span>
                  <span role="cell" className="ln">{l.schedule_c}</span>
                  <span role="cell" className="ln">{l.f1120s}</span>
                  <span role="cell" className="num">{l.minus ? neg(l.amount) : m(l.amount)}</span>
                </div>
              ))}
              <div className="ag-frow aside" role="row">
                <span role="cell">{t("adm.fin.g.m.salesTax")}</span>
                <span role="cell" className="ln">—</span>
                <span role="cell" className="ln">—</span>
                <span role="cell" className="num">{m(g.salesTax)}</span>
              </div>
            </div>
            <ul className="ag-list">
              <li>{t("adm.fin.g.vector.n1")}</li>
              <li>{t("adm.fin.g.vector.n2")}</li>
              <li>{t("adm.fin.g.vector.n3")}</li>
              <li>{t("adm.fin.g.vector.n4")}</li>
            </ul>
          </section>
        )}

        {tab === "order" && (
          <section className="ag-sec" role="tabpanel">
            <p className="ag-lead">{t("adm.fin.g.order.lead")}</p>
            <div className="ag-table" role="table" aria-label={t("adm.fin.g.tab.order")}>
              <Row sign="+" label={t("adm.fin.g.o.frame")} how={t("adm.fin.g.o.frameHow", { cost: m(o.ex.frameCost), n: o.ex.multiple })} value={m(o.framePrice)} />
              <Row sign="+" label={t("adm.fin.g.o.lenses")} how={t("adm.fin.g.o.lensesHow")} value={m(o.ex.lensPrice)} />
              <Row sign="+" label={t("adm.fin.g.o.delivery")} how={t("adm.fin.g.o.deliveryHow")} value={m(o.ex.delivery)} />
              <Row sign="=" label={t("adm.fin.g.o.paid")} how={t("adm.fin.g.o.paidHow", { sales: m(o.sales), delivery: m(o.ex.delivery) })} value={m(o.paid)} cls="sub" />
              <Row sign="−" label={t("adm.fin.g.o.cogs")} how={t("adm.fin.g.o.cogsHow", { frame: m(o.ex.frameCost), lens: m(o.ex.lensCost) })} value={neg(o.cogs)} tag="cogs" />
              <Row sign="−" label={t("adm.fin.g.o.gateway")} how={t("adm.fin.g.o.gatewayHow", { pct: o.ex.gatewayPct, fixed: m(o.ex.gatewayFixed), paid: m(o.paid) })} value={neg(o.gateway)} tag="variable" />
              <Row sign="−" label={t("adm.fin.g.o.carrier")} how={t("adm.fin.g.o.carrierHow")} value={neg(o.ex.carrier)} tag="perSale" />
              <Row sign="=" label={t("adm.fin.g.o.left")} how={t("adm.fin.g.o.leftHow", { pct: o.leftPct })} value={m(o.left)} cls="fin" />
            </div>
            <ul className="ag-list">
              <li>{t("adm.fin.g.order.n1")}</li>
              <li>{t("adm.fin.g.order.n2")}</li>
              <li>{t("adm.fin.g.order.n3")}</li>
            </ul>
          </section>
        )}

        {tab === "mine" && (
          <section className="ag-sec" role="tabpanel">
            {pnl ? (
              <>
                <p className="ag-lead">{t("adm.fin.g.mine.lead", { month, scope: scopeLabel })}</p>
                <div className="ag-table" role="table" aria-label={t("adm.fin.g.tab.mine")}>
                  {mine.map((r) => <Row key={r.k} sign={r.sign} label={t(`adm.fin.g.my.${r.k}`)} how={r.how ?? t(`adm.fin.g.my.${r.k}How`)} value={r.v} cls={r.cls || ""} />)}
                </div>
                <p className="ag-note"><Icon name="info" size={12} /> {t("adm.fin.g.mine.note")}</p>
              </>
            ) : <p className="ag-lead">{t("adm.fin.g.mine.none")}</p>}
          </section>
        )}
      </div>
    </Modal>
  );
}
