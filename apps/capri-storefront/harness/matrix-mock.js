// Backend simulado de «Productos y precios» (docs/PRICE-MATRIX.md) para los
// bancos de pruebas: exec.html?tab=products&sub=frames|cases|lenses|treatments|rules.
// Con estado: lo que se edita en la matriz, se importa o se da de alta queda
// mientras la página no se recarga. Las cifras imitan el cálculo del servidor
// (regla % de la tienda → banda → precio exacto; descuento por artículo) solo lo
// necesario para que la pantalla tenga datos creíbles: 4 tiendas con color, 3
// marcas × 10 modelos, estuches, diseños de lente y tratamientos.
//
//   matrixMock(path, url, init) → Response | null (null = no es de aquí)
//
// Casos para probar a mano:
//   · precio > 5000 → 422 bad_value (revierte la casilla con el motivo)
//   · descuento > 90 → 422 discount_range
//   · SKU «DC401» en el alta → 422 sku_taken
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (reason, status = 422) => json({ reason, message: reason }, status);
const DELAY = Number(new URLSearchParams(location.search).get("delay") || 260);

export const MATRIX_STORES = [
  { id: "est_01", code: "Op1", name: "Fry Family Clinic", color: "#1B7F4C" },
  { id: "est_02", code: "Op2", name: "El Rancho 39", color: "#B5651D" },
  { id: "est_03", code: "Op3", name: "El Rancho 41", color: "#C2185B" },
  { id: "est_04", code: "Op4", name: "Hialeah Gardens", color: "#2563EB" },
];
const ADJUST = { est_01: 0, est_02: 5, est_03: -3, est_04: 10 };
const BAND = { below: 3000, to: 6000 }; // < $30 → $60 (monturas)

const BRANDS = [
  { slug: "di-caprio", name: "Di Caprio", prefix: "DC", base: 401, img: "/lookbook/model-01.jpg" },
  { slug: "flexure", name: "Flexure", prefix: "FX", base: 210, img: "/lookbook/model-02.jpg" },
  { slug: "milenial", name: "Milenial", prefix: "ML", base: 8, img: "/lookbook/model-03.jpg" },
];
const seed = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

/* ───────── Estado ───────── */
const items = new Map(); // key → item
const exact = new Map(); // `${store}|${key}` → cents
const disc = new Map(); // `${store}|${key}` → pct
const rules = new Map(); // `${store}|product|id` | `${store}|brand|slug` → bool

function addFrame({ id, section, brand, brandName, sku, title, cost, thumb, status = "published", source = "supplier_list", first_seen_at = null }) {
  items.set(id, { section, kind: section === "cases" ? "case" : "frame", key: id, product_id: id, group: brand, groupLabel: brandName, sku, title, cost_cents: cost, cost_source: cost ? source : null, supplier_cents: source === "supplier_list" ? cost : null, thumbnail: thumb, status, first_seen_at });
}
for (const b of BRANDS) {
  for (let i = 0; i < 10; i++) {
    const n = b.base + i * (b.prefix === "ML" ? 1 : 2);
    const sku = `${b.prefix}${n}`;
    const h = seed(sku);
    // Un par sin costo (para el filtro «sin costo») y alguno descontinuado.
    const cost = i === 7 ? null : 1200 + (h % 1400);
    addFrame({
      id: `prod_${sku.toLowerCase()}`, section: "frames", brand: b.slug, brandName: b.name, sku,
      title: b.prefix === "ML" ? `ML ${n}` : sku, cost, thumb: i % 3 === 2 ? null : b.img,
      status: b.slug === "flexure" && i === 9 ? "draft" : "published",
      first_seen_at: i === 0 ? new Date(Date.now() - 4 * 864e5).toISOString() : "2025-11-01T00:00:00Z",
    });
  }
}
[["CS01", "Estuche rígido negro", 180], ["CS02", "Estuche rígido carey", 220], ["CS03", "Estuche blando microfibra", 90], ["CS04", "Estuche infantil Trendy", 150]].forEach(([sku, title, cost]) =>
  addFrame({ id: `prod_${sku.toLowerCase()}`, section: "cases", brand: "estuches", brandName: "Estuches", sku, title, cost, thumb: null }));

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
const PHOTO = [["photo-grey", "Fotocromático Grey", { sv: 85, bifocal: 110, prog: 90 }, 1800], ["trans-s-grey", "Transitions Gen S Grey", { sv: 105, bifocal: 105, prog: 105 }, 3200], ["trans-x-brown", "Transitions XTRActive Brown", { sv: 130, bifocal: 130, prog: 130 }, 4100]];
const CAT = { sv: "visión sencilla", bifocal: "bifocal", prog: "progresivo" };
for (const [code, label, prices, cost] of PHOTO) for (const [c, usd] of Object.entries(prices)) {
  const key = `${code}:${c}`;
  items.set(key, { section: "treatments", kind: "photo", key, group: "photo", groupLabel: "Fotocromáticos", sku: null, title: `${label} · ${CAT[c]}`, cost_cents: cost, cost_source: "lab", base_cents: usd * 100 });
}
[["ar-green-basic", "AR Green Básico", 60, 700], ["ar-blue-protect", "AR Blue Protect", 90, 1300], ["crystal", "Crystal", 80, 1100], ["flawless", "Flawless", 120, 2200]].forEach(([code, label, usd, cost]) =>
  items.set(code, { section: "treatments", kind: "ar", key: code, group: "ar", groupLabel: "Antirreflejo", sku: null, title: label, cost_cents: cost, cost_source: "lab", base_cents: usd * 100 }));

// Algunas excepciones para ver los estados: precios fijados, descuentos y modelos ocultos.
exact.set("est_02|prod_dc401", 6900); exact.set("est_04|prod_dc405", 7500); exact.set("est_01|prod_fx212", 5900);
exact.set("est_03|sv:poly", 9500);
disc.set("est_01|prod_dc401", 10); disc.set("est_03|prod_dc403", 15); disc.set("est_02|prod_ml9", 20); disc.set("est_04|sv:cr39", 10); disc.set("est_01|ar-blue-protect", 25);
rules.set("est_03|brand|milenial", false); rules.set("est_03|product|prod_ml10", true); rules.set("est_02|product|prod_fx214", false);

/* ───────── Cálculo ───────── */
const masterCents = (it) => {
  if (it.base_cents != null) return it.base_cents;
  const c = it.cost_cents || 1500;
  return Math.ceil((c * 2.9) / 100) * 100 - 3; // «x.97», como la lista de la web
};
function cellOf(it, sid) {
  const k = `${sid}|${it.key}`;
  let price;
  let source;
  if (exact.has(k)) { price = exact.get(k); source = "store_exact"; }
  else {
    const m = masterCents(it);
    const adj = ADJUST[sid] || 0;
    price = Math.round(m * (1 + adj / 100));
    source = adj ? "rule" : "master";
    if ((it.kind === "frame") && price < BAND.below) { price = BAND.to; source = "band"; }
  }
  const pct = disc.get(k) || 0;
  let exposed = true;
  if (it.kind === "frame" || it.kind === "case") {
    const own = rules.get(`${sid}|product|${it.product_id}`);
    const brand = rules.get(`${sid}|brand|${it.group}`);
    exposed = own ?? brand ?? true;
  }
  return { price_cents: price, source, exact: source === "store_exact", discount_pct: pct, final_cents: Math.round(price * (1 - pct / 100)), exposed };
}
function rowOf(it, costAccess = true) {
  const stores = {};
  for (const s of MATRIX_STORES) stores[s.id] = cellOf(it, s.id);
  const r = { kind: it.kind, key: it.key, product_id: it.product_id, sku: it.sku, title: it.title, thumbnail: it.thumbnail || null, status: it.status, first_seen_at: it.first_seen_at, stores };
  if (costAccess) { r.cost_cents = it.cost_cents; r.cost_source = it.cost_source; }
  return r;
}
function section(sec, q = "") {
  const k = String(q).toLowerCase();
  const groups = new Map();
  for (const it of items.values()) {
    if (it.section !== sec) continue;
    if (k && !`${it.title} ${it.sku || ""} ${it.groupLabel}`.toLowerCase().includes(k)) continue;
    if (!groups.has(it.group)) groups.set(it.group, { key: it.group, label: it.groupLabel, kind: sec === "frames" ? "brand" : sec === "cases" ? "case_group" : sec === "lenses" ? "design" : "family", rows: [] });
    groups.get(it.group).rows.push(rowOf(it));
  }
  return { section: sec, cost_access: true, stores: MATRIX_STORES, groups: [...groups.values()] };
}

/* ───────── Escrituras ───────── */
function writeCell({ kind, key, field, store, value }) {
  const it = items.get(key);
  if (!it) return { error: "unknown_item" };
  if (!["cost", "price", "discount"].includes(field)) return { error: "bad_field" };
  if (field === "cost" && store) return { error: "store_not_allowed" };
  if (field !== "cost" && !store) return { error: "store_required" };
  if (store && !MATRIX_STORES.some((s) => s.id === store)) return { error: "store_not_found" };
  const v = value === null || value === "" ? null : Number(value);
  if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: field === "discount" ? "discount_range" : "bad_value" };
  if (field === "discount" && v !== null && v > 90) return { error: "discount_range" };
  if (field === "price" && v !== null && v > 5000) return { error: "bad_value" };
  void kind;
  const k = `${store}|${key}`;
  const before = field === "cost" ? it.cost_cents : field === "price" ? cellOf(it, store).price_cents : disc.get(k) || 0;
  if (field === "cost") { it.cost_cents = v === null ? (it.supplier_cents ?? null) : Math.round(v * 100); it.cost_source = v === null ? (it.supplier_cents ? "supplier_list" : null) : "owner_edit"; }
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
    const it = r.sku ? [...items.values()].find((x) => x.sku && x.sku.toUpperCase() === String(r.sku).toUpperCase()) : items.get(r.key);
    if (!it) { errors.push({ row: i + 1, reason: "unknown_item", detail: r.sku || r.key }); return; }
    const item = it.sku ? `${it.groupLabel} ${it.title}` : it.title;
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
    return r.error ? fail(r.error) : json({ row: r.row });
  }
  if (p === "/admin/pricing/matrix/import") {
    await sleep(DELAY * 2);
    const b = body();
    const { plan, ops } = planImport(Array.isArray(b.rows) ? b.rows : []);
    if (!b.apply) return json({ plan });
    if (plan.errors.length) return fail("import_has_errors");
    for (const op of ops) writeCell(op);
    return json({ applied: ops.length });
  }
  if (p === "/admin/catalog/brands") {
    await sleep(DELAY);
    const map = new Map();
    for (const it of items.values()) if (it.section === "frames") map.set(it.group, { slug: it.group, name: it.groupLabel, models: (map.get(it.group)?.models || 0) + 1 });
    return json({ brands: [...map.values()] });
  }
  if (p === "/admin/catalog/frames" && method === "POST") {
    await sleep(DELAY * 2);
    const b = body();
    if (!String(b.brand || "").trim()) return fail("bad_brand");
    if (!String(b.sku || "").trim()) return fail("bad_sku");
    if ([...items.values()].some((x) => x.sku && x.sku.toUpperCase() === String(b.sku).toUpperCase())) return fail("sku_taken");
    if (!Array.isArray(b.colors) || !b.colors.length) return fail("bad_colors");
    const sec = b.kind === "case" ? "cases" : "frames";
    const id = `prod_${slug(b.sku)}_${Date.now() % 10000}`;
    const brandSlug = sec === "cases" ? "estuches" : b.brand_slug || slug(b.brand);
    addFrame({ id, section: sec, brand: brandSlug, brandName: sec === "cases" ? "Estuches" : b.brand, sku: b.sku, title: b.model || b.sku, cost: b.cost == null ? null : Math.round(b.cost * 100), thumb: b.colors[0]?.image || null, source: "owner_edit", first_seen_at: new Date().toISOString() });
    for (const [sid, v] of Object.entries(b.prices || {})) {
      if (v.price != null) exact.set(`${sid}|${id}`, Math.round(v.price * 100));
      if (v.discount) disc.set(`${sid}|${id}`, v.discount);
    }
    return json({ product: { id, sku: b.sku, status: "published" }, row: rowOf(items.get(id)) });
  }
  if (p === "/admin/pricing/treatments" && method === "POST") {
    await sleep(DELAY * 2);
    const b = body();
    if (b.type !== "photo" && b.type !== "ar") return fail("bad_type");
    if (!String(b.label_es || "").trim() || !String(b.label_en || "").trim()) return fail("bad_label");
    const code = slug(b.label_es);
    if ([...items.values()].some((x) => x.key === code || x.key.startsWith(`${code}:`))) return fail("code_taken");
    if (b.type === "ar") items.set(code, { section: "treatments", kind: "ar", key: code, group: "ar", groupLabel: "Antirreflejo", title: b.label_es, cost_cents: b.cost == null ? null : Math.round(b.cost * 100), cost_source: "owner_edit", base_cents: Math.round(Number(b.prices) * 100) });
    else for (const [c, usd] of Object.entries(b.prices || {})) items.set(`${code}:${c}`, { section: "treatments", kind: "photo", key: `${code}:${c}`, group: "photo", groupLabel: "Fotocromáticos", title: `${b.label_es} · ${CAT[c]}`, cost_cents: b.cost == null ? null : Math.round(b.cost * 100), cost_source: "owner_edit", base_cents: Math.round(usd * 100) });
    return json({ option: { code, type: b.type } });
  }
  // Surtido: solo lo que es de este catálogo simulado (lo demás lo atiende exec.jsx).
  const rule = /^\/admin\/store-assortment\/([^/]+)\/rule$/.exec(p);
  if (rule && method === "POST") {
    const b = body();
    const known = b.scope === "brand" ? [...items.values()].some((x) => x.group === b.target) : items.has(b.target);
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
