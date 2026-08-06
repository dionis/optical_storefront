/**
 * Seed the 2026 lens price list ("matriz") — Óptica El Rancho.
 * Run with: medusa exec src/scripts/seed-lens-2026.ts
 *
 * Writes via the shared Postgres connection (Knex), mirroring the store routes
 * (/store/lens-config/matrix and /quote), so it is independent of the lens-config
 * module's ORM manager lifecycle. Re-running replaces the 5 matrix tables.
 *
 * All amounts are USD cents (integers) to keep the price-list columns explicit.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";

const DESIGNS = [
  { code: "sv", category: "sv", requires_rx: true, requires_add: false, label_es: "Visión Sencilla", label_en: "Single Vision", sort: 0 },
  { code: "bifocal", category: "bifocal", requires_rx: true, requires_add: true, label_es: "Bifocal FT-28", label_en: "Bifocal FT-28", sort: 1 },
  { code: "prog-mid", category: "prog", requires_rx: true, requires_add: true, label_es: "Progresivo Gama Media", label_en: "Progressive · Mid", sort: 2 },
  { code: "prog-high", category: "prog", requires_rx: true, requires_add: true, label_es: "Progresivo Gama Alta", label_en: "Progressive · Premium", sort: 3 },
];

const MATERIALS = [
  { code: "cr39", max_abs: 2, label_es: "CR-39 (Resina)", label_en: "CR-39 (Resin)", desc_es: "Estándar, económico.", desc_en: "Standard, budget.", sort: 0 },
  { code: "poly", max_abs: 3, label_es: "Policarbonato", label_en: "Polycarbonate", desc_es: "Resistente a impactos. Niños/deporte.", desc_en: "Impact-resistant. Kids/sport.", sort: 1 },
  { code: "1.67", max_abs: 6, label_es: "Índice 1.67", label_en: "Index 1.67", desc_es: "Muy delgado.", desc_en: "Very thin.", sort: 4 },
  { code: "1.74", max_abs: 99, label_es: "Índice 1.74", label_en: "Index 1.74", desc_es: "Ultra delgado. Alta graduación.", desc_en: "Ultra-thin. High Rx.", sort: 5 },
];

// BASE[design][material] in USD → cents.
const BASE_USD: Record<string, Record<string, number>> = {
  "sv": { cr39: 24, poly: 30, "1.67": 52, "1.74": 95 },
  "bifocal": { cr39: 47, poly: 55, "1.67": 160, "1.74": 180 },
  "prog-mid": { cr39: 75, poly: 75, "1.67": 131, "1.74": 145 },
  "prog-high": { cr39: 101, poly: 101, "1.67": 135, "1.74": 135 },
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
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

  // Clean re-seed (nothing references these tables yet).
  await pg("lens_base_price").del();
  await pg("lens_design").del();
  await pg("lens_material").del();
  await pg("lens_photo_option").del();
  await pg("lens_ar_option").del();

  await pg("lens_design").insert(DESIGNS);
  await pg("lens_material").insert(MATERIALS);

  const basePrices: { design_code: string; material_code: string; price_cents: number }[] = [];
  for (const design of Object.keys(BASE_USD)) {
    for (const material of Object.keys(BASE_USD[design])) {
      basePrices.push({ design_code: design, material_code: material, price_cents: BASE_USD[design][material] * 100 });
    }
  }
  await pg("lens_base_price").insert(basePrices);
  await pg("lens_photo_option").insert(PHOTOS);
  await pg("lens_ar_option").insert(ARS);

  console.log(
    `[seed] 2026 matrix: ${DESIGNS.length} designs, ${MATERIALS.length} materials, ` +
    `${basePrices.length} base prices, ${PHOTOS.length} photos, ${ARS.length} AR options.`
  );
}
