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

/* ───────── Switched off / hidden (frames and cases) ───────── */

/** A brand switched off for the whole chain (general switch = catalog_brand.active false). */
export const brandOff = (g) => g?.active === false || g?.registry?.active === false;

/** A discontinued model (draft): it is sold nowhere. */
const isDraft = (r) => Boolean(r?.status) && r.status !== "published";

/**
 * A model sold in NONE of the shown stores: discontinued, its brand off for
 * the chain, or hidden in every store column. These go to the end of their
 * group, under a separator. Lens/treatment rows carry no `exposed`: never off.
 */
export function rowOff(r, g, storeIds) {
  if (isDraft(r) || brandOff(g)) return true;
  return storeIds.length > 0 && storeIds.every((sid) => r.stores?.[sid]?.exposed === false);
}

/** A model hidden in AT LEAST one shown store (or off everywhere): the «off» filter. */
export function rowHiddenSome(r, g, storeIds) {
  if (isDraft(r) || brandOff(g)) return true;
  return storeIds.some((sid) => r.stores?.[sid]?.exposed === false);
}

/**
 * A brand group sold in none of the shown stores: off for the chain, every
 * model off, or (no model yet) its brand rule off in every store.
 */
export function groupOff(g, storeIds) {
  if (brandOff(g)) return true;
  const rows = g?.rows || [];
  if (rows.length) return rows.every((r) => rowOff(r, g, storeIds));
  return g?.kind === "brand" && storeIds.length > 0 && storeIds.every((sid) => g.stores?.[sid]?.brand_rule === false);
}

/**
 * Off things last: the groups sold nowhere after the rest (`off: true`), and
 * inside each group the models sold nowhere after the rest; `offAt` is the
 * index of the first such model (= rows.length when none), where the screen
 * draws the separator. Stable: the server's order is kept on each side. Pure.
 */
export function orderOff(groups, storeIds) {
  const on = [];
  const off = [];
  for (const g of groups) {
    const rows = g.rows || [];
    const live = rows.filter((r) => !rowOff(r, g, storeIds));
    const dead = rows.filter((r) => rowOff(r, g, storeIds));
    const next = { ...g, rows: [...live, ...dead], offAt: live.length, off: groupOff(g, storeIds) };
    (next.off ? off : on).push(next);
  }
  return { on, off };
}

/**
 * Filters of the toolbar. `filters` = Set of "nocost" | "discount" | "exact" | "off".
 * Several filters together narrow (AND). Groups without rows left drop out
 * (with «off», a brand with no model stays when the brand itself is off).
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
    if (filters.has("off") && !rowHiddenSome(r, g, storeIds)) return false;
    return true;
  };
  const emptyOk = (g) => {
    if ((g.rows || []).length) return false; // it had models: none matched
    if (filters.has("off")) {
      if (filters.size > 1) return false;
      if (words.length && !words.every((w) => norm(`${g.label} ${g.label_en || ""} ${g.key}`).includes(w))) return false;
      return groupOff(g, storeIds);
    }
    return !words.length && filters.size === 0;
  };
  return groups
    .map((g) => ({ ...g, rows: (g.rows || []).filter((r) => keep(r, g)), _empty: emptyOk(g) }))
    .filter((g) => g.rows.length > 0 || g._empty)
    .map(({ _empty, ...g }) => g);
}

/**
 * Where a store price comes from, as one of five tones (v2 precedence: exact
 * price of the model > brand price > store rule > band > master).
 */
export const sourceTone = (source) => {
  const s = String(source || "");
  if (s === "store_exact" || s === "exact") return "exact";
  if (s === "brand") return "brand";
  if (s === "rule" || s === "adjusted") return "rule";
  if (s === "band") return "band";
  return "master";
};
/** Dictionary key for a price cell's `source` (tooltip of the price cell). */
export const sourceKey = (source) => `adm.pm.src.${sourceTone(source)}`;

/**
 * Where a cost comes from, as a pill tone, or null (no pill): the Capri 2026
 * list, the previous list (`supplier_list_prev`, v2), an owner edit, the lab.
 */
export const costTone = (source) => {
  const s = String(source || "");
  if (s === "supplier_list") return "c2026";
  if (s === "supplier_list_prev") return "prev";
  if (s === "owner_edit" || s === "owner" || s === "manual") return "own";
  if (s === "lab") return "lab";
  return null;
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

/* ───────── Brands (v2: catalog_brand registry + brand price/discount) ───────── */

/** A brand group of frames/cases: the only groups with a brand price header. */
export const isBrandGroup = (g, section) => (section === "frames" || section === "cases") && g?.kind === "brand" && Boolean(g.stores || g.registry);

/** The scope a brand price is written with: the section's (frames → frame, cases → case). */
export const brandScope = (section) => (section === "cases" ? "case" : "frame");

/** Brand price / discount of a brand group in one store (GET: `group.stores[est]`). */
export function brandCell(group, storeId) {
  const c = group?.stores?.[storeId] || {};
  const pct = Number(c.brand_discount_pct);
  return {
    priceCents: c.brand_price_cents == null ? null : Number(c.brand_price_cents),
    pct: pct > 0 ? pct : null,
  };
}

/**
 * The matrix groups plus the registry brands that have no model yet (a brand
 * just created must show up, with its «add the first model» row). Inactive
 * ones too (listed with the switched-off brands); a group gets its registry entry attached
 * (`registry`: logo, kind, active, source) so the header can draw the logo.
 */
export function withRegistry(groups, brands, section) {
  if (section !== "frames" && section !== "cases") return groups;
  const kind = brandScope(section);
  const bySlug = new Map((brands || []).map((b) => [b.slug, b]));
  const seen = new Set();
  const out = groups.map((g) => {
    if (g.kind !== "brand") return g;
    seen.add(g.key);
    const b = bySlug.get(g.key);
    return b ? { ...g, registry: b, logo_url: g.logo_url ?? b.logo_url ?? null } : g;
  });
  for (const b of brands || []) {
    // An inactive brand with no model shows too: at the end, among the switched off.
    if (seen.has(b.slug)) continue;
    if ((b.kind || "frame") !== kind) continue;
    if (Number(b.models) > 0) continue; // it has models: they are in some other section
    out.push({ key: b.slug, label: b.name, kind: "brand", rows: [], stores: {}, registry: b, logo_url: b.logo_url ?? null, empty: true });
  }
  return out;
}

/** Up to two initials for the monogram chip of a brand without a logo. */
export function monogram(name) {
  const words = String(name || "").replace(/[^\p{L}\p{N} ]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
/** Stable tone (0..5) for a monogram, from the slug. */
export function monogramTone(slug) {
  let h = 0;
  for (const c of String(slug || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}

/** Replace one group (same key) keeping its rows when the server sent none. */
export function replaceGroup(groups, group) {
  if (!group?.key) return groups;
  return groups.map((g) => (g.key === group.key ? { ...g, ...group, rows: Array.isArray(group.rows) ? group.rows : g.rows } : g));
}

/** Drop one row (a deleted model) from the groups. */
export const removeRow = (groups, rowKey) => groups.map((g) => (g.rows.some((r) => r.key === rowKey) ? { ...g, rows: g.rows.filter((r) => r.key !== rowKey) } : g));

/* ───────── The online store's product sheet (PDP) attributes ─────────
   Stored the way the scraper stores them (apps/scraper/scraper/medusa_push.py):
   English slugs in `metadata`. Shown with the storefront's canonical Spanish
   value through `tv()` (src/i18n/translations.js VAL), the same words the PDP
   and the catalogue filters use (src/data/medusaCatalog.js, frameSpecLabels.js). */
export const FRAME_ATTRS = {
  shape: { square: "Cuadrado", round: "Redondo", "cat-eye": "Ojo de gato", navigator: "Navegador", rectangle: "Rectángulo", aviator: "Aviador", geometric: "Geométrico", oval: "Oval", "modified-oval": "Óvalo modificado", "modified-round": "Ronda modificada", combo: "Combo", "full-frame": "Marco completo" },
  material: { acetate: "Acetato", plastic: "Plástica", metal: "Metal", "stainless-steel": "Acero inoxidable", memory: "Memoria", titanium: "Titanio", injection: "Inyección", tr90: "TR-90", ultem: "Ultem" },
  style: { "full-frame": "Marco completo", combo: "Combo", "semi-rimless": "Sin montura semi al aire", "3-piece-rimless": "Juego de 3 piezas sin aro", sunglasses: "Gafas de sol" },
  gender: { men: "Hombres", women: "Señoras", unisex: "Unisexo", kids: "Niños" },
  age_group: { adult: "Adulto", kids: "Niños" },
};
/** Features the supplier publishes (stored as their English names, like the scraper). */
export const FRAME_FEATURES = { "Spring Hinge": "Bisagra de resorte", "Unifit Bridge": "Puente Unifit" };

/** A stored attribute value → its slug in FRAME_ATTRS (accepts the slug, the Spanish word or any casing). */
export function attrSlug(field, value) {
  if (value == null || value === "") return "";
  const v = Array.isArray(value) ? value[0] : value;
  const table = FRAME_ATTRS[field] || {};
  const k = String(v).trim().toLowerCase();
  if (table[k]) return k;
  if (k === "full-rim") return field === "style" ? "full-frame" : k;
  const hit = Object.entries(table).find(([, es]) => norm(es) === norm(v));
  return hit ? hit[0] : String(v).trim();
}

/* ───────── Add dialogs: the server reasons, checked before sending ───────── */

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;
// An uploaded file comes back as an absolute URL; a relative "/brands/…" path
// (served by the panel origin) is accepted too.
const URL_RE = /^(https?:\/\/\S+|\/[^\s/]\S*)$/i;
export const isImageUrl = (v) => URL_RE.test(String(v || "").trim());
/** Plausible millimetres; the server has the last word (`bad_measure`). */
export const MEASURES = { eye_size: [30, 75], bridge_size: [8, 30], temple_length: [100, 165] };
/** The other measures of the supplier sheet (A/B/ED/circumference), when known. */
export const EXTRA_MEASURES = { a: [30, 75], b: [15, 65], ed: [30, 85], circ: [90, 230] };
export const DESCRIPTION_MAX = 2000;

/**
 * Frame / case form → { errors: { field: reason }, body } with the body of
 * POST /admin/catalog/frames. `takenSkus` = SKUs already loaded (sku_taken
 * caught before the request; the server checks the whole catalog).
 */
export function validateFrameForm(form, { takenSkus = new Set(), stores = [], initialPrices = null } = {}) {
  const errors = {};
  const brand = String(form.brand || "").trim();
  // A case may have no brand: the server files it under «Cases (estuches)» (slug `case`).
  const isCase = form.kind === "case";
  if (!brand && !isCase) errors.brand = "bad_brand";
  const sku = String(form.sku || "").trim();
  if (!SKU_RE.test(sku)) errors.sku = "bad_sku";
  else if (takenSkus.has(sku.toUpperCase().replace(/[^A-Z0-9]+/g, ""))) errors.sku = "sku_taken";
  const colors = (form.colors || [])
    // The contract names the kept colour's variant `variant_id` (an `id` here
    // made the server plan every kept colour as new — QA v2, 7-nov-2026).
    .map((c) => ({ ...(c.id ? { variant_id: c.id } : {}), name: String(c.name || "").trim(), image: String(c.image || "").trim() }))
    .filter((c) => c.variant_id || c.name || c.image);
  if (!colors.length || colors.some((c) => !c.name || (c.image && !URL_RE.test(c.image)))) errors.colors = "bad_colors";
  const images = (form.images || []).map((u) => String(u || "").trim()).filter(Boolean);
  if (images.some((u) => !URL_RE.test(u))) errors.images = "bad_image";
  const measures = {};
  for (const [k, [lo, hi]] of Object.entries({ ...MEASURES, ...EXTRA_MEASURES })) {
    const v = parseInput(form[k]);
    if (v === null) { if (form.editing && form.had?.[k]) measures[k] = null; continue; }
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
    if (initialPrices) {
      // Editing: only the stores whose figures changed travel (no audit noise).
      const was = initialPrices[s.id] || {};
      const samePrice = (price ?? null) === (was.price ?? null);
      const sameDisc = (discount || 0) === (was.discount || 0);
      if (!samePrice || !sameDisc) prices[s.id] = { price: price ?? null, discount: discount ?? 0 };
    } else if (price != null || (discount != null && discount > 0)) prices[s.id] = { price: price ?? null, discount: discount ?? 0 };
  }
  const description = String(form.description || "").trim();
  if (description.length > DESCRIPTION_MAX) errors.description = "bad_value";
  const attrs = {};
  for (const k of Object.keys(FRAME_ATTRS)) {
    const v = String(form[k] || "").trim();
    if (v) attrs[k] = v;
    else if (form.editing && form.had?.[k]) attrs[k] = null;
  }
  const features = (form.features || []).map((f) => String(f || "").trim()).filter(Boolean);
  const body = {
    kind: form.kind === "case" ? "case" : "frame",
    brand,
    brand_slug: form.brandSlug || (brand ? slugify(brand) : ""),
    sku,
    model: String(form.model || "").trim() || sku,
    colors,
    ...measures,
    ...(cost != null ? { cost } : form.editing && form.had?.cost ? { cost: null } : {}),
    ...(Object.keys(prices).length ? { prices } : {}),
    ...(images.length || form.editing ? { images } : {}),
    ...attrs,
    ...(features.length || form.editing ? { features } : {}),
    ...(description || (form.editing && form.had?.description) ? { description } : {}),
  };
  return { errors, body };
}

/**
 * A model as the edit dialog fills its form: Medusa's own product
 * (`GET /admin/products/:id`: title, variants, images, metadata); a `frame`
 * object in the create body's shape is read too.
 */
export function frameToForm(src, row = null) {
  const f = src?.frame || src?.product || src || {};
  const m = f.metadata || {};
  const pick = (...vs) => vs.find((v) => v !== undefined && v !== null && v !== "");
  const num = (v) => (v == null || v === "" ? "" : String(v));
  const variants = Array.isArray(f.variants) ? f.variants : [];
  const colors = Array.isArray(f.colors) && f.colors.length
    ? f.colors.map((c) => ({ id: c.id || c.variant_id || undefined, name: c.name || "", image: c.image || "" }))
    : variants.map((v, i) => ({ id: v.id, name: v.title || v.metadata?.color || "", image: v.metadata?.image || f.images?.[i]?.url || "" }));
  const imgs = (Array.isArray(f.images) ? f.images : []).map((x) => (typeof x === "string" ? x : x?.url)).filter(Boolean);
  const colorImgs = new Set(colors.map((c) => c.image).filter(Boolean));
  const out = {
    kind: pick(f.kind, m.kind, row?.kind) === "case" ? "case" : "frame",
    brand: pick(f.brand, m.brand, "") || "",
    brandSlug: pick(f.brand_slug, m.brand_slug, m.collection_slug, row?.brand_slug, "") || "",
    model: pick(f.model, f.title, row?.title, "") || "",
    sku: pick(f.sku, row?.sku, variants[0]?.sku, "") || "",
    colors: colors.length ? colors : [{ name: "", image: "" }],
    // Extra photos: the product images that are not some colour's photo.
    images: Array.isArray(f.colors) ? imgs : imgs.filter((u) => !colorImgs.has(u)),
    description: pick(f.description, m.description, "") || "",
    features: Array.isArray(pick(f.features, m.features)) ? pick(f.features, m.features).filter((x) => typeof x === "string") : [],
    cost: row?.cost_cents != null ? (Number(row.cost_cents) / 100).toFixed(2) : num(f.cost),
  };
  for (const k of [...Object.keys(MEASURES), ...Object.keys(EXTRA_MEASURES)]) out[k] = num(pick(f[k], m[k]));
  for (const k of Object.keys(FRAME_ATTRS)) out[k] = attrSlug(k, pick(f[k], m[k]));
  out.had = {};
  for (const k of [...Object.keys(MEASURES), ...Object.keys(EXTRA_MEASURES), ...Object.keys(FRAME_ATTRS), "description", "cost"]) out.had[k] = out[k] !== "";
  return out;
}

/** The exact prices / discounts of a matrix row, as the dialog's per-store grid. */
export function rowPrices(row, stores) {
  const out = {};
  for (const s of stores) {
    const c = row?.stores?.[s.id] || {};
    const exact = Boolean(c.exact || c.source === "store_exact");
    const pct = Number(c.discount_pct) || 0;
    out[s.id] = { price: exact && c.price_cents != null ? Number(c.price_cents) / 100 : null, discount: pct > 0 ? pct : 0 };
  }
  return out;
}

/** Brand form → { errors, body } for POST /admin/catalog/brands[/:slug]. */
export function validateBrandForm(form, { takenSlugs = new Set(), editing = false } = {}) {
  const errors = {};
  const name = String(form.name || "").trim();
  if (!name || name.length > 60) errors.name = "bad_brand";
  else if (!editing && takenSlugs.has(slugify(name))) errors.name = "brand_taken";
  const logo = String(form.logo_url || "").trim();
  if (logo && !URL_RE.test(logo)) errors.logo_url = "bad_image";
  const body = editing
    ? { name, logo_url: logo || null, active: form.active !== false }
    : { name, kind: form.kind === "case" ? "case" : "frame", ...(logo ? { logo_url: logo } : {}) };
  return { errors, body };
}

/**
 * Treatment form → { errors, body } for POST /admin/pricing/treatments, or,
 * with `editing`, for POST /admin/pricing/treatments/:code (names, group and
 * cost only: its prices are cells of the matrix).
 */
export function validateTreatmentForm(form, { editing = false } = {}) {
  const errors = {};
  const type = form.type === "ar" ? "ar" : form.type === "photo" ? "photo" : null;
  if (!type) errors.type = "bad_type";
  const es = String(form.label_es || "").trim();
  const en = String(form.label_en || "").trim();
  if (!es) errors.label_es = "bad_label";
  if (!en) errors.label_en = "bad_label";
  const cost = parseInput(form.cost);
  if (cost === undefined || (cost != null && cost < 0)) errors.cost = "bad_value";
  if (editing) {
    const body = {
      label_es: es,
      label_en: en,
      ...(cost != null ? { cost } : form.hadCost ? { cost: null } : {}),
      ...(type === "ar" ? { ar_group: ["all", "sv", "bifprog"].includes(form.ar_group) ? form.ar_group : "all" } : {}),
    };
    return { errors, body };
  }
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

/** The option code of a treatment row (`code:category` keys for photochromics). */
export const treatmentCode = (r) => String(r?.code || String(r?.key || "").split(":")[0] || "");

/** A group's label in the chosen language (lens designs, the two treatment families, the brandless cases). */
export function groupLabel(g, t, lang) {
  if (g?.kind === "design") return lang === "en" ? g.label_en || g.label : g.label;
  if (g?.kind === "treatment" && (g.key === "photo" || g.key === "ar")) return t(`adm.pm.grp.${g.key}`);
  if (g?.kind === "brand" && g.key === "case" && !g.stores) return t("adm.pm.grp.cases");
  return g?.label ?? "";
}
