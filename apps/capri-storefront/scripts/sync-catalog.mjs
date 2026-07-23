#!/usr/bin/env node
/*
 * Óptica El Rancho — daily catalog sync service.
 *
 * Queries the caprioptics.com WooCommerce Store API (public, no auth), keeps only the
 * frames/cases that are AVAILABLE (is_in_stock === true), normalizes attributes to the
 * Spanish canonical values + filter size-buckets the storefront expects, and regenerates:
 *     public/catalog.json      (available frames)
 *     public/cases.json        (available cases)
 *     public/catalog-meta.json (lastSync, counts per brand, added/removed vs previous run)
 *
 * The storefront fetches these at runtime, so:
 *   - a model that is no longer available disappears automatically,
 *   - a brand-new model (any brand) shows up automatically.
 *
 * Per-color images: reused from the previous catalog when the model already existed;
 * for brand-new models the product page gallery is fetched once to map color -> image.
 *
 * Run daily via Windows Task Scheduler (see _runners/sync-catalog.bat).
 * Usage:  node scripts/sync-catalog.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Output dir is configurable for cloud/SaaS deploys (e.g. write to a mounted volume,
// a build dir, or a synced folder). Defaults to the storefront's public/.
const PUBLIC = process.env.CATALOG_OUT_DIR
  ? path.resolve(process.env.CATALOG_OUT_DIR)
  : path.resolve(__dirname, "..", "public");
fs.mkdirSync(PUBLIC, { recursive: true });
// Source site is configurable so the same service can power multiple SaaS tenants.
const SITE = (process.env.CATALOG_SOURCE || "https://caprioptics.com").replace(/\/$/, "");
const API = `${SITE}/wp-json/wc/store/v1/products`;
const UA = { "User-Agent": "OpticaElRancho-CatalogSync/1.0 (+storefront)" };

// ---- brand + attribute normalization (must match src/data filters/VAL) ----
const BRAND = {
  "eyeleos": "Eyeleos", "ago": "Ago", "artistik-eyewear": "Artistik Eyewear",
  "artistik-galerie": "Artistik Galerie", "simply-lite": "Simplylite", "di-caprio": "Di Caprio",
  "flexure": "Flexure", "grande": "Grande", "versailles-palace": "Versailles Palace",
  "trendy": "Trendy", "millennial": "Millennial", "peachtree": "Peachtree", "4u": "Four You",
  "prorx": "ProRx", "candy-shoppe": "The Candy Shoppe", "slimfold": "Slimfold", "case": "Cases",
};
const IGNORE = new Set(["new-releases","uncategorized","featured","on-sale","sale","new",
  "blog","accessories","sunglasses","sun-glasses","kids","mens","womens","men","women","unisex"]);

const SHAPE = {"square":"Cuadrado","round":"Redondo","cat eye":"Ojo de gato","navigator":"Navegador",
 "rectangle":"Rectángulo","aviator":"Aviador","geometric":"Geométrico","oval":"Oval",
 "modified oval":"Óvalo modificado","modified round":"Ronda modificada","combo":"Combo",
 "modified rectangle":"Rectángulo","full frame":"Marco completo","round modified":"Ronda modificada",
 "modified square":"Cuadrado"};
const MAT = {"acetate":"Acetato","plastic":"Plástica","metal":"Metal","stainless steel":"Acero inoxidable",
 "memory":"Memoria","titanium":"Titanio","injection":"Inyección","tr90":"TR-90","tr-90":"TR-90","ultem":"Ultem"};
const GEN = {"men":"Hombres","ladies":"Señoras","women":"Señoras","unisex":"Unisexo","kids":"Niños"};
const AGE = {"adult":"Adulto","childrens":"Niños","children":"Niños","kids":"Niños","youth":"Niños",
 "high-school-to-college":"Adulto"};

const firstInt = (v) => { if (v == null) return null; const m = String(v).match(/\d+/); return m ? +m[0] : null; };
const bEye = (n) => n==null?null : n<=43?"34-43 mm":n<=47?"44-47 mm":n<=50?"48-50 mm":n<=53?"51-53 mm":n<=56?"54-56 mm":n<=59?"57-59 mm":"Más de 60 mm";
const bBridge = (n) => n==null?null : n<=15?"13-15 mm":n<=17?"16-17 mm":n<=19?"18-19 mm":n<=22?"20-22 mm":"23-24 mm";
const bTemple = (n) => n==null?null : n<=120?"115-120 mm":n<=130?"125-130 mm":n<=140?"135-140 mm":n<=150?"145-150 mm":"155+ mm";
const trShape = (v) => v ? (SHAPE[String(v).trim().toLowerCase()] || String(v).trim()) : null;
const trGender = (v) => v ? (GEN[String(v).trim().toLowerCase()] || String(v).trim()) : null;
const trAge = (v) => { if(!v) return null; const k=String(v).split(",")[0].trim().toLowerCase(); return AGE[k] || String(v).split(",")[0].trim(); };
const trMat = (arr) => {
  const out=[]; const seen=new Set();
  for (const m of (arr||[])) { const t = MAT[String(m).trim().toLowerCase()] || String(m).trim(); if(!seen.has(t)){seen.add(t); out.push(t);} }
  return out;
};

async function getJSON(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return { data: await r.json(), headers: r.headers };
}

async function fetchAllProducts() {
  const all = [];
  let page = 1, totalPages = 1;
  do {
    const { data, headers } = await getJSON(`${API}?per_page=100&page=${page}`);
    if (page === 1) totalPages = parseInt(headers.get("x-wp-totalpages") || "1", 10) || 1;
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    page++;
  } while (page <= totalPages);
  return all;
}

function pickBrand(categories) {
  const cats = categories || [];
  for (const c of cats) if (BRAND[c.slug]) return { slug: c.slug, name: BRAND[c.slug] };
  for (const c of cats) if (!IGNORE.has(c.slug)) return { slug: c.slug, name: c.name }; // new brand
  return null;
}

function attrTerms(product, wanted) {
  // wanted: lowercased name (without "(mm)"); returns array of term names
  for (const a of (product.attributes || [])) {
    const nm = String(a.name || "").replace(/\(mm\)/i, "").trim().toLowerCase();
    if (nm === wanted) return (a.terms || []).map((t) => t.name);
  }
  return [];
}

function galleryFrom(product) {
  return (product.images || []).map((i) => i.src).filter(Boolean);
}

function tokenMatch(name, urls) {
  const toks = name.toLowerCase().replace(/\b\d+\s*-?\s*/g, " ").split(/[^a-z]+/).filter(Boolean);
  if (!toks.length) return null;
  for (const url of urls) {
    const u = decodeURIComponent(url).toLowerCase();
    if (toks.every((t) => u.includes(t))) return url;
  }
  return null;
}

// simple concurrency pool
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; } }
  }));
  return out;
}

async function galleryFromHTML(url) {
  try {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) return [];
    const html = await r.text();
    const urls = new Set();
    const re = /data-large_image="([^"]+)"/g; let m;
    while ((m = re.exec(html))) urls.add(m[1].replace(/&#0?38;|&amp;/g, "&"));
    if (!urls.size) {
      const re2 = /<a[^>]+href="(https?:\/\/[^"]+\/wp-content\/uploads\/[^"]+\.(?:jpg|jpeg|png|JPG))"/g;
      while ((m = re2.exec(html))) urls.add(m[1].replace(/&#0?38;|&amp;/g, "&"));
    }
    return [...urls];
  } catch { return []; }
}

function loadPrev(name) {
  try { return JSON.parse(fs.readFileSync(path.join(PUBLIC, name), "utf8")); } catch { return []; }
}

async function main() {
  const startedISO = new Date().toISOString();
  console.log("[sync] fetching Store API…");
  let raw;
  try { raw = await fetchAllProducts(); }
  catch (e) { console.error("[sync] ABORT — API unreachable, keeping previous catalog:", e.message); process.exit(1); }
  console.log(`[sync] ${raw.length} products from API`);

  const prevFrames = loadPrev("catalog.json");
  const prevCases = loadPrev("cases.json");
  const prevImg = {}; // slugKey -> { colorNameLower -> image }
  for (const p of [...prevFrames, ...prevCases]) {
    const key = String(p.sku).toLowerCase().replace(/\s+/g, "");
    prevImg[key] = Object.fromEntries((p.colors || []).map((c) => [c.name.toLowerCase(), c.image]));
  }

  const frames = [], cases = [];
  const needHTML = []; // products needing gallery fetch (new, multi-color)

  for (const p of raw) {
    if (p.is_in_stock !== true) continue;               // <-- availability gate
    const brand = pickBrand(p.categories);
    if (!brand) continue;
    const sku = String(p.name).trim();
    const key = sku.toLowerCase().replace(/\s+/g, "");
    const colorNames = attrTerms(p, "color");
    const names = colorNames.length ? colorNames : ["Default"];
    const featured = (p.images && p.images[0] && p.images[0].src) || "";
    const gallery = galleryFrom(p);

    const rec = { sku, name: sku, brand: brand.name, brand_slug: brand.slug,
      _names: names, _featured: featured, _gallery: gallery, _permalink: p.permalink, _key: key };

    if (brand.slug === "case") {
      cases.push(rec);
    } else {
      const eye = bEye(firstInt(attrTerms(p, "eye size")[0]));
      const bridge = bBridge(firstInt(attrTerms(p, "bridge size")[0]));
      const temple = bTemple(firstInt(attrTerms(p, "temple length")[0]));
      const attrs = {};
      const sh = trShape(attrTerms(p, "shape")[0]); if (sh) attrs.shape = sh;
      attrs.material = trMat(attrTerms(p, "material"));
      const g = trGender(attrTerms(p, "gender")[0]); if (g) attrs.gender = g;
      const ag = trAge(attrTerms(p, "age")[0]); if (ag) attrs.age = ag;
      if (eye) attrs.eye_size = eye;
      if (bridge) attrs.bridge_size = bridge;
      if (temple) attrs.temple_length = temple;
      rec._attributes = attrs;
      frames.push(rec);
    }
    // decide if a fresh gallery fetch is needed (new model with >1 color and no cached imgs)
    const cached = prevImg[key];
    const missing = names.some((n) => !(cached && cached[n.toLowerCase()]));
    if (missing && names.length > 1 && gallery.length < names.length) needHTML.push(rec);
  }

  console.log(`[sync] available: ${frames.length} frames, ${cases.length} cases · gallery fetch for ${needHTML.length} new models`);
  const galleries = await pool(needHTML, 6, async (rec) => ({ key: rec._key, imgs: await galleryFromHTML(rec._permalink) }));
  const htmlBy = Object.fromEntries(galleries.filter(Boolean).map((g) => [g.key, g.imgs]));

  const resolveColors = (rec) => {
    const cached = prevImg[rec._key] || {};
    const html = htmlBy[rec._key] || [];
    const cand = [...html, ...rec._gallery];
    return rec._names.map((name, i) => {
      let img = cached[name.toLowerCase()];
      if (!img) img = tokenMatch(name, cand);
      if (!img) img = html[i] || rec._gallery[i] || rec._featured;
      return { name, image: img || rec._featured };
    }).filter((c) => c.image);
  };

  const outFrames = frames.map((r) => ({ sku: r.sku, name: r.name, brand: r.brand, brand_slug: r.brand_slug,
    colors: resolveColors(r), attributes: r._attributes || {} })).filter((f) => f.colors.length);
  const outCases = cases.map((r) => { const colors = resolveColors(r); const o = { sku: r.sku, name: r.name, colors }; return o; }).filter((c) => c.colors.length);

  // diff vs previous
  const prevKeys = new Set(prevFrames.concat(prevCases).map((p) => String(p.sku).toLowerCase().replace(/\s+/g, "")));
  const nowKeys = new Set(outFrames.concat(outCases).map((p) => String(p.sku).toLowerCase().replace(/\s+/g, "")));
  const added = [...nowKeys].filter((k) => !prevKeys.has(k));
  const removed = [...prevKeys].filter((k) => !nowKeys.has(k));

  const perBrand = {};
  for (const f of outFrames) perBrand[f.brand_slug] = (perBrand[f.brand_slug] || 0) + 1;

  if (!outFrames.length) { console.error("[sync] ABORT — 0 frames resolved, keeping previous catalog"); process.exit(1); }

  fs.writeFileSync(path.join(PUBLIC, "catalog.json"), JSON.stringify(outFrames));
  fs.writeFileSync(path.join(PUBLIC, "cases.json"), JSON.stringify(outCases));
  fs.writeFileSync(path.join(PUBLIC, "catalog-meta.json"), JSON.stringify({
    lastSync: startedISO, seed: false, source: "woocommerce-store-api",
    totalFrames: outFrames.length, totalCases: outCases.length, perBrand,
    added, removed, addedCount: added.length, removedCount: removed.length,
  }, null, 2));

  // append daily history (for the admin "new / discontinued over time" view)
  const histPath = path.join(PUBLIC, "catalog-history.json");
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { hist = []; }
  if (!Array.isArray(hist)) hist = [];
  const dateKey = startedISO.slice(0, 10);
  hist = hist.filter((h) => h.date !== dateKey); // one entry per day (replace today)
  hist.push({ date: dateKey, totalFrames: outFrames.length, totalCases: outCases.length, added, removed });
  hist = hist.slice(-400);
  fs.writeFileSync(histPath, JSON.stringify(hist));

  console.log(`[sync] DONE ${startedISO}`);
  console.log(`[sync] frames=${outFrames.length} cases=${outCases.length} added=${added.length} removed=${removed.length}`);
  if (added.length) console.log("[sync] + " + added.slice(0, 30).join(", ") + (added.length > 30 ? " …" : ""));
  if (removed.length) console.log("[sync] - " + removed.slice(0, 30).join(", ") + (removed.length > 30 ? " …" : ""));
}

main().catch((e) => { console.error("[sync] FATAL", e); process.exit(1); });
