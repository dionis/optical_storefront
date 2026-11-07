// Dónde se usa: pestaña «Pacientes» del panel (dueño, superadmin, supervisor y
// encargado; docs/PATIENTS.md). A la izquierda la lista de pacientes con lo que
// han comprado (compras, total, promedio, última compra y categoría: nuevo,
// recurrente, VIP, inactivo); a la derecha la ficha del elegido en acordeones:
// datos, historial de compras (total gastado y promedio), evolución de la
// graduación y próximo examen. Todo sale de GET /admin/patients(/:id): los
// totales los calcula el servidor (sale_fact, POS + web, sin anuladas).
// La receta es dato de salud: la ficha no se exporta ni se imprime desde aquí,
// y cada apertura queda en Auditoría (`patient.view`).
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Accordion from "./Accordion.jsx";
import Icon from "./icons.jsx";
import { money, shortDate } from "./adminOrders.js";
import { fetchPatient, fetchPatients } from "./posApi.js";
import { useStoreFilter } from "./StoreFilter.jsx";
import { DESIGNS, MATERIALS, PHOTO, AR_OPTIONS, L } from "../data/lensPricing.js";
import "./patients.css";

const SORTS = ["recent", "total", "purchases", "avg"];
const TIERS = ["vip", "returning", "new"];
const lensName = (list, code, lang) => {
  if (!code) return "";
  const x = (Array.isArray(list) ? list : []).find((i) => i.id === code);
  return x ? L(x.label, lang) : String(code);
};
/** Dioptrías con signo: +1.25 / −0.50 / — */
const dpt = (v) => (v == null || v === "" ? "—" : `${Number(v) > 0 ? "+" : Number(v) < 0 ? "−" : ""}${Math.abs(Number(v)).toFixed(2)}`);
const nameOf = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();

function TierBadge({ tier, lapsed, t }) {
  return (
    <span className="pt-badges">
      {tier && tier !== "none" && <span className={`pt-tier t-${tier}`}>{t(`adm.pt.tier.${tier}`)}</span>}
      {lapsed && <span className="pt-tier t-lapsed" title={t("adm.pt.lapsedHint")}>{t("adm.pt.lapsed")}</span>}
    </span>
  );
}

function Tile({ label, value, hint, strong = false }) {
  return (
    <div className={`pt-tile ${strong ? "strong" : ""}`} title={hint || undefined}>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function RxEye({ eye, side, t }) {
  return (
    <tr>
      <th scope="row">{t(side === "od" ? "adm.pt.rx.od" : "adm.pt.rx.os")}</th>
      <td>{dpt(eye?.sph)}</td>
      <td>{dpt(eye?.cyl)}</td>
      <td>{eye?.axis == null ? "—" : `${eye.axis}°`}</td>
      <td>{dpt(eye?.add)}</td>
    </tr>
  );
}

function PatientFile({ id, stores, openSale, onBack }) {
  const { t, lang } = useLang();
  const [file, setFile] = useState(null);
  const [state, setState] = useState("loading");
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    setState("loading");
    fetchPatient(id)
      .then((r) => { if (n === seq.current) { setFile(r); setState("ok"); } })
      .catch((e) => { if (n === seq.current) setState(e.message || "adm.err.pos.generic"); });
  }, [id]);
  const m = (cents) => money((Number(cents) || 0) / 100, "usd", lang);
  const storeOf = (sid) => stores.find((s) => s.id === sid) || null;
  const placeOf = (p) => (p.channel === "web" ? t("adm.pt.online") : storeOf(p.establishment_id)?.code || "—");

  if (state === "loading" && !file) return <div className="pt-file"><div className="adm-src-note loading">{t("adm.pt.loading")}</div></div>;
  if (state !== "ok" && state !== "loading") return <div className="pt-file"><div className="adm-login-err">{t(state)}</div></div>;
  const c = file.customer;
  const s = file.summary;
  const main = s.main_store ? storeOf(s.main_store) : null;
  const history = [...(file.history || [])].reverse(); // la más reciente primero
  return (
    <div className="pt-file" aria-live="polite">
      <div className="pt-file-head">
        {onBack && (
          <button type="button" className="btn-xs pt-back" onClick={onBack}><Icon name="chevronLeft" size={14} /> {t("adm.pt.back")}</button>
        )}
        <div className="pt-avatar" aria-hidden="true">{(nameOf(c) || c.email || "?").slice(0, 1).toUpperCase()}</div>
        <div className="pt-who">
          <h3>{nameOf(c) || c.email || t("adm.pt.noName")}</h3>
          <div className="pt-who-sub">
            <TierBadge tier={s.tier} lapsed={s.lapsed} t={t} />
            {c.since && <span>{t("adm.pt.since", { date: shortDate(c.since, lang) })}</span>}
          </div>
        </div>
      </div>

      <div className="pt-tiles">
        <Tile label={t("adm.pt.totalSpent")} value={m(s.total_cents)} strong />
        <Tile label={t("adm.pt.purchases")} value={s.purchases} hint={s.voided ? t("adm.pt.voidedN", { n: s.voided }) : undefined} />
        <Tile label={t("adm.pt.avgTicket")} value={s.avg_cents == null ? "—" : m(s.avg_cents)} />
        <Tile label={t("adm.pt.lastPurchase")} value={s.last_at ? shortDate(s.last_at, lang) : "—"} hint={s.months_since_last != null ? t("adm.pt.monthsAgo", { n: s.months_since_last }) : undefined} />
      </div>

      <Accordion id="pt-data" icon="user" title={t("adm.pt.acc.data")} defaultOpen
        summary={[c.phone ? { value: c.phone } : null, main ? { label: t("adm.pt.mainStore"), value: main.code } : null].filter(Boolean)}>
        <dl className="pt-dl">
          <div><dt>{t("adm.pt.f.name")}</dt><dd>{nameOf(c) || "—"}</dd></div>
          <div><dt>{t("adm.pt.f.phone")}</dt><dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—"}</dd></div>
          <div><dt>{t("adm.pt.f.email")}</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</dd></div>
          <div><dt>{t("adm.pt.f.birth")}</dt><dd>{c.birth_date ? shortDate(`${c.birth_date}T12:00:00Z`, lang) : "—"}</dd></div>
          <div className="wide"><dt>{t("adm.pt.f.address")}</dt><dd>{c.address ? [c.address.address_1, c.address.city, [c.address.province, c.address.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "—"}</dd></div>
          <div><dt>{t("adm.pt.f.mainStore")}</dt><dd>{main ? `${main.code} · ${main.name}` : s.stores.some((x) => x.channel === "web") ? t("adm.pt.online") : "—"}</dd></div>
          <div><dt>{t("adm.pt.f.account")}</dt><dd>{t(c.has_account ? "adm.pt.f.accountYes" : "adm.pt.f.accountNo")}</dd></div>
        </dl>
      </Accordion>

      <Accordion id="pt-purchases" icon="receipt" title={t("adm.pt.acc.purchases")} defaultOpen
        summary={[
          { label: t("adm.pt.purchases"), value: s.purchases },
          { label: t("adm.pt.total"), value: m(s.total_cents), strong: true },
          { label: t("adm.pt.avg"), value: s.avg_cents == null ? "—" : m(s.avg_cents) },
        ]}>
        {!file.purchases.length ? (
          <p className="pt-empty">{t("adm.pt.noPurchases")}</p>
        ) : (
          <>
            <div className="pt-stores">
              {s.stores.map((x) => {
                const st = x.channel === "web" ? null : storeOf(x.establishment_id);
                return (
                  <span key={`${x.channel}:${x.establishment_id || ""}`} className="pt-store" style={{ "--st": st?.color || "var(--adm-accent)" }}>
                    <i className="dot" /> {x.channel === "web" ? t("adm.pt.online") : st?.code || "—"} <small>{t("adm.pt.storeLine", { n: x.purchases, total: m(x.total_cents) })}</small>
                  </span>
                );
              })}
            </div>
            <table className="pt-table responsive">
              <thead>
                <tr>
                  <th scope="col">{t("adm.pt.col.date")}</th>
                  <th scope="col">{t("adm.pt.col.where")}</th>
                  <th scope="col">{t("adm.pt.col.items")}</th>
                  <th scope="col" className="num">{t("adm.pt.col.total")}</th>
                </tr>
              </thead>
              <tbody>
                {file.purchases.map((p) => {
                  const voided = p.status === "voided";
                  const canOpen = Boolean(openSale && (p.sale_id || p.order_id));
                  return (
                    <tr key={p.order_id} className={voided ? "is-voided" : ""}>
                      <td data-label={t("adm.pt.col.date")}>
                        {shortDate(p.sold_at, lang)}
                        {canOpen ? (
                          <button type="button" className="pt-link" onClick={() => openSale(p.sale_id ? { saleId: p.sale_id } : { orderId: p.order_id })}>{p.sale_number || t("adm.pt.webOrder")}</button>
                        ) : <small>{p.sale_number || ""}</small>}
                      </td>
                      <td data-label={t("adm.pt.col.where")}>{placeOf(p)}{p.has_prescription && <span className="pt-rxmark" title={t("adm.pt.withRx")}>Rx</span>}</td>
                      <td data-label={t("adm.pt.col.items")}>
                        <ul className="pt-lines">
                          {p.lines.map((l, i) => (
                            <li key={i}>
                              <Icon name={l.category === "case" ? "case" : "glasses"} size={12} />
                              <span>
                                {[l.brand, l.title].filter(Boolean).join(" ") || t(l.category === "own_frame" ? "adm.pt.cat.own_frame" : l.category === "case" ? "adm.pt.cat.case" : "adm.pt.cat.frame")}
                                {l.lens && (
                                  <small className="pt-lens">
                                    {[lensName(DESIGNS, l.lens.design, lang), lensName(MATERIALS, l.lens.material, lang), lensName(PHOTO, l.lens.photo, lang), lensName(AR_OPTIONS, l.lens.ar, lang)].filter(Boolean).join(" · ")}
                                  </small>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {voided && <em className="pt-void">{t("adm.pt.voided")}</em>}
                      </td>
                      <td data-label={t("adm.pt.col.total")} className="num">{m(p.total_cents)}{p.discount_cents > 0 && <small>{t("adm.pt.discountLine", { v: m(p.discount_cents) })}</small>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Accordion>

      <Accordion id="pt-rx" icon="glasses" title={t("adm.pt.acc.rx")} defaultOpen={history.length > 0}
        summary={history.length ? [
          { label: t("adm.pt.rxCount"), value: history.length },
          history.some((h) => h.change?.significant) ? { value: t("adm.pt.rxChanged"), tone: "warn" } : { value: t("adm.pt.rxStable"), tone: "good" },
        ] : []}>
        {!history.length ? <p className="pt-empty">{t("adm.pt.noRx")}</p> : (
          <div className="pt-rx-list">
            {history.map((h) => (
              <div key={h.id} className={`pt-rx ${h.change?.significant ? "changed" : ""}`}>
                <div className="pt-rx-head">
                  <b>{h.rx_date ? shortDate(`${h.rx_date}T12:00:00Z`, lang) : shortDate(h.created_at, lang)}</b>
                  <span className="pt-rx-kind">{t(h.kind === "worn" ? "adm.pt.rx.worn" : "adm.pt.rx.new")}{h.rx_number ? ` · ${h.rx_number}` : ""}</span>
                  {h.change && (
                    <span className={`pt-rx-chg ${h.change.significant ? "warn" : ""}`} title={t("adm.pt.rx.seHint")}>
                      {h.change.significant ? t("adm.pt.rx.changed") : t("adm.pt.rx.noChange")}
                      {h.change.max_se != null && ` · ${t("adm.pt.rx.se")} ${dpt(h.change.max_se)}`}
                    </span>
                  )}
                </div>
                <table className="pt-rx-table">
                  <thead><tr><th scope="col" /><th scope="col">SPH</th><th scope="col">CYL</th><th scope="col">{t("adm.pt.rx.axis")}</th><th scope="col">ADD</th></tr></thead>
                  <tbody>
                    <RxEye eye={h.od} side="od" t={t} />
                    <RxEye eye={h.os} side="os" t={t} />
                  </tbody>
                </table>
                {(h.pd || h.pd_od) && <small className="pt-rx-pd">{t("adm.pt.rx.pd")}: {h.pd ?? "—"}{h.pd_od ? ` (${h.pd_od} / ${h.pd_os ?? "—"})` : ""}{h.seg_height ? ` · ${t("adm.pt.rx.seg")} ${h.seg_height}` : ""}</small>}
              </div>
            ))}
          </div>
        )}
      </Accordion>

      <Accordion id="pt-exam" icon="calendar" title={t("adm.pt.acc.exam")}
        summary={file.exam ? [{ value: shortDate(`${file.exam.due_on}T12:00:00Z`, lang), tone: file.exam.overdue ? "bad" : "good" }] : []}>
        {file.exam ? (
          <p className={`pt-exam ${file.exam.overdue ? "overdue" : ""}`}>
            <Icon name={file.exam.overdue ? "alert" : "calendar"} size={14} />{" "}
            {t(file.exam.overdue ? "adm.pt.examOverdue" : "adm.pt.examNext", { date: shortDate(`${file.exam.due_on}T12:00:00Z`, lang) })}
          </p>
        ) : <p className="pt-empty">{t("adm.pt.examUnknown")}</p>}
      </Accordion>
      <p className="pt-privacy"><Icon name="lock" size={12} /> {t("adm.pt.privacy")}</p>
    </div>
  );
}

export default function Patients({ me, openSale, params = {} }) {
  const { t, lang } = useLang();
  const { storeId, isAll, isWeb, stores } = useStoreFilter(me);
  const [q, setQ] = useState("");
  const [debQ, setDebQ] = useState("");
  const [sort, setSort] = useState("recent");
  const [tier, setTier] = useState("");
  const [list, setList] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState("loading");
  const [sel, setSel] = useState(params.patient || null);
  const seq = useRef(0);

  useEffect(() => { const id = setTimeout(() => setDebQ(q.trim()), 300); return () => clearTimeout(id); }, [q]);
  useEffect(() => {
    const n = ++seq.current;
    setState("loading");
    // «Tienda online» no es un establecimiento: la lista va sin filtro de tienda.
    fetchPatients({ q: debQ.length >= 2 ? debQ : "", sort, store: isAll || isWeb ? "" : storeId, limit: 200 })
      .then((r) => { if (n !== seq.current) return; setList(r.patients || []); setTruncated(Boolean(r.truncated)); setState("ok"); })
      .catch((e) => { if (n === seq.current) setState(e.message || "adm.err.pos.generic"); });
  }, [debQ, sort, storeId, isAll, isWeb]);

  const shown = useMemo(() => (list || []).filter((p) => !tier || (tier === "lapsed" ? p.lapsed : p.tier === tier)), [list, tier]);
  const totals = useMemo(() => {
    const live = (list || []).filter((p) => p.purchases > 0);
    const total = live.reduce((a, p) => a + p.total_cents, 0);
    const n = live.reduce((a, p) => a + p.purchases, 0);
    return { patients: live.length, total, avg: n ? Math.round(total / n) : null };
  }, [list]);
  const m = (cents) => money((Number(cents) || 0) / 100, "usd", lang);

  return (
    <div className={`adm-section pt ${sel ? "has-sel" : ""}`}>
      <div className="adm-head-row">
        <h2>{t("adm.tab.patients")}</h2>
        <p className="muted pt-lead">{t("adm.pt.lead")}</p>
      </div>
      <div className="pt-grid">
        <div className="pt-listcol">
          <div className="pt-bar">
            <label className="pt-search">
              <Icon name="search" size={14} />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("adm.pt.search")} aria-label={t("adm.pt.search")} autoComplete="off" />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("adm.pt.sortBy")} title={t("adm.pt.sortBy")}>
              {SORTS.map((k) => <option key={k} value={k}>{t(`adm.pt.sort.${k}`)}</option>)}
            </select>
          </div>
          <div className="pt-chips" role="group" aria-label={t("adm.pt.filterTier")}>
            {["", ...TIERS, "lapsed"].map((k) => (
              <button key={k || "all"} type="button" className={tier === k ? "on" : ""} aria-pressed={tier === k} onClick={() => setTier(k)}>
                {k ? t(k === "lapsed" ? "adm.pt.lapsed" : `adm.pt.tier.${k}`) : t("adm.pt.all")}
              </button>
            ))}
          </div>
          {state === "ok" && !debQ && (
            <p className="pt-agg">{t("adm.pt.agg", { n: totals.patients, total: m(totals.total), avg: totals.avg == null ? "—" : m(totals.avg) })}</p>
          )}
          {state === "loading" && !list && <div className="adm-src-note loading">{t("adm.pt.loading")}</div>}
          {state !== "ok" && state !== "loading" && <div className="adm-login-err">{t(state)}</div>}
          {list && (
            <ul className="pt-list" aria-busy={state === "loading"}>
              {shown.map((p) => (
                <li key={p.id}>
                  <button type="button" className={`pt-row ${sel === p.id ? "on" : ""}`} onClick={() => setSel(p.id)} aria-current={sel === p.id ? "true" : undefined}>
                    <span className="pt-row-main">
                      <b>{nameOf(p) || p.email || t("adm.pt.noName")}</b>
                      <small>{[p.phone, p.email].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="pt-row-nums">
                      <b>{m(p.total_cents)}</b>
                      <small>{t("adm.pt.rowNums", { n: p.purchases, avg: p.avg_cents == null ? "—" : m(p.avg_cents) })}</small>
                      <small>{p.last_at ? shortDate(p.last_at, lang) : t("adm.pt.never")}</small>
                    </span>
                    <TierBadge tier={p.tier} lapsed={p.lapsed} t={t} />
                  </button>
                </li>
              ))}
              {!shown.length && <li className="pt-empty">{t(debQ ? "adm.pt.noMatch" : "adm.pt.none")}</li>}
            </ul>
          )}
          {truncated && <p className="pt-note"><Icon name="info" size={12} /> {t("adm.pt.truncated")}</p>}
        </div>
        <div className="pt-filecol">
          {sel ? (
            <PatientFile key={sel} id={sel} stores={stores} openSale={openSale} onBack={() => setSel(null)} />
          ) : (
            <div className="pt-file pt-pick"><Icon name="user" size={28} /><p>{t("adm.pt.pick")}</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
