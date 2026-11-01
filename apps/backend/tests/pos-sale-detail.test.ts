/**
 * Who a till sale was for and what was sold on it, read from the source tables
 * instead of the `sale_fact` projection (lib/pos-sale-detail.ts). What matters
 * here: a sale with no order or no customer comes back with nulls and never
 * throws, a whole page of sales costs a FIXED number of queries (never one per
 * sale), and a frame the customer brought is marked as such.
 */
import {
  currentLinesByOrder,
  customerNameOf,
  EMPTY_SALE_DETAIL,
  lensSummaryOf,
  lineFactOf,
  loadSaleDetails,
  saleDetailOf,
  type SaleLineRow,
} from "../src/lib/pos-sale-detail";

const LENS = { design_code: "sv", material_code: "cr39", photo_code: "none", ar_code: "ar-premium" };

const line = (over: Partial<SaleLineRow> = {}): SaleLineRow => ({
  order_id: "order_1",
  id: "oli_1",
  version: 1,
  product_id: "prod_1",
  variant_sku: "FX1-GOLD",
  product_title: "Flexure 2041",
  title: "Flexure 2041 / Gold",
  variant_title: "Dorado",
  metadata: { kind: "configured-frame", lens_config: LENS, prescription_id: "rx_1" },
  ...over,
});

const META = new Map<string, Record<string, unknown>>([
  ["prod_1", { brand: "Flexure", brand_slug: "flexure" }],
  ["prod_case", { collection_slug: "case" }],
  ["prod_bare", {}],
]);

const LABELS = {
  designs: new Map([["sv", { label_es: "Monofocal", label_en: "Single vision" }]]),
  materials: new Map([["cr39", { label_es: "CR-39", label_en: "CR-39" }]]),
  photos: new Map<string, { label_es?: string | null; label_en?: string | null }>(),
  ars: new Map([["ar-premium", { label_es: "AR Premium", label_en: null }]]),
};

describe("lineFactOf", () => {
  it("reads a configured frame: brand from the product metadata, model from the line, SKU and lenses", () => {
    const f = lineFactOf(line(), META.get("prod_1"));
    expect(f).toMatchObject({
      line_item_id: "oli_1",
      category: "frame",
      brand: "Flexure",
      title: "Flexure 2041",
      sku: "FX1-GOLD",
      variant_title: "Dorado",
      has_prescription: true,
    });
    expect(f.lens).toEqual({ design: "sv", material: "cr39", photo: "none", ar: "ar-premium" });
  });

  it("falls back to the brand slug, and a product whose slug is `case` is a case, not a frame", () => {
    expect(lineFactOf(line({ product_id: "prod_case", product_title: "Estuche rígido" }), META.get("prod_case"))).toMatchObject({ category: "case", brand: "case" });
    expect(lineFactOf(line({ product_id: "prod_bare" }), META.get("prod_bare"))).toMatchObject({ category: "frame", brand: null });
  });

  it("marks a frame the customer brought the way the projection marks it (metadata.kind)", () => {
    const own = lineFactOf(
      line({ product_id: null, variant_sku: null, product_title: null, title: "Patient's own frame", variant_title: null, metadata: { kind: "own-frame", lens_config: LENS, own_frame: { description: "Ray-Ban azul del cliente" } } }),
      undefined
    );
    expect(own).toMatchObject({ category: "own_frame", brand: null, sku: null, title: "own_frame" });
  });

  it("a frame-only sale carries no lens codes", () => {
    const f = lineFactOf(line({ metadata: { kind: "configured-frame", lens_config: { design_code: "frame-only" } } }), META.get("prod_1"));
    expect(f.lens).toEqual({ design: null, material: null, photo: null, ar: null });
    expect(f.has_prescription).toBe(false);
  });
});

describe("saleDetailOf", () => {
  it("puts the sale's frame, lenses, customer and items on the row, with the analytics field names", () => {
    const d = saleDetailOf([line(), line({ id: "oli_2", product_id: "prod_case", product_title: "Estuche", variant_title: null, metadata: {} })], META, { first_name: "Ana", last_name: "Pérez", phone: "+1 555 0100" }, LABELS);
    expect(d).toMatchObject({
      customer_name: "Ana Pérez",
      customer_phone: "+1 555 0100",
      frame_brand: "Flexure",
      frame_model: "Flexure 2041",
      frame_color: "Dorado",
      frame_sku: "FX1-GOLD",
      own_frame: false,
      has_rx: true,
      items: "Flexure 2041 · Estuche",
    });
    // The codes where a label is missing, each language falling back to the other.
    expect(d.lens_summary).toEqual({ es: "Monofocal · CR-39 · none · AR Premium", en: "Single vision · CR-39 · none · AR Premium" });
  });

  it("an own frame reads as the customer's description, with no brand, colour or SKU", () => {
    const own = line({ product_id: null, variant_sku: null, product_title: null, title: "x", variant_title: null, metadata: { kind: "own-frame", lens_config: LENS, own_frame: { description: "Ray-Ban azul del cliente" } } });
    const d = saleDetailOf([own], META, null, LABELS);
    expect(d).toMatchObject({ own_frame: true, frame_model: "Ray-Ban azul del cliente", frame_brand: null, frame_color: null, frame_sku: null, has_rx: true });
  });

  it("a sale with no lines and no customer is all nulls, not an error", () => {
    expect(saleDetailOf([], META, null)).toEqual(EMPTY_SALE_DETAIL);
  });

  it("a customer with no name shows their email; nobody shows nothing", () => {
    expect(customerNameOf({ first_name: null, last_name: null, email: "ana@x.co" })).toBe("ana@x.co");
    expect(customerNameOf(null)).toBeNull();
    expect(lensSummaryOf({ design: null, material: null, photo: null, ar: null })).toBeNull();
  });
});

describe("currentLinesByOrder", () => {
  it("keeps only the current version of an edited order, so a replaced line is not counted twice", () => {
    const rows = [line({ id: "old", version: 1, product_title: "Vieja" }), line({ id: "new", version: 2, product_title: "Nueva" }), line({ order_id: "order_2", id: "other", version: 1 })];
    const byOrder = currentLinesByOrder(rows);
    expect(byOrder.get("order_1")?.map((l) => l.id)).toEqual(["new"]);
    expect(byOrder.get("order_2")?.map((l) => l.id)).toEqual(["other"]);
  });
});

// ── loadSaleDetails: a page of sales in a fixed number of queries ────────────

type Row = Record<string, unknown>;

/** A knex-like stub that records which table each query hit. */
function fakePg(tables: Record<string, Row[]>) {
  const hits: string[] = [];
  const pg = (name: string) => {
    const table = String(name).split(" as ")[0];
    hits.push(table);
    const q = {
      innerJoin: () => q,
      whereIn: () => q,
      whereNull: () => q,
      select: async () => tables[table] ?? [],
    };
    return q;
  };
  return { pg: pg as unknown as never, hits };
}

const SALE_LINES = [
  { order_id: "order_1", version: 1, id: "oli_1", product_id: "prod_1", variant_sku: "FX1-GOLD", product_title: "Flexure 2041", title: "x", variant_title: "Dorado", metadata: { kind: "configured-frame", lens_config: LENS, prescription_id: "rx_1" } },
  { order_id: "order_2", version: 1, id: "oli_2", product_id: null, variant_sku: null, product_title: null, title: "y", variant_title: null, metadata: { kind: "own-frame", lens_config: LENS, own_frame: { description: "Montura del cliente" } } },
];

const TABLES: Record<string, Row[]> = {
  customer: [{ id: "cus_1", first_name: "Ana", last_name: "Pérez", email: "ana@x.co", phone: "+1 555 0100" }],
  order_item: SALE_LINES,
  product: [{ id: "prod_1", metadata: { brand: "Flexure", brand_slug: "flexure" } }],
  lens_design: [{ code: "sv", label_es: "Monofocal", label_en: "Single vision" }],
  lens_material: [{ code: "cr39", label_es: "CR-39", label_en: "CR-39" }],
  lens_photo_option: [],
  lens_ar_option: [{ code: "ar-premium", label_es: "AR Premium", label_en: "AR Premium" }],
};

const container = (pg: never) => ({ resolve: () => pg }) as never;

describe("loadSaleDetails", () => {
  const sales = [
    { id: "poss_1", order_id: "order_1", customer_id: "cus_1" },
    { id: "poss_2", order_id: "order_2", customer_id: null },
    { id: "poss_3", order_id: null, customer_id: "cus_gone" },
  ];

  it("resolves the whole page with one query per source and never one per sale", async () => {
    const { pg, hits } = fakePg(TABLES);
    const map = await loadSaleDetails(container(pg), sales);
    expect(map.size).toBe(3);
    // customer · order lines · products · the four lens catalogs.
    expect(hits).toEqual(["customer", "order_item", "product", "lens_design", "lens_material", "lens_photo_option", "lens_ar_option"]);

    // Ten times the sales, the same queries.
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `poss_${i}`, order_id: i % 2 ? "order_1" : "order_2", customer_id: "cus_1" }));
    const second = fakePg(TABLES);
    await loadSaleDetails(container(second.pg), many);
    expect(second.hits).toEqual(hits);
  });

  it("fills each sale from its own order and customer", async () => {
    const { pg } = fakePg(TABLES);
    const map = await loadSaleDetails(container(pg), sales);
    expect(map.get("poss_1")).toMatchObject({
      customer_name: "Ana Pérez",
      customer_phone: "+1 555 0100",
      frame_brand: "Flexure",
      frame_model: "Flexure 2041",
      frame_color: "Dorado",
      frame_sku: "FX1-GOLD",
      own_frame: false,
      has_rx: true,
    });
    expect(map.get("poss_1")?.lens_summary?.es).toBe("Monofocal · CR-39 · none · AR Premium");
  });

  it("a sale with no customer keeps its frame; one with no order is all nulls", async () => {
    const { pg } = fakePg(TABLES);
    const map = await loadSaleDetails(container(pg), sales);
    expect(map.get("poss_2")).toMatchObject({ customer_name: null, customer_phone: null, own_frame: true, frame_model: "Montura del cliente" });
    expect(map.get("poss_3")).toEqual(EMPTY_SALE_DETAIL);
  });

  it("an empty page asks nothing, and a table that is not there does not sink the list", async () => {
    const { pg, hits } = fakePg(TABLES);
    expect((await loadSaleDetails(container(pg), [])).size).toBe(0);
    expect(hits).toEqual([]);

    const broken = (() => {
      const q = {
        innerJoin: () => q,
        whereIn: () => q,
        whereNull: () => q,
        select: async () => {
          throw new Error("relation does not exist");
        },
      };
      return (() => q) as unknown as never;
    })();
    const map = await loadSaleDetails(container(broken), sales);
    expect(map.get("poss_1")).toEqual(EMPTY_SALE_DETAIL);
  });
});

// ── listSales: the detail is opt-in, and it rides on the row ─────────────────

describe("listSales withDetail", () => {
  const stored = [
    { id: "poss_1", number: "A-000001", establishment_id: "est_1", terminal_id: "t1", seller_id: "u_1", seller_code: "V1", customer_id: "cus_1", order_id: "order_1", list_cents: 20000, discount_cents: 0, discount_pct: 0, total_cents: 20000, paid_cents: 20000, insurance_cents: 0, balance_cents: 0, status: "completed", tray_number: null, promised_on: null, delivery: "pickup", created_at: "2026-10-27T15:00:00.000Z" },
    { id: "poss_3", number: "A-000003", establishment_id: "est_1", terminal_id: "t1", seller_id: "u_1", seller_code: "V1", customer_id: null, order_id: null, list_cents: 5000, discount_cents: 0, discount_pct: 0, total_cents: 5000, paid_cents: 5000, insurance_cents: 0, balance_cents: 0, status: "completed", tray_number: null, promised_on: null, delivery: "pickup", created_at: "2026-10-26T15:00:00.000Z" },
  ];

  const scope = (pg: never) => {
    const svc = { listPosSales: async () => stored, listPosSalePayments: async () => [] };
    return { resolve: (key: string) => (key === "pos" ? svc : pg) } as never;
  };

  it("attaches the customer and the frame to every row, and nulls where there is no order", async () => {
    const { listSales } = await import("../src/lib/pos-data");
    const { pg, hits } = fakePg(TABLES);
    const rows = await listSales(scope(pg), { establishmentIds: ["est_1"] }, 50, { withDetail: true });
    expect(rows[0]).toMatchObject({ number: "A-000001", customer_name: "Ana Pérez", frame_brand: "Flexure", frame_model: "Flexure 2041", own_frame: false, has_rx: true });
    expect(rows[1]).toMatchObject({ number: "A-000003", customer_name: null, frame_brand: null, frame_model: null, own_frame: false, has_rx: false });
    expect(hits).toEqual(["customer", "order_item", "product", "lens_design", "lens_material", "lens_photo_option", "lens_ar_option"]);
  });

  it("asks nothing extra when the caller did not ask for the detail", async () => {
    const { listSales } = await import("../src/lib/pos-data");
    const { pg, hits } = fakePg(TABLES);
    const rows = await listSales(scope(pg), { establishmentIds: ["est_1"] }, 50);
    expect(hits).toEqual([]);
    expect(rows[0].customer_name).toBeUndefined();
  });
});
