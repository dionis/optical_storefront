/**
 * Unit tests for the Google Sheets order row. Pure functions only — no Google
 * API calls in CI.
 */
import {
  HISTORY_COLUMNS,
  ORDER_COLUMNS,
  ORDER_TYPE,
  buildRows,
  eventLabel,
  normalizePrivateKey,
  orderType,
  privateKeyProblem,
  sheetDateSerial,
  sheetDateTimeSerial,
  sheetMonth,
  spreadsheetIdFrom,
  STAGE_LABEL,
} from "../src/lib/gsheet-sync";
import { deriveOrderProgress } from "../src/lib/order-status";
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

  const { orderRow, historyRow } = buildRows(order, "compra_confirmada", {
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

  it("follows the template's column structure", () => {
    expect(orderRow).toHaveLength(ORDER_COLUMNS.length);
    expect(ORDER_COLUMNS.map((c) => c.type)).toEqual([
      "TEXT", "DROPDOWN", "TEXT", "TEXT", "DROPDOWN", "DATE", "TEXT", "TEXT",
    ]);
  });

  it("only writes dropdown values the column accepts", () => {
    ORDER_COLUMNS.forEach((c, i) => {
      if (c.type === "DROPDOWN") expect(c.options).toContain(orderRow[i]);
    });
  });

  it("carries the buyer, the purchase and the AI/try-on facts", () => {
    const [pedido, , detalles, cliente, estado, fecha, archivo, notas] = orderRow as string[];
    expect(pedido).toBe("#42");
    expect(detalles).toContain("TOTAL 210.00 USD");
    expect(cliente).toContain("Ana Pérez");
    expect(cliente).toContain("ana@example.com");
    expect(cliente).toContain("+17875550000");
    expect(cliente).toContain("San Juan");
    expect(estado).toBe(STAGE_LABEL[deriveOrderProgress(order).stage]);
    expect(fecha).toBe(46314);
    expect(archivo).toContain("Prueba virtual");
    expect(notas).toContain("Luis");
    expect(notas).toContain("IA");
  });

  it("copies the values read from the prescription", () => {
    const notas = String(orderRow[7]);
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
    expect(String(orderRow[6])).toContain("solo en el panel");
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
