// Dónde se usa: todo el panel (/admin) — exportar cualquier tabla o tarjeta a
// CSV (Excel) y a PDF. Sin librerías: el PDF se genera con el diálogo de
// impresión del navegador ("Guardar como PDF"), que respeta los SVG de los
// gráficos, los colores y la tipografía tal como se ven en pantalla.
//
// `printElement(el, title)` clona el nodo dentro de una hoja de impresión
// aislada (#adm-print-root), oculta el resto del panel mientras dura la
// impresión y limpia al terminar. Funciona con cualquier tarjeta, tabla o
// pestaña completa.

const esc = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** `cols` = [[cabecera, fn(row) | clave]], devuelve texto CSV con BOM (Excel). */
export function rowsToCsv(cols, rows) {
  const get = (c, r) => (typeof c[1] === "function" ? c[1](r) : r?.[c[1]]);
  const lines = [cols.map((c) => esc(c[0])).join(",")];
  for (const r of rows || []) lines.push(cols.map((c) => esc(get(c, r))).join(","));
  return "﻿" + lines.join("\n");
}

export function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

export function downloadCsv(name, cols, rows) {
  downloadText(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(cols, rows));
}

/**
 * Convierte en CSV lo que hay en pantalla dentro de un nodo: todas sus tablas
 * (cabeceras + celdas) y, si no hay tablas, los pares etiqueta/valor de los
 * KPI (`small`/`b`). Así cualquier tarjeta se exporta sin cablear columnas.
 */
export function elementToCsv(el) {
  const tables = [...el.querySelectorAll("table")];
  const blocks = [];
  if (tables.length) {
    for (const tb of tables) {
      const rows = [...tb.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => esc(c.innerText.replace(/\s+/g, " ").trim())).join(","));
      blocks.push(rows.join("\n"));
    }
  } else {
    const kpis = [...el.querySelectorAll(".cx-kpi, .cost-kpi, .sel-stat, .exec-pipe-col, .adm-tb-row, .cx-legend-row")];
    const rows = kpis.map((k) => [...k.querySelectorAll("small, b, .adm-tb-name, span")].map((x) => x.innerText.replace(/\s+/g, " ").trim()).filter(Boolean));
    if (rows.length) blocks.push(rows.map((r) => r.map(esc).join(",")).join("\n"));
    else blocks.push(esc(el.innerText.trim()));
  }
  return "﻿" + blocks.join("\n\n");
}

let printStyle = null;
function ensurePrintStyle() {
  if (printStyle) return;
  printStyle = document.createElement("style");
  printStyle.textContent = `
    #adm-print-root { display: none; }
    @media print {
      body.adm-printing > *:not(#adm-print-root) { display: none !important; }
      #adm-print-root { display: block !important; padding: 12mm; font-family: "Inter", system-ui, sans-serif; color: #17191f; }
      #adm-print-root .adm-print-title { font-family: "Fraunces", Georgia, serif; font-size: 20pt; margin: 0 0 2mm; }
      #adm-print-root .adm-print-meta { font-size: 9pt; color: #5b6472; margin: 0 0 6mm; }
      #adm-print-root .adm-card, #adm-print-root .cost-kpi, #adm-print-root .cx-kpi { box-shadow: none !important; break-inside: avoid; animation: none !important; transform: none !important; }
      #adm-print-root .adm-grid-2, #adm-print-root .exec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
      #adm-print-root .adm-kpis, #adm-print-root .cost-kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
      #adm-print-root table { width: 100%; border-collapse: collapse; font-size: 9pt; }
      #adm-print-root th, #adm-print-root td { border-bottom: 1px solid #ddd; padding: 2mm 1.5mm; text-align: left; }
      #adm-print-root .adm-noprint, #adm-print-root button, #adm-print-root input, #adm-print-root select, #adm-print-root .adm-range, #adm-print-root .adm-subtabs { display: none !important; }
      #adm-print-root svg { max-width: 100%; height: auto; }
      @page { margin: 10mm; }
    }`;
  document.head.appendChild(printStyle);
}

/** Imprime (→ PDF) un nodo del panel con título y fecha. */
export function printElement(el, title, meta = "") {
  if (!el) return;
  ensurePrintStyle();
  let root = document.getElementById("adm-print-root");
  if (!root) { root = document.createElement("div"); root.id = "adm-print-root"; document.body.appendChild(root); }
  root.innerHTML = "";
  const h = document.createElement("h1"); h.className = "adm-print-title"; h.textContent = title || document.title; root.appendChild(h);
  const m = document.createElement("p"); m.className = "adm-print-meta"; m.textContent = `${meta ? meta + " · " : ""}${new Date().toLocaleString()}`; root.appendChild(m);
  const clone = el.cloneNode(true);
  // Los inputs no se clonan con su valor: se copia a mano para que el PDF
  // enseñe lo que había escrito (importes de las fichas, filtros…).
  const src = el.querySelectorAll("input, select, textarea");
  const dst = clone.querySelectorAll("input, select, textarea");
  src.forEach((s, i) => { const d = dst[i]; if (!d) return; const span = document.createElement("span"); span.textContent = s.value; span.className = "adm-print-val"; d.replaceWith(span); });
  root.appendChild(clone);
  document.body.classList.add("adm-printing");
  const done = () => { document.body.classList.remove("adm-printing"); root.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
}
