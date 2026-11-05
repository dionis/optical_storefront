// Dónde se usa: al confirmar una venta en el punto de venta y en «Ventas» —
// imprimir la ficha de laboratorio y el recibo, y enviar el recibo por email
// (documento acordado, «Recibo y ficha de laboratorio»). Los datos los da el
// servidor (GET/POST /admin/pos/sales/:id/documents); aquí solo se maquetan.
//
// Tres documentos impresos: la ficha de laboratorio (carta), el recibo de rollo
// de 80 mm (impresora térmica) y el recibo «doble» (una hoja carta apaisada con
// copia del cliente y copia de la tienda, para una impresora normal). Los tres
// llevan la foto de la montura: la del catálogo o la que trajo el cliente.
import { useState } from "react";
import qrcode from "qrcode-generator";
import { T } from "../i18n/translations.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";
import { resolveImageSized } from "../data/imageUrl.js";

/** Una impresora de rollo (térmica) se reconoce por cómo la describió el dueño en el punto de venta. */
export const isThermalPrinter = (printer) => /thermal|t[ée]rmic|roll|80\s?mm|58\s?mm/i.test(String(printer ?? ""));

/** Diccionario en un idioma fijo: el del recibo o la ficha de ese punto de venta, no el del panel. */
const tIn = (lang) => (key, params) => {
  const s = T[lang]?.[key] ?? T.es[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
};

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Code 128 (juego B): anchos barra/espacio de cada símbolo, 103 = start A … 106 = stop.
const C128 = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");

/** Código de barras Code 128-B como SVG: lo que lee el escáner de cualquier tienda (HU-103). */
export function code128Svg(text, height = 46) {
  const values = [...String(text)].map((ch) => Math.max(0, Math.min(94, ch.charCodeAt(0) - 32)));
  const check = (104 + values.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  const symbols = [104, ...values, check, 106];
  let x = 10;
  let bars = "";
  for (const sym of symbols) {
    const widths = C128[sym];
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]);
      if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} ${height}" width="${(x + 10) * 1.4}" height="${height}" fill="#000">${bars}</svg>`;
}

function qrSvg(url) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
}

// Lines are printed at LIST price so they add up to the subtotal; the discount
// and the tax appear once, below (same rule as the e-mailed receipt).
const fmtDate = (v, lang) => (v ? new Date(v).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtRx = (v, digits = 2, sign = true) => (v === null || v === undefined ? "—" : `${sign && Number(v) > 0 ? "+" : ""}${Number(v).toFixed(digits)}`);
const bi = (o, lang) => (o ? o[lang] || o.es || "" : "");

/** Icono de montura para la caja de foto cuando no hay imagen (no es copy: es un dibujo). */
const FRAME_ICON = `<svg class="ico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9a9a9a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="14.5" r="4"/><circle cx="17.5" cy="14.5" r="4"/><path d="M10.5 14.5h3M2.5 13.5l2.5-6.5h3M21.5 13.5l-2.5-6.5h-3"/></svg>`;

/**
 * Caja con la foto de la montura (catálogo, o la que trajo el cliente por un
 * enlace prefirmado) o el icono de montura si no hay foto. `px` es el ancho que
 * se le pide al almacén; el tamaño impreso lo fija la clase CSS.
 */
export function photoBox(line, px, alt = "") {
  const url = line?.image_url ? resolveImageSized(line.image_url, px) : "";
  return `<div class="ph">${url ? `<img src="${esc(url)}" alt="${esc(alt)}"/>` : FRAME_ICON}</div>`;
}

export const PRINT_CSS = `
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0}
  .job{width:100%;max-width:7.6in;margin:0 auto;padding:.25in;page-break-after:always}
  .job:last-child{page-break-after:auto}
  .jh{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #111;padding-bottom:6px}
  .jh b{font-size:16px} .jh small{display:block;color:#333}
  .ids{display:flex;gap:16px;font-size:13px;margin:6px 0} .ids b{font-size:15px}
  .reprint{border:2px solid #b00;color:#b00;font-weight:800;padding:2px 8px;display:inline-block;margin:4px 0}
  .pt{font-size:20px;font-weight:800;margin:8px 0}
  table{border-collapse:collapse;width:100%;font-size:12.5px} th,td{border:1px solid #999;padding:4px 6px;text-align:left}
  th{background:#eee} h4{margin:10px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em}
  .kv td:first-child{width:38%;color:#333;background:#f6f6f6}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .fold{margin-top:16px;border-top:2px dashed #111;padding-top:8px;display:flex;align-items:center;justify-content:space-between;gap:12px}
  .fold .big{font-size:34px;font-weight:900;letter-spacing:.02em}
  .muted{color:#555;font-size:11px}
  .ph{display:flex;align-items:center;justify-content:center;border:1px solid #bbb;background:#fff;overflow:hidden;flex:0 0 auto}
  .ph img{display:block;width:100%;height:100%;object-fit:contain}
  .ph .ico{width:55%;height:55%}
  .job .ph{width:45mm;height:22mm;margin:4px 0 6px}
  .rcpt{width:72mm;margin:0 auto;padding:4mm 2mm;font-size:12px}
  .rcpt .c{text-align:center} .rcpt h2{font-size:15px;margin:2px 0}
  .rcpt table{font-size:11.5px} .rcpt td{border:0;padding:2px 0;vertical-align:top} .rcpt .r{text-align:right;white-space:nowrap}
  .rcpt .tot td{font-weight:800;font-size:13px;border-top:1px solid #111}
  .rcpt hr{border:0;border-top:1px dashed #111;margin:6px 0}
  .rcpt .qr svg{width:28mm;height:28mm}
  .rcpt .lp{width:30mm;padding-right:2mm} .rcpt .ph{width:28mm;height:14mm}
  .duo{display:flex;width:100%;height:200mm;overflow:hidden;font-size:10.5px;line-height:1.3}
  .duo .half{flex:1 1 0;min-width:0;height:100%;overflow:hidden;padding:0 4mm;display:flex;flex-direction:column}
  .duo .cut{flex:0 0 0;border-left:1.2px dashed #777;position:relative;margin:0 1mm}
  .duo .cut span{position:absolute;top:2mm;left:-6.5px;font-size:13px;line-height:1;color:#555;background:#fff;transform:rotate(90deg)}
  .duo .cut small{position:absolute;bottom:2mm;left:-4px;transform:rotate(-90deg);transform-origin:left top;white-space:nowrap;font-size:8px;color:#777;background:#fff}
  .duo .dh{display:flex;justify-content:space-between;gap:8px;border-bottom:1.5px solid #111;padding-bottom:3px}
  .duo .dh b{font-size:13px} .duo .dh small{display:block;color:#333;font-size:9.5px}
  .duo .dh .no{font-size:16px;font-weight:900;letter-spacing:.02em}
  .duo .reprint{font-size:10px;padding:1px 6px;margin:3px 0}
  .duo .who{display:flex;justify-content:space-between;gap:8px;margin:4px 0;font-size:10.5px}
  .duo table{font-size:10px} .duo th,.duo td{border:0;border-bottom:1px solid #ddd;padding:2px 3px;vertical-align:top}
  .duo th{background:#f0f0f0;font-size:9px;text-transform:uppercase;letter-spacing:.03em}
  .duo .r{text-align:right;white-space:nowrap} .duo .c{text-align:center}
  .duo .lp{width:32mm} .duo .ph{width:30mm;height:14mm}
  .duo .sum{display:flex;gap:6mm;margin-top:4px;align-items:flex-start}
  .duo .sum>div{flex:1 1 0;min-width:0} .duo .sum table td{border-bottom:1px dotted #ccc}
  .duo .tot td{font-weight:800;font-size:11.5px;border-top:1px solid #111;border-bottom:0}
  .duo .due td{font-weight:900;font-size:12px;border:0}
  .duo .foot{margin-top:auto;padding-top:4px;border-top:1px solid #999;display:flex;align-items:flex-end;justify-content:space-between;gap:6px}
  .duo .foot .qr svg{width:16mm;height:16mm} .duo .foot .bc svg{height:9mm;width:auto}
  .duo .copy{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;text-align:center;margin-top:4px}
  .duo .note{font-size:9px;color:#444;margin-top:3px}
  @page{margin:8mm}
  @media print{.noprint{display:none}}
`;

/** Hoja carta apaisada para el recibo doble; se añade después del CSS común, así que su @page gana. */
export const DUO_PAGE_CSS = `@page{size:letter landscape;margin:6mm} html,body{width:100%;height:100%} body{overflow:hidden}`;

/** Ficha de laboratorio: una por línea con lentes. Sin precios ni pagos. */
export function jobHtml(doc) {
  const lang = doc.terminal.ticket_locale === "es" ? "es" : "en";
  const t = tIn(lang);
  const head = (tk) => `
    <div class="jh">
      <div><b>${esc(doc.business.name)} · ${esc(doc.store.name)}</b>
        <small>${esc([doc.store.address, doc.store.phone].filter(Boolean).join(" · "))}</small></div>
      <div style="text-align:right"><small>${esc(t("adm.doc.job.store"))} <b>${esc(doc.store.code)}</b> · ${esc(t("adm.doc.job.pos"))} <b>${esc(doc.terminal.code || "—")}</b></small>
        <small>${esc(t("adm.doc.job.invoice"))} <b>${esc(doc.sale.number)}</b></small></div>
    </div>
    ${doc.print.reprint ? `<div class="reprint">${esc(t("adm.doc.reprint", { date: fmtDate(new Date().toISOString(), lang) }))}</div>` : ""}
    ${doc.sale.status === "voided" ? `<div class="reprint">${esc(t("adm.doc.voided"))}</div>` : ""}
    <div class="pt">${esc(doc.customer.name || "—")}</div>
    <table class="kv"><tbody>
      <tr><td>${esc(t("adm.doc.job.ordered"))}</td><td>${esc(fmtDate(doc.sale.created_at, lang))}</td></tr>
      <tr><td>${esc(t("adm.doc.job.submitted"))}</td><td>${esc([doc.sale.seller_code, doc.terminal.code].filter(Boolean).join(" · ") || "—")}</td></tr>
      <tr><td>${esc(t("adm.doc.job.updated"))}</td><td>${esc(fmtDate(doc.sale.updated_at, lang))}</td></tr>
      <tr><td>${esc(t("adm.doc.job.promised"))}</td><td>${esc(doc.sale.promised_on || "—")}</td></tr>
    </tbody></table>
    <h4>${esc(t("adm.doc.job.rx"))}</h4>
    <table><thead><tr><th></th><th>SPH</th><th>CYL</th><th>${esc(t("adm.doc.job.axis"))}</th><th>ADD</th><th>${esc(t("adm.doc.job.prism"))}</th><th>${esc(t("adm.doc.job.seg"))}</th><th>${esc(t("adm.doc.job.pd"))}</th></tr></thead><tbody>
      ${["od", "os"].map((eye) => {
        const e = tk.rx?.[eye] || {};
        return `<tr><th>${eye.toUpperCase()}</th><td>${fmtRx(e.sph)}</td><td>${fmtRx(e.cyl)}</td><td>${e.axis ?? "—"}</td><td>${fmtRx(e.add)}</td>
          <td>${e.prism == null ? "—" : `${fmtRx(e.prism, 2, false)}${e.base ? ` ${esc(e.base)}` : ""}`}</td>
          <td>${fmtRx(tk.rx?.seg_height, 2, false)}</td><td>${fmtRx(tk.rx?.[`pd_${eye}`], 2, false)}</td></tr>`;
      }).join("")}
    </tbody></table>`;
  return doc.tickets.map((tk) => {
    const l = tk.line;
    const handling = l.handling === "patient_own_frame" ? t("adm.doc.job.handling.own") : t("adm.doc.job.handling.supplied");
    return `<section class="job">
      ${head(tk)}
      <div class="grid2">
        <div><h4>${esc(t("adm.doc.job.overview"))}</h4><table class="kv"><tbody>
          <tr><td>${esc(t("adm.doc.job.jobType"))}</td><td>${esc(t(`adm.doc.job.type.${tk.job_type}`))}</td></tr>
          <tr><td>Rx #</td><td>${esc(tk.rx?.rx_number || "—")}</td></tr>
          <tr><td>${esc(t("adm.doc.job.tray"))}</td><td><b>${esc(doc.sale.tray || "—")}</b></td></tr>
          <tr><td>${esc(t("adm.doc.job.invoice"))}</td><td>${esc(doc.sale.number)}</td></tr>
        </tbody></table>
        <h4>${esc(t("adm.doc.job.lens"))}</h4><table class="kv"><tbody>
          <tr><td>${esc(t("adm.doc.job.material"))}</td><td>${esc(bi(l.lens?.material, lang) || "—")}</td></tr>
          <tr><td>${esc(t("adm.doc.job.style"))}</td><td>${esc(bi(l.lens?.design, lang) || "—")}</td></tr>
          <tr><td>${esc(t("adm.doc.job.intrinsic"))}</td><td>${esc(bi(l.lens?.photo, lang) || "—")}</td></tr>
          <tr><td>${esc(t("adm.doc.job.coating"))}</td><td>${esc(bi(l.lens?.ar, lang) || "—")}</td></tr>
        </tbody></table></div>
        <div><h4>${esc(t("adm.doc.job.frame"))}</h4>
        ${photoBox(l, 480, l.image_url ? "" : t("adm.doc.rcpt.noPhoto"))}
        <table class="kv"><tbody>
          <tr><td>${esc(t("adm.doc.job.handling"))}</td><td><b>${esc(handling)}</b></td></tr>
          ${l.own_frame
            ? `<tr><td>${esc(t("adm.doc.job.ownDesc"))}</td><td>${esc(l.own_frame.description || "—")}</td></tr>
               <tr><td>${esc(t("adm.doc.job.photo"))}</td><td>${esc(l.own_frame.has_photo ? t("adm.doc.job.photoYes") : t("adm.doc.job.photoNo"))}</td></tr>`
            : `<tr><td>${esc(t("adm.doc.job.maker"))}</td><td>${esc(l.frame?.brand || "—")}</td></tr>
               <tr><td>${esc(t("adm.doc.job.model"))}</td><td>${esc([l.frame?.model, l.variant_title].filter(Boolean).join(" · ") || "—")}</td></tr>
               <tr><td>${esc(t("adm.doc.job.frameMaterial"))}</td><td>${esc(l.frame?.material || "—")}</td></tr>
               <tr><td>${esc(t("adm.doc.job.eye"))}</td><td>${esc(l.frame?.eye_size ?? "—")}</td></tr>
               <tr><td>${esc(t("adm.doc.job.bridge"))}</td><td>${esc(l.frame?.bridge ?? "—")}</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="fold">
        <div><div class="big">${esc(doc.store.code)} · ${esc(String(doc.sale.tray || "").split("-").pop() || "—")}</div>
          <div class="muted">${esc(t("adm.doc.job.fold"))} · ${esc(doc.sale.number)}</div></div>
        <div>${code128Svg(doc.sale.number)}</div>
      </div>
    </section>`;
  }).join("");
}

/** Lo que se lee de una línea en los recibos: nombre, resumen de lentes (o «solo montura») y forma de pago. */
const lineName = (l, t) => (l.kind === "own_frame" ? `${t("adm.pos.own.tag")}${l.title ? ` (${l.title})` : ""}` : [l.title, l.variant_title].filter(Boolean).join(" · "));
const lineLens = (l, t, lang) =>
  l.lens ? [bi(l.lens.design, lang), bi(l.lens.material, lang), bi(l.lens.photo, lang), bi(l.lens.ar, lang)].filter(Boolean).join(" · ") : l.design_code === "frame-only" ? t("adm.doc.rcpt.frameOnly") : "";
const payMethod = (p, t, lang) => (p.method ? bi(p.method, lang) : t(`adm.pos.method.${p.method_code}`));
const payKindKey = (p) => (p.kind === "refund" ? "adm.doc.rcpt.refund" : p.method_code === "insurance" ? "adm.doc.rcpt.insurance" : p.kind === "balance" ? "adm.doc.rcpt.balancePaid" : "adm.doc.rcpt.deposit");

/** Recibo del cliente: rollo de 80 mm. Sin valores de receta (dato de salud). */
export function receiptHtml(doc) {
  const lang = doc.terminal.receipt_locale === "en" ? "en" : "es";
  const t = tIn(lang);
  const m = (v) => money(v, "usd", lang);
  const tot = doc.totals;
  const method = (p) => payMethod(p, t, lang);
  const kindKey = payKindKey;
  return `<section class="rcpt">
    <div class="c"><h2>${esc(doc.business.name)} · ${esc(doc.store.name)}</h2>
      <div>${esc([doc.store.address, doc.store.phone, doc.terminal.code].filter(Boolean).join(" · "))}</div></div>
    ${doc.print.reprint ? `<div class="c reprint">${esc(t("adm.doc.reprint", { date: fmtDate(new Date().toISOString(), lang) }))}</div>` : ""}
    ${doc.sale.status === "voided" ? `<div class="c reprint">${esc(t("adm.doc.voided"))}</div>` : ""}
    <hr/>
    <table><tbody>
      <tr><td>${esc(t("adm.doc.rcpt.sale"))}</td><td class="r"><b>${esc(doc.sale.number)}</b></td></tr>
      <tr><td>${esc(t("adm.doc.rcpt.date"))}</td><td class="r">${esc(fmtDate(doc.sale.created_at, lang))}</td></tr>
      ${doc.sale.seller_code ? `<tr><td>${esc(t("adm.doc.rcpt.served"))}</td><td class="r">${esc(doc.sale.seller_code)}</td></tr>` : ""}
      ${doc.customer.name ? `<tr><td>${esc(t("adm.doc.rcpt.customer"))}</td><td class="r">${esc(doc.customer.name)}</td></tr>` : ""}
    </tbody></table>
    <hr/>
    <table><tbody>
      ${doc.lines.map((l) => {
        const lens = lineLens(l, t, lang);
        const qty = l.quantity > 1 ? ` ×${l.quantity}` : "";
        return `<tr><td class="lp">${photoBox(l, 320, l.image_url ? "" : t("adm.doc.rcpt.noPhoto"))}</td>
          <td>${esc(lineName(l, t))}${qty}${l.sku ? `<br/><span class="muted">${esc(l.sku)}</span>` : ""}${lens ? `<br/><span class="muted">${esc(lens)}</span>` : ""}</td>
          <td class="r">${m(l.list)}</td></tr>`;
      }).join("")}
    </tbody></table>
    <table><tbody>
      ${tot.discount > 0 || tot.tax > 0 ? `<tr><td>${esc(t("adm.doc.rcpt.subtotal"))}</td><td class="r">${m(tot.list)}</td></tr>` : ""}
      ${tot.discount > 0 ? `<tr><td>${esc(t("adm.doc.rcpt.discount", { n: tot.discount_pct }))}</td><td class="r">−${m(tot.discount)}</td></tr>` : ""}
      ${tot.tax > 0 ? `<tr><td>${esc(t("adm.doc.rcpt.tax"))}</td><td class="r">${m(tot.tax)}</td></tr>` : ""}
      <tr class="tot"><td>${esc(t("adm.doc.rcpt.total"))}</td><td class="r">${m(tot.total)}</td></tr>
      ${doc.payments.map((p) => `<tr><td>${esc(t(kindKey(p)))} (${esc(method(p))})</td><td class="r">${m(p.amount)}</td></tr>`).join("")}
      <tr class="tot"><td>${esc(t("adm.doc.rcpt.balance"))}</td><td class="r">${m(tot.balance)}</td></tr>
    </tbody></table>
    <hr/>
    <table><tbody>
      ${doc.sale.promised_on ? `<tr><td>${esc(t("adm.doc.rcpt.promised"))}</td><td class="r">${esc(doc.sale.promised_on)}</td></tr>` : ""}
      ${doc.sale.tray ? `<tr><td>${esc(t("adm.doc.rcpt.tray"))}</td><td class="r"><b>${esc(doc.sale.tray)}</b></td></tr>` : ""}
    </tbody></table>
    <div class="c">${code128Svg(doc.sale.number, 36)}</div>
    <div class="c qr">${qrSvg(doc.tracking_url)}<div class="muted">${esc(doc.sale.number)} · ${esc(t("adm.doc.rcpt.scan"))}</div></div>
    ${doc.store.receipt_note ? `<hr/><div class="muted">${esc(doc.store.receipt_note)}</div>` : ""}
    <div class="muted c">${esc(t("adm.doc.rcpt.noRx"))}</div>
  </section>`;
}

/** Una copia del recibo doble: media hoja carta, densa, con todo lo de la venta. `copyKey` es el pie (cliente / tienda). */
function duoCopyHtml(doc, t, lang, copyKey) {
  const m = (v) => money(v, "usd", lang);
  const tot = doc.totals;
  const method = (p) => payMethod(p, t, lang);
  const kv = (k, v) => (v ? `<tr><td>${esc(k)}</td><td class="r">${v}</td></tr>` : "");
  return `<div class="half">
    <div class="dh">
      <div><b>${esc(doc.business.name)} · ${esc(doc.store.name)}</b>
        <small>${esc([doc.store.address, doc.store.phone].filter(Boolean).join(" · "))}</small></div>
      <div style="text-align:right"><div class="no">${esc(doc.sale.number)}</div>
        <small>${esc(fmtDate(doc.sale.created_at, lang))}</small>
        <small>${esc([doc.sale.seller_code ? `${t("adm.doc.rcpt.served")}: ${doc.sale.seller_code}` : "", doc.terminal.code ? `${t("adm.doc.job.pos")}: ${doc.terminal.code}` : ""].filter(Boolean).join(" · "))}</small></div>
    </div>
    ${doc.print.reprint ? `<div class="reprint">${esc(t("adm.doc.reprint", { date: fmtDate(new Date().toISOString(), lang) }))}</div>` : ""}
    ${doc.sale.status === "voided" ? `<div class="reprint">${esc(t("adm.doc.voided"))}</div>` : ""}
    <div class="who">
      <div><b>${esc(t("adm.doc.rcpt.customer"))}:</b> ${esc(doc.customer.name || "—")}${doc.customer.phone ? ` · ${esc(t("adm.doc.rcpt.phone"))} ${esc(doc.customer.phone)}` : ""}</div>
      <div><b>${esc(t("adm.doc.rcpt.delivery"))}:</b> ${esc(t(doc.sale.delivery === "ship" ? "adm.pos.pay.ship" : "adm.pos.pay.pickup"))}</div>
    </div>
    <table><thead><tr><th class="lp"></th><th>${esc(t("adm.doc.rcpt.item"))}</th><th class="c">${esc(t("adm.doc.rcpt.qty"))}</th><th class="r">${esc(t("adm.doc.rcpt.price"))}</th></tr></thead><tbody>
      ${doc.lines.map((l) => {
        // The product title usually starts with the brand already ("Di Caprio 407"): do not print it twice.
        const brand = l.frame?.brand && !String(l.title || "").toLowerCase().startsWith(String(l.frame.brand).toLowerCase()) ? l.frame.brand : "";
        const specs = [brand, l.title, l.variant_title].filter(Boolean).join(" · ");
        const lens = lineLens(l, t, lang);
        return `<tr><td class="lp">${photoBox(l, 320, l.image_url ? "" : t("adm.doc.rcpt.noPhoto"))}</td>
          <td><b>${esc(l.kind === "own_frame" ? lineName(l, t) : specs || lineName(l, t))}</b>${l.sku ? ` <span class="muted">${esc(l.sku)}</span>` : ""}${lens ? `<div class="muted">${esc(lens)}</div>` : ""}</td>
          <td class="c">${l.quantity}</td><td class="r">${m(l.list)}</td></tr>`;
      }).join("")}
    </tbody></table>
    <div class="sum">
      <div><table><tbody>
        <tr><th colspan="2">${esc(t("adm.doc.rcpt.payments"))}</th></tr>
        ${doc.payments.map((p) => `<tr><td>${esc(t(payKindKey(p)))} · ${esc(method(p))}${p.reference ? ` <span class="muted">${esc(t("adm.doc.rcpt.ref"))} ${esc(p.reference)}</span>` : ""}<br/><span class="muted">${esc(fmtDate(p.created_at, lang))}</span></td><td class="r">${m(p.amount)}</td></tr>`).join("")}
        ${kv(t("adm.doc.rcpt.paid"), m(tot.paid))}
        ${tot.insurance > 0 ? kv(t("adm.doc.rcpt.insurance"), m(tot.insurance)) : ""}
        ${kv(t("adm.doc.rcpt.promised"), esc(doc.sale.promised_on || ""))}
        ${kv(t("adm.doc.rcpt.tray"), doc.sale.tray ? `<b>${esc(doc.sale.tray)}</b>` : "")}
      </tbody></table></div>
      <div><table><tbody>
        <tr><td>${esc(t("adm.doc.rcpt.subtotal"))}</td><td class="r">${m(tot.list)}</td></tr>
        ${tot.discount > 0 ? `<tr><td>${esc(t("adm.doc.rcpt.discount", { n: tot.discount_pct }))}</td><td class="r">−${m(tot.discount)}</td></tr>` : ""}
        ${tot.tax > 0 ? `<tr><td>${esc(t("adm.doc.rcpt.tax"))}</td><td class="r">${m(tot.tax)}</td></tr>` : ""}
        <tr class="tot"><td>${esc(t("adm.doc.rcpt.total"))}</td><td class="r">${m(tot.total)}</td></tr>
        <tr class="due"><td>${esc(t("adm.doc.rcpt.balance"))}</td><td class="r">${m(tot.balance)}</td></tr>
      </tbody></table></div>
    </div>
    ${doc.store.receipt_note ? `<div class="note">${esc(doc.store.receipt_note)}</div>` : ""}
    <div class="foot">
      <div class="bc">${code128Svg(doc.sale.number, 30)}<div class="muted">${esc(t("adm.doc.rcpt.noRx"))}</div></div>
      <div class="qr c">${qrSvg(doc.tracking_url)}<div class="muted">${esc(t("adm.doc.rcpt.scan"))}</div></div>
    </div>
    <div class="copy">${esc(t(copyKey))}</div>
  </div>`;
}

/**
 * Recibo «doble»: UNA hoja carta apaisada con dos copias iguales — cliente a la
 * izquierda, tienda (archivo) a la derecha — y una línea de corte entre las dos.
 * Para puntos de venta con impresora normal; el rollo sigue para las térmicas.
 */
export function receiptDuoHtml(doc) {
  const lang = doc.terminal.receipt_locale === "en" ? "en" : "es";
  const t = tIn(lang);
  return `<section class="duo">
    ${duoCopyHtml(doc, t, lang, "adm.doc.duo.customerCopy")}
    <div class="cut"><span>✂</span><small>${esc(t("adm.doc.duo.cut"))}</small></div>
    ${duoCopyHtml(doc, t, lang, "adm.doc.duo.storeCopy")}
  </section>`;
}

/** Espera a que carguen (o fallen) todas las imágenes del documento, con un tope: una foto a medias se imprime en blanco. */
function imagesSettled(doc, timeoutMs = 4000) {
  const pending = [...doc.images].filter((img) => !img.complete);
  if (!pending.length) return Promise.resolve();
  return Promise.race([
    Promise.all(pending.map((img) => new Promise((resolve) => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); }))),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Imprime en un iframe oculto: funciona aunque haya habido una petición antes
 * (sin bloqueo de ventanas). No llama a print() hasta que las fotos están
 * cargadas (o pasan 4 s). `extraCss` va después del CSS común (p. ej. el @page
 * apaisado del recibo doble).
 */
async function printHtml(title, body, extraCss = "") {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const d = frame.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}${extraCss}</style></head><body>${body}</body></html>`);
  d.close();
  await imagesSettled(d);
  await new Promise((resolve) => setTimeout(resolve, 100));
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60000);
}

/**
 * `printer`: cómo describió el dueño la impresora del punto de venta (campo
 * `printer` del terminal). Con una térmica, el recibo principal es el rollo; con
 * cualquier otra (o sin dato), el recibo doble en carta, y el rollo queda como
 * botón secundario.
 */
export default function SaleDocuments({ saleId, compact = false, printer = null }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState("");
  const [photo, setPhoto] = useState(null);
  const [emailDetail, setEmailDetail] = useState(false);
  const thermal = isThermalPrinter(printer);

  const print = async (kind) => {
    setBusy(kind);
    try {
      const { document: doc } = await adminFetch(`/admin/pos/sales/${encodeURIComponent(saleId)}/documents`, { method: "POST", body: { kind } });
      if (kind === "job") {
        if (!doc.tickets?.length) { toast({ tone: "info", title: t("adm.doc.noLenses") }); return; }
        const own = doc.tickets.find((tk) => tk.line.own_frame?.photo_url);
        setPhoto(own ? own.line.own_frame.photo_url : null);
        await printHtml(`${doc.sale.number} · job`, jobHtml(doc));
      } else if (kind === "receipt_duo") {
        await printHtml(`${doc.sale.number} · receipt`, receiptDuoHtml(doc), DUO_PAGE_CSS);
      } else {
        await printHtml(`${doc.sale.number} · receipt`, receiptHtml(doc));
      }
    } catch (e) {
      toast({ tone: "error", title: t(e.reason ? `adm.err.pos.${e.reason}` : "adm.err.pos.generic") });
    } finally { setBusy(""); }
  };

  const receiptButtons = thermal
    ? [["receipt", "adm.doc.printReceipt"], ["receipt_duo", "adm.doc.printReceiptDuo"]]
    : [["receipt_duo", "adm.doc.printReceiptDuo"], ["receipt", "adm.doc.printReceiptRoll"]];

  const send = async () => {
    setBusy("email");
    try {
      const r = await adminFetch(`/admin/pos/sales/${encodeURIComponent(saleId)}/receipt`, { method: "POST", body: { receipt_detail: emailDetail } });
      setEmailDetail(false);
      toast({ tone: "success", title: t(r.detailed ? "adm.doc.sentDetail" : "adm.doc.sent", { to: r.to }) });
    } catch (e) {
      toast({ tone: "error", title: t(e.reason ? `adm.err.pos.${e.reason}` : "adm.err.pos.generic") });
    } finally { setBusy(""); }
  };

  return (
    <div className={`pos-docs ${compact ? "compact" : ""}`}>
      <button type="button" className="btn-sm" disabled={Boolean(busy)} onClick={() => print("job")}><Icon name="printer" size={14} /> {busy === "job" ? "…" : t("adm.doc.printJob")}</button>
      {receiptButtons.map(([kind, label]) => (
        <button key={kind} type="button" className="btn-sm" disabled={Boolean(busy)} onClick={() => print(kind)}><Icon name="receipt" size={14} /> {busy === kind ? "…" : t(label)}</button>
      ))}
      <button type="button" className="btn-sm" disabled={Boolean(busy)} onClick={send}><Icon name="mail" size={14} /> {busy === "email" ? "…" : t("adm.doc.emailReceipt")}</button>
      <label className="pos-check" title={t("adm.pos.pay.notifyDetailOn")}><input type="checkbox" checked={emailDetail} disabled={Boolean(busy)} onChange={(e) => setEmailDetail(e.target.checked)} /> {t("adm.doc.emailDetail")}</label>
      {photo && <a className="btn-sm" href={photo} target="_blank" rel="noreferrer"><Icon name="camera" size={14} /> {t("adm.doc.ownPhoto")}</a>}
    </div>
  );
}
