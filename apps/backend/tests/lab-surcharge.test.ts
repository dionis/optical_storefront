import { DEFAULT_LAB_SURCHARGES, normalizeSurcharges, surchargeFor, surchargesDenied } from "../src/lib/lab-surcharge";
import { ledgerOf, statementOf, type LedgerInput } from "../src/lib/financial-statement";

/** Lab surcharges for high powers (owner, 18-nov-2026: > +6.00 sphere → lab cost +$30). */
const on = (ids: string[]) => DEFAULT_LAB_SURCHARGES.map((r) => ({ ...r, active: ids.includes(r.id) }));

describe("lab surcharges", () => {
  it("> +6.00 on either eye pays $30; +6.00 exactly does not", () => {
    const rules = on(["plus-6"]);
    expect(surchargeFor({ od: { sph: 6.25 }, os: { sph: 2 } }, rules).cents).toBe(3000);
    expect(surchargeFor({ od: { sph: 2 }, os: { sph: 6.5 } }, rules).cents).toBe(3000);
    expect(surchargeFor({ od: { sph: 6 }, os: { sph: 6 } }, rules).cents).toBe(0);
    expect(surchargeFor({ od: { sph: -2.5 }, os: { sph: -2.5 } }, rules).cents).toBe(0);
  });
  it("tiers: only the furthest step of one power and direction; different powers add up", () => {
    const rules = on(["plus-6", "plus-8", "cyl-4", "minus-6", "minus-10"]);
    expect(surchargeFor({ od: { sph: 8.5 } }, rules)).toMatchObject({ cents: 4500, applied: [{ id: "plus-8" }] });
    expect(surchargeFor({ od: { sph: 7, cyl: -4.5 } }, rules).cents).toBe(3000 + 2500);
    expect(surchargeFor({ os: { sph: -11 } }, rules)).toMatchObject({ cents: 4000, applied: [{ id: "minus-10" }] });
    expect(surchargeFor({ os: { sph: -8 } }, rules).cents).toBe(2000);
    expect(surchargeFor({ od: { cyl: 4.5 } }, rules).cents).toBe(2500); // plus-cylinder notation, same cylinder
  });
  it("switched off or zero cost = nothing; validation of the owner's list", () => {
    expect(surchargeFor({ od: { sph: 9 } }, on([])).cents).toBe(0);
    expect(surchargesDenied(DEFAULT_LAB_SURCHARGES)).toBeNull();
    expect(surchargesDenied([{ ...DEFAULT_LAB_SURCHARGES[0], scope: "cyl", op: "lt", threshold: 2 }])).toBe("bad_surcharges");
    expect(surchargesDenied([DEFAULT_LAB_SURCHARGES[0], DEFAULT_LAB_SURCHARGES[0]])).toBe("bad_surcharges");
    expect(surchargesDenied([{ ...DEFAULT_LAB_SURCHARGES[0], cost: -1 }])).toBe("bad_surcharges");
    expect(normalizeSurcharges(null).find((r) => r.id === "plus-6")).toMatchObject({ active: true, cost: 30, threshold: 6 });
  });
  it("is part of the lenses' cost in the books", () => {
    const fact = { order_id: "o1", channel: "pos", establishment_id: "est_1", seller_id: null, seller_code: null, product_id: null, sku: null, qty: 1, total_cents: 30000, tax_cents: 0, lens_design: "sv", lens_material: null, lens_photo: null, lens_ar: null, lens_finish: null, sold_date_local: "2026-11-10", lab_surcharge_cents: 3000 };
    const input: LedgerInput = { months: ["2026-11"], facts: [fact], pays: [], rules: [], items: [], brandOf: () => null, pctOf: () => null, storeIds: ["est_1"], activeStoreIds: ["est_1"], tz: "UTC", web: false };
    const e = ledgerOf(input)[0].entities.get("est_1")!;
    expect(e.cogs.lenses).toBe(3000);
    expect(e.cogs_lines?.lab_surcharge?.cents).toBe(3000);
    expect(statementOf([e]).cogs.total).toBe(3000);
  });
});
