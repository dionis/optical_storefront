// Modelo PURO del «Informe contable por categorías» (FinanceReport.jsx; dueño,
// 17-nov-2026: «debe salir algún reporte con filtro para ver toda la
// contabilidad y las finanzas por categorías de costo y se debe poder exportar
// a PDF»). Sin React ni idioma: recibe el documento de
// GET /admin/finance/category-report y devuelve las filas que pintan la
// pantalla, el PDF, el Excel y el CSV (las mismas para los cuatro).
//
// Cada categoría es una línea del estado de resultados (sale de `statements`,
// que cuadra al centavo con el Resultado por tienda) y su detalle son las
// piezas que el servidor ya sumó en esa línea: conceptos del costo de lo
// vendido, partidas de costo, vendedores. Probado por
// scripts/test-category-report.mjs.

export const SECTIONS = ["revenue", "cogs", "opex"];
export const OPEX_TAX = ["rent", "utilities", "payroll", "payroll_taxes", "insurance", "advertising", "software", "professional_fees", "bank_fees", "repairs", "supplies", "taxes_licenses", "depreciation", "other"];

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Las categorías, en el orden del estado de resultados. `get(s)` lee la línea
 * del estado (dólares); `label` es la clave del diccionario; `details(doc)`
 * las piezas (con `total`, `by_period`, `by_entity`), o null si no tiene.
 */
export function categoriesOf() {
  const cogsLine = (line) => (doc) => (doc.cogs_detail || []).filter((c) => c.line === line).map((c) => ({ id: `c:${c.key}`, kind: "concept", label: c.label, sub: null, amounts: c }));
  const items = (tax) => (doc) => (doc.items || []).filter((i) => i.tax_category === tax).map((i) => ({ id: `i:${i.id}`, kind: "item", label: i.description, sub: null, item: i, amounts: i }));
  return [
    { id: "revenue.pos", section: "revenue", label: "adm.fin.st.l.revenue.pos", get: (s) => s.revenue.pos, details: null },
    { id: "revenue.web", section: "revenue", label: "adm.fin.st.l.revenue.web", get: (s) => s.revenue.web, details: null },
    { id: "revenue.shipping", section: "revenue", label: "adm.fin.st.l.revenue.shipping", get: (s) => s.revenue.shipping ?? 0, details: null },
    { id: "cogs.frames", section: "cogs", label: "adm.fin.st.l.cogs.frames", get: (s) => s.cogs.frames, details: cogsLine("frames") },
    { id: "cogs.lenses", section: "cogs", label: "adm.fin.st.l.cogs.lenses", get: (s) => s.cogs.lenses, details: cogsLine("lenses") },
    { id: "cogs.treatments", section: "cogs", label: "adm.fin.st.l.cogs.treatments", get: (s) => s.cogs.treatments, details: cogsLine("treatments") },
    { id: "cogs.per_order", section: "cogs", label: "adm.fin.st.l.cogs.per_order", get: (s) => s.cogs.per_order, details: cogsLine("per_order") },
    { id: "cogs.items", section: "cogs", label: "adm.fin.st.l.cogs.items", get: (s) => s.cogs.items, details: items("cost_of_goods") },
    ...OPEX_TAX.map((c) => ({ id: `opex.${c}`, section: "opex", label: `adm.fin.tax.${c}`, get: (s) => s.opex[c] ?? 0, details: items(c) })),
    { id: "opex.card_fees", section: "opex", label: "adm.fin.st.l.opex.card_fees", get: (s) => s.opex.card_fees, details: null },
    {
      id: "opex.commissions", section: "opex", label: "adm.fin.st.l.opex.commissions", get: (s) => s.opex.commissions,
      details: (doc) => (doc.sellers || []).map((x) => ({ id: `s:${x.key}`, kind: "seller", label: x.name || x.seller_code, sub: null, seller: x, amounts: { ...x, by_entity: null } })),
    },
  ];
}

/** Lo que cada sección suma en el estado (para comprobar que la selección completa cuadra). */
export const SECTION_TOTAL = { revenue: (s) => s.revenue.total, cogs: (s) => s.cogs.total_all, opex: (s) => s.opex.total };

/**
 * Las columnas: por período (cada mes/trimestre/año del consolidado de la
 * vista + Total) o por tienda (cada tienda del período entero + Total).
 * `amountOf(a)` lee una pieza del detalle en esa columna (null = no se sabe
 * por tienda, p. ej. la comisión de un vendedor).
 */
export function columnsOf(doc, layout) {
  if (!doc) return [];
  const all = { key: "all", kind: "total", period: "all", entity: "total", s: doc.statements.all.total, amountOf: (a) => a.total };
  if (layout === "stores") {
    const ents = doc.entities.filter((e) => e.kind !== "total");
    return [
      ...ents.map((e) => ({ key: e.id, kind: "entity", period: "all", entity: e.id, ent: e, s: doc.statements.all[e.id], amountOf: (a) => (a.by_entity ? a.by_entity[e.id] ?? 0 : null) })),
      ...(ents.length > 1 ? [all] : []),
    ];
  }
  return [
    ...doc.periods.map((p) => ({ key: p, kind: "period", period: p, entity: "total", s: doc.statements[p].total, amountOf: (a) => a.by_period?.[p] ?? 0 })),
    ...(doc.periods.length > 1 ? [all] : []),
  ];
}

const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Las filas, en orden: sección · categoría · (piezas si está abierta) ·
 * subtotal de la sección · resultados. Pura.
 *
 *  - `selected`: Set de ids de categoría, o null = todas.
 *  - `open(id)`: si la categoría enseña sus piezas.
 *  - `showZero`: también las categorías y piezas en cero.
 *  - `q`: texto; deja las categorías cuyo nombre o alguna pieza lo contiene
 *     (y de las piezas, solo las que lo contienen, salvo que coincida la categoría).
 *  - `labelOf(cat)`, `detailText(d)`: el texto (lo pone quien traduce);
 *    `matchText(d)`: lo que la búsqueda mira de una pieza (nombre, tienda, proveedor…).
 *
 * Cada fila: { type, id, label, sub?, values: { [colKey]: number|null }, pct?, cat?, count? }.
 * `pct` = % de los ingresos totales (columna Total) en categorías, piezas y subtotales.
 */
export function rowsOf(doc, cols, { selected = null, open = () => false, showZero = false, q = "", labelOf = (c) => c.label, detailText = (d) => d.label || "", matchText = detailText } = {}) {
  if (!doc || !cols.length) return [];
  const cats = categoriesOf();
  const isOn = (c) => !selected || selected.has(c.id);
  const totalCol = cols[cols.length - 1];
  const revenue = Number(doc.statements.all.total.revenue.total) || 0;
  const pctOf = (v) => (revenue > 0 && v != null ? Math.round((v / revenue) * 1000) / 10 : null);
  const query = norm(q);
  const rows = [];
  const sums = {};
  for (const section of SECTIONS) {
    const inSection = cats.filter((c) => c.section === section && isOn(c));
    const block = [];
    const secSum = Object.fromEntries(cols.map((c) => [c.key, 0]));
    for (const cat of inSection) {
      const values = Object.fromEntries(cols.map((c) => [c.key, r2(cat.get(c.s))]));
      const zero = cols.every((c) => !values[c.key]);
      let details = cat.details ? cat.details(doc) : [];
      if (!showZero) details = details.filter((d) => Number(d.amounts.total));
      const catMatch = !query || norm(labelOf(cat)).includes(query);
      const hits = query && !catMatch ? details.filter((d) => norm(matchText(d)).includes(query)) : details;
      if (query && !catMatch && !hits.length) continue;
      if (zero && !showZero && !query) continue;
      for (const c of cols) secSum[c.key] += values[c.key];
      block.push({ type: "cat", id: cat.id, section, cat, label: labelOf(cat), values, pct: pctOf(values[totalCol.key]), count: details.length, expandable: details.length > 0 });
      if (details.length && (open(cat.id) || (query && !catMatch))) {
        for (const d of hits) {
          const dv = Object.fromEntries(cols.map((c) => { const v = c.amountOf(d.amounts); return [c.key, v == null ? null : r2(v)]; }));
          block.push({ type: "det", id: `${cat.id}|${d.id}`, section, cat, detail: d, label: detailText(d), values: dv, pct: pctOf(dv[totalCol.key]) });
        }
      }
    }
    if (!block.length) continue;
    const values = Object.fromEntries(cols.map((c) => [c.key, r2(secSum[c.key])]));
    sums[section] = values;
    rows.push({ type: "sec", id: `h.${section}`, section, label: section, values: {} });
    rows.push(...block);
    rows.push({ type: "sum", id: `t.${section}`, section, label: section, values, pct: pctOf(values[totalCol.key]), complete: cats.filter((c) => c.section === section).every(isOn) });
  }
  // Con todas las categorías (y sin buscar), el resultado del estado; si no, el total de lo elegido.
  const complete = !selected && !query;
  if (complete) {
    const line = (id, get, pct) => ({ type: "res", id, label: id, values: Object.fromEntries(cols.map((c) => [c.key, r2(get(c.s))])), pct: pct ? pctOf(r2(get(totalCol.s))) : null });
    rows.push(line("gross_profit", (s) => s.gross_profit, true));
    rows.push(line("net_income", (s) => s.net_income, true));
    rows.push({ type: "res", id: "net_margin", label: "net_margin", values: Object.fromEntries(cols.map((c) => [c.key, c.s.pct.net_margin])), isPct: true });
  } else {
    const costs = Object.fromEntries(cols.map((c) => [c.key, r2((sums.cogs?.[c.key] || 0) + (sums.opex?.[c.key] || 0))]));
    if (sums.cogs || sums.opex) rows.push({ type: "res", id: "selected_costs", label: "selected_costs", values: costs, pct: pctOf(costs[totalCol.key]) });
  }
  return rows;
}

/** Reparto de los costos elegidos (costo de lo vendido + gastos) del período entero, de mayor a menor. */
export function costShares(doc, selected = null) {
  if (!doc) return [];
  const s = doc.statements.all.total;
  const list = categoriesOf()
    .filter((c) => c.section !== "revenue" && (!selected || selected.has(c.id)))
    .map((c) => ({ id: c.id, label: c.label, amount: r2(c.get(s)) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const total = list.reduce((a, x) => a + x.amount, 0);
  return list.map((x) => ({ ...x, share: total > 0 ? Math.round((x.amount / total) * 1000) / 10 : 0 }));
}
