#!/usr/bin/env node
// Análisis de deduplicación de geometrías para el probador 3D.
//
// La malla de una montura depende SÓLO de sus medidas y su forma, no del SKU:
// dos referencias con el mismo calibre, puente, varilla, forma y familia de
// material producen exactamente el mismo modelo, y el color es únicamente
// material (KHR_materials_variants). Este script mide cuántas geometrías
// ÚNICAS hay de verdad en el catálogo, que es el número que decide si hace
// falta un servicio de generación bajo demanda o basta un job de CI.
//
//   node scripts/geometry-dedup.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = resolve(HERE, "../public/catalog.json");

// Estimaciones para dimensionar el coste (ver informe al final).
const KB_PER_GEOMETRY = 100;      // glb con Draco
const SECONDS_PARAMETRIC = 0.5;   // generar + exportar + comprimir
const SECONDS_BAKED = 30;         // idem + horneado de AO/normales en Blender

// — mismas reglas que src/components/tryon/frameGeometry.js —
function parseMm(value) {
  const nums = String(value ?? "").match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  const avg = nums.reduce((a, n) => a + parseFloat(n), 0) / nums.length;
  return Math.round(avg * 2) / 2;               // a 0,5 mm
}
function materialClass(attrs) {
  const mats = (attrs?.material || []).map((m) => String(m).toLowerCase());
  if (!mats.length) return "desconocido";
  return mats.some((m) => /metal|acero|titanio|memoria/.test(m)) ? "metal" : "acetato";
}
function normShape(attrs) {
  return String(attrs?.shape || "sin-forma").toLowerCase().trim();
}

// Tres niveles de agresividad al agrupar.
const LEVELS = {
  A: {
    label: "A · estricto (calibre + puente + varilla + forma + material)",
    key: (a) => [parseMm(a.eye_size), parseMm(a.bridge_size), parseMm(a.temple_length),
                 normShape(a), materialClass(a)].join("|"),
  },
  B: {
    label: "B · sin longitud de varilla (queda casi siempre ocluida)",
    key: (a) => [parseMm(a.eye_size), parseMm(a.bridge_size),
                 normShape(a), materialClass(a)].join("|"),
  },
  C: {
    label: "C · medidas redondeadas a 2 mm + forma + material",
    key: (a) => {
      const r = (v) => { const n = parseMm(v); return n == null ? null : Math.round(n / 2) * 2; };
      return [r(a.eye_size), r(a.bridge_size), normShape(a), materialClass(a)].join("|");
    },
  },
};

function loadCatalog() {
  const raw = JSON.parse(readFileSync(CATALOG, "utf8"));
  const arr = Array.isArray(raw) ? raw : (raw.products || raw.frames || []);
  return arr.filter((p) => p && p.sku);
}

function analyse(products, level) {
  const groups = new Map();
  for (const p of products) {
    const a = p.attributes || {};
    const k = level.key(a);
    if (!groups.has(k)) groups.set(k, { skus: [], variants: 0 });
    const g = groups.get(k);
    g.skus.push(p.sku);
    g.variants += (p.colors?.length || 1);
  }
  return groups;
}

// Cuántas geometrías hacen falta para cubrir el X% de los SKUs.
function coverage(sorted, totalSkus, pct) {
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i][1].skus.length;
    if (acc / totalSkus >= pct) return i + 1;
  }
  return sorted.length;
}

const products = loadCatalog();
const totalSkus = products.length;
const totalVariants = products.reduce((n, p) => n + (p.colors?.length || 1), 0);

// Integridad de los datos: sin medidas no hay geometría paramétrica posible.
const incomplete = products.filter((p) => {
  const a = p.attributes || {};
  return parseMm(a.eye_size) == null || parseMm(a.bridge_size) == null;
});

console.log("═".repeat(72));
console.log("  DEDUPLICACIÓN DE GEOMETRÍAS · catálogo del probador 3D");
console.log("═".repeat(72));
console.log(`  SKUs (modelos)            : ${totalSkus}`);
console.log(`  Variantes (SKU × color)   : ${totalVariants}`);
console.log(`  Sin medidas utilizables   : ${incomplete.length}` +
            (incomplete.length ? `  → ${incomplete.slice(0, 6).map((p) => p.sku).join(", ")}${incomplete.length > 6 ? "…" : ""}` : ""));
console.log();

const results = {};
for (const [id, level] of Object.entries(LEVELS)) {
  const groups = analyse(products, level);
  const sorted = [...groups.entries()].sort((x, y) => y[1].skus.length - x[1].skus.length);
  const singletons = sorted.filter(([, g]) => g.skus.length === 1).length;
  results[id] = { groups, sorted, singletons };

  console.log("─".repeat(72));
  console.log(`  ${level.label}`);
  console.log("─".repeat(72));
  console.log(`    geometrías únicas       : ${groups.size}`);
  console.log(`    reducción vs variantes  : ${(totalVariants / groups.size).toFixed(1)}×`);
  console.log(`    geometrías de un solo SKU: ${singletons} (${(singletons / groups.size * 100).toFixed(0)}%)`);
  console.log(`    cubren el 50% de SKUs   : ${coverage(sorted, totalSkus, 0.5)} geometrías`);
  console.log(`    cubren el 80% de SKUs   : ${coverage(sorted, totalSkus, 0.8)} geometrías`);
  console.log(`    cubren el 95% de SKUs   : ${coverage(sorted, totalSkus, 0.95)} geometrías`);
  const mb = (groups.size * KB_PER_GEOMETRY) / 1024;
  const secP = groups.size * SECONDS_PARAMETRIC;
  const secB = groups.size * SECONDS_BAKED;
  console.log(`    almacenamiento estimado : ${mb.toFixed(1)} MB`);
  console.log(`    generar todo (paramétrico): ${secP < 90 ? secP.toFixed(0) + " s" : (secP / 60).toFixed(1) + " min"}`);
  console.log(`    generar todo (con horneado): ${(secB / 3600).toFixed(1)} h`);
  console.log();
}

// Detalle del nivel estricto: es el que se usaría en producción.
console.log("─".repeat(72));
console.log("  Top 15 geometrías más compartidas (nivel A)");
console.log("─".repeat(72));
console.log("    calibre puente varilla forma / material          SKUs  ejemplos");
for (const [key, g] of results.A.sorted.slice(0, 15)) {
  const [eye, bridge, temple, shape, mat] = key.split("|");
  const desc = `${String(eye).padStart(5)} ${String(bridge).padStart(6)} ${String(temple).padStart(7)}  ${shape}/${mat}`;
  console.log(`    ${desc.padEnd(46)}${String(g.skus.length).padStart(4)}  ${g.skus.slice(0, 3).join(", ")}`);
}
console.log();

console.log("─".repeat(72));
console.log("  Reparto por forma y material (nivel A)");
console.log("─".repeat(72));
const byShape = new Map();
for (const [key, g] of results.A.groups) {
  const shape = key.split("|")[3];
  if (!byShape.has(shape)) byShape.set(shape, { geoms: 0, skus: 0 });
  const e = byShape.get(shape);
  e.geoms++; e.skus += g.skus.length;
}
for (const [shape, e] of [...byShape.entries()].sort((a, b) => b[1].skus - a[1].skus)) {
  console.log(`    ${shape.padEnd(24)} ${String(e.geoms).padStart(4)} geometrías  ${String(e.skus).padStart(4)} SKUs`);
}
console.log();

console.log("═".repeat(72));
const gA = results.A.groups.size;
console.log(`  VEREDICTO: ${totalVariants} variantes → ${gA} geometrías únicas`);
console.log(`  Generarlas todas en paramétrico cuesta ~${(gA * SECONDS_PARAMETRIC / 60).toFixed(1)} min y ~${(gA * KB_PER_GEOMETRY / 1024).toFixed(0)} MB.`);
console.log(gA * SECONDS_PARAMETRIC < 600
  ? "  → Cabe en un job de CI. Un servicio bajo demanda no se justifica todavía."
  : "  → Suficientemente caro como para plantear generación bajo demanda.");
console.log("═".repeat(72));
