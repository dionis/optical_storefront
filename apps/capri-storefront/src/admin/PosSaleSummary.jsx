// Dónde se usa: último paso de una venta (PosSale.jsx). Todo lo que se va a
// confirmar, de un vistazo, para revisarlo con el cliente antes de cobrar. Solo
// pinta lo que ya hay en el asistente: importes y artículos salen de la cotización
// del servidor, nunca se recalculan aquí.
import { useLang } from "../i18n/LanguageContext.jsx";
import { FRAME_ONLY } from "../data/lensPricing.js";
import Icon from "./icons.jsx";
import PosFramePhoto from "./PosFramePhoto.jsx";

const EYE_FIELDS = ["sph", "cyl", "axis", "add", "prism"];

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
  const L = (o) => (o ? o[lang] ?? o.es : "");
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  const age = ageOf(customer.birth_date);
  const address = [customer.address_1, customer.city, [customer.province, customer.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const birth = customer.birth_date ? new Date(`${customer.birth_date}T12:00:00Z`).toLocaleDateString(lang === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeZone: "UTC" }) : "";

  const lensText = (selection) => {
    if (selection.design_code === "frame-only") return L(FRAME_ONLY.label) || t("adm.pos.sum.frameOnly");
    return [
      L(catalog.DESIGNS.find((d) => d.id === selection.design_code)?.label),
      L(catalog.MATERIALS.find((m) => m.id === selection.material_code)?.label),
      L(catalog.PHOTO.find((p) => p.id === selection.photo_code)?.label),
      L(Object.values(catalog.AR).flat().find((a) => a.id === selection.ar_code)?.label),
    ].filter(Boolean).join(" · ");
  };
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
                    <b>{own ? t("adm.pos.own.tag") : l.title}</b>
                    <small>{[own ? l.description : l.variant_title, l.sku && `${t("adm.pos.sum.sku")} ${l.sku}`].filter(Boolean).join(" · ")}</small>
                    <small>{lensText(l.selection)}</small>
                    <small className="muted">
                      {[!own && `${t("adm.pos.sum.frame")} ${money(l.frame)}`, l.lenses > 0 && `${t("adm.pos.sum.lenses")} ${money(l.lenses)}`, l.tax_amount > 0 && `${t("adm.pos.price.tax")} ${money(l.tax_amount)}`].filter(Boolean).join(" · ")}
                    </small>
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
