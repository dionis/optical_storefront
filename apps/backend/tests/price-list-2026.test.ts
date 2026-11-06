import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AR_OPTIONS,
  DESIGNS,
  MATERIALS,
  MATERIAL_CODES,
  PHOTO_OPTIONS,
  cents,
  sqlArray,
  sqlText,
} from "../src/modules/lens-config/price-list-2026";

/**
 * The owner's printed list ("LISTA DE PRECIOS PROFESIONAL 2026" + the progressive
 * power map) written out by hand. If someone edits price-list-2026.ts, these
 * numbers are what the store actually charges at the counter, so they must be
 * changed here too — deliberately, never by accident.
 */
const BASE_LIST: Record<string, [number, number, number, number, number, number]> = {
  //                 cr39  poly  1.56  1.61  1.67  1.74
  sv: /*         */ [60, 90, 100, 100, 120, 150],
  // "Bifocal FT-28" became "Tallado" + "De stock" (Nov 2026); both start at its price.
  tallado: /*    */ [130, 140, 140, 140, 160, 160],
  stock: /*      */ [130, 140, 140, 140, 160, 160],
  "prog-mid": /* */ [180, 180, 180, 180, 200, 230],
  "prog-high": /**/ [240, 240, 240, 240, 280, 300],
};

/** "Desde" price of each named digital progressive, and its step class. */
const NAMED: Record<string, { from: number; cls: "mid" | "high"; tier: string }> = {
  "purity-basic": { from: 160, cls: "mid", tier: "Básico" },
  "purity-plus": { from: 180, cls: "mid", tier: "Intermedio" },
  "dvg-distinct": { from: 240, cls: "high", tier: "Avanzado" },
  "dvg-drive": { from: 250, cls: "high", tier: "Avanzado" },
  "purity-office": { from: 200, cls: "high", tier: "Premium" },
  "dvg-cubicle": { from: 210, cls: "high", tier: "Premium" },
  "dvg-aqueous": { from: 260, cls: "high", tier: "Premium superior" },
  "dvg-maverick": { from: 280, cls: "high", tier: "Premium superior" },
  "dvg-camber": { from: 300, cls: "high", tier: "Elite" },
};

/** Photochromic / Transitions add-on: [single vision, bifocal, progressive]. */
const PHOTO_LIST: Record<string, [number | null, number, number]> = {
  "photo-grey": [85, 110, 90],
  "photo-brown": [null, 110, 90], // not offered for single vision
  "trans-s-grey": [105, 105, 105],
  "trans-s-brown": [105, 105, 105],
  "trans-s-green": [105, 105, 105],
  "trans-x-grey": [130, 130, 130],
  "trans-x-brown": [130, 130, 130],
};

const AR_LIST: Record<string, { group: "sv" | "bifprog"; price: number }> = {
  "ar-green-basic": { group: "sv", price: 60 },
  "ar-green-plus": { group: "sv", price: 90 },
  "ar-blue-protect": { group: "sv", price: 90 },
  adequate: { group: "bifprog", price: 50 },
  crystal: { group: "bifprog", price: 80 },
  flawless: { group: "bifprog", price: 120 },
  "blue-uv-445": { group: "bifprog", price: 120 },
};

const byCode = <T extends { code: string }>(rows: T[], code: string): T => {
  const row = rows.find((r) => r.code === code);
  if (!row) throw new Error(`missing ${code}`);
  return row;
};

describe("2026 price list — base matrix", () => {
  it("has the six material columns of the printed list, in order", () => {
    expect(MATERIALS.map((m) => m.code)).toEqual(["cr39", "poly", "1.56", "1.61", "1.67", "1.74"]);
  });

  it.each(Object.entries(BASE_LIST))("%s charges the printed price in every material", (code, row) => {
    const design = byCode(DESIGNS, code);
    expect(MATERIAL_CODES.map((m) => design.prices[m])).toEqual(row);
  });

  it.each(Object.entries(NAMED))("%s starts at its 'desde' price and steps on the thin indexes", (code, spec) => {
    const design = byCode(DESIGNS, code);
    const step = spec.cls === "high" ? [40, 90] : [20, 50];
    expect(design.tier).toBe(spec.tier);
    expect(design.category).toBe("prog");
    expect(design.requires_add).toBe(true);
    expect(MATERIAL_CODES.map((m) => design.prices[m])).toEqual([
      spec.from, spec.from, spec.from, spec.from, spec.from + step[0], spec.from + step[1],
    ]);
  });

  it("prices every design in every material, with no design missing a cell", () => {
    for (const d of DESIGNS) {
      for (const m of MATERIAL_CODES) {
        expect(typeof d.prices[m]).toBe("number");
        expect(d.prices[m]).toBeGreaterThan(0);
      }
    }
  });

  it("gives every design a unique code", () => {
    expect(new Set(DESIGNS.map((d) => d.code)).size).toBe(DESIGNS.length);
  });
});

describe("2026 price list — add-ons", () => {
  it.each(Object.entries(PHOTO_LIST))("%s costs the printed amount per category", (code, [sv, bifocal, prog]) => {
    const row = byCode(PHOTO_OPTIONS, code);
    expect([row.sv, row.bifocal, row.prog]).toEqual([sv, bifocal, prog]);
  });

  it("offers photochromic brown only for bifocals and progressives", () => {
    expect(byCode(PHOTO_OPTIONS, "photo-brown").sv).toBeNull();
  });

  it.each(Object.entries(AR_LIST))("%s is priced for its design group", (code, spec) => {
    const row = byCode(AR_OPTIONS, code);
    expect(row.ar_group).toBe(spec.group);
    expect(row.price).toBe(spec.price);
  });

  it("offers three antireflectives for single vision and four for bifocals/progressives", () => {
    expect(AR_OPTIONS.filter((a) => a.ar_group === "sv")).toHaveLength(3);
    expect(AR_OPTIONS.filter((a) => a.ar_group === "bifprog")).toHaveLength(4);
  });
});

describe("2026 price list — seed helpers", () => {
  it("turns dollars into integer cents and keeps 'not offered' as null", () => {
    expect(cents(85)).toBe(8500);
    expect(cents(0.1)).toBe(10);
    expect(cents(null)).toBeNull();
  });

  it("escapes quotes so a label cannot break the seed SQL", () => {
    expect(sqlText("Lente d'agua")).toBe("'Lente d''agua'");
    expect(sqlText(null)).toBe("NULL");
  });

  it("writes a Postgres text array for the colour swatches", () => {
    expect(sqlArray(["grey", "brown"])).toBe("'{grey,brown}'");
    expect(sqlArray([])).toBe("'{}'");
  });
});

describe("storefront fallback (capri-storefront src/data/lensPricing.js)", () => {
  // The storefront quotes from its bundled copy until /store/lens-config/matrix
  // answers, so a mismatch shows the customer a price the backend will not honour.
  const file = readFileSync(
    join(__dirname, "..", "..", "capri-storefront", "src", "data", "lensPricing.js"),
    "utf8",
  );

  it.each(Object.entries(BASE_LIST))("quotes %s like the backend", (code, row) => {
    const line = new RegExp(`"?${code.replace(/[.]/g, "\\.")}"?:\\s*\\{([^}]*)\\}`).exec(file);
    expect(line).not.toBeNull();
    const cell = (m: string) => {
      const hit = new RegExp(`"?${m.replace(/[.]/g, "\\.")}"?:\\s*(\\d+)`).exec(line![1]);
      return hit ? Number(hit[1]) : null;
    };
    expect(MATERIAL_CODES.map(cell)).toEqual(row);
  });

  it("carries the 2026 antireflectives and not the retired ones", () => {
    for (const code of Object.keys(AR_LIST)) expect(file).toContain(`id: "${code}"`);
    expect(file).not.toContain('id: "ar-green"');
    expect(file).not.toContain('id: "ar-blue"');
  });

  it("lists the same designs as the backend", () => {
    for (const d of DESIGNS) expect(file).toContain(`id: "${d.code}"`);
    // The retired bifocal row must not come back through the bundled fallback.
    expect(file).not.toContain('id: "bifocal"');
  });
});
