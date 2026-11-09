// Dónde se usa: último paso de una venta (PosSale.jsx). Todo lo que se va a
// confirmar, de un vistazo, para revisarlo con el cliente antes de cobrar. Solo
// pinta lo que ya hay en el asistente: importes y artículos salen de la cotización
// del servidor, nunca se recalculan aquí.
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { FRAME_ONLY } from "../data/lensPricing.js";
import Icon from "./icons.jsx";
import PosFramePhoto from "./PosFramePhoto.jsx";
import { promoOf } from "./pricing/promo.js";
import "./pricing/promo.css";

const EYE_FIELDS = ["sph", "cyl", "axis", "add", "prism"];

/**
 * Las piezas con nombre de una selección de lentes: `lens` = diseño (con el
 * acabado donde el diseño admite los dos) y material; `treatments` = foto y
 * antirreflejo. Lo usan el resumen final y la franja del total en curso para
 * que una misma selección se lea igual en los dos sitios.
 */
export function describeSelection(selection, catalog, t, lang) {
  const L = (o) => (o ? o[lang] ?? o.es : "");
  if (!selection || selection.design_code === "frame-only") return { frameOnly: true, lens: L(FRAME_ONLY.label) || t("adm.pos.sum.frameOnly"), treatments: [] };
  const design = catalog.DESIGNS.find((d) => d.id === selection.design_code);
  const finish = design && design.cat !== "prog" && selection.finish ? ` (${t(`adm.pos.lens.finish.${selection.finish}`)})` : "";
  const lens = [design ? `${L(design.label)}${finish}` : "", L(catalog.MATERIALS.find((m) => m.id === selection.material_code)?.label)].filter(Boolean).join(" · ");
  const treatments = [
    L(catalog.PHOTO.find((p) => p.id === selection.photo_code)?.label),
    L(Object.values(catalog.AR).flat().find((a) => a.id === selection.ar_code)?.label),
  ].filter(Boolean);
  return { frameOnly: false, lens, treatments };
}

/**
 * Franja con el total que acompaña la venta desde que hay montura: montura,
 * lentes, tratamientos, subtotal y, cuando el servidor ya los calculó,
 * descuento y total. Solo precios de lista y totales — nunca costos ni
 * márgenes: la ve quien vende. Las cifras salen de la última cotización del
 * servidor (`quote`); `status` dice si se está recalculando o si la última
 * petición falló (entonces se dejan las cifras conocidas con un aviso).
 * `beforeLenses`: antes del paso Lentes la selección es solo el valor inicial,
 * así que la fila de lentes se marca pendiente en vez de nombrar un lente que
 * nadie eligió todavía.
 */
export function PosRunningTotal({ quote, status, lines, catalog, money, beforeLenses = false }) {
  const { t, lang } = useLang();
  // En móvil arranca plegada (solo el total); en escritorio, con el desglose a la vista.
  // Plegada de entrada en móvil y en tablet vertical: la línea de cabecera ya
  // dice montura, lentes y total; el detalle se abre con un toque. En vertical
  // la franja es pegajosa y abierta se comía un cuarto de la pantalla.
  const [open, setOpen] = useState(() => !(typeof window !== "undefined" && window.matchMedia?.("(max-width: 760px), (pointer: coarse) and (orientation: portrait), (orientation: landscape) and (max-height: 560px)").matches));
  if (!lines.length) return null;
  const pending = !quote;
  const dash = "—";
  const rows = lines.map((line, i) => {
    const ql = quote?.lines?.[i] || null;
    const own = line.kind === "own_frame";
    const d = describeSelection(line.selection, catalog, t, lang);
    return {
      key: line.key ?? i,
      frameName: own ? t("adm.pos.own.tag") : line.kind === "store_frame" ? `${t("adm.pos.store.tag")} · ${line.title}` : [line.title, line.variant_title].filter(Boolean).join(" · "),
      framePrice: own ? null : ql ? money(ql.frame) : dash,
      lens: beforeLenses ? t("adm.pos.flow.lensesLater") : d.lens,
      lensPrice: beforeLenses || d.frameOnly ? null : ql ? money(ql.lenses) : dash,
      treatments: d.treatments,
      frameOnly: beforeLenses || d.frameOnly,
    };
  });
  const totalText = quote ? money(quote.total) : dash;
  return (
    <aside className={`pos-run ${status} ${open ? "open" : ""}`} aria-live="polite" aria-busy={status === "loading"}>
      <button type="button" className="pos-run-head" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t("adm.pos.flow.toggle")}>
        <span className="pos-run-ttl"><Icon name="receipt" size={14} /> {t("adm.pos.flow.title")}</span>
        <span className="pos-run-brief">
          {rows.map((r) => (
            <span key={r.key} className="pos-run-brief-line">
              {r.framePrice !== null && <span>{t("adm.pos.sum.frame")} <b>{r.framePrice}</b></span>}
              {r.lensPrice !== null && <span>{t("adm.pos.sum.lenses")} <b>{r.lensPrice}</b></span>}
            </span>
          ))}
        </span>
        <span className="pos-run-total">
          <small>{status === "loading" ? t("adm.pos.flow.updating") : t("adm.pos.price.total")}</small>
          <b>{totalText}</b>
        </span>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={14} />
      </button>
      {open && (
        <div className="pos-run-body">
          {rows.map((r) => (
            <dl key={r.key} className="pos-run-rows">
              <dt>{t("adm.pos.sum.frame")}</dt><dd><span>{r.frameName}</span>{r.framePrice !== null && <b>{r.framePrice}</b>}</dd>
              <dt>{t("adm.pos.sum.lenses")}</dt><dd><span>{r.lens}</span>{r.lensPrice !== null && <b>{r.lensPrice}</b>}</dd>
              {!r.frameOnly && (
                <><dt>{t("adm.pos.flow.treatments")}</dt><dd><span>{r.treatments.length ? r.treatments.join(" · ") : t("adm.pos.lens.none")}</span>{r.treatments.length > 0 && <small className="muted">{t("adm.pos.flow.inLenses")}</small>}</dd></>
              )}
            </dl>
          ))}
          <dl className="pos-run-rows pos-run-sum">
            <dt>{t("adm.pos.flow.subtotal")}</dt><dd><b>{quote ? money(quote.list_cents / 100) : dash}</b></dd>
            {quote?.discount_cents > 0 && <><dt>{t("adm.pos.price.discountAmt", { n: quote.discount_pct })}</dt><dd><b>−{money(quote.discount_cents / 100)}</b></dd></>}
            {quote?.tax_cents > 0 && <><dt>{t("adm.pos.price.tax")}</dt><dd><b>{money(quote.tax_cents / 100)}</b></dd></>}
            <dt className="big">{t("adm.pos.price.total")}</dt><dd className="big"><b>{totalText}</b></dd>
          </dl>
          {pending && status !== "loading" && <small className="muted pos-run-note">{t("adm.pos.flow.pending")}</small>}
          {status === "error" && quote && <small className="pos-run-note warn"><Icon name="alert" size={12} /> {t("adm.pos.flow.stale")}</small>}
        </div>
      )}
    </aside>
  );
}

function ageOf(birth) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(birth || "") ? new Date(`${birth}T12:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const passed = now.getMonth() > d.getUTCMonth() || (now.getMonth() === d.getUTCMonth() && now.getDate() >= d.getUTCDate());
  return now.getFullYear() - d.getUTCFullYear() - (passed ? 0 : 1);
}

/** Una sección con su botón para volver al paso donde se cambia. */
function Part({ title, icon, onEdit, wide, children }) {
  const { t } = useLang();
  return (
    <section className={`pos-sum-part ${wide ? "wide" : ""}`}>
      <header>
        <h4><Icon name={icon} size={14} />{title}</h4>
        {onEdit && <button type="button" className="btn-xs" onClick={onEdit}><Icon name="edit" size={12} /> {t("adm.pos.sum.edit")}</button>}
      </header>
      {children}
    </section>
  );
}

export default function PosSaleSummary({ customer, customerId, quote, lines, catalog, rx, noRx, approval, delivery, notifyEmail, receiptDetail, store, terminal, sellerCode, money, onEdit }) {
  const { t, lang } = useLang();
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  const age = ageOf(customer.birth_date);
  const address = [customer.address_1, customer.city, [customer.province, customer.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const birth = customer.birth_date ? new Date(`${customer.birth_date}T12:00:00Z`).toLocaleDateString(lang === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeZone: "UTC" }) : "";

  // El acabado se nombra donde el diseño admite los dos (stock / tallado digital); un progresivo es digital de suyo.
  const lensText = (selection) => { const d = describeSelection(selection, catalog, t, lang); return [d.lens, ...d.treatments].filter(Boolean).join(" · "); };
  const eyeRows = ["od", "os"].filter((e) => EYE_FIELDS.some((k) => rx?.[e]?.[k] !== "" && rx?.[e]?.[k] != null));

  return (
    <details className="pos-sum" open>
      <summary><Icon name="receipt" size={15} /> {t("adm.pos.sum.title")}</summary>
      <div className="pos-sum-grid">
        <Part title={t("adm.pos.step.frame")} icon="glasses" onEdit={() => onEdit("frame")} wide>
          <ul className="pos-sum-items">
            {quote.lines.map((l, i) => {
              const line = lines[i];
              const own = l.kind === "own_frame";
              return (
                <li key={line?.key ?? i}>
                  <PosFramePhoto line={line} />
                  <div className="pos-sum-item">
                    <b>{own ? t("adm.pos.own.tag") : l.kind === "store_frame" ? t("adm.pos.store.tag") : l.title}</b>
                    <small>{[own || l.kind === "store_frame" ? l.description : l.variant_title, l.sku && `${t("adm.pos.sum.sku")} ${l.sku}`].filter(Boolean).join(" · ")}</small>
                    <small>{lensText(l.selection)}</small>
                    <small className="muted">
                      {[!own && `${t("adm.pos.sum.frame")} ${money(l.frame)}`, l.lenses > 0 && `${t("adm.pos.sum.lenses")} ${money(l.lenses)}`, l.tax_amount > 0 && `${t("adm.pos.price.tax")} ${money(l.tax_amount)}`].filter(Boolean).join(" · ")}
                    </small>
                    {(() => {
                      // The owner's item promotion (docs/PRICE-MATRIX.md): the line is already at the discounted price.
                      const p = promoOf(l);
                      return p ? <small className="pos-sum-promo">{t("adm.pm.promoBefore")} <s>{money(p.before)}</s> · {t("adm.pm.promoTag", { pct: p.pct })}</small> : null;
                    })()}
                  </div>
                  <b className="pos-sum-price">{money(l.unit_price)}</b>
                </li>
              );
            })}
          </ul>
        </Part>

        <Part title={t("adm.pos.step.customer")} icon="user" onEdit={() => onEdit("customer")}>
          <p><b>{name}</b>{customerId ? <small className="muted"> · {t("adm.pos.cust.existing")}</small> : null}</p>
          <p>{customer.email}<br />{customer.phone}</p>
          {birth && <p className="muted">{birth}{age !== null ? ` · ${t("adm.pos.sum.age", { n: age })}` : ""}</p>}
          {address && <p className="muted">{address}</p>}
        </Part>

        <Part title={t("adm.pos.step.rx")} icon="eye" onEdit={() => onEdit("rx")}>
          {noRx || !eyeRows.length ? <p className="muted">{t("adm.pos.sum.noRx")}</p> : (
            <>
              <table className="pos-sum-rx">
                <thead><tr><th />{EYE_FIELDS.map((k) => <th key={k}>{t(`adm.pos.rx.${k}`)}</th>)}</tr></thead>
                <tbody>
                  {eyeRows.map((e) => (
                    <tr key={e}><th scope="row">{t(`adm.pos.rx.${e}`)}</th>{EYE_FIELDS.map((k) => <td key={k}>{rx[e][k] === "" || rx[e][k] == null ? "—" : rx[e][k]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">{[rx.pd && `${t("adm.pos.rx.pd")}: ${rx.pd}`, rx.seg_height && `${t("adm.pos.rx.seg")}: ${rx.seg_height}`, rx.rx_date && `${t("adm.pos.rx.date")}: ${rx.rx_date}`].filter(Boolean).join(" · ")}</p>
            </>
          )}
        </Part>

        <Part title={t("adm.pos.sum.sale")} icon="store">
          <p>{delivery === "ship" ? t("adm.pos.pay.ship") : t("adm.pos.pay.pickup")}{delivery === "ship" && address ? `: ${address}` : ""}</p>
          <p className="muted">{notifyEmail ? t(!receiptDetail ? "adm.pos.sum.receiptTo" : !noRx && eyeRows.length ? "adm.pos.sum.receiptToRx" : "adm.pos.sum.receiptToPhotos", { email: customer.email }) : t("adm.pos.sum.noReceipt")}</p>
          <p className="muted">{[store && `${store.code} · ${store.name}`, terminal?.code, sellerCode].filter(Boolean).join(" · ")}</p>
        </Part>

        <Part title={t("adm.pos.step.price")} icon="dollar" onEdit={() => onEdit("price")}>
          <dl className="pos-totals">
            <dt>{t("adm.pos.price.listTotal")}</dt><dd>{money(quote.list_cents / 100)}</dd>
            {quote.discount_cents > 0 && <><dt>{t("adm.pos.price.discountAmt", { n: quote.discount_pct })}</dt><dd>−{money(quote.discount_cents / 100)}</dd></>}
            {quote.tax_cents > 0 && <><dt>{t("adm.pos.price.tax")}</dt><dd>{money(quote.tax_cents / 100)}</dd></>}
            <dt className="big">{t("adm.pos.price.total")}</dt><dd className="big">{money(quote.total)}</dd>
          </dl>
          {approval?.status === "approved" && <p className="muted"><Icon name="check" size={12} /> {t("adm.pos.sum.approved")}</p>}
        </Part>
      </div>
    </details>
  );
}
