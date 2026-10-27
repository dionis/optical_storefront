// Dónde se usa: al confirmar una venta en el punto de venta y en «Ventas» —
// imprimir la ficha de laboratorio y el recibo, y enviar el recibo por email
// (documento acordado, «Recibo y ficha de laboratorio»). Los datos los da el
// servidor (GET/POST /admin/pos/sales/:id/documents); aquí solo se maquetan.
import { useState } from "react";
import qrcode from "qrcode-generator";
import { T } from "../i18n/translations.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";

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

const fmtDate = (v, lang) => (v ? new Date(v).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtRx = (v, digits = 2, sign = true) => (v === null || v === undefined ? "—" : `${sign && Number(v) > 0 ? "+" : ""}${Number(v).toFixed(digits)}`);
const bi = (o, lang) => (o ? o[lang] || o.es || "" : "");

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
  .rcpt{width:72mm;margin:0 auto;padding:4mm 2mm;font-size:12px}
  .rcpt .c{text-align:center} .rcpt h2{font-size:15px;margin:2px 0}
  .rcpt table{font-size:11.5px} .rcpt td{border:0;padding:2px 0} .rcpt .r{text-align:right;white-space:nowrap}
  .rcpt .tot td{font-weight:800;font-size:13px;border-top:1px solid #111}
  .rcpt hr{border:0;border-top:1px dashed #111;margin:6px 0}
  .rcpt .qr svg{width:28mm;height:28mm}
  @page{margin:8mm}
  @media print{.noprint{display:none}}
`;

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
        <div><h4>${esc(t("adm.doc.job.frame"))}</h4><table class="kv"><tbody>
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

/** Recibo del cliente: rollo de 80 mm. Sin valores de receta (dato de salud). */
export function receiptHtml(doc) {
  const lang = doc.terminal.receipt_locale === "en" ? "en" : "es";
  const t = tIn(lang);
  const m = (v) => money(v, "usd", lang);
  const tot = doc.totals;
  const method = (p) => (p.method ? bi(p.method, lang) : t(`adm.pos.method.${p.method_code}`));
  const kindKey = (p) => (p.kind === "refund" ? "adm.doc.rcpt.refund" : p.method_code === "insurance" ? "adm.doc.rcpt.insurance" : p.kind === "balance" ? "adm.doc.rcpt.balancePaid" : "adm.doc.rcpt.deposit");
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
        const name = l.kind === "own_frame" ? `${t("adm.pos.own.tag")}${l.title ? ` (${l.title})` : ""}` : [l.title, l.variant_title].filter(Boolean).join(" · ");
        const lens = l.lens ? [bi(l.lens.design, lang), bi(l.lens.material, lang), bi(l.lens.photo, lang), bi(l.lens.ar, lang)].filter(Boolean).join(" · ") : "";
        return `<tr><td>${esc(name)}${lens ? `<br/><span class="muted">${esc(lens)}</span>` : ""}</td><td class="r">${m(l.unit_price)}</td></tr>`;
      }).join("")}
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

/** Imprime en un iframe oculto: funciona aunque haya habido una petición antes (sin bloqueo de ventanas). */
function printHtml(title, body) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const d = frame.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`);
  d.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  }, 250);
}

export default function SaleDocuments({ saleId, compact = false }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState("");
  const [photo, setPhoto] = useState(null);

  const print = async (kind) => {
    setBusy(kind);
    try {
      const { document: doc } = await adminFetch(`/admin/pos/sales/${encodeURIComponent(saleId)}/documents`, { method: "POST", body: { kind } });
      if (kind === "job") {
        if (!doc.tickets?.length) { toast({ tone: "info", title: t("adm.doc.noLenses") }); return; }
        const own = doc.tickets.find((tk) => tk.line.own_frame?.photo_url);
        setPhoto(own ? own.line.own_frame.photo_url : null);
        printHtml(`${doc.sale.number} · job`, jobHtml(doc));
      } else {
        printHtml(`${doc.sale.number} · receipt`, receiptHtml(doc));
      }
    } catch (e) {
      toast({ tone: "error", title: t(e.reason ? `adm.err.pos.${e.reason}` : "adm.err.pos.generic") });
    } finally { setBusy(""); }
  };

  const send = async () => {
    setBusy("email");
    try {
      const r = await adminFetch(`/admin/pos/sales/${encodeURIComponent(saleId)}/receipt`, { method: "POST", body: {} });
      toast({ tone: "success", title: t("adm.doc.sent", { to: r.to }) });
    } catch (e) {
      toast({ tone: "error", title: t(e.reason ? `adm.err.pos.${e.reason}` : "adm.err.pos.generic") });
    } finally { setBusy(""); }
  };

  return (
    <div className={`pos-docs ${compact ? "compact" : ""}`}>
      <button type="button" className="btn-sm" disabled={Boolean(busy)} onClick={() => print("job")}><Icon name="printer" size={14} /> {busy === "job" ? "…" : t("adm.doc.printJob")}</button>
      <button type="button" className="btn-sm" disabled={Boolean(busy)} onClick={() => print("receipt")}><Icon name="receipt" size={14} /> {busy === "receipt" ? "…" : t("adm.doc.printReceipt")}</button>
      <button type="button" className="btn-sm" disabled={Boolean(busy)} onClick={send}><Icon name="mail" size={14} /> {busy === "email" ? "…" : t("adm.doc.emailReceipt")}</button>
      {photo && <a className="btn-sm" href={photo} target="_blank" rel="noreferrer"><Icon name="camera" size={14} /> {t("adm.doc.ownPhoto")}</a>}
    </div>
  );
}
