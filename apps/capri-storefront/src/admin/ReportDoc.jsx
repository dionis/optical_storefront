// Dónde se usa: Estado de tienda (StoreStatus), Pedidos de la tienda
// (StoreOrders) y el Ejecutivo (ExecutiveHub) — los reportes que salen del
// panel en PDF, Excel y CSV con la misma estructura: cabecera en el color de
// la tienda con el nombre de la óptica y el título del reporte, tira de
// indicadores, resúmenes en pastillas, gráficos pequeños y las tablas (una
// línea por venta). No es un componente React: construye el documento a mano
// (HTML + report.css) y lo imprime en un iframe aislado (exportUtils.printHtml),
// así ni el CSS del panel ni el título de la pestaña se cuelan en el papel.
//
//   const spec = {
//     title: t("adm.rpt.statusTitle", { store: "Fry Family Clinic" }),
//     subtitle?: "…",                                   // bajo el título
//     store: { code, name, color, address, phone } | null,
//     period: { from: "2026-10-01", to: "2026-10-31" } | null,
//     generatedAt?: Date,
//     kpis: [{ label, value, sub?, tone?: "good"|"bad"|"warn", neg?, raw? }],   // value null/"" → no se pinta
//     summaries: [{ title, pills: [{ label, value, tone?, strong? }] }],
//     charts?: [{ title?, svg: string } | { title?, node: Element } | Element | string],
//     tables: [{ title, note?, cols: [{ header, key|get, type?, width?, align?, text?, cls?, tag?, groupHide? }], rows, totals?, totalsLabel?, main?, empty?,
//                groupBy?, sortBy?, dropZero? }],
//     landscape?: true, lang, t, filename?: "estado-FRY-2026-10-31"
//   };
//   exportReport("pdf" | "xlsx" | "csv", spec);
//
// DOS AUDIENCIAS. El mismo `spec` se imprime de dos formas: "owner" (la de
// siempre, completa) y "share" (el estado de la tienda que se socializa, sin
// saldo, costo, ganancia, margen ni comisión y con el total vendido en lugar
// de la fila de tarjetas). La elige la barra de filtros con
// `withReportAudience(...)` y el filtrado es una función pura sobre la
// especificación: `specForAudience(spec, "share")` — ver su bloque más abajo.
// Para que una tarjeta, pastilla o gráfico PUEDA salir en la versión para
// compartir tiene que decir qué es (`key` o `concept`: "revenue", "count",
// "mix", "discount"); lo que no se identifica se queda fuera.
//
// `cols` sirve a los tres formatos: `get`/`key` da el valor crudo (Excel, CSV),
// `text(row)` lo que se imprime (si falta, se formatea por `type`: money, int,
// pct, date), `cls(row)` clases extra de la celda ("neg", "muted"…) y `tag`
// pinta el texto como etiqueta. `main: true` marca la tabla que va al CSV.
//
// Bloques por grupo (reportes de «Todas las tiendas», vendedores por tienda…):
//
//   groupBy: {
//     key | get(row),                  // de qué grupo es cada fila (id de tienda, código de vendedor…)
//     label(groupKey, rows) → string,  // lo que se lee en la banda del grupo ("FRY · Fry Family Clinic")
//     colorOf?(groupKey) → "#hex",     // punto y franja en el color de la tienda (sin él, el del reporte)
//     order?: "label" | "total-desc" | "given",   // alfabético (defecto), por total descendente, o como llegan
//     totalKey?: "total",              // columna que decide "total-desc" (defecto: la primera de subtotalKeys)
//     subtotalKeys?: ["total", "paid"],  // columnas numéricas que se suman por grupo (defecto: las claves de `totals`)
//     subtotals?(rows, groupKey) → { key: value },  // o el cálculo propio (p. ej. salesReportTotals), que manda sobre la suma
//     count?(rows) → n, countLabel?(n) → "12 ventas",   // el contador de la banda (defecto: filas, "{n} líneas")
//     keys?: [...],                    // grupos a enseñar aunque no tengan filas (con hideEmptyGroups: false)
//     hideEmptyGroups?: true,          // defecto true
//     groupSheets?: false,             // Excel: true = una hoja por grupo; false = bandas y subtotales dentro de la hoja
//   }
//   PDF: una banda por grupo (punto de color + nombre + contador), sus filas, una fila de subtotal
//   en negrita y el total general al final; una columna con `groupHide: true` (la que repite el
//   grupo, p. ej. «Tienda») no se imprime en ese caso. Excel: según groupSheets. CSV: una línea
//   de cabecera por grupo.
//
//   sortBy: { key, dir: "asc" | "desc" }   // ordena las filas por esa columna (también dentro de cada grupo)
//   dropZero: { key }                      // quita las filas cuyo valor en esa columna es 0 o vacío, y lo dice
//                                          // en una nota al pie: «N sin ventas en el período»
//
//   Una columna con `hidden: true` no sale en ningún formato (PDF, Excel ni CSV):
//   es lo que DataTable.jsx (tableSpecFrom) marca cuando quien mira apagó esa
//   columna con el selector «Columnas» — el reporte lleva lo mismo que la pantalla.
//
//   El reporte de vendedores de todas las tiendas, por ejemplo:
//   { …, groupBy: { get: (r) => r.establishment_id, label: storeLabel, colorOf, order: "total-desc", subtotalKeys: ["sales"] },
//     sortBy: { key: "sales", dir: "desc" }, dropZero: { key: "sales" } }
import { TENANT } from "../config/tenant.js";
import { money } from "./adminOrders.js";
import { downloadText, printHtml, rowsToCsv } from "./exportUtils.js";
import { downloadXlsx } from "./exportXlsx.js";
import { sortRows } from "./useSortable.js";
import reportCss from "./report.css?inline";
// Los retoques de la versión para compartir, en su propia hoja (ver más abajo).
import reportShareCss from "./report-share.css?inline";

const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NEUTRAL = "#1f2a44";

/** Texto blanco o tinta sobre el color de la tienda, según su luminancia. */
export function inkOn(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color || "").trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.5 ? "#17191f" : "#ffffff";
}

const locale = (lang) => (lang === "en" ? "en-US" : "es-US");
const dayText = (ymd, lang) => {
  if (!ymd) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T12:00:00`) : new Date(ymd);
  return Number.isNaN(d.getTime()) ? String(ymd) : d.toLocaleDateString(locale(lang), { day: "2-digit", month: "short", year: "numeric" });
};
const whenText = (d, lang) => new Date(d || Date.now()).toLocaleString(locale(lang), { dateStyle: "medium", timeStyle: "short" });

/** Valor crudo de una columna (Excel/CSV). */
const rawOf = (c, r) => (typeof c.get === "function" ? c.get(r) : c.key != null ? r?.[c.key] : undefined);

/** Lo que se imprime en la celda: `text(row)` o el crudo formateado por tipo. */
export function cellText(c, r, lang) {
  if (typeof c.text === "function") return c.text(r);
  return fmtByType(rawOf(c, r), c.type, lang);
}
export function fmtByType(v, type, lang) {
  if (v == null || v === "") return type === "money" || type === "int" || type === "pct" ? "—" : "";
  if (type === "money") return money(v, "usd", lang);
  if (type === "int") return (Number(v) || 0).toLocaleString(locale(lang));
  if (type === "pct") return Number.isNaN(Number(v)) ? String(v) : `${Math.round(Number(v) * 10) / 10}%`;
  if (type === "date") return dayText(v, lang);
  return String(v);
}

/**
 * Copia de un SVG del panel que se sostiene sola: los estilos calculados
 * (colores que en pantalla son variables CSS, tipografía) se pasan a atributos
 * de estilo y lo oculto (globos de ayuda) se quita. Devuelve el `outerHTML`.
 */
export function snapshotSvg(node) {
  if (!node) return null;
  const svg = String(node.tagName || "").toLowerCase() === "svg" ? node : node.querySelector?.("svg");
  if (!svg) return null;
  const clone = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll("*")];
  const dst = [clone, ...clone.querySelectorAll("*")];
  const PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-family", "font-weight", "color", "text-anchor", "dominant-baseline", "letter-spacing"];
  const gone = [];
  src.forEach((s, i) => {
    const d = dst[i];
    if (!d) return;
    const cs = getComputedStyle(s);
    if (cs.display === "none" || cs.visibility === "hidden") { gone.push(d); return; }
    for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v && v !== "normal") d.style.setProperty(p, v); }
    d.style.removeProperty("animation"); d.style.removeProperty("transition"); d.style.removeProperty("transform");
    d.removeAttribute("class");
  });
  gone.forEach((d) => d.remove());
  clone.querySelectorAll("animate, animateTransform, animateMotion, set").forEach((x) => x.remove());
  if (!clone.getAttribute("viewBox")) {
    const r = svg.getBoundingClientRect();
    if (r.width && r.height) clone.setAttribute("viewBox", `0 0 ${Math.round(r.width)} ${Math.round(r.height)}`);
  }
  clone.removeAttribute("width"); clone.removeAttribute("height");
  clone.style.width = ""; clone.style.height = "";
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return clone.outerHTML;
}

/**
 * Los gráficos que haya dentro de un nodo (los SVG anchos: los iconos se
 * ignoran), con el título de su tarjeta. Para el Ejecutivo: los dos gráficos
 * pequeños del resumen sin cablear selectores.
 */
export function collectCharts(root, { max = 2, minWidth = 160, skip = () => false } = {}) {
  if (!root) return [];
  const out = [];
  for (const svg of root.querySelectorAll("svg")) {
    if (out.length >= max) break;
    const r = svg.getBoundingClientRect();
    if (r.width < minWidth || r.height < 40 || skip(svg)) continue;
    const card = svg.closest(".adm-card, .cx-card, .ex-chart, section, article");
    const title = card?.querySelector("h3, h4, .adm-card-head, .cx-title")?.textContent?.replace(/\s+/g, " ").trim() || "";
    const snap = snapshotSvg(svg);
    if (snap) out.push({ title, svg: snap });
  }
  return out;
}

/**
 * Los resúmenes de los acordeones (Accordion.jsx) tal como se ven en pantalla:
 * título + pastillas de la cabecera, que se pintan aunque el acordeón esté
 * cerrado. Para el Ejecutivo y el Estado de tienda: `summaries: summariesFromAccordions(bodyRef.current)`.
 */
export function summariesFromAccordions(root) {
  if (!root) return [];
  const TONES = ["good", "bad", "warn", "muted"];
  return [...root.querySelectorAll("details.adm-acc")].map((d) => {
    const titleEl = d.querySelector("summary .acc-title");
    const title = titleEl ? [...titleEl.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() || titleEl.textContent.trim() : "";
    const pills = [...d.querySelectorAll("summary .acc-pill")].map((p) => ({
      // `data-concept` (si la pastilla lo trae) es lo ÚNICO que permite
      // publicarla en la versión para compartir: su texto está traducido y no
      // sirve para saber si lleva un costo. Ver specForAudience.
      concept: p.dataset?.concept || undefined,
      label: p.querySelector("small")?.textContent?.trim() || "",
      value: p.querySelector("b")?.textContent?.trim() || p.textContent.trim(),
      strong: p.classList.contains("strong"),
      tone: TONES.find((c) => p.classList.contains(c)) || "",
    }));
    return { title, pills };
  }).filter((s) => s.title && s.pills.length);
}

const chartOf = (c) => {
  if (!c) return null;
  if (typeof c === "string") return { title: "", svg: c };
  if (typeof c.svg === "string") return { title: c.title || "", svg: c.svg };
  const node = c.node || (c.nodeType ? c : null);
  const svg = snapshotSvg(node);
  return svg ? { title: c.title || "", svg } : null;
};

const visibleKpis = (kpis) => (kpis || []).filter((k) => k && k.value != null && k.value !== "" && k.value !== false && !k.hidden);
const visibleSummaries = (summaries) => (summaries || []).map((s) => (s ? { ...s, pills: (s.pills || []).filter((p) => p && p.value != null && p.value !== "") } : null)).filter((s) => s && s.pills.length);

/** Anchos de columna (% del total) a partir de `width` (caracteres, como en Excel) o del largo de la cabecera. */
function colWidths(cols) {
  const w = cols.map((c) => Number(c.pw) || Number(c.width) || Math.max(6, String(c.header || "").length + 2));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => Math.round((x / sum) * 1000) / 10);
}

/** Las columnas que van al reporte: sin las apagadas (`hidden`, selector «Columnas» de DataTable). */
export const shownCols = (cols) => (cols || []).filter((c) => c && !c.hidden);
const colByKey = (cols, key) => cols.find((c) => c.key === key) || null;
const valueOf = (cols, key, r) => { const c = colByKey(cols, key); return c ? rawOf(c, r) : r?.[key]; };
const tr0 = (t) => (k, p) => (typeof t === "function" ? t(k, p) : k);

/* ── Audiencia del reporte: el del dueño y el que se socializa ──────────────
 *
 * El mismo reporte se imprime para dos lectores muy distintos:
 *
 *   · "owner"  el de siempre, completo: la fila de tarjetas (ventas, cobrado,
 *              por cobrar, costo real, ganancia, margen…), los resúmenes de
 *              los acordeones, los gráficos y la lista con todas sus columnas.
 *              Es la vista del dueño y NO se toca.
 *   · "share"  el estado de resultados de la tienda que se le enseña a un
 *              encargado, a un socio o al contable de la tienda. Se socializa,
 *              así que va sin la fila de tarjetas (en su lugar, el total
 *              vendido del período) y sin NADA de saldo, costo real, ganancia,
 *              margen ni comisión: ni en tarjetas, ni en resúmenes, ni en
 *              columnas, ni en los totales al pie.
 *
 * Por qué se filtra AQUÍ y no en cada pantalla: la especificación llega ya
 * construida (salesReportSpec, sellersReportSpec…), así que una sola función
 * pura sobre la especificación cubre los tres formatos (PDF, Excel y CSV) y
 * toda pantalla, la de hoy y la que se añada mañana. Si el filtro viviera en
 * cada pantalla bastaría con que una se olvidara para publicar un costo.
 *
 * Cómo se reconoce cada concepto: por la CLAVE (`key`) de la tarjeta, columna
 * o total — nunca por la cabecera, que está traducida. El reporte sale en dos
 * idiomas y el inglés no puede abrir un agujero que el español no tiene.
 *
 * Y se falla del lado seguro: una CIFRA (dinero o porcentaje) cuya clave el
 * clasificador no sepa encasillar se queda FUERA de la versión para compartir.
 * Publicar un costo por error no se deshace; que falte una columna se ve y se
 * pide. El texto descriptivo (nº de venta, fecha, marca, modelo, paciente,
 * etapa…) sí se queda: no puede delatar un costo y sin él no hay «lista de lo
 * vendido» que enseñar.
 */
export const REPORT_AUDIENCES = ["owner", "share"];

/**
 * Clave → concepto. El orden MANDA: primero lo que no puede salir, para que
 * `total_cost` sea costo y no «total», y `paid` sea cobrado y no ingreso.
 * Las raíces van en los dos idiomas porque las claves del panel mezclan
 * inglés (`balance`, `profit`) y español (`saldo`, `ganancia`).
 */
const CONCEPT_RULES = [
  ["balance", /balance|saldo|due|owed|outstanding|receivable|por_cobrar|pendiente/],
  ["collected", /paid|collected|cobrado|cash|efectivo|deposit|abono|anticipo|settle/],
  ["cost", /cost|coste|costo|cogs|fee|expense|gasto|spend|supplier|proveedor/],
  ["profit", /profit|ganancia|utilidad|gain|benefit|beneficio|earning|contribution|contribucion/],
  ["margin", /margin|margen|markup/],
  ["commission", /commission|comision|payout|incentive/],
  ["revenue", /total|sales|ventas|revenue|ingreso|gross|amount|importe|price|precio|subtotal|ticket/],
  ["count", /count|units|unidades|orders|pedidos|items|articulos|qty|quantity|cantidad|lines|lineas|rows/],
  ["mix", /share|mix|participacion|weight|peso/],
  ["discount", /discount|descuento|rebate/],
];

/** Lo que NO se publica en la versión para compartir, por decisión del dueño. */
const BLOCKED = new Set(["balance", "cost", "profit", "margin", "commission",
  // «Cobrado» se va con el saldo: total − cobrado ES el saldo, así que
  // dejarlo sería publicar por resta justo lo que se pidió quitar.
  "collected"]);
/** Las únicas cifras que sobreviven: lo que se vendió y cuánto. */
const FIGURE_OK = new Set(["revenue", "count", "mix", "discount"]);
/** Conceptos que son dinero (o porcentaje de dinero) aunque la columna no declare `type`. */
const MONEYISH = new Set([...BLOCKED, ...FIGURE_OK]);

/** El concepto de una clave, o "" si no lo sabe (sin acentos y en minúsculas). */
export function conceptOf(key) {
  const k = String(key ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!k) return "";
  for (const [concept, re] of CONCEPT_RULES) if (re.test(k)) return concept;
  return "";
}

/** ¿Es una cifra (lo que puede delatar un costo)? Por `type` o por la propia clave. */
const isFigure = (c, concept) => c.type === "money" || c.type === "pct" || MONEYISH.has(concept);

/** ¿Esta columna puede salir en la versión para compartir? */
export function colForShare(c) {
  if (!c) return false;
  const concept = conceptOf(c.key);
  if (BLOCKED.has(concept)) return false;
  // Cifra: solo si se sabe que es ingreso, recuento, mezcla o descuento.
  // Sin clasificar → fuera (regla de fallar del lado seguro).
  if (isFigure(c, concept)) return FIGURE_OK.has(concept);
  return true;
}

/** Igual para una tarjeta o pastilla: aquí TODO es cifra, así que hace falta saber qué es. */
const markedForShare = (x) => {
  const concept = conceptOf(x?.concept ?? x?.key);
  return Boolean(concept) && FIGURE_OK.has(concept);
};
/** ¿Trae identificador propio (y entonces se puede clasificar)? */
const hasMark = (x) => x && (x.concept != null || x.key != null);

const pickKeys = (obj, keep) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keep.has(k)));

/** La tabla sin las columnas, subtotales ni totales que no se publican. */
function tableForShare(tb) {
  if (!tb) return tb;
  const cols = (tb.cols || []).filter(colForShare);
  const keep = new Set(cols.map((c) => c.key).filter((k) => k != null));
  const out = { ...tb, cols };
  if (tb.totals) out.totals = pickKeys(tb.totals, keep);
  // Ordenar por una columna que no se publica delataría su ranking (quién deja
  // más ganancia), así que ese orden también se cae.
  if (tb.sortBy?.key && BLOCKED.has(conceptOf(tb.sortBy.key))) out.sortBy = undefined;
  if (tb.groupBy) {
    const g = tb.groupBy;
    const subKeys = (g.subtotalKeys || Object.keys(tb.totals || {})).filter((k) => keep.has(k));
    out.groupBy = {
      ...g,
      subtotalKeys: subKeys,
      totalKey: g.totalKey && keep.has(g.totalKey) ? g.totalKey : subKeys[0],
      ...(typeof g.subtotals === "function" ? { subtotals: (rows, key) => pickKeys(g.subtotals(rows, key), keep) } : {}),
    };
  }
  return out;
}

/**
 * El total vendido del período, leído de los TOTALES de la tabla principal —
 * el mismo número que se imprime al pie, así la tarjeta y la tabla no pueden
 * discrepar. Se prefiere la clave exacta conocida y se descartan los
 * promedios (un ticket medio no es el total del período). Sin un total de
 * ingreso reconocible no se inventa ninguna tarjeta: mejor sin fila que con
 * una cifra adivinada.
 */
function totalSalesKpi(spec) {
  const tr = tr0(spec.t);
  const main = (spec.tables || []).find((tb) => tb.main) || (spec.tables || [])[0];
  const totals = main?.totals;
  if (!totals) return null;
  const keys = Object.keys(totals);
  const isAvg = (k) => /avg|average|ticket|promedio|medio|per_/i.test(k);
  const revenue = ["total", "sales", "revenue", "net_sales", "gross"].find((k) => keys.includes(k) && totals[k] != null)
    || keys.find((k) => conceptOf(k) === "revenue" && !isAvg(k) && totals[k] != null);
  if (!revenue) return null;
  const count = ["count", "sales_count", "orders", "n"].find((k) => keys.includes(k) && Number(totals[k]) > 0);
  return {
    key: "total",
    label: tr("adm.rpt.share.totalSales"),
    value: money(totals[revenue], "usd", spec.lang || "es"),
    raw: totals[revenue],
    sub: count ? tr("adm.rpt.share.salesCount", { n: Number(totals[count]).toLocaleString(locale(spec.lang)) }) : undefined,
  };
}

/**
 * La especificación tal como se imprime para `audience`. Pura: no toca la que
 * recibe. Con "owner" devuelve la misma (el reporte de hoy, intacto).
 *
 * Qué pasa con lo que no trae identificador:
 *   · tarjetas  hoy ninguna pantalla las identifica, así que la fila entera se
 *               cae y en su lugar va el total vendido. Si una especificación
 *               empieza a marcarlas (`key`/`concept`), se filtran una por una
 *               y las que no digan qué son se quedan fuera.
 *   · resúmenes las pastillas de los acordeones se leen de la pantalla
 *               (summariesFromAccordions): son texto traducido sin clave, así
 *               que no hay forma de garantizar que no lleven un costo → fuera.
 *               Con `concept` (o `data-concept` en la pastilla) se publican.
 *   · gráficos  una serie puede ser de ganancia y un SVG no se puede leer:
 *               fuera, salvo que el gráfico se declare (`concept` o `share`).
 */
export function specForAudience(spec, audience = "owner") {
  if (!spec || audience !== "share") return spec;
  const tr = tr0(spec.t);
  const kpis = (spec.kpis || []).filter(Boolean);
  const marked = kpis.filter(hasMark);
  const total = totalSalesKpi(spec);
  return {
    ...spec,
    audience: "share",
    kpis: marked.length ? marked.filter(markedForShare) : (total ? [total] : []),
    summaries: (spec.summaries || [])
      .map((s) => (s ? { ...s, pills: (s.pills || []).filter((p) => hasMark(p) && markedForShare(p)) } : null))
      .filter((s) => s && s.pills.length),
    charts: (spec.charts || []).filter((c) => c && (c.share === true || markedForShare(c))),
    tables: (spec.tables || []).map(tableForShare),
    // Que se lea en el papel cuál de las dos versiones es: un PDF suelto sobre
    // una mesa no tiene quien explique de dónde salió.
    subtitle: [spec.subtitle, tr("adm.rpt.share.subtitle")].filter(Boolean).join(" · "),
    filename: `${fileBase(spec)}-${slug(tr("adm.rpt.share.fileTag"))}`,
  };
}

/* La audiencia elegida en la barra (GlobalFilterBar). Es de módulo porque las
   pantallas registran manejadores que llaman a `exportReport` por su cuenta
   (menuHandlers → report(kind)) y la barra no puede meter un argumento por
   medio sin tocar cada pantalla. `exportReport` la lee al entrar, y como todo
   el documento se construye en la misma pulsación (printHtml recibe el HTML ya
   hecho) no hay ventana para que se cuele otra. */
let AUDIENCE = "owner";
/** Corre `run()` con esa audiencia y la devuelve a su sitio, pase lo que pase. */
export function withReportAudience(audience, run) {
  const prev = AUDIENCE;
  AUDIENCE = REPORT_AUDIENCES.includes(audience) ? audience : "owner";
  try { return run(); } finally { AUDIENCE = prev; }
}

/**
 * Las filas de una tabla listas para pintar o exportar: sin las de valor cero
 * (`dropZero`, contadas en `dropped`), ordenadas (`sortBy`) y, si hay
 * `groupBy`, repartidas en grupos con su subtotal, etiqueta, color y contador.
 * Devuelve { rows, groups: [{ key, label, color, rows, subtotals, count }] | null, dropped }.
 */
export function prepareTable(tb, t) {
  const tr = tr0(t);
  const cols = tb.cols || [];
  let rows = [...(tb.rows || [])];
  let dropped = 0;
  if (tb.dropZero?.key) {
    rows = rows.filter((r) => { const v = valueOf(cols, tb.dropZero.key, r); if (v == null || v === "" || !Number(v)) { dropped += 1; return false; } return true; });
  }
  if (tb.sortBy?.key) rows = sortRows(rows, { key: "_", dir: tb.sortBy.dir }, { _: (r) => valueOf(cols, tb.sortBy.key, r) });
  const g = tb.groupBy;
  if (!g) return { rows, groups: null, dropped };
  const keyOf = typeof g.get === "function" ? g.get : (r) => r?.[g.key];
  const map = new Map();
  for (const k of g.keys || []) map.set(k, []);
  for (const r of rows) { const k = keyOf(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); }
  const subKeys = g.subtotalKeys || Object.keys(tb.totals || {});
  let groups = [...map.entries()].map(([key, list]) => {
    const sums = {};
    for (const k of subKeys) {
      let sum = 0;
      let any = false;
      for (const r of list) { const v = valueOf(cols, k, r); if (v == null || v === "") continue; const n = Number(v); if (Number.isFinite(n)) { sum += n; any = true; } }
      sums[k] = any ? Math.round(sum * 1e6) / 1e6 : null; // sin la cola de coma flotante (55.589999…) en Excel/CSV
    }
    const subtotals = typeof g.subtotals === "function" ? { ...sums, ...g.subtotals(list, key) } : sums;
    const count = typeof g.count === "function" ? g.count(list, key) : list.length;
    return {
      key, rows: list, subtotals, count,
      label: typeof g.label === "function" ? String(g.label(key, list) ?? "") : String(key ?? ""),
      color: typeof g.colorOf === "function" ? g.colorOf(key) || null : null,
      countText: typeof g.countLabel === "function" ? g.countLabel(count) : tr("adm.rpt.groupRows", { n: count }),
    };
  });
  if (g.hideEmptyGroups !== false) groups = groups.filter((x) => x.rows.length);
  const totalKey = g.totalKey || subKeys[0];
  if (g.order === "total-desc" && totalKey) groups.sort((a, b) => (Number(b.subtotals[totalKey]) || 0) - (Number(a.subtotals[totalKey]) || 0));
  else if (g.order !== "given") groups.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
  return { rows, groups, dropped };
}

/** Primera columna con subtotal: la etiqueta ocupa las de delante (colspan). */
const labelSpan = (cols, values) => { const i = cols.findIndex((c, j) => j > 0 && c.key != null && values[c.key] != null); return i > 0 ? i : 1; };

function tableHtml(tb, lang, t) {
  const tr = tr0(t);
  const { rows, groups, dropped } = prepareTable(tb, t);
  // Con bloques por grupo, la columna que repite el grupo (`groupHide`, p. ej. «Tienda») sobra en el papel; Excel y CSV la conservan.
  const cols = shownCols(tb.cols).filter((c) => !(groups && c.groupHide));
  const widths = colWidths(cols);
  const align = (c) => (c.align === "r" || (!c.align && (c.type === "money" || c.type === "int" || c.type === "pct")) ? "r" : c.align === "c" ? "c" : "");
  const num = (c) => (c.type === "money" || c.type === "int" || c.type === "pct" ? "num" : "");
  const head = cols.map((c, i) => `<th class="${align(c)}" style="width:${widths[i]}%">${h(c.header)}</th>`).join("");
  let alt = 0;
  const rowHtml = (r) => {
    const rowCls = [typeof tb.rowCls === "function" ? tb.rowCls(r) || "" : "", alt++ % 2 ? "alt" : ""].filter(Boolean).join(" ");
    const cells = cols.map((c) => {
      const text = cellText(c, r, lang);
      const cls = [align(c), num(c), typeof c.cls === "function" ? c.cls(r) || "" : ""].filter(Boolean).join(" ");
      const inner = c.tag && text ? `<span class="rp-tag ${typeof c.cls === "function" ? c.cls(r) || "" : ""}">${h(text)}</span>` : h(text);
      return `<td class="${cls}" title="${h(text)}">${inner}</td>`;
    }).join("");
    return `<tr class="${rowCls}">${cells}</tr>`;
  };
  const sumCells = (values, label, cls) => {
    const span = labelSpan(cols, values);
    const first = `<td colspan="${span}">${h(label)}</td>`;
    const rest = cols.slice(span).map((c) => {
      const v = c.key != null ? values[c.key] : undefined;
      const text = v == null ? "" : typeof c.totalText === "function" ? c.totalText(v) : fmtByType(v, c.type, lang);
      return `<td class="${align(c)} ${num(c)}">${h(text)}</td>`;
    }).join("");
    return `<tr class="${cls}">${first}${rest}</tr>`;
  };
  const groupHtml = (g) => {
    alt = 0;
    const band = `<tr class="rp-group"><td colspan="${cols.length}"><span class="rp-group-band" style="${g.color ? `--rp-group:${h(g.color)}` : ""}"><i class="rp-group-dot"></i><b>${h(g.label)}</b><small>${h(g.countText)}</small></span></td></tr>`;
    return band + g.rows.map(rowHtml).join("") + sumCells(g.subtotals, tr("adm.rpt.subtotal", { group: g.label }), "rp-subtotal");
  };
  const body = groups ? groups.map(groupHtml).join("") : rows.map(rowHtml).join("");
  let foot = "";
  if (tb.totals) {
    const cells = cols.map((c, i) => {
      const v = c.key != null ? tb.totals[c.key] : undefined;
      if (i === 0 && v == null) return `<td>${h(tb.totalsLabel || "Total")}</td>`;
      const text = v == null ? "" : typeof c.totalText === "function" ? c.totalText(v) : fmtByType(v, c.type, lang);
      return `<td class="${align(c)} ${c.type ? "num" : ""}">${h(text)}</td>`;
    }).join("");
    foot = `<tfoot><tr>${cells}</tr></tfoot>`;
  }
  const note = tb.note ? `<small>${h(tb.note)}</small>` : "";
  const footnote = dropped ? `<div class="rp-footnote">${h(tr("adm.rpt.dropZero", { n: dropped }))}</div>` : "";
  const content = rows.length ? `<table class="rp-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>${footnote}` : `<div class="rp-empty">${h(tb.empty || "—")}</div>${footnote}`;
  return `<section class="rp-section">${tb.title ? `<h2 class="rp-section-title">${h(tb.title)}${note}</h2>` : ""}${content}</section>`;
}

/** El HTML del reporte (sin <html>/<head>: lo envuelve printHtml). */
export function reportHtml(spec) {
  const { t, lang = "es" } = spec;
  const tr = (k, p) => (typeof t === "function" ? t(k, p) : k);
  const tenant = spec.tenant || TENANT.name;
  const store = spec.store || null;
  const accent = store?.color || spec.color || NEUTRAL;
  const ink = inkOn(accent);
  const generated = whenText(spec.generatedAt, lang);
  const kpis = visibleKpis(spec.kpis);
  const summaries = visibleSummaries(spec.summaries);
  const charts = (spec.charts || []).map(chartOf).filter(Boolean);
  const tables = spec.tables || [];
  const storeLine = store
    ? `<span class="rp-head-store">${store.code ? `<span class="rp-code">${h(store.code)}</span>` : ""}<b>${h(store.name || "")}</b></span>`
    : `<b>${h(spec.scope || tr("adm.rpt.allStores"))}</b>`;
  const side = [
    `<span><small>${h(tr("adm.rpt.store"))}</small>${storeLine}</span>`,
    spec.period ? `<span><small>${h(tr("adm.rpt.period"))}</small><b>${h(dayText(spec.period.from, lang))} – ${h(dayText(spec.period.to, lang))}</b></span>` : `<span><small>${h(tr("adm.rpt.generated"))}</small><b>${h(generated)}</b></span>`,
    store?.address || store?.phone ? `<span class="rp-head-addr">${h([store.address, store.phone ? `${tr("adm.rpt.phone")} ${store.phone}` : ""].filter(Boolean).join(" · "))}</span>` : "",
  ].join("");
  const head = `<header class="rp-head"><div class="rp-head-main"><div class="rp-tenant">${h(tenant)}</div><h1 class="rp-title">${h(spec.title || "")}</h1>${spec.subtitle ? `<div class="rp-subtitle">${h(spec.subtitle)}</div>` : ""}</div><div class="rp-head-side">${side}</div></header>`;
  const kpiHtml = kpis.length
    ? `<div class="rp-kpis">${kpis.map((k) => `<div class="rp-kpi"><small>${h(k.label)}</small><b class="${k.neg ? "neg" : ""}">${h(k.value)}</b>${k.sub ? `<i class="${h(k.tone || "")}">${h(k.sub)}</i>` : ""}</div>`).join("")}</div>`
    : "";
  const sumHtml = summaries.length
    ? `<div class="rp-summaries ${summaries.length === 1 ? "one" : ""}">${summaries.map((s) => `<div class="rp-summary"><span class="rp-summary-title">${h(s.title)}</span><span class="rp-pills">${s.pills.map((p) => `<span class="rp-pill ${h(p.tone || "")} ${p.strong ? "strong" : ""}">${p.label ? `<small>${h(p.label)}</small>` : ""}<b>${h(p.value)}</b></span>`).join("")}</span></div>`).join("")}</div>`
    : "";
  const chartHtml = charts.length ? `<div class="rp-charts">${charts.map((c) => `<div class="rp-chart ${charts.length === 1 ? "tall" : ""}">${c.title ? `<div class="rp-chart-title">${h(c.title)}</div>` : ""}${c.svg}</div>`).join("")}</div>` : "";
  const tablesHtml = tables.map((tb) => tableHtml(tb, lang, t)).join("");
  const foot = `<div class="rp-foot"><span><i class="rp-foot-dot"></i><b>${h(tenant)}</b> · ${h(spec.title || "")}${spec.period ? ` · ${h(dayText(spec.period.from, lang))} – ${h(dayText(spec.period.to, lang))}` : ""}</span><span>${h(tr("adm.rpt.generatedBy", { name: tenant }))} · ${h(generated)}</span></div>`;
  const style = `--rp-accent:${h(accent)};--rp-accent-ink:${ink}`;
  // `share`: la versión que se socializa, con sus pocos retoques (report-share.css).
  return `<div class="rp-doc ${spec.landscape === false ? "portrait" : ""} ${spec.audience === "share" ? "share" : ""}" style="${style}"><table class="rp-layout"><thead><tr><td></td></tr></thead><tbody><tr><td><div class="rp-body">${head}${kpiHtml}${sumHtml}${chartHtml}${tablesHtml}</div></td></tr></tbody><tfoot><tr><td></td></tr></tfoot></table>${foot}</div>`;
}

/** El reporte como elemento (para previsualizar o montar en pantalla). */
export function buildReport(spec) {
  const wrap = document.createElement("div");
  wrap.innerHTML = reportHtml(spec);
  return wrap.firstElementChild;
}

/** La hoja del reporte, tal como se incrusta en el iframe (las dos versiones). */
export const REPORT_CSS = `${reportCss}\n${reportShareCss}`;

/** "Óptica El Rancho — Reporte de estado · Fry Family Clinic": lo que el navegador escribe en su encabezado y el nombre del PDF. */
export const reportDocTitle = (spec) => `${spec.tenant || TENANT.name} — ${spec.title || ""}`.trim();

const stamp = () => new Date().toISOString().slice(0, 10);
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const fileBase = (spec) => spec.filename || [slug(spec.title), spec.store?.code, spec.period ? `${spec.period.from}_${spec.period.to}` : stamp()].filter(Boolean).join("-");

/** Las filas del bloque general: título, tienda, período, generado, indicadores y resúmenes (Excel «Resumen» y cabecera del CSV). */
export function summaryRows(spec) {
  const { t, lang = "es" } = spec;
  const tr = (k, p) => (typeof t === "function" ? t(k, p) : k);
  const store = spec.store;
  const rows = [
    { k: spec.tenant || TENANT.name, v: spec.title || "" },
    { k: tr("adm.rpt.store"), v: store ? `${store.code ? `${store.code} · ` : ""}${store.name || ""}` : spec.scope || tr("adm.rpt.allStores"), d: store ? [store.address, store.phone].filter(Boolean).join(" · ") : "" },
    ...(spec.period ? [{ k: tr("adm.rpt.period"), v: `${spec.period.from} → ${spec.period.to}` }] : []),
    { k: tr("adm.rpt.generated"), v: whenText(spec.generatedAt, lang) },
    {},
  ];
  for (const k of visibleKpis(spec.kpis)) rows.push({ k: k.label, v: k.raw ?? k.value, d: k.sub || "" });
  const summaries = visibleSummaries(spec.summaries);
  if (summaries.length) rows.push({});
  for (const s of summaries) for (const p of s.pills) rows.push({ k: [s.title, p.label].filter(Boolean).join(" · "), v: p.value });
  // Lo que una tabla dejó fuera por `dropZero` también se dice en el bloque general.
  for (const tb of spec.tables || []) {
    if (!tb.dropZero) continue;
    const { dropped } = prepareTable(tb, t);
    if (dropped) rows.push({ k: tb.title || "", v: tr("adm.rpt.dropZero", { n: dropped }) });
  }
  return rows;
}

/** Celdas de una fila sintética (banda o subtotal de un grupo) por índice de columna. */
const syntheticRow = (cols, label, values) => {
  const span = labelSpan(cols, values || {});
  return { __rp: cols.map((c, i) => (i === 0 ? label : i < span ? "" : c.key != null && values ? values[c.key] ?? "" : "")) };
};

/** Excel: hoja «Resumen» + una hoja por tabla (o por grupo, con `groupBy.groupSheets`). */
export function reportSheets(spec) {
  const { t } = spec;
  const tr = tr0(t);
  const sheets = [{
    name: tr("adm.rpt.summarySheet"),
    cols: [{ header: tr("adm.rpt.concept"), key: "k", width: 40 }, { header: tr("adm.rpt.value"), key: "v", width: 24 }, { header: tr("adm.rpt.detail"), key: "d", width: 36 }],
    rows: summaryRows(spec),
  }];
  for (const tb of spec.tables || []) {
    const name = tb.sheet || tb.title || tr("adm.rpt.detail");
    const { rows, groups } = prepareTable(tb, t);
    const shown = shownCols(tb.cols);
    const cols = shown.map((c, i) => ({ header: c.header, key: c.key, get: (r) => (r && r.__rp ? r.__rp[i] : rawOf(c, r)), type: c.type, width: c.width }));
    if (groups && tb.groupBy.groupSheets) {
      for (const g of groups) sheets.push({ name: g.label || name, cols, rows: g.rows, totals: g.subtotals, totalsLabel: tr("adm.rpt.subtotal", { group: g.label }) });
      continue;
    }
    const flat = groups
      ? groups.flatMap((g) => [syntheticRow(shown, `${g.label} · ${g.countText}`), ...g.rows, syntheticRow(shown, tr("adm.rpt.subtotal", { group: g.label }), g.subtotals)])
      : rows;
    sheets.push({ name, cols, rows: flat, totals: tb.totals, totalsLabel: tb.totalsLabel });
  }
  return sheets;
}

const csvEsc = (x) => (x == null ? "" : /[",\n;]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));

/** CSV: el bloque general arriba y la tabla principal (`main`, o la primera) debajo; con grupos, una línea de cabecera por grupo. */
export function reportCsv(spec) {
  const tr = tr0(spec.t);
  const lines = summaryRows(spec).map((r) => (r.k == null ? "" : [r.k, r.v, r.d].filter((x) => x != null && x !== "").map(csvEsc).join(",")));
  const main = (spec.tables || []).find((tb) => tb.main) || (spec.tables || [])[0];
  const head = "\ufeff" + lines.join("\n");
  if (!main) return head;
  const shown = shownCols(main.cols);
  const cols = shown.map((c) => [c.header, (r) => rawOf(c, r)]);
  const { rows, groups, dropped } = prepareTable(main, spec.t);
  const strip = (csv) => csv.replace(/^\ufeff/, "").split("\n").slice(1).join("\n");
  const headerLine = rowsToCsv(cols, []).replace(/^\ufeff/, "");
  let body;
  if (groups) {
    body = groups.map((g) => [
      csvEsc(`${g.label} · ${g.countText}`),
      strip(rowsToCsv(cols, g.rows)),
      shown.map((c, i) => csvEsc(i === 0 ? tr("adm.rpt.subtotal", { group: g.label }) : c.key != null ? g.subtotals[c.key] ?? "" : "")).join(","),
    ].filter(Boolean).join("\n")).join("\n");
  } else body = strip(rowsToCsv(cols, rows));
  const foot = dropped ? `\n${csvEsc(tr("adm.rpt.dropZero", { n: dropped }))}` : "";
  return `${head}\n\n${headerLine}\n${body}${foot}`;
}

/**
 * Exporta el reporte: "pdf" (impresión aislada), "xlsx" o "csv".
 *
 * `audience` decide QUÉ versión se imprime (ver specForAudience): por defecto,
 * la elegida en la barra de filtros — "owner" mientras nadie elija otra, así
 * que un llamador antiguo sigue sacando el reporte completo de siempre.
 */
export function exportReport(kind, spec, audience = AUDIENCE) {
  if (!spec) return;
  spec = specForAudience(spec, audience);
  const base = fileBase(spec);
  if (kind === "xlsx") return downloadXlsx(`${base}.xlsx`, reportSheets(spec));
  if (kind === "csv") return downloadText(`${base}.csv`, reportCsv(spec));
  return printHtml({ html: reportHtml(spec), css: REPORT_CSS, title: reportDocTitle(spec), lang: spec.lang || "es" });
}
