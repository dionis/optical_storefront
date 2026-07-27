/**
 * Seed the 2026 lens price list ("matriz") — Óptica El Rancho.
 * Run with: medusa exec src/scripts/seed-lens-2026.ts
 * Idempotent: creates rows only when their unique code (or design/material cell)
 * is missing, so it is safe to re-run.
 *
 * All amounts are USD cents (integers) to match Medusa product prices.
 */
import { LENS_CONFIG_MODULE } from "../modules/lens-config/index";
import type LensConfigModuleService from "../modules/lens-config/service";

const DESIGNS = [
  { code: "sv", category: "sv", requires_rx: true, requires_add: false, label_es: "Visión Sencilla", label_en: "Single Vision", sort: 0 },
  { code: "bifocal", category: "bifocal", requires_rx: true, requires_add: true, label_es: "Bifocal FT-28", label_en: "Bifocal FT-28", sort: 1 },
  { code: "prog-mid", category: "prog", requires_rx: true, requires_add: true, label_es: "Progresivo Gama Media", label_en: "Progressive · Mid", sort: 2 },
  { code: "prog-high", category: "prog", requires_rx: true, requires_add: true, label_es: "Progresivo Gama Alta", label_en: "Progressive · Premium", sort: 3 },
];

const MATERIALS = [
  { code: "cr39", max_abs: 2, label_es: "CR-39 (Resina)", label_en: "CR-39 (Resin)", desc_es: "Estándar, económico.", desc_en: "Standard, budget.", sort: 0 },
  { code: "poly", max_abs: 3, label_es: "Policarbonato", label_en: "Polycarbonate", desc_es: "Resistente a impactos. Niños/deporte.", desc_en: "Impact-resistant. Kids/sport.", sort: 1 },
  { code: "1.56", max_abs: 3, label_es: "Índice 1.56", label_en: "Index 1.56", desc_es: "Más delgado que CR-39.", desc_en: "Thinner than CR-39.", sort: 2 },
  { code: "1.61", max_abs: 4, label_es: "Índice 1.61", label_en: "Index 1.61", desc_es: "Delgado.", desc_en: "Thin.", sort: 3 },
  { code: "1.67", max_abs: 6, label_es: "Índice 1.67", label_en: "Index 1.67", desc_es: "Muy delgado.", desc_en: "Very thin.", sort: 4 },
  { code: "1.74", max_abs: 99, label_es: "Índice 1.74", label_en: "Index 1.74", desc_es: "Ultra delgado. Alta graduación.", desc_en: "Ultra-thin. High Rx.", sort: 5 },
];

// BASE[design][material] in USD → cents.
const BASE_USD: Record<string, Record<string, number>> = {
  "sv": { cr39: 60, poly: 90, "1.56": 100, "1.61": 100, "1.67": 120, "1.74": 150 },
  "bifocal": { cr39: 130, poly: 140, "1.56": 140, "1.61": 140, "1.67": 160, "1.74": 160 },
  "prog-mid": { cr39: 180, poly: 180, "1.56": 180, "1.61": 180, "1.67": 200, "1.74": 230 },
  "prog-high": { cr39: 240, poly: 240, "1.56": 240, "1.61": 240, "1.67": 280, "1.74": 300 },
};

const c = (usd: number | null): number | null => (usd == null ? null : usd * 100);

const PHOTOS = [
  { code: "photo-grey", label_es: "Fotocromático Grey", label_en: "Photochromic Grey", colors: ["grey"], price_sv_cents: c(85), price_bifocal_cents: c(110), price_prog_cents: c(90), sort: 0 },
  { code: "photo-brown", label_es: "Fotocromático Brown", label_en: "Photochromic Brown", colors: ["brown"], price_sv_cents: c(null), price_bifocal_cents: c(110), price_prog_cents: c(90), sort: 1 },
  { code: "trans-s-grey", label_es: "Transitions Gen S Grey", label_en: "Transitions Gen S Grey", colors: ["grey"], price_sv_cents: c(105), price_bifocal_cents: c(105), price_prog_cents: c(105), sort: 2 },
  { code: "trans-s-brown", label_es: "Transitions Gen S Brown", label_en: "Transitions Gen S Brown", colors: ["brown"], price_sv_cents: c(105), price_bifocal_cents: c(105), price_prog_cents: c(105), sort: 3 },
  { code: "trans-s-green", label_es: "Transitions Gen S Graphite Green", label_en: "Transitions Gen S Graphite Green", colors: ["green"], price_sv_cents: c(105), price_bifocal_cents: c(105), price_prog_cents: c(105), sort: 4 },
  { code: "trans-x-grey", label_es: "Transitions Xtractive Grey", label_en: "Transitions Xtractive Grey", colors: ["grey"], price_sv_cents: c(130), price_bifocal_cents: c(130), price_prog_cents: c(130), sort: 5 },
  { code: "trans-x-brown", label_es: "Transitions Xtractive Brown (RAM)", label_en: "Transitions Xtractive Brown (RAM)", colors: ["brown"], price_sv_cents: c(130), price_bifocal_cents: c(130), price_prog_cents: c(130), sort: 6 },
];

const ARS = [
  { code: "ar-green-basic", ar_group: "sv", label_es: "AR Green Básico", label_en: "AR Green Basic", price_cents: 60 * 100, sort: 0 },
  { code: "ar-green-plus", ar_group: "sv", label_es: "AR Green Plus", label_en: "AR Green Plus", price_cents: 90 * 100, sort: 1 },
  { code: "ar-blue-protect", ar_group: "sv", label_es: "AR Blue Protect", label_en: "AR Blue Protect", price_cents: 90 * 100, sort: 2 },
  { code: "adequate", ar_group: "bifprog", label_es: "Adequate", label_en: "Adequate", price_cents: 50 * 100, sort: 3 },
  { code: "crystal", ar_group: "bifprog", label_es: "Crystal", label_en: "Crystal", price_cents: 80 * 100, sort: 4 },
  { code: "flawless", ar_group: "bifprog", label_es: "Flawless", label_en: "Flawless", price_cents: 120 * 100, sort: 5 },
  { code: "blue-uv-445", ar_group: "bifprog", label_es: "Blue UV 445", label_en: "Blue UV 445", price_cents: 120 * 100, sort: 6 },
];

export default async function seedLens2026({
  container,
}: {
  container: { resolve: <T>(id: string) => T };
}): Promise<void> {
  const svc = container.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);

  for (const d of DESIGNS) {
    const existing = await svc.listLensDesigns({ code: d.code });
    if (!existing.length) { await svc.createLensDesigns(d); console.log(`[seed] design ${d.code}`); }
  }
  for (const m of MATERIALS) {
    const existing = await svc.listLensMaterials({ code: m.code });
    if (!existing.length) { await svc.createLensMaterials(m); console.log(`[seed] material ${m.code}`); }
  }
  for (const design of Object.keys(BASE_USD)) {
    for (const material of Object.keys(BASE_USD[design])) {
      const existing = await svc.listLensBasePrices({ design_code: design, material_code: material });
      if (!existing.length) {
        await svc.createLensBasePrices({ design_code: design, material_code: material, price_cents: BASE_USD[design][material] * 100 });
      }
    }
  }
  for (const p of PHOTOS) {
    const existing = await svc.listLensPhotoOptions({ code: p.code });
    if (!existing.length) { await svc.createLensPhotoOptions(p); console.log(`[seed] photo ${p.code}`); }
  }
  for (const a of ARS) {
    const existing = await svc.listLensArOptions({ code: a.code });
    if (!existing.length) { await svc.createLensArOptions(a); console.log(`[seed] ar ${a.code}`); }
  }

  console.log("[seed] 2026 lens matrix ready.");
}
