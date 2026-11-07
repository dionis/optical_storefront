// Pure helpers of «Productos y precios» (PriceMatrix.jsx). No React, no i18n
// hook and no network: what comes out are numbers, booleans or dictionary KEYS,
// so the xlsx test script (scripts/test-xlsx.mjs) can import this file in Node.
// Shape of the data: docs/PRICE-MATRIX.md → GET /admin/pricing/matrix.

/** The sections of the matrix, in the order of the sub-tabs. */
export const MATRIX_SECTIONS = ["frames", "cases", "lenses", "treatments"];

/** Row kind the cell endpoint expects for a matrix row (`row.kind` wins when present). */
export const rowKind = (row, section) => row?.kind || ({ frames: "frame", cases: "case", lenses: "lens" }[section] ?? "ar");

/** Discount bounds the server enforces (`discount_range`). */
export const DISCOUNT_MAX = 90;

/**
 * Text typed in a cell → number, `null` (empty = clear) or `undefined`
 * (not a number). Accepts "54", "54.5", "$54.50", "1,234.50", "10%", "54,5".
 */
export function parseInput(raw) {
  const s = String(raw ?? "").trim().replace(/[$%\s]/g, "");
  if (s === "") return null;
  // "1,234.50" → thousands comma; "54,5" (only a comma) → decimal comma.
  const norm = s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  if (!/^-?\d*\.?\d+$/.test(norm)) return undefined;
  const n = Number(norm);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Client check that mirrors the server's reasons for one cell, so an obvious
 * mistake never makes the round-trip. Returns a reason code or null.
 */
export function cellProblem(field, value) {
  if (value === undefined) return "bad_value";
  if (value === null) return null;
  if (value < 0) return field === "discount" ? "discount_range" : "bad_value";
  if (field === "discount" && value > DISCOUNT_MAX) return "discount_range";
  return null;
}

/** Cents → dollars (null stays null). */
export const usd = (cents) => (cents == null ? null : Math.round(Number(cents)) / 100);

/** Plain text for an input: "54.00", "" when empty. Discounts drop trailing zeros. */
export function inputText(field, value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (field === "discount") return String(Math.round(n * 100) / 100);
  return n.toFixed(2);
}

/** Margin on the selling price, in %, one decimal. null when it cannot be known. */
export function marginOf(priceCents, costCents) {
  const p = Number(priceCents);
  const c = Number(costCents);
  if (!(p > 0) || !(c > 0)) return null;
  return Math.round(((p - c) / p) * 1000) / 10;
}

/** The price a customer pays in a store after the item discount. */
export const finalCents = (cell) => {
  if (!cell) return null;
  if (cell.final_cents != null) return Number(cell.final_cents);
  if (cell.price_cents == null) return null;
  const pct = Number(cell.discount_pct) || 0;
  return Math.round(Number(cell.price_cents) * (1 - pct / 100));
};

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * Accordion header numbers: models, average cost, average margin (over every
 * store cell with a price, on the final price) and, per store, its average
 * margin and whether the brand is visible there (any model exposed).
 */
export function groupStats(group, storeIds) {
  const rows = group.rows || [];
  const costs = rows.map((r) => Number(r.cost_cents)).filter((c) => c > 0);
  const margins = [];
  const perStore = {};
  for (const sid of storeIds) {
    const m = [];
    let exposed = 0;
    for (const r of rows) {
      const cell = r.stores?.[sid];
      if (!cell) continue;
      if (cell.exposed !== false) exposed += 1;
      const mg = marginOf(finalCents(cell), r.cost_cents);
      if (mg != null) { m.push(mg); margins.push(mg); }
    }
    perStore[sid] = { margin: avg(m), exposed, visible: exposed > 0 };
  }
  const a = avg(costs);
  const am = avg(margins);
  return {
    count: rows.length,
    avgCostCents: a == null ? null : Math.round(a),
    avgMargin: am == null ? null : Math.round(am * 10) / 10,
    perStore,
  };
}

/** Lower-case, accent-free text for search. */
export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Filters of the toolbar. `filters` = Set of "nocost" | "discount" | "exact".
 * Several filters together narrow (AND). Groups without rows left drop out.
 */
export function filterGroups(groups, { q = "", filters = new Set(), storeIds = [] } = {}) {
  const k = norm(q).trim();
  const words = k ? k.split(/\s+/) : [];
  const cellsOf = (r) => storeIds.map((sid) => r.stores?.[sid]).filter(Boolean);
  const keep = (r, g) => {
    if (words.length) {
      // Both languages: the screen shows the English titles when `en` is chosen.
      const hay = norm(`${r.title} ${r.sku || ""} ${g.label} ${g.label_en || ""} ${r.label_en || ""} ${r.material_label_en || ""} ${r.key}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    // An unpriced digital cell (`available: false`) is not a missing cost: it is not sold yet.
    if (filters.has("nocost") && (Number(r.cost_cents) > 0 || r.available === false)) return false;
    if (filters.has("discount") && !cellsOf(r).some((c) => Number(c.discount_pct) > 0)) return false;
    if (filters.has("exact") && !cellsOf(r).some((c) => c.exact || c.source === "store_exact")) return false;
    return true;
  };
  return groups
    .map((g) => ({ ...g, rows: (g.rows || []).filter((r) => keep(r, g)) }))
    .filter((g) => g.rows.length > 0 || (!words.length && filters.size === 0));
}

/** Dictionary key for a price cell's `source` (tooltip of the price cell). */
export const sourceKey = (source) => {
  const s = String(source || "");
  if (s === "store_exact") return "adm.pm.src.exact";
  if (s === "rule") return "adm.pm.src.rule";
  if (s === "band") return "adm.pm.src.band";
  return "adm.pm.src.master";
};

/** Replace one row (same key) inside the groups, keeping everything else by reference. */
export function replaceRow(groups, row) {
  if (!row) return groups;
  // The server's row is the whole row (same shape as the GET): replace, never
  // merge — a merge kept flags the new row no longer has (an unpriced digital
  // cell stayed `available: false`, cost locked, after its first price).
  return groups.map((g) => (g.rows.some((r) => r.key === row.key) ? { ...g, rows: g.rows.map((r) => (r.key === row.key ? { ...row } : r)) } : g));
}

/**
 * After a photochromic cost write: every row of the same option (`code:<cat>`)
 * shows the cost the server returned for the written one. Pure.
 */
export function patchSiblingCost(groups, row) {
  const code = String(row?.code || String(row?.key || "").split(":")[0] || "");
  if (!code) return groups;
  const same = (r) => r.key !== row.key && r.kind === "photo" && (r.code === code || String(r.key).split(":")[0] === code);
  return groups.map((g) => (!g.rows.some(same) ? g : {
    ...g,
    rows: g.rows.map((r) => (same(r) ? { ...r, cost_cents: row.cost_cents ?? null, cost_source: row.cost_source ?? null } : r)),
  }));
}

/** Patch one store cell of one row (optimistic writes and exposure toggles). */
export function patchCell(groups, rowKey, storeId, patch) {
  return groups.map((g) => (!g.rows.some((r) => r.key === rowKey) ? g : {
    ...g,
    rows: g.rows.map((r) => (r.key !== rowKey ? r : storeId == null ? { ...r, ...patch } : { ...r, stores: { ...r.stores, [storeId]: { ...(r.stores?.[storeId] || {}), ...patch } } })),
  }));
}

/** A slug like the server's for a new brand («Di Caprio» → «di-caprio»). */
export const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ───────── Add dialogs: the server reasons, checked before sending ───────── */

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;
const URL_RE = /^https?:\/\/\S+$/i;
/** Plausible millimetres; the server has the last word (`bad_measure`). */
export const MEASURES = { eye_size: [30, 75], bridge_size: [8, 30], temple_length: [100, 165] };

/**
 * Frame / case form → { errors: { field: reason }, body } with the body of
 * POST /admin/catalog/frames. `takenSkus` = SKUs already loaded (sku_taken
 * caught before the request; the server checks the whole catalog).
 */
export function validateFrameForm(form, { takenSkus = new Set(), stores = [] } = {}) {
  const errors = {};
  const brand = String(form.brand || "").trim();
  // A case may have no brand: the server files it under «Cases (estuches)» (slug `case`).
  const isCase = form.kind === "case";
  if (!brand && !isCase) errors.brand = "bad_brand";
  const sku = String(form.sku || "").trim();
  if (!SKU_RE.test(sku)) errors.sku = "bad_sku";
  else if (takenSkus.has(sku.toUpperCase().replace(/[^A-Z0-9]+/g, ""))) errors.sku = "sku_taken";
  const colors = (form.colors || []).map((c) => ({ name: String(c.name || "").trim(), image: String(c.image || "").trim() })).filter((c) => c.name || c.image);
  if (!colors.length || colors.some((c) => !c.name || (c.image && !URL_RE.test(c.image)))) errors.colors = "bad_colors";
  const measures = {};
  for (const [k, [lo, hi]] of Object.entries(MEASURES)) {
    const v = parseInput(form[k]);
    if (v === null) continue;
    if (v === undefined || v < lo || v > hi) errors[k] = "bad_measure";
    else measures[k] = v;
  }
  const cost = parseInput(form.cost);
  if (cost === undefined || (cost != null && cost < 0)) errors.cost = "bad_value";
  const prices = {};
  for (const s of stores) {
    const p = form.prices?.[s.id] || {};
    const price = parseInput(p.price);
    const discount = parseInput(p.discount);
    if (price === undefined || (price != null && price < 0)) errors[`price:${s.id}`] = "bad_value";
    if (discount === undefined || (discount != null && (discount < 0 || discount > DISCOUNT_MAX))) errors[`discount:${s.id}`] = "discount_range";
    if (price != null || (discount != null && discount > 0)) prices[s.id] = { price: price ?? null, discount: discount ?? 0 };
  }
  const body = {
    kind: form.kind === "case" ? "case" : "frame",
    brand,
    brand_slug: form.brandSlug || (brand ? slugify(brand) : ""),
    sku,
    model: String(form.model || "").trim() || sku,
    colors,
    ...measures,
    ...(cost != null ? { cost } : {}),
    ...(Object.keys(prices).length ? { prices } : {}),
  };
  return { errors, body };
}

/** Treatment form → { errors, body } for POST /admin/pricing/treatments. */
export function validateTreatmentForm(form) {
  const errors = {};
  const type = form.type === "ar" ? "ar" : form.type === "photo" ? "photo" : null;
  if (!type) errors.type = "bad_type";
  const es = String(form.label_es || "").trim();
  const en = String(form.label_en || "").trim();
  if (!es) errors.label_es = "bad_label";
  if (!en) errors.label_en = "bad_label";
  const cost = parseInput(form.cost);
  if (cost === undefined || (cost != null && cost < 0)) errors.cost = "bad_value";
  let prices;
  if (type === "photo") {
    prices = {};
    for (const c of ["sv", "bifocal", "prog"]) {
      const v = parseInput(form.prices?.[c]);
      if (v === undefined || (v != null && v < 0)) errors[`price:${c}`] = "bad_value";
      else if (v != null) prices[c] = v;
    }
    if (!Object.keys(prices).length && !Object.keys(errors).some((k) => k.startsWith("price:"))) errors.prices = "bad_value";
  } else {
    const v = parseInput(form.price);
    if (v == null || v < 0) errors.price = "bad_value";
    prices = v;
  }
  const body = {
    type,
    label_es: es,
    label_en: en,
    ...(cost != null ? { cost } : {}),
    ...(type === "ar" ? { ar_group: ["all", "sv", "bifprog"].includes(form.ar_group) ? form.ar_group : "all" } : {}),
    prices,
  };
  return { errors, body };
}

/**
 * A row's title in the chosen language. The server titles lens cells and
 * treatments in Spanish («CR-39 (Resina) · stock», «Fotocromático Grey · sv»)
 * and sends the pieces (material labels, finish, label_es/label_en, category)
 * so the screen can rebuild them; frames and cases keep their model name.
 */
export function rowTitle(r, t, lang) {
  const en = lang === "en";
  if (r?.kind === "lens" && (r.material_label_es || r.material_label_en) && r.finish) {
    const mat = en ? r.material_label_en || r.material_label_es : r.material_label_es || r.material_label_en;
    return `${mat} · ${t(`adm.price.lens.finish.${r.finish}`)}`;
  }
  if ((r?.kind === "photo" || r?.kind === "ar") && (r.label_es || r.label_en)) {
    const name = en ? r.label_en || r.label_es : r.label_es || r.label_en;
    return r.kind === "photo" && r.category ? `${name} · ${t(`adm.price.lenses.cat.${r.category}`)}` : name;
  }
  return r?.title ?? "";
}

/** A group's label in the chosen language (lens designs, the two treatment families, the brandless cases). */
export function groupLabel(g, t, lang) {
  if (g?.kind === "design") return lang === "en" ? g.label_en || g.label : g.label;
  if (g?.kind === "treatment" && (g.key === "photo" || g.key === "ar")) return t(`adm.pm.grp.${g.key}`);
  if (g?.kind === "brand" && g.key === "case" && !g.stores) return t("adm.pm.grp.cases");
  return g?.label ?? "";
}
