// Everything about one pair of glasses in a past order: how the lenses were
// configured, the frame's technical sheet, and the prescription they were cut
// to — each with a short plain-language note.
//
// The point is not decoration. A shopper who has to call an optician, compare
// with an older pair, or ask us why a lens costs what it costs needs to be able
// to READ their order, not just recognise it. Codes and slugs arrive from
// /store/my-orders; every word on screen is resolved here through the
// dictionary, so the page follows the language toggle like everything else.
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { frameSpecRows } from "../data/frameSpecLabels.js";
import { lensConfigRows } from "../data/lensLabels.js";

/** One labelled row. Mirrors the drawer's existing rows. */
function Row({ label, value, hint }) {
  return (
    <div className="mo-drow">
      <span className="mo-dlabel">
        {label}
        {hint && <small className="mo-dhint">{hint}</small>}
      </span>
      <span className="mo-dvalue">{value}</span>
    </div>
  );
}

/** Dioptric values always carry their sign — "+1.50" and "-1.50" are opposites. */
const dpt = (v) => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return (n > 0 ? "+" : "") + n.toFixed(2);
};
const plain = (v) => (v == null || v === "" ? "—" : String(v));

/**
 * The prescription the lenses were made to, exactly as it was ordered.
 *
 * Shown with its provenance on purpose: values read from a photo by the OCR are
 * a machine's reading of a document, and the customer confirmed them on screen
 * before we cut anything. Saying so is what lets them spot a misread later.
 */
function PrescriptionBlock({ rx }) {
  const { t, lang } = useLang();
  const L = (k) => t(`orders.${k}`);
  const [openHelp, setOpenHelp] = useState(false);

  const hasPrism = [rx.od, rx.os].some((e) => e && (e.prism != null || e.base));
  const eyes = [
    [L("rxRight"), rx.od || {}],
    [L("rxLeft"), rx.os || {}],
  ];
  const pdText =
    rx.pd != null
      ? `${plain(rx.pd)} mm`
      : rx.pd_od != null || rx.pd_os != null
        ? `${t("lens.pd.odS")} ${plain(rx.pd_od)} · ${t("lens.pd.osS")} ${plain(rx.pd_os)} mm`
        : "—";
  // Both eyes normally share one addition — the funnel only offers a single ADD
  // — so it is only split when the stored values actually differ.
  const odAdd = rx.od?.add ?? null;
  const osAdd = rx.os?.add ?? null;
  const addText =
    odAdd == null && osAdd == null
      ? null
      : odAdd != null && osAdd != null && Number(odAdd) === Number(osAdd)
        ? dpt(odAdd)
        : `${t("orders.rxRight")} ${dpt(odAdd)} · ${t("orders.rxLeft")} ${dpt(osAdd)}`;

  return (
    <section className="mo-dblock mo-rx-block">
      <h4>{L("rxTitle")}</h4>
      <p className="mo-dnote">
        {rx.source === "ocr" ? L("rxFromOcr") : L("rxFromManual")}
        {rx.verified_by_user && ` ${L("rxConfirmed")}`}
      </p>

      {/* ¿Para quién son? (elegido en el probador). */}
      {rx.patient_for === "other" ? (
        <Row label={L("patientForLabel")} value={rx.patient_name || L("patientOther")} />
      ) : rx.patient_for === "me" ? (
        <Row label={L("patientForLabel")} value={L("patientMe")} />
      ) : null}

      <div className="mo-rx-scroll">
        <table className="mo-rx-table">
          <thead>
            <tr>
              <th aria-hidden="true" />
              <th>{t("lens.sphS")}</th>
              <th>{t("lens.cylS")}</th>
              <th>{t("lens.axisS")}</th>
              <th>{t("lens.addS")}</th>
              {hasPrism && <th>{L("rxPrism")}</th>}
              {hasPrism && <th>{L("rxBase")}</th>}
            </tr>
          </thead>
          <tbody>
            {eyes.map(([label, eye]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{dpt(eye.sph)}</td>
                <td>{dpt(eye.cyl)}</td>
                <td>{eye.axis != null ? `${eye.axis}°` : "—"}</td>
                <td>{dpt(eye.add)}</td>
                {hasPrism && <td>{dpt(eye.prism)}</td>}
                {hasPrism && <td>{plain(eye.base)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Same measurements block the shopper saw when choosing the lenses:
          PD, addition and fitting height, in that order. */}
      <Row label={t("lens.pd")} value={pdText} />
      {addText && <Row label={t("lens.addLbl")} value={addText} />}
      {rx.seg_height != null && (
        <Row label={t("lens.height")} value={`${rx.seg_height} mm`} />
      )}
      {/* Same closing rows as the order emails, so both records read alike. */}
      {rx.created_at && (
        <Row
          label={L("rxCapturedOn")}
          value={new Date(rx.created_at).toLocaleDateString(lang === "en" ? "en-US" : "es")}
        />
      )}
      {/* Imágenes guardadas con el pedido: la prueba virtual (rostro con los
          espejuelos) y la receta subida. Llegan como enlaces firmados de corta
          duración desde /store/my-orders; se abren en una pestaña al tocarlas. */}
      {(rx.tryon_image || rx.rx_image) && (
        <div className="mo-rx-imgs">
          {rx.tryon_image && (
            <a className="mo-rx-img" href={rx.tryon_image} target="_blank" rel="noopener noreferrer">
              <img src={rx.tryon_image} alt={L("tryonPhoto")} loading="lazy" />
              <span>{L("tryonPhoto")}</span>
            </a>
          )}
          {rx.rx_image && (
            <a className="mo-rx-img" href={rx.rx_image} target="_blank" rel="noopener noreferrer">
              <img src={rx.rx_image} alt={L("rxPhoto")} loading="lazy" />
              <span>{L("rxPhoto")}</span>
            </a>
          )}
        </div>
      )}
      {rx.has_file && !rx.rx_image && <Row label={L("rxPhoto")} value={L("rxPhotoOnFile")} />}

      <button
        type="button"
        className="mo-gloss-toggle"
        aria-expanded={openHelp}
        onClick={() => setOpenHelp((v) => !v)}
      >
        {openHelp ? L("rxHelpHide") : L("rxHelpShow")}
      </button>
      {openHelp && (
        <dl className="mo-gloss">
          {[
            ["sph", t("lens.sph")],
            ["cyl", t("lens.cyl")],
            ["axis", t("lens.axis")],
            ["add", t("lens.addLbl")],
            ["pd", t("lens.pd")],
            ...(rx.seg_height != null ? [["height", t("lens.height")]] : []),
          ].map(([key, term]) => (
            <div key={key} className="mo-gloss-row">
              <dt>{term}</dt>
              <dd>{L(`rxGloss.${key}`)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** Lens configuration + frame sheet + prescription for one order line. */
export default function OrderGlassesDetails({ item, money }) {
  const { t, lang } = useLang();
  const L = (k) => t(`orders.${k}`);
  const lensRows = lensConfigRows(item.lens, lang, t);
  const specRows = frameSpecRows(item.frame, lang, t);
  const bd = item.breakdown || {};

  return (
    <>
      <section className="mo-dblock">
        <h4>{item.title}</h4>
        {/* Brand lives in product metadata, never in a Medusa collection — the
            line item's own snapshot of it is always empty in this store. */}
        {item.frame?.brand && <Row label={L("frameBrand")} value={item.frame.brand} />}
        {item.variant_title && <Row label={L("frameColor")} value={item.variant_title} />}
        {lensRows.map((r) => (
          <Row key={r.key} label={r.label} value={r.value} />
        ))}
        {item.quantity > 1 && <Row label={L("qty")} value={item.quantity} />}
        {/* What the shopper was actually charged, split the way it was priced. */}
        {bd.frame_price != null && <Row label={L("framePrice")} value={money(bd.frame_price)} />}
        {bd.lens_addon != null && bd.lens_addon > 0 && (
          <Row label={L("lensPrice")} value={money(bd.lens_addon)} />
        )}
        {bd.tax_amount != null && bd.tax_amount > 0 && (
          <Row label={L("taxes")} value={money(bd.tax_amount)} />
        )}
        <Row label={L("lineTotal")} value={money(item.total)} />
      </section>

      {specRows.length > 0 && (
        <section className="mo-dblock">
          <h4>{L("frameSpecs")}</h4>
          {specRows.map((r) => (
            <Row key={r.key} label={r.label} value={r.value} />
          ))}
          <p className="mo-dnote">{L("frameSizeNote")}</p>
        </section>
      )}

      {item.prescription ? (
        <PrescriptionBlock rx={item.prescription} />
      ) : (
        item.has_prescription && (
          <section className="mo-dblock">
            <h4>{L("rxTitle")}</h4>
            {/* The line was ordered with an Rx but the record could not be read
                right now — say so rather than implying there was none. */}
            <p className="mo-dnote">{L("rxUnavailable")}</p>
          </section>
        )
      )}
    </>
  );
}
