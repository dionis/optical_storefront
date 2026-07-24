/**
 * Seed script: populate lens options and coating options with defaults.
 * Run with: medusa exec src/scripts/seed.ts
 * Safe to re-run (idempotent).
 */

import type { CoatingType, UsageType } from "@eyewear/shared";
import { LENS_CONFIG_MODULE } from "../modules/lens-config/index";
import type LensConfigModuleService from "../modules/lens-config/service";

interface LensOptionSeed {
  usage_type: UsageType;
  index: number;
  label: string;
  price_modifier_cents: number;
}

interface CoatingOptionSeed {
  type: CoatingType;
  label: string;
  description: string;
  price_modifier_cents: number;
  compatible_usage_types: UsageType[];
}

export default async function seed({
  container,
}: {
  container: { resolve: <T>(id: string) => T };
}): Promise<void> {
  const lensService = container.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);

  // ── Lens index options ──────────────────────────────────────────
  const lensOptions: LensOptionSeed[] = [
    // Single vision distance
    { usage_type: "single_vision_distance", index: 1.57, label: "Estándar (1.57)", price_modifier_cents: 0 },
    { usage_type: "single_vision_distance", index: 1.61, label: "Delgado (1.61)", price_modifier_cents: 2000 },
    { usage_type: "single_vision_distance", index: 1.67, label: "Muy delgado (1.67)", price_modifier_cents: 4000 },
    { usage_type: "single_vision_distance", index: 1.74, label: "Ultra delgado (1.74)", price_modifier_cents: 7000 },
    // Single vision reading
    { usage_type: "single_vision_reading", index: 1.57, label: "Estándar (1.57)", price_modifier_cents: 0 },
    { usage_type: "single_vision_reading", index: 1.61, label: "Delgado (1.61)", price_modifier_cents: 2000 },
    { usage_type: "single_vision_reading", index: 1.67, label: "Muy delgado (1.67)", price_modifier_cents: 4000 },
    // Progressive
    { usage_type: "progressive", index: 1.57, label: "Progresivo estándar (1.57)", price_modifier_cents: 8000 },
    { usage_type: "progressive", index: 1.61, label: "Progresivo delgado (1.61)", price_modifier_cents: 10000 },
    { usage_type: "progressive", index: 1.67, label: "Progresivo muy delgado (1.67)", price_modifier_cents: 13000 },
    { usage_type: "progressive", index: 1.74, label: "Progresivo ultra delgado (1.74)", price_modifier_cents: 17000 },
    // Non-prescription
    { usage_type: "non_prescription", index: 1.57, label: "Sin graduar (plano)", price_modifier_cents: 0 },
  ];

  for (const opt of lensOptions) {
    const existing = await lensService.listLensOptions({
      filters: { usage_type: opt.usage_type, index: opt.index },
    });
    if (existing.length === 0) {
      await lensService.createLensOptions(opt);
      console.log(`[seed] Created lens option: ${opt.label}`);
    }
  }

  // ── Coating options ─────────────────────────────────────────────
  const coatings: CoatingOptionSeed[] = [
    {
      type: "anti_reflective",
      label: "Antirreflejante",
      description: "Elimina reflejos para mayor comodidad visual.",
      price_modifier_cents: 1500,
      compatible_usage_types: [],
    },
    {
      type: "blue_light",
      label: "Filtro de luz azul",
      description: "Reduce la fatiga visual frente a pantallas.",
      price_modifier_cents: 2000,
      compatible_usage_types: [],
    },
    {
      type: "photochromic",
      label: "Fotocromático (se oscurece al sol)",
      description: "Se adapta automáticamente a la luz exterior.",
      price_modifier_cents: 5000,
      compatible_usage_types: ["single_vision_distance", "single_vision_reading", "progressive"],
    },
    {
      type: "polarized",
      label: "Polarizado",
      description: "Elimina el deslumbramiento. Ideal para conducir y actividades al aire libre.",
      price_modifier_cents: 4000,
      compatible_usage_types: ["non_prescription", "single_vision_distance"],
    },
    {
      type: "tint",
      label: "Tinte de color",
      description: "Tinte estético en el color que prefieras.",
      price_modifier_cents: 1500,
      compatible_usage_types: [],
    },
  ];

  for (const coating of coatings) {
    const existing = await lensService.listCoatingOptions({
      filters: { type: coating.type },
    });
    if (existing.length === 0) {
      await lensService.createCoatingOptions(coating);
      console.log(`[seed] Created coating: ${coating.label}`);
    }
  }

  console.log("[seed] Done.");
}
