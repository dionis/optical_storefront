// Backend simulado de «Productos y precios» (docs/PRICE-MATRIX.md, v1 + v2)
// para los bancos de pruebas: exec.html?tab=products&sub=frames|cases|lenses|treatments|rules.
// Con estado: lo que se edita en la matriz, se importa o se da de alta queda
// mientras la página no se recarga. Las cifras imitan el cálculo del servidor
// solo lo necesario para que la pantalla tenga datos creíbles: 4 tiendas con
// color, marcas con logo (y una sin logo → monograma), estuches por marca,
// diseños de lente y tratamientos.
//
// Precedencia v2 del precio de una montura/estuche en una tienda:
//   precio exacto del modelo > precio de la marca > ajuste % de la tienda > banda > maestro
// Descuento: el del modelo si existe; si no, el de la marca.
//
//   matrixMock(path, url, init) → Response | null (null = no es de aquí)
//
// Casos para probar a mano:
//   · precio > 5000 → 422 bad_value (revierte la casilla con el motivo)
//   · descuento > 90 → 422 discount_range
//   · SKU «DC401» en el alta → 409 sku_taken
//   · borrar «Di Caprio» → 409 brand_has_models; borrar «Peachtree» (0 modelos) → ok
//   · borrar DC401 (vendido) → archived; DC403 (nunca vendido) → deleted
//   · subir una imagen: el simulador devuelve una foto de muestra (no guarda el archivo)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (reason, status = 422, extra = {}) => json({ reason, message: reason, ...extra }, status);
const DELAY = Number(new URLSearchParams(location.search).get("delay") || 260);
const ORIGIN = location.origin;

export const MATRIX_STORES = [
  { id: "est_01", code: "Op1", name: "Fry Family Clinic", color: "#1B7F4C" },
  { id: "est_02", code: "Op2", name: "El Rancho 39", color: "#B5651D" },
  { id: "est_03", code: "Op3", name: "El Rancho 41", color: "#C2185B" },
  { id: "est_04", code: "Op4", name: "Hialeah Gardens", color: "#2563EB" },
];
const ADJUST = { est_01: 0, est_02: 5, est_03: -3, est_04: 10 };
const BAND = { below: 3000, to: 6000 }; // < $30 → $60 (monturas)

/* ───────── Registro de marcas (catalog_brand) ───────── */
const registry = new Map(); // slug → { slug, name, logo_url, kind, active, source, sort }
[
  ["di-caprio", "Di Caprio", "/brands/logo-di-caprio.png", "frame"],
  ["flexure", "Flexure", "/brands/logo-flexure.png", "frame"],
  ["milenial", "Milenial", "/brands/logo-millennial.png", "frame"], // slug del catálogo ≠ archivo (mapa explícito)
  ["for-you", "For You", null, "frame"], // sin logo → monograma
  ["peachtree", "Peachtree", "/brands/logo-peachtree.png", "frame"], // 0 modelos
  ["case", "Cases (estuches)", "/brands/logo-case.png", "case"],
  ["trendy", "Trendy Kids", "/brands/logo-trendy.png", "case"],
].forEach(([slug, name, logo, kind], i) => registry.set(slug, { slug, name, logo_url: logo, kind, active: true, source: "capri", sort: i }));

const FRAME_BRANDS = [
  { slug: "di-caprio", prefix: "DC", base: 401, img: "/lookbook/model-01.jpg" },
  { slug: "flexure", prefix: "FX", base: 210, img: "/lookbook/model-02.jpg" },
  { slug: "milenial", prefix: "ML", base: 8, img: "/lookbook/model-03.jpg" },
  { slug: "for-you", prefix: "FY", base: 100, img: "/lookbook/model-04.jpg" },
];
const SAMPLE_UPLOADS = ["/lookbook/model-01.jpg", "/lookbook/model-02.jpg", "/lookbook/model-03.jpg", "/lookbook/model-04.jpg"];
const seed = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const abs = (u) => (u && u.startsWith("/") ? `${ORIGIN}${u}` : u);

/* ───────── Estado ───────── */
const items = new Map(); // key → item
const exact = new Map(); // `${store}|${key}` → cents
const disc = new Map(); // `${store}|${key}` → pct
const brandPrice = new Map(); // `${store}|${scope}|${slug}` → cents
const brandDisc = new Map(); // `${store}|${scope}|${slug}` → pct
const rules = new Map(); // `${store}|product|id` | `${store}|brand|slug` → bool
let uploads = 0;

const COLORS = ["Black", "Tortoise", "Blue", "Grey", "Burgundy"];
function addFrame({ id, section, brand, sku, title, cost, thumb, status = "published", source = "supplier_list", first_seen_at = null, sold = false, meta = {} }) {
  const kind = section === "cases" ? "case" : "frame";
  const ncol = 1 + (seed(sku) % 3);
  const colors = COLORS.slice(0, ncol).map((name, i) => ({ id: `var_${id}_${i}`, name, image: i === 0 ? thumb : null, sold: sold && i === 0 }));
  items.set(id, {
    section, kind, key: id, product_id: id, group: brand, sku, title, cost_cents: cost, cost_source: cost ? source : null,
    supplier_cents: source === "supplier_list" || source === "supplier_list_prev" ? cost : null, supplier_source: source,
    thumbnail: thumb, status, first_seen_at, sold, colors, images: [],
    eye_size: kind === "frame" ? 48 + (seed(sku) % 9) : null, bridge_size: kind === "frame" ? 16 + (seed(sku) % 4) : null, temple_length: kind === "frame" ? 135 + (seed(sku) % 3) * 5 : null,
    a: null, b: null, ed: null, circ: null,
    material: kind === "frame" ? ["acetate", "metal", "tr90"][seed(sku) % 3] : "plastic", shape: kind === "frame" ? ["square", "round", "cat-eye", "rectangle"][seed(sku) % 4] : "",
    style: kind === "frame" ? "full-frame" : "", gender: kind === "frame" ? ["women", "men", "unisex"][seed(sku) % 3] : "", age_group: "adult",
    features: seed(sku) % 2 ? ["Spring Hinge"] : [], description: "", ...meta,
  });
}
for (const b of FRAME_BRANDS) {
  const n = b.slug === "for-you" ? 4 : 10;
  for (let i = 0; i < n; i++) {
    const num = b.base + i * (b.prefix === "ML" ? 1 : 2);
    const sku = `${b.prefix}${num}`;
    const h = seed(sku);
    // Un par sin costo (filtro «sin costo»), algunos de la lista anterior y alguno descontinuado.
    const cost = i === 7 ? null : 1200 + (h % 1400);
    addFrame({
      id: `prod_${sku.toLowerCase()}`, section: "frames", brand: b.slug, sku,
      title: b.prefix === "ML" ? `ML ${num}` : sku, cost,
      // Miniaturas absolutas; una sin foto y otra con un enlace roto (marco neutro, nunca el icono roto).
      thumb: i % 3 === 2 ? null : i === 4 ? `${ORIGIN}/missing/r2-key-${sku}.jpg` : abs(b.img),
      status: b.slug === "flexure" && i === 9 ? "draft" : "published",
      source: i % 4 === 3 ? "supplier_list_prev" : i === 5 ? "owner_edit" : "supplier_list",
      first_seen_at: i === 0 ? new Date(Date.now() - 4 * 864e5).toISOString() : "2025-11-01T00:00:00Z",
      sold: i % 2 === 0,
    });
  }
}
[["CS01", "Estuche rígido negro", 180, "case"], ["CS02", "Estuche rígido carey", 220, "case"], ["CS03", "Estuche blando microfibra", 90, "case"], ["TK01", "Estuche infantil Trendy", 150, "trendy"], ["TK02", "Estuche Trendy dinosaurios", 160, "trendy"]].forEach(([sku, title, cost, brand], i) =>
  addFrame({ id: `prod_${sku.toLowerCase()}`, section: "cases", brand, sku, title, cost, thumb: i === 1 ? abs("/brands/medal-case.png") : null }));

const DESIGNS = [
  ["sv", "Visión sencilla", { cr39: [60, 900], poly: [90, 1400], "1.56": [100, 1600], "1.61": [100, 1900], "1.67": [120, 2600] }, true],
  ["bifocal", "Bifocal FT-28", { cr39: [130, 2100], poly: [140, 2400], "1.61": [140, 2900] }, true],
  ["prog-mid", "Progresivo gama media", { cr39: [180, 3800], poly: [180, 4000], "1.67": [200, 5200] }, false],
  ["prog-high", "Progresivo gama alta", { cr39: [240, 5600], poly: [240, 5900], "1.67": [280, 7100] }, false],
];
const MATS = { cr39: "CR-39", poly: "Policarbonato", "1.56": "Índice 1.56", "1.61": "Índice 1.61", "1.67": "Índice 1.67" };
for (const [code, label, mats, both] of DESIGNS) {
  for (const [m, [usd, cost]] of Object.entries(mats)) {
    const finishes = both ? ["stock", "digital"] : ["digital"];
    for (const f of finishes) {
      const key = f === "digital" && both ? `${code}:${m}:digital` : `${code}:${m}`;
      items.set(key, { section: "lenses", kind: "lens", key, group: code, groupLabel: label, sku: null, title: `${MATS[m]} · ${f === "stock" ? "stock" : "digital"}`, cost_cents: f === "digital" && both ? cost + 900 : cost, cost_source: "lab", base_cents: (f === "digital" && both ? usd + 25 : usd) * 100 });
    }
  }
}
const CAT = { sv: "visión sencilla", bifocal: "bifocal", prog: "progresivo" };
const treatments = new Map(); // code → { type, label_es, label_en, cost_cents, ar_group, sold, active }
function addPhoto(code, label_es, label_en, prices, cost, sold = false) {
  treatments.set(code, { type: "photo", label_es, label_en, cost_cents: cost, sold, active: true });
  for (const [c, usd] of Object.entries(prices)) items.set(`${code}:${c}`, { section: "treatments", kind: "photo", key: `${code}:${c}`, code, category: c, group: "photo", groupLabel: "Fotocromáticos", sku: null, title: `${label_es} · ${CAT[c]}`, label_es, label_en, cost_cents: cost, cost_source: "lab", base_cents: usd * 100 });
}
function addAr(code, label_es, label_en, usd, cost, ar_group = "all", sold = false) {
  treatments.set(code, { type: "ar", label_es, label_en, cost_cents: cost, ar_group, sold, active: true });
  items.set(code, { section: "treatments", kind: "ar", key: code, code, ar_group, group: "ar", groupLabel: "Antirreflejo", sku: null, title: label_es, label_es, label_en, cost_cents: cost, cost_source: "lab", base_cents: usd * 100 });
}
addPhoto("photo-grey", "Fotocromático Grey", "Photochromic Grey", { sv: 85, bifocal: 110, prog: 90 }, 1800, true);
addPhoto("trans-s-grey", "Transitions Gen S Grey", "Transitions Gen S Grey", { sv: 105, bifocal: 105, prog: 105 }, 3200);
addPhoto("trans-x-brown", "Transitions XTRActive Brown", "Transitions XTRActive Brown", { sv: 130, bifocal: 130, prog: 130 }, 4100);
addAr("ar-green-basic", "AR Green Básico", "AR Green Basic", 60, 700, "all", true);
addAr("ar-blue-protect", "AR Blue Protect", "AR Blue Protect", 90, 1300);
addAr("crystal", "Crystal", "Crystal", 80, 1100, "sv");
addAr("flawless", "Flawless", "Flawless", 120, 2200, "bifprog");

// Algunas excepciones para ver los estados: precios fijados, de marca, descuentos y modelos ocultos.
exact.set("est_02|prod_dc401", 6900); exact.set("est_04|prod_dc405", 7500); exact.set("est_01|prod_fx212", 5900);
exact.set("est_03|sv:poly", 9500);
brandPrice.set("est_01|frame|di-caprio", 6500); brandDisc.set("est_04|frame|flexure", 15); brandPrice.set("est_02|case|case", 1500);
disc.set("est_01|prod_dc401", 10); disc.set("est_03|prod_dc403", 15); disc.set("est_02|prod_ml9", 20); disc.set("est_04|sv:cr39", 10); disc.set("est_01|ar-blue-protect", 25);
rules.set("est_03|brand|milenial", false); rules.set("est_03|product|prod_ml10", true); rules.set("est_02|product|prod_fx214", false);

/* ───────── Cálculo ───────── */
const masterCents = (it) => {
  if (it.base_cents != null) return it.base_cents;
  const c = it.cost_cents || 1500;
  return Math.ceil((c * 2.9) / 100) * 100 - 3; // «x.97», como la lista de la web
};
const isProduct = (it) => it.kind === "frame" || it.kind === "case";
const scopeOf = (it) => (it.kind === "case" ? "case" : "frame");
function cellOf(it, sid) {
  const k = `${sid}|${it.key}`;
  const bk = isProduct(it) ? `${sid}|${scopeOf(it)}|${it.group}` : null;
  let price;
  let source;
  if (exact.has(k)) { price = exact.get(k); source = "store_exact"; }
  else if (bk && brandPrice.has(bk)) { price = brandPrice.get(bk); source = "brand"; }
  else {
    const m = masterCents(it);
    const adj = ADJUST[sid] || 0;
    price = Math.round(m * (1 + adj / 100));
    source = adj ? "rule" : "master";
    if (it.kind === "frame" && price < BAND.below) { price = BAND.to; source = "band"; }
  }
  const pct = disc.get(k) || (bk ? brandDisc.get(bk) : 0) || 0;
  let exposed = true;
  if (isProduct(it)) {
    const own = rules.get(`${sid}|product|${it.product_id}`);
    const brand = rules.get(`${sid}|brand|${it.group}`);
    exposed = own ?? brand ?? true;
  }
  return { price_cents: price, source, exact: source === "store_exact", discount_pct: pct || null, final_cents: Math.round(price * (1 - pct / 100)), exposed };
}
function rowOf(it, costAccess = true) {
  const stores = {};
  for (const s of MATRIX_STORES) stores[s.id] = cellOf(it, s.id);
  const r = { kind: it.kind, key: it.key, product_id: it.product_id, sku: it.sku, title: it.title, thumbnail: it.thumbnail || null, status: it.status, first_seen_at: it.first_seen_at, stores };
  if (isProduct(it)) { r.brand_slug = it.group; r.price_scope = scopeOf(it); }
  if (it.code) { r.code = it.code; r.label_es = it.label_es; r.label_en = it.label_en; if (it.category) r.category = it.category; if (it.ar_group) r.ar_group = it.ar_group; }
  if (costAccess) { r.cost_cents = it.cost_cents; r.cost_source = it.cost_source; }
  return r;
}
function brandGroup(slug, scope, rows) {
  const b = registry.get(slug);
  const stores = {};
  for (const s of MATRIX_STORES) {
    const k = `${s.id}|${scope}|${slug}`;
    stores[s.id] = { brand_rule: rules.has(`${s.id}|brand|${slug}`) ? rules.get(`${s.id}|brand|${slug}`) : null, exposed_rows: rows.filter((r) => r.stores[s.id]?.exposed !== false).length, brand_price_cents: brandPrice.get(k) ?? null, brand_discount_pct: brandDisc.get(k) ?? null };
  }
  return { key: slug, label: b?.name || slug, kind: "brand", logo_url: b?.logo_url ? abs(b.logo_url) : null, stores, rows };
}
function section(sec, q = "") {
  const k = String(q).toLowerCase();
  const groups = new Map();
  for (const it of items.values()) {
    if (it.section !== sec) continue;
    const gl = it.groupLabel || registry.get(it.group)?.name || it.group;
    if (k && !`${it.title} ${it.sku || ""} ${gl}`.toLowerCase().includes(k)) continue;
    if (!groups.has(it.group)) groups.set(it.group, { key: it.group, label: gl, kind: sec === "lenses" ? "design" : sec === "treatments" ? "treatment" : "brand", rows: [] });
    groups.get(it.group).rows.push(rowOf(it));
  }
  let list = [...groups.values()];
  if (sec === "frames" || sec === "cases") list = list.map((g) => brandGroup(g.key, sec === "cases" ? "case" : "frame", g.rows)).sort((a, b) => a.label.localeCompare(b.label));
  return { section: sec, cost_access: true, stores: MATRIX_STORES, groups: list };
}

/* ───────── Escrituras ───────── */
function writeCell({ kind, key, field, store, value, scope }) {
  if (!["cost", "price", "discount"].includes(field)) return { error: "bad_field" };
  if (field === "cost" && store) return { error: "store_not_allowed" };
  if (field !== "cost" && !store) return { error: "store_required" };
  if (store && !MATRIX_STORES.some((s) => s.id === store)) return { error: "store_not_found" };
  const v = value === null || value === "" ? null : Number(value);
  if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: field === "discount" ? "discount_range" : "bad_value" };
  if (field === "discount" && v !== null && v > 90) return { error: "discount_range" };
  if (field === "price" && v !== null && v > 5000) return { error: "bad_value" };
  if (kind === "brand") {
    if (!registry.has(key) && ![...items.values()].some((x) => x.group === key)) return { error: "unknown_item" };
    if (field === "cost") return { error: "bad_field" };
    const sc = scope === "case" ? "case" : "frame";
    const k = `${store}|${sc}|${key}`;
    if (field === "price") { if (v === null) brandPrice.delete(k); else brandPrice.set(k, Math.round(v * 100)); }
    else if (!v) brandDisc.delete(k); else brandDisc.set(k, Math.round(v * 100) / 100);
    const sec = sc === "case" ? "cases" : "frames";
    const rows = [...items.values()].filter((x) => x.section === sec && x.group === key).map((x) => rowOf(x));
    return { group: brandGroup(key, sc, rows) };
  }
  const it = items.get(key);
  if (!it) return { error: "unknown_item" };
  const k = `${store}|${key}`;
  const before = field === "cost" ? it.cost_cents : field === "price" ? cellOf(it, store).price_cents : disc.get(k) || 0;
  if (field === "cost") {
    const set = (x) => { x.cost_cents = v === null ? (x.supplier_cents ?? null) : Math.round(v * 100); x.cost_source = v === null ? (x.supplier_cents ? x.supplier_source : null) : "owner_edit"; };
    // Un fotocromático tiene UN costo por opción: sus filas por categoría lo comparten.
    if (it.kind === "photo") for (const x of items.values()) { if (x.code === it.code) set(x); } else set(it);
  }
  if (field === "price") { if (v === null) exact.delete(k); else exact.set(k, Math.round(v * 100)); }
  if (field === "discount") { if (!v) disc.delete(k); else disc.set(k, Math.round(v * 100) / 100); }
  return { before, row: rowOf(it) };
}

function planImport(rows) {
  const changes = [];
  const errors = [];
  const ops = [];
  const byCode = new Map(MATRIX_STORES.map((s) => [s.code, s]));
  rows.forEach((r, i) => {
    if (r.section === "brands") {
      const sc = r.scope === "case" ? "case" : "frame";
      if (!registry.has(r.key)) { errors.push({ row: i + 1, reason: "unknown_item", detail: r.key }); return; }
      for (const [code, cells] of Object.entries(r.stores || {})) {
        const s = byCode.get(code);
        if (!s) { errors.push({ row: i + 1, reason: "store_not_found", detail: code }); continue; }
        const k = `${s.id}|${sc}|${r.key}`;
        const item = registry.get(r.key).name;
        if ("price" in cells) { changes.push({ row: i + 1, section: "brands", item, field: "price", store: s.id, before: brandPrice.has(k) ? brandPrice.get(k) / 100 : null, after: cells.price }); ops.push({ kind: "brand", key: r.key, scope: sc, field: "price", store: s.id, value: cells.price }); }
        if ("discount" in cells) { changes.push({ row: i + 1, section: "brands", item, field: "discount", store: s.id, before: brandDisc.get(k) ?? null, after: cells.discount }); ops.push({ kind: "brand", key: r.key, scope: sc, field: "discount", store: s.id, value: cells.discount }); }
      }
      return;
    }
    const it = r.sku ? [...items.values()].find((x) => x.sku && x.sku.toUpperCase() === String(r.sku).toUpperCase()) : items.get(r.key);
    if (!it) { errors.push({ row: i + 1, reason: "unknown_item", detail: r.sku || r.key }); return; }
    const item = it.sku ? `${registry.get(it.group)?.name || it.group} ${it.title}` : it.title;
    if ("cost" in r) {
      if (r.cost !== null && !(Number(r.cost) >= 0)) errors.push({ row: i + 1, reason: "bad_value", detail: item });
      else { changes.push({ row: i + 1, section: it.section, item, field: "cost", store: null, before: it.cost_cents == null ? null : it.cost_cents / 100, after: r.cost }); ops.push({ kind: it.kind, key: it.key, field: "cost", value: r.cost }); }
    }
    for (const [code, cells] of Object.entries(r.stores || {})) {
      const s = byCode.get(code);
      if (!s) { errors.push({ row: i + 1, reason: "store_not_found", detail: code }); continue; }
      const now = cellOf(it, s.id);
      if ("price" in cells) {
        if (cells.price !== null && !(Number(cells.price) >= 0)) errors.push({ row: i + 1, reason: "bad_value", detail: `${item} · ${code}` });
        else { changes.push({ row: i + 1, section: it.section, item, field: "price", store: s.id, before: now.price_cents / 100, after: cells.price }); ops.push({ kind: it.kind, key: it.key, field: "price", store: s.id, value: cells.price }); }
      }
      if ("discount" in cells) {
        if (cells.discount !== null && !(Number(cells.discount) >= 0 && Number(cells.discount) <= 90)) errors.push({ row: i + 1, reason: "discount_range", detail: `${item} · ${code}` });
        else { changes.push({ row: i + 1, section: it.section, item, field: "discount", store: s.id, before: now.discount_pct, after: cells.discount }); ops.push({ kind: it.kind, key: it.key, field: "discount", store: s.id, value: cells.discount }); }
      }
    }
  });
  const counts = { rows: rows.length, changes: changes.length, price: changes.filter((c) => c.field === "price").length, discount: changes.filter((c) => c.field === "discount").length, cost: changes.filter((c) => c.field === "cost").length, errors: errors.length };
  return { plan: { changes, errors, counts }, ops };
}

const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const modelsOf = (s) => [...items.values()].filter((x) => isProduct(x) && x.group === s).length;
const brandOut = (b) => ({ ...b, logo_url: b.logo_url ? abs(b.logo_url) : null, models: modelsOf(b.slug) });
const ATTRS = ["material", "shape", "style", "gender", "age_group", "description"];
const MEAS = ["eye_size", "bridge_size", "temple_length", "a", "b", "ed", "circ"];
function frameOut(it) {
  const out = { id: it.product_id, kind: it.kind, brand: registry.get(it.group)?.name || it.group, brand_slug: it.group, sku: it.sku, model: it.title, colors: it.colors.map((c) => ({ id: c.id, name: c.name, image: c.image || "" })), images: it.images, features: it.features, status: it.status };
  for (const k of [...ATTRS, ...MEAS]) out[k] = it[k] ?? null;
  return { frame: out };
}
function applyBody(it, b) {
  for (const k of [...ATTRS, ...MEAS]) if (k in b) it[k] = b[k];
  if (Array.isArray(b.features)) it.features = b.features;
  if (Array.isArray(b.images)) it.images = b.images;
  if (Array.isArray(b.colors)) {
    const keep = new Set(b.colors.map((c) => c.id).filter(Boolean));
    const sold = it.colors.find((c) => c.sold && !keep.has(c.id));
    if (sold) return "color_sold";
    it.colors = b.colors.map((c, i) => ({ id: c.id || `var_${it.key}_n${Date.now() % 1e5}_${i}`, name: c.name, image: c.image || null, sold: it.colors.find((x) => x.id === c.id)?.sold || false }));
    it.thumbnail = it.colors.find((c) => c.image)?.image || it.images[0] || null;
  }
  if (b.model) it.title = b.model;
  if (b.sku) it.sku = b.sku;
  for (const [sid, v] of Object.entries(b.prices || {})) {
    if (v.price != null) exact.set(`${sid}|${it.key}`, Math.round(v.price * 100)); else exact.delete(`${sid}|${it.key}`);
    if (v.discount) disc.set(`${sid}|${it.key}`, v.discount); else disc.delete(`${sid}|${it.key}`);
  }
  return null;
}

export async function matrixMock(p, url, init) {
  const method = (init?.method || "GET").toUpperCase();
  const body = () => { try { return JSON.parse(init?.body || "{}"); } catch { return {}; } };
  if (p === "/admin/pricing/matrix" && method === "GET") {
    await sleep(DELAY);
    return json(section(url.searchParams.get("section") || "frames", url.searchParams.get("q") || ""));
  }
  if (p === "/admin/pricing/matrix/cell") {
    await sleep(DELAY);
    const r = writeCell(body());
    return r.error ? fail(r.error) : json(r.group ? { group: r.group } : { row: r.row });
  }
  if (p === "/admin/pricing/matrix/import") {
    await sleep(DELAY * 2);
    const b = body();
    const { plan, ops } = planImport(Array.isArray(b.rows) ? b.rows : []);
    if (!b.apply) return json({ plan });
    if (plan.errors.length) return fail("import_has_errors", 422, { plan });
    for (const op of ops) writeCell(op);
    return json({ applied: ops.length, failed: [] });
  }

  /* Marcas */
  if (p === "/admin/catalog/brands" && method === "GET") {
    await sleep(DELAY);
    return json({ brands: [...registry.values()].map(brandOut).sort((a, b) => a.name.localeCompare(b.name)) });
  }
  if (p === "/admin/catalog/brands" && method === "POST") {
    await sleep(DELAY);
    const b = body();
    const name = String(b.name || "").trim();
    if (!name) return fail("bad_brand");
    const s = slug(name);
    if (registry.has(s)) return fail("brand_taken", 409);
    const brand = { slug: s, name, logo_url: b.logo_url || null, kind: b.kind === "case" ? "case" : "frame", active: true, source: "manual", sort: registry.size };
    registry.set(s, brand);
    return json({ brand: brandOut(brand) }, 201);
  }
  const br = /^\/admin\/catalog\/brands\/([^/]+)$/.exec(p);
  if (br) {
    await sleep(DELAY);
    const s = decodeURIComponent(br[1]);
    const b = registry.get(s);
    if (!b) return fail("unknown_item", 404);
    if (method === "DELETE") {
      const n = modelsOf(s);
      if (n) return fail("brand_has_models", 409, { models: n });
      registry.delete(s);
      return json({ deleted: true });
    }
    const x = body();
    if ("name" in x) { if (!String(x.name || "").trim()) return fail("bad_brand"); b.name = String(x.name).trim(); }
    if ("logo_url" in x) b.logo_url = x.logo_url || null;
    if ("active" in x) b.active = Boolean(x.active);
    return json({ brand: brandOut(b) });
  }

  /* Archivos: el simulador no guarda el archivo; devuelve una foto de muestra. */
  if (p === "/admin/catalog/uploads" && method === "POST") {
    await sleep(DELAY * 3);
    const file = init?.body instanceof FormData ? init.body.get("file") : null;
    if (!file || !String(file.type || "").startsWith("image/")) return fail("bad_file");
    if (file.size > 8 * 1024 * 1024) return fail("file_too_large", 413);
    uploads += 1;
    return json({ url: abs(SAMPLE_UPLOADS[uploads % SAMPLE_UPLOADS.length]) }, 201);
  }

  /* Modelos */
  if (p === "/admin/catalog/frames" && method === "POST") {
    await sleep(DELAY * 2);
    const b = body();
    if (!String(b.brand || "").trim() && b.kind !== "case") return fail("bad_brand");
    if (!String(b.sku || "").trim()) return fail("bad_sku");
    if ([...items.values()].some((x) => x.sku && x.sku.toUpperCase() === String(b.sku).toUpperCase())) return fail("sku_taken", 409);
    if (!Array.isArray(b.colors) || !b.colors.length) return fail("bad_colors");
    const sec = b.kind === "case" ? "cases" : "frames";
    const id = `prod_${slug(b.sku)}_${Date.now() % 10000}`;
    const brandSlug = b.brand_slug || (b.brand ? slug(b.brand) : "case");
    if (!registry.has(brandSlug)) registry.set(brandSlug, { slug: brandSlug, name: b.brand || "Cases", logo_url: null, kind: b.kind === "case" ? "case" : "frame", active: true, source: "manual", sort: registry.size });
    addFrame({ id, section: sec, brand: brandSlug, sku: b.sku, title: b.model || b.sku, cost: b.cost == null ? null : Math.round(b.cost * 100), thumb: b.colors.find((c) => c.image)?.image || (b.images || [])[0] || null, source: "owner_edit", first_seen_at: new Date().toISOString() });
    const it = items.get(id);
    it.colors = [];
    applyBody(it, { ...b, sku: undefined, model: undefined });
    return json({ product_id: id, handle: slug(b.sku), row: rowOf(it) }, 201);
  }
  const fr = /^\/admin\/catalog\/frames\/([^/]+)$/.exec(p);
  if (fr) {
    await sleep(DELAY);
    const it = items.get(decodeURIComponent(fr[1]));
    if (!it || !isProduct(it)) return fail("unknown_item", 404);
    if (method === "GET") return json(frameOut(it));
    if (method === "DELETE") {
      if (it.sold) { it.status = "draft"; return json({ archived: true }); }
      items.delete(it.key);
      return json({ deleted: true });
    }
    const b = body();
    if (b.sku && [...items.values()].some((x) => x !== it && x.sku && x.sku.toUpperCase() === String(b.sku).toUpperCase())) return fail("sku_taken", 409);
    if ("cost" in b) { it.cost_cents = b.cost == null ? it.supplier_cents : Math.round(b.cost * 100); it.cost_source = b.cost == null ? it.supplier_source : "owner_edit"; }
    if (b.brand_slug && b.brand_slug !== it.group) { it.group = b.brand_slug; if (!registry.has(b.brand_slug)) registry.set(b.brand_slug, { slug: b.brand_slug, name: b.brand, logo_url: null, kind: it.kind, active: true, source: "manual", sort: registry.size }); }
    if (b.kind && (b.kind === "case") !== (it.kind === "case")) { it.kind = b.kind === "case" ? "case" : "frame"; it.section = b.kind === "case" ? "cases" : "frames"; }
    const err = applyBody(it, b);
    if (err) return fail(err, 409);
    return json({ product_id: it.product_id, row: rowOf(it) });
  }

  /* Tratamientos */
  if (p === "/admin/pricing/treatments" && method === "POST") {
    await sleep(DELAY * 2);
    const b = body();
    if (b.type !== "photo" && b.type !== "ar") return fail("bad_type");
    if (!String(b.label_es || "").trim() || !String(b.label_en || "").trim()) return fail("bad_label");
    const code = slug(b.label_es);
    if (treatments.has(code)) return fail("code_taken", 409);
    const cost = b.cost == null ? null : Math.round(b.cost * 100);
    if (b.type === "ar") addAr(code, b.label_es, b.label_en, Number(b.prices), cost, b.ar_group || "all");
    else addPhoto(code, b.label_es, b.label_en, b.prices || {}, cost);
    return json({ type: b.type, code, rows: [...items.values()].filter((x) => x.code === code).map((x) => rowOf(x)) }, 201);
  }
  const tr = /^\/admin\/pricing\/treatments\/([^/]+)$/.exec(p);
  if (tr) {
    await sleep(DELAY);
    const code = decodeURIComponent(tr[1]);
    const opt = treatments.get(code);
    if (!opt) return fail("unknown_item", 404);
    const rowsOf = () => [...items.values()].filter((x) => x.code === code);
    if (method === "DELETE") {
      if (opt.sold) { opt.active = false; return json({ archived: true }); }
      for (const x of rowsOf()) items.delete(x.key);
      treatments.delete(code);
      return json({ deleted: true });
    }
    const b = body();
    if (("label_es" in b && !String(b.label_es || "").trim()) || ("label_en" in b && !String(b.label_en || "").trim())) return fail("bad_label");
    Object.assign(opt, { label_es: b.label_es ?? opt.label_es, label_en: b.label_en ?? opt.label_en, ar_group: b.ar_group ?? opt.ar_group });
    for (const x of rowsOf()) {
      x.label_es = opt.label_es; x.label_en = opt.label_en; x.title = x.category ? `${opt.label_es} · ${CAT[x.category]}` : opt.label_es;
      if (opt.type === "ar") x.ar_group = opt.ar_group;
      if ("cost" in b) { x.cost_cents = b.cost == null ? null : Math.round(b.cost * 100); x.cost_source = "owner_edit"; }
    }
    return json({ type: opt.type, code, rows: rowsOf().map((x) => rowOf(x)) });
  }

  // Surtido: solo lo que es de este catálogo simulado (lo demás lo atiende exec.jsx).
  const rule = /^\/admin\/store-assortment\/([^/]+)\/rule$/.exec(p);
  if (rule && method === "POST") {
    const b = body();
    const known = b.scope === "brand" ? registry.has(b.target) || [...items.values()].some((x) => x.group === b.target) : items.has(b.target);
    if (!known) return null;
    await sleep(DELAY);
    const k = `${rule[1]}|${b.scope}|${b.target}`;
    if (b.exposed === null) rules.delete(k); else rules.set(k, Boolean(b.exposed));
    return json({ ok: true });
  }
  const prod = /^\/admin\/products\/([^/]+)$/.exec(p);
  if (prod && method === "POST" && items.has(prod[1])) {
    await sleep(DELAY);
    const it = items.get(prod[1]);
    it.status = body().status || it.status;
    return json({ product: { id: it.product_id, status: it.status } });
  }
  return null;
}
