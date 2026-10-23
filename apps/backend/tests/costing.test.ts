/**
 * Cost sheet math and rule validation. Pure functions only.
 *
 * The model: gross → deductions (shipping, taxes, payment fees) → net base →
 * materials + the owner's percentages and the seller's commission (both of
 * the NET base) → margin; the profit target is a goal over the net base.
 */
import {
  COST_KINDS,
  CostRuleError,
  DEFAULT_PROFIT_TARGET_PCT,
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
  lineGroup,
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
  tax_total: 0,
  paid: true,
  items: [
    { title: "Flexure 2043", quantity: 1, sku: "FX2043-BLK", brand_slug: "flexure", lens: { design_code: "sv", material_code: "poly", photo_code: "photo-grey", ar_code: "ar-green" } },
    { title: "Estuche", quantity: 2, sku: "CASE-01", brand_slug: "case", lens: { design_code: null } },
  ],
};

const byKey = (sheet: CostSheet) => Object.fromEntries(sheet.lines.map((l) => [l.key, l]));

/** The owner's worked example: the Peachtree frame sold at 43 with 28 of shipping. */
const OWNER_RULES: CostRule[] = [
  rule("order_percent", "payment_fee", 2.9, "percent", { label: "Comisión del cobro (porcentaje)" }),
  rule("payment_fixed", "payment_fee_fixed", 0.3, "fixed", { label: "Comisión del cobro (fija)" }),
  rule("shipping", "actual", 0, "fixed", { label: "Envío (lo que pagó el cliente)" }),
  rule("frame_brand", "peachtree", 0, "fixed", { label: "Montura Peachtree" }),
  rule("order_fixed", "lab", 0, "fixed", { label: "Laboratorio" }),
  rule("order_fixed", "packaging", 0, "fixed", { label: "Empaque" }),
  rule("order_percent", "customer_service", 3, "percent", { label: "Atención al cliente" }),
  rule("order_percent", PROFIT_TARGET_KEY, 30, "percent", { label: "Ganancia objetivo" }),
];
const OWNER_ORDER = {
  total: 43,
  shipping_total: 28,
  tax_total: 0,
  paid: true,
  items: [{ title: "Peachtree P1", quantity: 1, sku: "PT-1", brand_slug: "peachtree", lens: {} }],
};

describe("computeCostSheet — the owner's rule: deductions first, then distribute the net", () => {
  it("worked example: 43 paid, 28 shipping, 2.9 % + 0.30 fee, 3 % service, 30 % target", () => {
    const sheet = computeCostSheet(OWNER_ORDER, OWNER_RULES);
    const by = byKey(sheet);
    expect(sheet.gross).toBe(43);
    expect(sheet.revenue).toBe(43);
    // Deductions: 28 + 0 tax + 1.25 (2.9 % of the GROSS 43) + 0.30.
    expect(by["shipping:actual"]).toMatchObject({ group: "deduction", subtotal: 28, source: "order" });
    expect(by["tax:order"]).toBeUndefined(); // no taxes → no line
    expect(by["order_percent:payment_fee"]).toMatchObject({ group: "deduction", amount: 1.25 });
    expect(by["payment_fixed:payment_fee_fixed"]).toMatchObject({ group: "deduction", amount: 0.3 });
    expect(sheet.deductions_total).toBe(29.55);
    expect(sheet.net_base).toBe(13.45);
    // Materials (all still 0 in the owner's table): frame, lab, packaging.
    expect(by["frame:PT-1"]).toMatchObject({ group: "material", amount: 0, undefined_cost: true });
    expect(sheet.materials_total).toBe(0);
    // Customer service is 3 % of the NET base (13.45 → 0.40), not of the 43.
    expect(by["order_percent:customer_service"]).toMatchObject({ group: "percent", amount: 0.4, subtotal: 0.4 });
    expect(sheet.percent_total).toBe(0.4);
    expect(sheet.commission_total).toBe(0);
    expect(sheet.cost_total).toBe(29.95);
    expect(sheet.margin).toBe(13.05);
    expect(sheet.margin_pct).toBeCloseTo(30.35, 2);
    expect(sheet.profit_pct_net).toBeCloseTo(97.03, 2);
    // Target: 30 % of the net base, never of the gross.
    expect(sheet.profit_target_pct).toBe(30);
    expect(sheet.profit_target_amount).toBeCloseTo(4.04, 1);
    expect(sheet.profit_gap).toBeCloseTo(9.01, 1);
    // No materials → nothing to price from.
    expect(sheet.suggested_price).toBeNull();
    expect(sheet.suggested_delta).toBeNull();
    expect(sheet.manual).toBe(false);
    // The target never becomes a line, and lines are deductions → materials → percent.
    expect(sheet.lines.some((l) => l.key.includes(PROFIT_TARGET_KEY))).toBe(false);
    expect(sheet.lines.map((l) => l.group)).toEqual(["deduction", "deduction", "deduction", "material", "material", "material", "percent"]);
  });

  it("second example: frame 12, seller 10 %, tax 2 → the suggested price is self-consistent at the target", () => {
    const rules = OWNER_RULES.map((r) => (r.kind === "frame_brand" ? { ...r, amount: 12 } : r));
    const order = { ...OWNER_ORDER, tax_total: 2 };
    const sheet = computeCostSheet(order, rules, { commission_pct: 10 });
    const by = byKey(sheet);
    expect(by["tax:order"]).toMatchObject({ kind: "tax", group: "deduction", amount: 2, subtotal: 2, source: "order", label: "Impuestos (lo que pagó el cliente)" });
    expect(sheet.deductions_total).toBe(31.55); // 28 + 2 + 1.25 + 0.30
    expect(sheet.net_base).toBe(11.45);
    expect(sheet.materials_total).toBe(12);
    expect(by["order_percent:customer_service"].amount).toBeCloseTo(0.34, 2); // 3 % of 11.45
    expect(by["order_percent:seller_commission"]).toMatchObject({ group: "seller", source: "seller" });
    expect(sheet.commission_total).toBeCloseTo(1.15, 1); // 10 % of 11.45
    expect(sheet.cost_total).toBeCloseTo(45.04, 1);
    expect(sheet.margin).toBeCloseTo(-2.04, 1); // sold below cost
    expect(sheet.profit_gap).toBeLessThan(0);

    // S = 30, f = 0.029, F = 0.30, M = 12, p = 0.13, g = 0.30:
    // net* = 12 / 0.57 = 21.05; price = (21.05 + 30 + 0.30) / 0.971 = 52.89.
    expect(sheet.suggested_price).toBeCloseTo(52.89, 2);
    expect(sheet.suggested_delta).toBeCloseTo(9.89, 2);

    // Selling at that price leaves exactly the target (30 % of the net).
    const at = computeCostSheet({ ...order, total: sheet.suggested_price! }, rules, { commission_pct: 10 });
    expect(at.margin).toBeCloseTo(at.net_base * 0.3, 1);
    expect(Math.abs(at.margin - at.net_base * 0.3)).toBeLessThan(0.02);
    expect(Math.abs(at.profit_gap!)).toBeLessThan(0.02);
    expect(at.suggested_delta).toBeCloseTo(0, 1);
  });

  it("never lets the net base go below zero and never divides by zero", () => {
    const sheet = computeCostSheet({ total: 20, shipping_total: 28, tax_total: 0, items: [] }, OWNER_RULES);
    expect(sheet.net_base).toBe(0);
    expect(byKey(sheet)["order_percent:customer_service"].amount).toBe(0);
    expect(sheet.profit_pct_net).toBe(0);
    expect(sheet.profit_target_amount).toBe(0);
    const free = computeCostSheet({ total: 0, shipping_total: 0, items: [] }, RULES);
    expect(free.margin_pct).toBe(0);
    expect(free.profit_pct_net).toBe(0);
  });

  it("has no suggestion when the percentages and the target eat the whole net, or without a target", () => {
    const greedy = [...OWNER_RULES.map((r) => (r.kind === "frame_brand" ? { ...r, amount: 12 } : r)), rule("order_percent", "rent", 70, "percent")];
    expect(computeCostSheet(OWNER_ORDER, greedy).suggested_price).toBeNull(); // 1 − 0.73 − 0.30 < 0
    const noTarget = OWNER_RULES.filter((r) => r.match_key !== PROFIT_TARGET_KEY).map((r) => (r.kind === "frame_brand" ? { ...r, amount: 12 } : r));
    const sheet = computeCostSheet(OWNER_ORDER, noTarget);
    expect(sheet.profit_target_pct).toBeNull();
    expect(sheet.profit_target_amount).toBeNull();
    expect(sheet.profit_gap).toBeNull();
    expect(sheet.suggested_price).toBeNull();
    // The 5th argument overrides the rules' target (null = none).
    expect(computeCostSheet(OWNER_ORDER, noTarget, null, null, 30).profit_target_pct).toBe(30);
    expect(computeCostSheet(OWNER_ORDER, OWNER_RULES, null, null, null).profit_target_pct).toBeNull();
  });

  it("the 2.9 % fee is of the gross; every other percentage and the commission are of the net", () => {
    const rules = [...RULES, rule("order_percent", "rent", 10, "percent", { label: "Alquiler" })];
    const sheet = computeCostSheet(ORDER, rules, { commission_pct: 10 });
    const by = byKey(sheet);
    expect(by["order_percent:payment_fee"].amount).toBe(6.09); // 2.9 % of 210
    expect(sheet.deductions_total).toBe(16.39); // 10 + 6.09 + 0.30
    expect(sheet.net_base).toBe(193.61);
    expect(by["order_percent:rent"]).toMatchObject({ label: "Alquiler", amount: 19.36, group: "percent" }); // 10 % of 193.61
    expect(by["order_percent:seller_commission"]).toMatchObject({ amount: 19.36, subtotal: 19.36, group: "seller" });
    expect(sheet.percent_total).toBe(19.36);
    expect(sheet.commission_total).toBe(19.36);
  });
});

describe("computeCostSheet — lines", () => {
  it("prefers the SKU rule over the brand rule and prices every lens code", () => {
    const sheet = computeCostSheet(ORDER, RULES);
    const by = byKey(sheet);
    expect(by["frame:FX2043-BLK"].amount).toBe(22); // sku beats brand (18)
    expect(by["frame:CASE-01"]).toMatchObject({ amount: 2, qty: 2, subtotal: 4 }); // case by brand
    expect(by["lens_design:sv"].subtotal).toBe(6);
    expect(by["lens_material:poly"].subtotal).toBe(4);
    expect(by["lens_ar:ar-green"].subtotal).toBe(3);
    // An inactive rule is as good as none: the line exists, flagged undefined.
    expect(by["lens_photo:photo-grey"]).toMatchObject({ amount: 0, undefined_cost: true });
    expect(sheet.materials_total).toBe(52.5); // 22 + 4 + 6 + 4 + 3 + 0 + 12 + 1.5
  });

  it("adds per-order items, actual shipping, the percent fee and the fixed fee", () => {
    const sheet = computeCostSheet(ORDER, RULES);
    const by = byKey(sheet);
    expect(by["order_fixed:lab"]).toMatchObject({ subtotal: 12, group: "material" });
    expect(by["order_fixed:packaging"].subtotal).toBe(1.5);
    expect(by["shipping:actual"]).toMatchObject({ amount: 10, source: "order", undefined_cost: false });
    expect(by["order_percent:payment_fee"].amount).toBe(6.09);
    expect(by["payment_fixed:payment_fee_fixed"].amount).toBe(0.3);
    // 10 + 6.09 + 0.3 (deductions) + 52.5 (materials)
    expect(sheet.cost_total).toBe(68.89);
    expect(sheet.revenue).toBe(210);
    expect(sheet.margin).toBe(141.11);
    expect(sheet.margin_pct).toBe(67.2);
    expect(sheet.profit_pct_net).toBe(72.88); // 141.11 / 193.61
    expect(sheet.manual).toBe(false);
  });

  it("skips the fixed payment fee on an unpaid order", () => {
    const sheet = computeCostSheet({ ...ORDER, paid: false }, RULES);
    expect(sheet.lines.some((l) => l.key === "payment_fixed:payment_fee_fixed")).toBe(false);
    expect(sheet.deductions_total).toBe(16.09);
  });

  it("adds the seller's commission as its own line, never from a rule", () => {
    const sheet = computeCostSheet(ORDER, RULES, { commission_pct: 10 });
    const line = sheet.lines.find((l) => l.source === "seller")!;
    expect(line).toMatchObject({ key: "order_percent:seller_commission", amount: 19.36, subtotal: 19.36 });
    expect(sheet.cost_total).toBe(88.25);
    expect(computeCostSheet(ORDER, RULES, { commission_pct: 0 }).lines.some((l) => l.source === "seller")).toBe(false);
  });

  it("uses a fixed shipping rule when the owner prefers it", () => {
    const rules = RULES.filter((r) => r.kind !== "shipping").concat(rule("shipping", "fixed", 7));
    const sheet = computeCostSheet(ORDER, rules);
    const by = byKey(sheet);
    expect(by["shipping:fixed"]).toMatchObject({ amount: 7, group: "deduction" });
    expect(by["shipping:actual"]).toBeUndefined();
    expect(sheet.deductions_total).toBe(13.39);
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

  it("a manual override replaces the rules entirely, but the net base still comes from the order", () => {
    const manual = { lines: [{ key: "frame:X", label: "Montura", amount: 20, qty: 1 }, { key: "manual", label: "Extra", amount: 2.5, qty: 2 }], updated_at: "2026-10-20T00:00:00Z", updated_by: "user_1" };
    const sheet = computeCostSheet({ ...ORDER, tax_total: 5 }, [...RULES, rule("order_percent", PROFIT_TARGET_KEY, 30, "percent")], { commission_pct: 10 }, manual);
    expect(sheet.manual).toBe(true);
    expect(sheet.lines.every((l) => l.source === "manual" && l.kind === "manual" && l.group === "manual")).toBe(true);
    expect(sheet.cost_total).toBe(25);
    expect(sheet.margin).toBe(185);
    expect(sheet.margin_pct).toBe(88.1);
    expect(sheet.deductions_total).toBe(15); // shipping 10 + tax 5 of the order
    expect(sheet.net_base).toBe(195);
    expect(sheet.materials_total).toBe(25); // the stored lines are the whole cost
    expect(sheet.percent_total).toBe(0);
    expect(sheet.commission_total).toBe(0);
    expect(sheet.profit_pct_net).toBe(94.87);
    expect(sheet.profit_target_amount).toBe(58.5); // 30 % of 195
    expect(sheet.profit_gap).toBe(126.5);
    // price − 25 = 0.3 × (price − 15) ⇒ price = (25 − 4.5) / 0.7
    expect(sheet.suggested_price).toBeCloseTo(29.29, 2);
    expect(sheet.suggested_delta).toBeCloseTo(-180.71, 2);
  });

  it("tags every line with its kind, group and match key", () => {
    const sheet = computeCostSheet({ ...ORDER, tax_total: 3 }, RULES, { commission_pct: 10 });
    const by = byKey(sheet);
    expect(by["frame:FX2043-BLK"]).toMatchObject({ kind: "frame_sku", match_key: "FX2043-BLK", group: "material" });
    expect(by["frame:CASE-01"]).toMatchObject({ kind: "frame_brand", match_key: "case" });
    expect(by["lens_design:sv"].kind).toBe("lens_design");
    expect(by["lens_photo:photo-grey"]).toMatchObject({ kind: "lens_photo", match_key: "photo-grey" }); // unmatched, still typed
    expect(by["order_fixed:lab"].kind).toBe("order_fixed");
    expect(by["shipping:actual"]).toMatchObject({ kind: "shipping", group: "deduction" });
    expect(by["tax:order"]).toMatchObject({ kind: "tax", match_key: "order", group: "deduction" });
    expect(by["order_percent:payment_fee"]).toMatchObject({ kind: "order_percent", group: "deduction" });
    expect(by["payment_fixed:payment_fee_fixed"]).toMatchObject({ kind: "payment_fixed", group: "deduction" });
    expect(by["order_percent:seller_commission"]).toMatchObject({ kind: "seller_commission", group: "seller" });
    expect(sheet.lines.every((l) => lineKind(l) === l.kind)).toBe(true);
    expect(sheet.lines.every((l) => lineGroup(l) === l.group)).toBe(true);
    expect(sheet.lines.every((l) => Boolean(LINE_KIND_LABEL[l.kind]))).toBe(true);
    // Manual lines are "manual"; the key fallback still classifies old stored lines.
    const manual = computeCostSheet(ORDER, RULES, null, { lines: [{ key: "frame:X", label: "M", amount: 1, qty: 1 }], updated_at: "", updated_by: null });
    expect(manual.lines[0].kind).toBe("manual");
    expect(lineKind({ key: "frame:X", source: "rule" })).toBe("frame_brand");
    expect(lineKind({ key: "lens_ar:ar-blue", source: "rule" })).toBe("lens_ar");
    expect(lineKind({ key: "tax:order", source: "order" })).toBe("tax");
    expect(lineKind({ key: "order_percent:seller_commission", source: "seller" })).toBe("seller_commission");
    expect(lineGroup({ key: "order_percent:payment_fee", source: "rule" })).toBe("deduction");
    expect(lineGroup({ key: "order_percent:rent", source: "rule" })).toBe("percent");
    expect(lineGroup({ key: "tax:order", source: "order" })).toBe("deduction");
    expect(lineGroup({ key: "frame:X", source: "rule" })).toBe("material");
    expect(lineGroup({ key: "x", source: "manual" })).toBe("manual");
  });

  it("allocates free percentages of the net (rent, service, webmaster) as cost lines", () => {
    const rules = [
      ...RULES,
      rule("order_percent", "rent", 10, "percent", { label: "Alquiler" }),
      rule("order_percent", "customer_service", 5, "percent", { label: "Atención al cliente" }),
    ];
    const by = byKey(computeCostSheet(ORDER, rules));
    expect(by["order_percent:rent"]).toMatchObject({ label: "Alquiler", amount: 19.36, subtotal: 19.36, kind: "order_percent", group: "percent" });
    expect(by["order_percent:customer_service"].amount).toBe(9.68); // 5 % of 193.61
  });

  it("never counts the profit target as a cost, but reports it next to the margin", () => {
    const rules = [...RULES, rule("order_percent", PROFIT_TARGET_KEY, 30, "percent", { label: "Ganancia objetivo" })];
    const sheet = computeCostSheet(ORDER, rules);
    expect(sheet.lines.some((l) => l.key.includes(PROFIT_TARGET_KEY))).toBe(false);
    expect(sheet.cost_total).toBe(68.89); // identical to the sheet without the target
    expect(profitTargetPct(rules)).toBe(30);
    expect(sheet.profit_target_pct).toBe(30);
    expect(sheet.profit_target_amount).toBe(58.08); // 30 % of the net 193.61
    expect(sheet.profit_gap).toBe(83.03); // 141.11 − 58.08: above target
    expect(profitTargetFor(30, sheet.net_base, sheet.margin)).toEqual({ profit_target_pct: 30, profit_target_amount: 58.08, profit_gap: 83.03 });
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
  const sheet = computeCostSheet({ ...ORDER, tax_total: 4 }, RULES, { commission_pct: 10 });

  it("groups lines per concept (kind:match_key; seller commission and manual lines by kind)", () => {
    const keys = sheet.lines.map(conceptKey);
    expect(keys).toEqual(expect.arrayContaining(["frame_sku:FX2043-BLK", "frame_brand:case", "lens_design:sv", "order_fixed:lab", "shipping:actual", "tax:order", "order_percent:payment_fee", "seller_commission"]));
    const manual: CostLine = { key: "x", kind: "manual", group: "manual", label: "Extra", amount: 2, qty: 1, subtotal: 2, source: "manual" };
    expect(conceptKey(manual)).toBe("manual");
    const condensed = condenseLines([...sheet.lines, manual, { ...manual, subtotal: 3 }]);
    expect(condensed[0].amount).toBeGreaterThanOrEqual(condensed[condensed.length - 1].amount);
    expect(condensed.find((c) => c.key === "manual")).toMatchObject({ kind: "manual", label: "Ajustes manuales", amount: 5 });
    expect(condensed.find((c) => c.key === "seller_commission")).toMatchObject({ label: "Comisión de vendedores", amount: 18.96 }); // 10 % of 189.61
    expect(condensed.find((c) => c.key === "frame_sku:FX2043-BLK")).toMatchObject({ kind: "frame_sku", amount: 22 });
    expect(condensed.find((c) => c.key === "tax:order")).toMatchObject({ kind: "tax", label: "Impuestos (lo que pagó el cliente)", amount: 4 });
  });

  it("renders the sheet's text summary as 'label amount' pairs, taxes included", () => {
    expect(costBreakdownText([{ label: "Montura Peachtree", subtotal: 12 }, { label: "Envío real", subtotal: 28 }, { label: "Vendedor ANA (10%)", subtotal: 4.3 }])).toBe(
      "Montura Peachtree 12.00 · Envío real 28.00 · Vendedor ANA (10%) 4.30"
    );
    expect(costBreakdownText([])).toBe("");
    expect(costBreakdownText(null)).toBe("");
    expect(costBreakdownText(sheet.lines)).toContain("Impuestos (lo que pagó el cliente) 4.00");
    expect(costBreakdownText(sheet.lines)).toContain("Comisión del vendedor (10%) 18.96");
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

  it("summarizes a window per concept, seller, day and brand, with the window's totals", () => {
    const items = (brand: string, total: number) => [{ title: "F", quantity: 1, sku: null, brand_slug: brand, lens: {}, total } as never];
    const windowRules = [rule("frame_brand", "flexure", 18), rule("frame_brand", "case", 2), rule("order_percent", PROFIT_TARGET_KEY, 30, "percent")];
    const mk = (id: string, created_at: string, seller_code: string | null, brand: string, total: number, pct = 0, tax = 0): { order: never; sheet: CostSheet } => {
      const its = items(brand, total);
      const sheet = computeCostSheet({ total, shipping_total: 0, tax_total: tax, paid: true, items: its }, windowRules, pct ? { commission_pct: pct } : null);
      return { order: { id, display_id: 1, created_at, seller_code, seller_source: null, items: its, customer_name: null } as never, sheet };
    };
    const entries = [
      mk("o1", "2026-10-01T10:00:00Z", "ANA", "flexure", 100, 10),
      mk("o2", "2026-10-01T18:00:00Z", "ANA", "flexure", 50, 10),
      mk("o3", "2026-10-02T10:00:00Z", null, "case", 20, 0, 2),
    ];
    const out = summarizeCostSheets(entries, new Map([["ANA", { name: "Ana", commission_pct: 10 }]]), "UTC");
    expect(out.by_kind).toEqual([
      { kind: "frame_brand", key: "frame_brand:flexure", label: "frame_brand flexure", amount: 36 },
      { kind: "seller_commission", key: "seller_commission", label: "Comisión de vendedores", amount: 15 },
      { kind: "frame_brand", key: "frame_brand:case", label: "frame_brand case", amount: 2 },
      { kind: "tax", key: "tax:order", label: "Impuestos (lo que pagó el cliente)", amount: 2 },
    ]);
    expect(out.by_seller).toEqual([
      { code: "ANA", name: "Ana", orders: 2, revenue: 150, cost: 51, margin: 99, commission: 15 },
      { code: null, name: "none", orders: 1, revenue: 20, cost: 4, margin: 16, commission: 0 },
    ]);
    expect(out.by_day).toEqual([
      { date: "2026-10-01", orders: 2, revenue: 150, cost: 51, margin: 99 },
      { date: "2026-10-02", orders: 1, revenue: 20, cost: 4, margin: 16 },
    ]);
    expect(out.by_brand).toEqual([
      { slug: "flexure", name: "Flexure", orders: 2, revenue: 150, frame_cost: 36, margin_share: 114 },
      { slug: "case", name: "Cases (estuches)", orders: 1, revenue: 20, frame_cost: 2, margin_share: 18 },
    ]);
    expect(out.totals).toEqual({
      orders: 3,
      gross: 170,
      revenue: 170,
      deductions: 2,
      net_base: 168,
      materials: 38,
      percent_items: 0,
      commission: 15,
      cost: 55,
      profit: 115,
      margin: 115,
      margin_pct: 67.65,
      profit_pct_net: 68.45,
      profit_target_pct: 30,
      profit_target_amount: 50.4, // 30 + 15 + 5.4
      profit_gap: 64.6,
    });
    // Without any target the sums stay null, never 0.
    const none = summarizeCostSheets([mk("o4", "2026-10-03T10:00:00Z", null, "case", 20)].map((e) => ({ ...e, sheet: computeCostSheet({ total: 20, items: items("case", 20) }, [rule("frame_brand", "case", 2)]) })), new Map(), "UTC");
    expect(none.totals).toMatchObject({ orders: 1, gross: 20, cost: 2, profit: 18, profit_target_pct: null, profit_target_amount: null, profit_gap: null });
    expect(summarizeCostSheets([], new Map(), "UTC").totals).toMatchObject({ orders: 0, gross: 0, margin_pct: 0, profit_pct_net: 0 });
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
    expect(reason([{ kind: "tax", match_key: "order", amount: 1 }])).toBe("bad_kind"); // taxes come from the order, never a rule
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

  it("seeds the payment, shipping, per-order and target rows plus one per brand and lens code", () => {
    const keys = seed.map((r) => `${r.kind}:${r.match_key}`);
    expect(keys).toEqual(expect.arrayContaining([
      "order_percent:payment_fee", "payment_fixed:payment_fee_fixed", "shipping:actual", "order_fixed:lab", "order_fixed:packaging", `order_percent:${PROFIT_TARGET_KEY}`,
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

  it("seeds the owner's 30 % profit target, active, as a goal the sheet never charges", () => {
    expect(DEFAULT_PROFIT_TARGET_PCT).toBe(30);
    expect(seed.find((r) => r.match_key === PROFIT_TARGET_KEY)).toMatchObject({ kind: "order_percent", label: "Ganancia objetivo", amount: 30, unit: "percent", active: true });
    expect(profitTargetPct(seed)).toBe(30);
    const sheet = computeCostSheet({ total: 100, shipping_total: 10, tax_total: 0, paid: true, items: [] }, seed);
    expect(sheet.lines.some((l) => l.key.includes(PROFIT_TARGET_KEY))).toBe(false);
    expect(sheet.profit_target_pct).toBe(30);
    expect(sheet.deductions_total).toBe(13.2); // 10 + 2.9 + 0.30
    expect(sheet.net_base).toBe(86.8);
    expect(sheet.profit_target_amount).toBe(26.04);
  });
});
