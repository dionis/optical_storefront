/**
 * Cost sheet math and rule validation. Pure functions only.
 */
import {
  COST_KINDS,
  CostRuleError,
  FALLBACK_LENS_CATALOG,
  KNOWN_BRANDS,
  LINE_KIND_LABEL,
  PROFIT_TARGET_KEY,
  computeCostSheet,
  conceptKey,
  condenseLines,
  costBreakdownText,
  dayKey,
  defaultCostRules,
  lineKind,
  normalizeMatchKey,
  orderBrands,
  profitTargetFor,
  profitTargetPct,
  summarizeCostSheets,
  undefinedCostCount,
  validateCostRules,
  type CostLine,
  type CostRule,
  type CostSheet,
} from "../src/lib/costing";

const rule = (kind: CostRule["kind"], match_key: string, amount: number, unit: CostRule["unit"] = "fixed", over: Partial<CostRule> = {}): CostRule => ({
  id: `r_${kind}_${match_key}`,
  kind,
  match_key,
  label: `${kind} ${match_key}`,
  amount,
  unit,
  active: true,
  sort_order: 0,
  ...over,
});

const RULES: CostRule[] = [
  rule("frame_brand", "flexure", 18),
  rule("frame_brand", "case", 2),
  rule("frame_sku", "FX2043-BLK", 22),
  rule("lens_design", "sv", 6),
  rule("lens_material", "poly", 4),
  rule("lens_ar", "ar-green", 3),
  rule("order_fixed", "lab", 12),
  rule("order_fixed", "packaging", 1.5),
  rule("shipping", "actual", 0),
  rule("order_percent", "payment_fee", 2.9, "percent"),
  rule("payment_fixed", "payment_fee_fixed", 0.3),
  rule("lens_photo", "photo-grey", 99, "fixed", { active: false }),
];

const ORDER = {
  total: 210,
  shipping_total: 10,
  paid: true,
  items: [
    { title: "Flexure 2043", quantity: 1, sku: "FX2043-BLK", brand_slug: "flexure", lens: { design_code: "sv", material_code: "poly", photo_code: "photo-grey", ar_code: "ar-green" } },
    { title: "Estuche", quantity: 2, sku: "CASE-01", brand_slug: "case", lens: { design_code: null } },
  ],
};

describe("computeCostSheet", () => {
  it("prefers the SKU rule over the brand rule and prices every lens code", () => {
    const sheet = computeCostSheet(ORDER, RULES);
    const by = Object.fromEntries(sheet.lines.map((l) => [l.key, l]));
    expect(by["frame:FX2043-BLK"].amount).toBe(22); // sku beats brand (18)
    expect(by["frame:CASE-01"]).toMatchObject({ amount: 2, qty: 2, subtotal: 4 }); // case by brand
    expect(by["lens_design:sv"].subtotal).toBe(6);
    expect(by["lens_material:poly"].subtotal).toBe(4);
    expect(by["lens_ar:ar-green"].subtotal).toBe(3);
    // An inactive rule is as good as none: the line exists, flagged undefined.
    expect(by["lens_photo:photo-grey"]).toMatchObject({ amount: 0, undefined_cost: true });
  });

  it("adds per-order items, actual shipping, the percent fee and the fixed fee", () => {
    const sheet = computeCostSheet(ORDER, RULES);
    const by = Object.fromEntries(sheet.lines.map((l) => [l.key, l]));
    expect(by["order_fixed:lab"].subtotal).toBe(12);
    expect(by["order_fixed:packaging"].subtotal).toBe(1.5);
    expect(by["shipping:actual"]).toMatchObject({ amount: 10, source: "order", undefined_cost: false });
    expect(by["order_percent:payment_fee"].amount).toBe(6.09); // 2.9% of 210
    expect(by["payment_fixed:payment_fee_fixed"].amount).toBe(0.3);
    // 22 + 4 + 6 + 4 + 3 + 0 + 12 + 1.5 + 10 + 6.09 + 0.3
    expect(sheet.cost_total).toBe(68.89);
    expect(sheet.revenue).toBe(210);
    expect(sheet.margin).toBe(141.11);
    expect(sheet.margin_pct).toBe(67.2);
    expect(sheet.manual).toBe(false);
  });

  it("skips the fixed payment fee on an unpaid order", () => {
    const sheet = computeCostSheet({ ...ORDER, paid: false }, RULES);
    expect(sheet.lines.some((l) => l.key === "payment_fixed:payment_fee_fixed")).toBe(false);
  });

  it("adds the seller's commission as its own line, never from a rule", () => {
    const sheet = computeCostSheet(ORDER, RULES, { commission_pct: 10 });
    const line = sheet.lines.find((l) => l.source === "seller")!;
    expect(line).toMatchObject({ key: "order_percent:seller_commission", amount: 21, subtotal: 21 });
    expect(sheet.cost_total).toBe(89.89);
    expect(computeCostSheet(ORDER, RULES, { commission_pct: 0 }).lines.some((l) => l.source === "seller")).toBe(false);
  });

  it("uses a fixed shipping rule when the owner prefers it", () => {
    const rules = RULES.filter((r) => r.kind !== "shipping").concat(rule("shipping", "fixed", 7));
    const by = Object.fromEntries(computeCostSheet(ORDER, rules).lines.map((l) => [l.key, l]));
    expect(by["shipping:fixed"].amount).toBe(7);
    expect(by["shipping:actual"]).toBeUndefined();
  });

  it("flags lines without a defined cost and a frame nobody has a rule for", () => {
    const sheet = computeCostSheet(
      { total: 100, shipping_total: 0, items: [{ title: "Mystery", quantity: 1, sku: "ZZ-1", brand_slug: "grande", lens: {} }] },
      [rule("frame_brand", "flexure", 18), rule("order_fixed", "lab", 0)]
    );
    expect(sheet.lines.map((l) => l.key)).toEqual(["frame:ZZ-1", "order_fixed:lab"]);
    expect(undefinedCostCount(sheet)).toBe(2);
    expect(sheet.margin).toBe(100);
  });

  it("a manual override replaces the rules entirely", () => {
    const manual = { lines: [{ key: "frame:X", label: "Montura", amount: 20, qty: 1 }, { key: "manual", label: "Extra", amount: 2.5, qty: 2 }], updated_at: "2026-10-20T00:00:00Z", updated_by: "user_1" };
    const sheet = computeCostSheet(ORDER, RULES, { commission_pct: 10 }, manual);
    expect(sheet.manual).toBe(true);
    expect(sheet.lines.every((l) => l.source === "manual")).toBe(true);
    expect(sheet.cost_total).toBe(25);
    expect(sheet.margin).toBe(185);
    expect(sheet.margin_pct).toBe(88.1);
  });

  it("never divides by zero on a free order", () => {
    const sheet = computeCostSheet({ total: 0, shipping_total: 0, items: [] }, RULES);
    expect(sheet.margin_pct).toBe(0);
  });

  it("tags every line with its kind and match key", () => {
    const sheet = computeCostSheet(ORDER, RULES, { commission_pct: 10 });
    const by = Object.fromEntries(sheet.lines.map((l) => [l.key, l]));
    expect(by["frame:FX2043-BLK"]).toMatchObject({ kind: "frame_sku", match_key: "FX2043-BLK" });
    expect(by["frame:CASE-01"]).toMatchObject({ kind: "frame_brand", match_key: "case" });
    expect(by["lens_design:sv"].kind).toBe("lens_design");
    expect(by["lens_photo:photo-grey"]).toMatchObject({ kind: "lens_photo", match_key: "photo-grey" }); // unmatched, still typed
    expect(by["order_fixed:lab"].kind).toBe("order_fixed");
    expect(by["shipping:actual"].kind).toBe("shipping");
    expect(by["order_percent:payment_fee"].kind).toBe("order_percent");
    expect(by["payment_fixed:payment_fee_fixed"].kind).toBe("payment_fixed");
    expect(by["order_percent:seller_commission"].kind).toBe("seller_commission");
    expect(sheet.lines.every((l) => lineKind(l) === l.kind)).toBe(true);
    expect(sheet.lines.every((l) => Boolean(LINE_KIND_LABEL[l.kind]))).toBe(true);
    // Manual lines are "manual"; the key fallback still classifies old stored lines.
    const manual = computeCostSheet(ORDER, RULES, null, { lines: [{ key: "frame:X", label: "M", amount: 1, qty: 1 }], updated_at: "", updated_by: null });
    expect(manual.lines[0].kind).toBe("manual");
    expect(lineKind({ key: "frame:X", source: "rule" })).toBe("frame_brand");
    expect(lineKind({ key: "lens_ar:ar-blue", source: "rule" })).toBe("lens_ar");
    expect(lineKind({ key: "order_percent:seller_commission", source: "seller" })).toBe("seller_commission");
  });

  it("allocates free percentages of the sale (rent, service, webmaster, taxes) as cost lines", () => {
    const rules = [
      ...RULES,
      rule("order_percent", "rent", 10, "percent", { label: "Alquiler" }),
      rule("order_percent", "customer_service", 5, "percent", { label: "Atención al cliente" }),
    ];
    const by = Object.fromEntries(computeCostSheet(ORDER, rules).lines.map((l) => [l.key, l]));
    expect(by["order_percent:rent"]).toMatchObject({ label: "Alquiler", amount: 21, subtotal: 21, kind: "order_percent" });
    expect(by["order_percent:customer_service"].amount).toBe(10.5);
  });

  it("never counts the profit target as a cost, but reports it next to the margin", () => {
    const rules = [...RULES, rule("order_percent", PROFIT_TARGET_KEY, 30, "percent", { label: "Ganancia objetivo" })];
    const sheet = computeCostSheet(ORDER, rules);
    expect(sheet.lines.some((l) => l.key.includes(PROFIT_TARGET_KEY))).toBe(false);
    expect(sheet.cost_total).toBe(68.89); // identical to the sheet without the target
    expect(profitTargetPct(rules)).toBe(30);
    expect(profitTargetFor(profitTargetPct(rules), sheet.revenue, sheet.margin)).toEqual({
      profit_target_pct: 30,
      profit_target_amount: 63, // 30 % of 210
      profit_gap: 78.11, // 141.11 − 63: above target
    });
    // Below target → negative gap.
    expect(profitTargetFor(30, 100, 20)).toEqual({ profit_target_pct: 30, profit_target_amount: 30, profit_gap: -10 });
    // No target (absent, inactive or still 0) → nulls, never zeros that look like a goal.
    expect(profitTargetPct(RULES)).toBeNull();
    expect(profitTargetPct([rule("order_percent", PROFIT_TARGET_KEY, 30, "percent", { active: false })])).toBeNull();
    expect(profitTargetPct([rule("order_percent", PROFIT_TARGET_KEY, 0, "percent")])).toBeNull();
    expect(profitTargetFor(null, 210, 141.11)).toEqual({ profit_target_pct: null, profit_target_amount: null, profit_gap: null });
  });
});

describe("breakdown helpers", () => {
  const sheet = computeCostSheet(ORDER, RULES, { commission_pct: 10 });

  it("groups lines per concept (kind:match_key; seller commission and manual lines by kind)", () => {
    const keys = sheet.lines.map(conceptKey);
    expect(keys).toEqual(expect.arrayContaining(["frame_sku:FX2043-BLK", "frame_brand:case", "lens_design:sv", "order_fixed:lab", "shipping:actual", "order_percent:payment_fee", "seller_commission"]));
    const manual: CostLine = { key: "x", kind: "manual", label: "Extra", amount: 2, qty: 1, subtotal: 2, source: "manual" };
    expect(conceptKey(manual)).toBe("manual");
    const condensed = condenseLines([...sheet.lines, manual, { ...manual, subtotal: 3 }]);
    expect(condensed[0].amount).toBeGreaterThanOrEqual(condensed[condensed.length - 1].amount);
    expect(condensed.find((c) => c.key === "manual")).toMatchObject({ kind: "manual", label: "Ajustes manuales", amount: 5 });
    expect(condensed.find((c) => c.key === "seller_commission")).toMatchObject({ label: "Comisión de vendedores", amount: 21 });
    expect(condensed.find((c) => c.key === "frame_sku:FX2043-BLK")).toMatchObject({ kind: "frame_sku", amount: 22 });
  });

  it("renders the sheet's text summary as 'label amount' pairs", () => {
    expect(costBreakdownText([{ label: "Montura Peachtree", subtotal: 12 }, { label: "Envío real", subtotal: 28 }, { label: "Vendedor ANA (10%)", subtotal: 4.3 }])).toBe(
      "Montura Peachtree 12.00 · Envío real 28.00 · Vendedor ANA (10%) 4.30"
    );
    expect(costBreakdownText([])).toBe("");
    expect(costBreakdownText(null)).toBe("");
    expect(costBreakdownText(sheet.lines)).toContain("Comisión del vendedor (10%) 21.00");
  });

  it("sums item totals per brand and names known ones", () => {
    const brands = orderBrands([
      { brand_slug: "peachtree", total: 120 } as never,
      { brand_slug: "case", total: 15 } as never,
      { brand_slug: "Peachtree", total: 30 } as never,
      { brand_slug: null, total: 5 } as never,
    ]);
    expect(brands).toEqual([
      { slug: "peachtree", name: "Peachtree", revenue: 150 },
      { slug: "case", name: "Cases (estuches)", revenue: 15 },
      { slug: "?", name: "?", revenue: 5 },
    ]);
  });

  it("keys a day in the given time zone", () => {
    expect(dayKey("2026-10-19T02:00:00Z", "UTC")).toBe("2026-10-19");
    expect(dayKey("2026-10-19T02:00:00Z", "America/New_York")).toBe("2026-10-18");
    expect(dayKey("nope", "UTC")).toBe("");
  });

  it("summarizes a window per concept, seller, day and brand", () => {
    const items = (brand: string, total: number) => [{ title: "F", quantity: 1, sku: null, brand_slug: brand, lens: {}, total } as never];
    const mk = (id: string, created_at: string, seller_code: string | null, brand: string, total: number, pct = 0): { order: never; sheet: CostSheet } => {
      const its = items(brand, total);
      const sheet = computeCostSheet({ total, shipping_total: 0, paid: true, items: its }, [rule("frame_brand", "flexure", 18), rule("frame_brand", "case", 2)], pct ? { commission_pct: pct } : null);
      return { order: { id, display_id: 1, created_at, seller_code, seller_source: null, items: its, customer_name: null } as never, sheet };
    };
    const entries = [
      mk("o1", "2026-10-01T10:00:00Z", "ANA", "flexure", 100, 10),
      mk("o2", "2026-10-01T18:00:00Z", "ANA", "flexure", 50, 10),
      mk("o3", "2026-10-02T10:00:00Z", null, "case", 20),
    ];
    const out = summarizeCostSheets(entries, new Map([["ANA", { name: "Ana", commission_pct: 10 }]]), "UTC");
    expect(out.by_kind).toEqual([
      { kind: "frame_brand", key: "frame_brand:flexure", label: "frame_brand flexure", amount: 36 },
      { kind: "seller_commission", key: "seller_commission", label: "Comisión de vendedores", amount: 15 },
      { kind: "frame_brand", key: "frame_brand:case", label: "frame_brand case", amount: 2 },
    ]);
    expect(out.by_seller).toEqual([
      { code: "ANA", name: "Ana", orders: 2, revenue: 150, cost: 51, margin: 99, commission: 15 },
      { code: null, name: "none", orders: 1, revenue: 20, cost: 2, margin: 18, commission: 0 },
    ]);
    expect(out.by_day).toEqual([
      { date: "2026-10-01", orders: 2, revenue: 150, cost: 51, margin: 99 },
      { date: "2026-10-02", orders: 1, revenue: 20, cost: 2, margin: 18 },
    ]);
    expect(out.by_brand).toEqual([
      { slug: "flexure", name: "Flexure", orders: 2, revenue: 150, frame_cost: 36, margin_share: 114 },
      { slug: "case", name: "Cases (estuches)", orders: 1, revenue: 20, frame_cost: 2, margin_share: 18 },
    ]);
  });
});

describe("validateCostRules", () => {
  it("normalizes keys per kind and fills the unit", () => {
    const [sku, brand, fee] = validateCostRules([
      { kind: "frame_sku", match_key: " fx2043-blk ", label: "", amount: "22" },
      { kind: "frame_brand", match_key: "Flexure", label: "Flexure", amount: 18 },
      { kind: "order_percent", match_key: "Payment Fee", label: "Fee", amount: 2.9 },
    ]);
    expect(sku).toMatchObject({ match_key: "FX2043-BLK", unit: "fixed", amount: 22, active: true });
    expect(sku.label).toContain("FX2043-BLK");
    expect(brand.match_key).toBe("flexure");
    expect(fee).toMatchObject({ match_key: "payment_fee", unit: "percent" });
  });

  it("accepts the owner's own percentage allocations and the profit target", () => {
    const [service, rent, target] = validateCostRules([
      { kind: "order_percent", match_key: "Atención al cliente", label: "Atención al cliente", amount: 5 },
      { kind: "order_percent", match_key: "rent", label: "Alquiler", amount: "10", unit: "fixed" },
      { kind: "order_percent", match_key: "profit_target", label: "Ganancia objetivo", amount: 30 },
    ]);
    expect(service).toMatchObject({ match_key: "atencion_al_cliente", label: "Atención al cliente", unit: "percent", amount: 5 });
    expect(rent).toMatchObject({ match_key: "rent", unit: "percent", amount: 10 }); // order_percent is always a percent
    expect(target).toMatchObject({ match_key: "profit_target", unit: "percent", amount: 30 });
    expect(normalizeMatchKey("order_percent", "  Web-master / SEO ")).toBe("web_master_seo");
    expect(() => validateCostRules([{ kind: "order_percent", match_key: "a".repeat(41), amount: 1 }])).toThrow(CostRuleError);
    expect(() => validateCostRules([{ kind: "order_percent", match_key: "a".repeat(40), amount: 1 }])).not.toThrow();
  });

  it("refuses bad kinds, bad amounts, duplicates and the reserved seller key", () => {
    const reason = (input: unknown[]) => {
      try {
        validateCostRules(input);
        return null;
      } catch (e) {
        return e instanceof CostRuleError ? e.reason : "other";
      }
    };
    expect(reason([{ kind: "nope", match_key: "x", amount: 1 }])).toBe("bad_kind");
    expect(reason([{ kind: "order_fixed", match_key: "lab", amount: -1 }])).toBe("bad_amount");
    expect(reason([{ kind: "order_percent", match_key: "fee", amount: 150 }])).toBe("bad_amount");
    expect(reason([{ kind: "order_fixed", match_key: "lab", amount: 1 }, { kind: "order_fixed", match_key: "LAB", amount: 2 }])).toBe("duplicate");
    expect(reason([{ kind: "order_percent", match_key: "seller_commission", amount: 5 }])).toBe("bad_match_key");
    expect(reason([{ kind: "order_fixed", match_key: "", amount: 1 }])).toBe("bad_match_key");
  });
});

describe("defaultCostRules", () => {
  const catalog = { brands: KNOWN_BRANDS, ...FALLBACK_LENS_CATALOG };
  const seed = defaultCostRules(catalog);

  it("seeds the payment, shipping and per-order rows plus one per brand and lens code", () => {
    const keys = seed.map((r) => `${r.kind}:${r.match_key}`);
    expect(keys).toEqual(expect.arrayContaining([
      "order_percent:payment_fee", "payment_fixed:payment_fee_fixed", "shipping:actual", "order_fixed:lab", "order_fixed:packaging",
      "frame_brand:di-caprio", "frame_brand:case", "lens_design:sv", "lens_design:prog-high", "lens_material:cr39", "lens_photo:photo-grey", "lens_ar:ar-blue",
    ]));
    expect(seed.find((r) => r.match_key === "payment_fee")).toMatchObject({ amount: 2.9, unit: "percent" });
    expect(seed.find((r) => r.match_key === "payment_fee_fixed")?.amount).toBe(0.3);
    expect(seed.filter((r) => r.kind === "frame_brand")).toHaveLength(KNOWN_BRANDS.length);
    expect(new Set(keys).size).toBe(keys.length);
    expect(seed.every((r) => COST_KINDS.includes(r.kind))).toBe(true);
    // The seed itself must pass the validator the panel goes through.
    expect(() => validateCostRules(seed)).not.toThrow();
  });
});
