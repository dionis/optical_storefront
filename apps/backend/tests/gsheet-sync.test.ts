/**
 * Unit tests for the Google Sheets order row. Pure functions only — no Google
 * API calls in CI.
 */
import {
  COST_SHEET_HEADERS,
  HISTORY_COLUMNS,
  ORDER_COLUMNS,
  ORDER_TYPE,
  buildRows,
  costRulesSheetRows,
  eventLabel,
  normalizePrivateKey,
  orderType,
  privateKeyProblem,
  richTextCell,
  EDITABLE_ORDER_COLUMNS,
  sheetDateSerial,
  sheetDateTimeSerial,
  sheetMonth,
  spreadsheetIdFrom,
  STAGE_LABEL,
} from "../src/lib/gsheet-sync";
import { deriveOrderProgress } from "../src/lib/order-status";
import type { CostRule } from "../src/lib/costing";
import { generateKeyPairSync } from "node:crypto";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

describe("spreadsheetIdFrom", () => {
  it.each([
    [`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=0#gid=0`],
    [`https://drive.google.com/file/d/${ID}/view?usp=sharing`],
    [`https://drive.google.com/open?id=${ID}`],
    [ID],
  ])("reads the id from %s", (value) => {
    expect(spreadsheetIdFrom(value)).toBe(ID);
  });

  it("returns null for empty or unrelated values", () => {
    expect(spreadsheetIdFrom("")).toBeNull();
    expect(spreadsheetIdFrom("https://example.com/x")).toBeNull();
  });
});

describe("sheetDateSerial", () => {
  it("matches the Sheets serial for a date", () => {
    // 19/10/2026 in Sheets is serial 46314.
    expect(sheetDateSerial("2026-10-19T15:00:00Z", "UTC")).toBe(46314);
  });

  it("uses the configured time zone for the day", () => {
    // 02:00 UTC is still the previous evening in New York.
    expect(sheetDateSerial("2026-10-19T02:00:00Z", "America/New_York")).toBe(46313);
  });
});

describe("orderType", () => {
  const rx = { metadata: { prescription_id: "rx_1", lens_config: { design_code: "sv" } } };
  const lenses = { metadata: { lens_config: { design_code: "sv" } } };
  const frame = { metadata: { lens_config: { design_code: "frame-only" } } };
  it("classifies an order by its lines", () => {
    expect(orderType([rx])).toBe(ORDER_TYPE.rx);
    expect(orderType([lenses])).toBe(ORDER_TYPE.lenses);
    expect(orderType([frame])).toBe(ORDER_TYPE.frame);
    expect(orderType([rx, frame])).toBe(ORDER_TYPE.mixed);
  });
});

describe("buildRows", () => {
  const order = {
    id: "order_1",
    display_id: 42,
    email: "ana@example.com",
    currency_code: "usd",
    created_at: "2026-10-19T15:00:00Z",
    payment_status: "captured",
    fulfillment_status: "not_fulfilled",
    metadata: { phone: "+17875550000", notify_sms: true },
    subtotal: 200,
    shipping_total: 10,
    tax_total: 0,
    discount_total: 0,
    total: 210,
    items: [
      {
        title: "Flexure 2043",
        quantity: 1,
        metadata: { prescription_id: "rx_1", lens_config: { design_code: "sv" } },
      },
    ],
    shipping_address: {
      first_name: "Ana",
      last_name: "Pérez",
      address_1: "Calle 1",
      city: "San Juan",
      postal_code: "00901",
      country_code: "pr",
    },
  };

  const built = buildRows(order, "compra_confirmada", {
    lines: [
      { frame_name: "Flexure 2043", brand: "Flexure", sku: "FX2043-BLK", color: "Negro", quantity: 1, design: "Monofocal", material: "Policarbonato", photo: null, ar: "Antirreflejo", with_rx: true, total: 200 },
    ],
    payment: { provider: "stripe", method: "card", brand: "visa", last4: "4242" },
    rx: [
      {
        od: { sph: 1.5, cyl: -0.5, axis: 170, add: 2, prism: null, base: null },
        os: { sph: 1.25, cyl: -0.5, axis: 170, add: 2, prism: null, base: null },
        pd: null,
        pd_od: 31.5,
        pd_os: 31.5,
        seg_height: 22,
        source: "ocr",
        verified_by_user: true,
        patient_for: "other",
        patient_name: "Luis",
        measurement_source: "ai",
        measurement_quality: "high",
        has_tryon: true,
        has_file: true,
      },
    ],
    adminUrl: "https://shop.example/admin",
  });
  const { orderRow, historyRow } = built;

  it("follows the template's column structure", () => {
    expect(orderRow).toHaveLength(ORDER_COLUMNS.length);
    expect(ORDER_COLUMNS.map((c) => c.type)).toEqual([
      "TEXT", "DROPDOWN", "TEXT", "TEXT", "DROPDOWN", "DATE", "DOUBLE", "DROPDOWN", "TEXT", "DROPDOWN", "TEXT", "TEXT", "TEXT",
      // Vendedor, Costo, Margen, Desglose costo
      "TEXT", "DOUBLE", "DOUBLE", "TEXT",
    ]);
    expect(ORDER_COLUMNS.slice(-4).map((c) => c.name)).toEqual(["Vendedor", "Costo", "Margen", "Desglose costo"]);
    expect(ORDER_COLUMNS[ORDER_COLUMNS.length - 1]).toMatchObject({ width: 320, wrap: true });
    expect(HISTORY_COLUMNS.slice(-4).map((c) => c.key)).toEqual(["seller", "cost", "margin", "cost_breakdown"]);
    expect(HISTORY_COLUMNS[HISTORY_COLUMNS.length - 1]).toMatchObject({ name: "Desglose costo", width: 320, wrap: true });
    expect(ORDER_COLUMNS.map((c) => c.name)).toEqual(expect.arrayContaining(EDITABLE_ORDER_COLUMNS));
  });

  it("only writes dropdown values the column accepts", () => {
    ORDER_COLUMNS.forEach((c, i) => {
      if (c.type === "DROPDOWN") expect(c.options).toContain(orderRow[i]);
    });
  });

  it("carries the buyer, the purchase and the AI/try-on facts", () => {
    const [pedido, , detalles, cliente, estado, fecha, total, pagado, marca, tryon, archivo, notas] = orderRow as string[];
    expect(pedido).toBe("#42");
    expect(detalles).toContain("TOTAL 210.00 USD");
    expect(cliente).toContain("Ana Pérez");
    expect(cliente).toContain("ana@example.com");
    expect(cliente).toContain("+17875550000");
    expect(cliente).toContain("San Juan");
    expect(estado).toBe(STAGE_LABEL[deriveOrderProgress(order).stage]);
    expect(fecha).toBe(46314);
    expect(total).toBe(210);
    expect(pagado).toBe("Sí");
    expect(marca).toBe("Flexure");
    expect(tryon).toBe("Sí");
    expect(archivo).toContain("Montura: Flexure 2043");
    expect(archivo).toContain("prueba virtual");
    expect(archivo).not.toMatch(/https?:\/\//); // referencias, nunca una URL a la vista
    expect(notas).toContain("Luis");
    expect(notas).toContain("IA");
  });

  it("copies the values read from the prescription", () => {
    const notas = String(orderRow[11]);
    expect(notas).toContain("OD: SPH +1.50 CYL -0.50 AXIS 170 ADD +2.00");
    expect(notas).toContain("OS: SPH +1.25");
    expect(notas).toContain("DIP OD 31.5 / OS 31.5 mm");
    expect(notas).toContain("Altura 22 mm");
    expect(notas).toContain("OCR");
  });

  it("carries brand, sku, lenses, prescription and payment", () => {
    const i = (key: string) => HISTORY_COLUMNS.findIndex((c) => c.key === key);
    const h = historyRow as unknown[];
    expect(h[i("brand")]).toBe("Flexure");
    expect(h[i("sku")]).toBe("FX2043-BLK");
    expect(h[i("lenses")]).toContain("Monofocal");
    expect(h[i("rx")]).toBe("Sí");
    expect(h[i("rx_od")]).toContain("SPH +1.50");
    expect(h[i("rx_pd")]).toContain("31.5");
    expect(h[i("rx_source")]).toContain("OCR");
    expect(h[i("tryon")]).toBe("Sí");
    expect(h[i("payment")]).toContain("4242");
    expect(h.join(" ")).not.toMatch(/rx\/|\.pdf|\.jpe?g/i);
  });

  it("never copies the original prescription document", () => {
    // It stays in the private bucket: the sheet only says it exists.
    const all = orderRow.join(" ");
    expect(all).not.toMatch(/rx\/|\.pdf|\.jpe?g|r2\./i);
    expect(String(orderRow[10])).toContain("Receta: ver documento original");
  });

  it("remembers what the editable columns show (mirror) and takes an owner note", () => {
    expect(built.mirror).toEqual({ status: STAGE_LABEL[deriveOrderProgress(order).stage], tracking: "" });
    expect(orderRow[ORDER_COLUMNS.findIndex((c) => c.name === "Guía (tracking)")]).toBe("");
    const withNote = buildRows(order, "correccion", { note: "No se pudo cambiar a \"Entregado\": nada en camino." });
    expect(String(withNote.orderRow[ORDER_COLUMNS.findIndex((c) => c.name === "Notas")])).toContain("⚠ No se pudo cambiar");
    expect(withNote.historyRow[HISTORY_COLUMNS.findIndex((c) => c.key === "event")]).toBe("Cambio rechazado (hoja corregida)");
  });

  it("fills seller, cost and margin, and appends the owner's note", () => {
    const col = (name: string) => ORDER_COLUMNS.findIndex((c) => c.name === name);
    const hcol = (key: string) => HISTORY_COLUMNS.findIndex((c) => c.key === key);
    // Sin vendedor ni ficha: celdas vacías, nunca ceros que parezcan un costo real.
    expect(orderRow[col("Vendedor")]).toBe("");
    expect(orderRow[col("Costo")]).toBe("");
    expect(orderRow[col("Margen")]).toBe("");

    const withSeller = buildRows(
      { ...order, metadata: { ...order.metadata, seller_code: "ana", owner_note: "Llamar antes de enviar" } },
      "costo",
      { cost: { cost_total: 61.4, margin: 148.6 } }
    );
    expect(withSeller.orderRow[col("Vendedor")]).toBe("ANA");
    expect(withSeller.orderRow[col("Costo")]).toBe(61.4);
    expect(withSeller.orderRow[col("Margen")]).toBe(148.6);
    expect(String(withSeller.orderRow[col("Notas")])).toContain("Nota: Llamar antes de enviar");
    expect(withSeller.historyRow[hcol("seller")]).toBe("ANA");
    expect(withSeller.historyRow[hcol("cost")]).toBe(61.4);
    expect(withSeller.historyRow[hcol("margin")]).toBe(148.6);
    expect(withSeller.historyRow[hcol("event")]).toBe("Ficha de costo actualizada");
    expect(String(withSeller.historyRow[hcol("notes")])).toContain("Nota: Llamar antes de enviar");
    expect(buildRows(order, "nota", {}).historyRow[hcol("event")]).toBe("Nota del dueño actualizada");
    // Without lines the breakdown is empty, never "undefined".
    expect(withSeller.orderRow[col("Desglose costo")]).toBe("");
    expect(withSeller.historyRow[hcol("cost_breakdown")]).toBe("");
  });

  it("writes the seller with the network that brought the sale, and the cost breakdown", () => {
    const col = (name: string) => ORDER_COLUMNS.findIndex((c) => c.name === name);
    const hcol = (key: string) => HISTORY_COLUMNS.findIndex((c) => c.key === key);
    const lines = [
      { label: "Montura Peachtree", subtotal: 12 },
      { label: "Envío real", subtotal: 28 },
      { label: "Comisión Stripe (%)", subtotal: 1.25 },
      { label: "Comisión del vendedor (10%)", subtotal: 4.3 },
    ];
    const built = buildRows(
      { ...order, metadata: { ...order.metadata, seller_code: "ana", seller_source: "Instagram" } },
      "costo",
      { cost: { cost_total: 45.55, margin: 164.45, lines } }
    );
    expect(built.orderRow[col("Vendedor")]).toBe("ANA · instagram");
    expect(built.historyRow[hcol("seller")]).toBe("ANA · instagram");
    const text = "Montura Peachtree 12.00 · Envío real 28.00 · Comisión Stripe (%) 1.25 · Comisión del vendedor (10%) 4.30";
    expect(built.orderRow[col("Desglose costo")]).toBe(text);
    expect(built.historyRow[hcol("cost_breakdown")]).toBe(text);
    expect(built.orderRow).toHaveLength(ORDER_COLUMNS.length);
    expect(built.historyRow).toHaveLength(HISTORY_COLUMNS.length);
    // A source without a code means nothing: the cell stays empty.
    expect(buildRows({ ...order, metadata: { seller_source: "tiktok" } }, "costo", {}).orderRow[col("Vendedor")]).toBe("");
  });

  it("links each Archivo reference (frame → product page, receta/foto → panel)", () => {
    const { fileLinks } = built;
    const text = String(orderRow[10]);
    expect(fileLinks.length).toBeGreaterThanOrEqual(3);
    for (const l of fileLinks) expect(text.slice(l.start, l.end)).not.toContain("\n");
    const frame = fileLinks.find((l) => text.slice(l.start, l.end).startsWith("Montura"));
    expect(frame?.uri).toMatch(/^https:\/\/shop\.example\/producto\//);
    const receta = fileLinks.find((l) => text.slice(l.start, l.end).startsWith("Receta"));
    expect(receta?.uri).toBe("https://shop.example/admin?tab=orders&order=order_1");
    const cell = richTextCell(text, fileLinks);
    const runs = cell.textFormatRuns as Array<{ startIndex: number; format: { link?: { uri: string } } }>;
    expect(runs[0].startIndex).toBe(0);
    expect(runs.some((r) => r.format.link)).toBe(true);
  });
});

describe("costRulesSheetRows", () => {
  const rule = (kind: CostRule["kind"], match_key: string, label: string, amount: number, unit: CostRule["unit"] = "fixed", over: Partial<CostRule> = {}): CostRule => ({
    kind, match_key, label, amount, unit, active: true, sort_order: 0, ...over,
  });

  it("lays out title, note, header and one row per rule grouped, with the profit target last", () => {
    const rows = costRulesSheetRows([
      rule("order_percent", "payment_fee", "Comisión del cobro", 2.9, "percent", { sort_order: 0 }),
      rule("order_percent", "rent", "Alquiler", 10, "percent", { sort_order: 1 }),
      rule("order_percent", "profit_target", "Ganancia objetivo", 30, "percent", { sort_order: 2 }),
      rule("frame_brand", "flexure", "Montura Flexure", 18, "fixed", { sort_order: 5 }),
      rule("lens_design", "sv", "Lente Visión Sencilla", 6, "fixed", { sort_order: 6, active: false }),
      rule("shipping", "actual", "Envío", 0, "fixed", { sort_order: 2 }),
    ]);
    expect(String(rows[0][0])).toMatch(/Fichas de costo y distribución$/);
    expect(String(rows[1][0])).toMatch(/panel/);
    expect(rows[3]).toEqual(COST_SHEET_HEADERS);
    const body = rows.slice(4);
    expect(body.map((r) => r[0])).toEqual(["Monturas", "Lentes", "Por pedido", "Comisiones y distribución", "Comisiones y distribución", "Objetivo"]);
    expect(body[0]).toEqual(["Monturas", "Montura Flexure", "Montura (por marca)", 18, "USD", "Sí", "frame_brand:flexure"]);
    expect(body[1]).toEqual(["Lentes", "Lente Visión Sencilla", "Lente (diseño)", 6, "USD", "No", "lens_design:sv"]);
    expect(body[3]).toEqual(["Comisiones y distribución", "Comisión del cobro", "Porcentaje del pedido", 2.9, "%", "Sí", "order_percent:payment_fee"]);
    expect(body[4][6]).toBe("order_percent:rent");
    expect(body[5]).toEqual(["Objetivo", "Ganancia objetivo", "Meta de ganancia (no es un costo)", 30, "%", "Sí", "order_percent:profit_target"]);
    // The target never appears twice (it is not a regular row).
    expect(body.filter((r) => String(r[6]).includes("profit_target"))).toHaveLength(1);
  });

  it("omits the target row when none is defined and never leaves holes", () => {
    const rows = costRulesSheetRows([rule("order_fixed", "lab", "Laboratorio", 12)]);
    expect(rows).toHaveLength(5);
    expect(rows.every(Array.isArray)).toBe(true);
    expect(rows[4][0]).toBe("Por pedido");
  });
});

describe("history row", () => {
  const byKey = (key: string) => {
    const i = HISTORY_COLUMNS.findIndex((c) => c.key === key);
    return (buildRows(order, "compra_confirmada", {}).historyRow as unknown[])[i];
  };
  const order = {
    id: "order_9", display_id: 9, email: "luis@example.com", currency_code: "usd",
    created_at: "2026-10-19T15:00:00Z", payment_status: "captured", fulfillment_status: "not_fulfilled",
    metadata: {}, subtotal: 99, shipping_total: 6.95, tax_total: 0, discount_total: 0, total: 105.95,
    items: [{ title: "DiCaprio DC407", product_title: "DiCaprio DC407", variant_title: "Dorado", quantity: 2, metadata: {} }],
    shipping_address: { first_name: "Luis", last_name: "Gómez", address_1: "100 Main St", city: "Katy", province: "TX", postal_code: "77449", country_code: "us", phone: "+12815550000" },
  };

  it("has one value per history column, in order", () => {
    const { historyRow } = buildRows(order, "compra_confirmada", {});
    expect(historyRow).toHaveLength(HISTORY_COLUMNS.length);
    expect(byKey("order")).toBe("#9");
    expect(byKey("event")).toBe("Compra confirmada");
    expect(byKey("month")).toBe("2026-10");
    expect(byKey("customer")).toBe("Luis Gómez");
    expect(byKey("city")).toBe("Katy");
    expect(byKey("zip")).toBe("77449");
    expect(byKey("model")).toBe("DiCaprio DC407");
    expect(byKey("color")).toBe("Dorado");
    expect(byKey("qty")).toBe(2);
    expect(byKey("total")).toBe(105.95);
    expect(byKey("paid")).toBe("Sí");
    expect(byKey("rx")).toBe("No");
    expect(byKey("order_id")).toBe("order_9");
    expect(typeof byKey("at")).toBe("number");
  });

  it("names the event for the owner", () => {
    expect(eventLabel("etapa: in_lab")).toBe("Etapa: En laboratorio");
    expect(eventLabel("cancelado (canceled)")).toBe("Cancelado por el cliente");
    expect(eventLabel("resincronizado")).toContain("resincronización");
  });

  it("serial date-time and month follow the configured time zone", () => {
    expect(sheetMonth("2026-11-01T02:00:00Z", "America/Chicago")).toBe("2026-10");
    expect(sheetDateTimeSerial("2026-10-19T12:00:00Z", "UTC")).toBeCloseTo(46314.5, 5);
  });
});

describe("normalizePrivateKey", () => {
  const pem = generateKeyPairSync("rsa", { modulusLength: 1024 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const escaped = pem.replace(/\n/g, "\n");

  it.each([
    ["real newlines", pem],
    ["escaped \n", escaped],
    ["escaped and quoted", `"${escaped}"`],
    ["double-escaped", pem.replace(/\n/g, "\\n")],
    ["CRLF", pem.replace(/\n/g, "\r\n")],
    ["single line with spaces", pem.replace(/\n/g, " ")],
    ["base64 of the PEM", Buffer.from(pem).toString("base64")],
  ])("yields a usable key from %s", (_label, raw) => {
    const { key } = normalizePrivateKey(raw);
    expect(privateKeyProblem(key)).toBeNull();
  });

  it("reads key and email from the whole service-account JSON", () => {
    const json = JSON.stringify({ client_email: "bot@p.iam.gserviceaccount.com", private_key: pem });
    const { key, email } = normalizePrivateKey(json);
    expect(email).toBe("bot@p.iam.gserviceaccount.com");
    expect(privateKeyProblem(key)).toBeNull();
  });

  it("explains a value that is not a PEM key", () => {
    expect(privateKeyProblem(normalizePrivateKey("1234567890abcdef").key)).toMatch(/BEGIN PRIVATE KEY/);
    expect(privateKeyProblem("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n")).toMatch(
      /no es una clave PEM/
    );
  });
});
