/**
 * Unit tests for the Google Sheets order row. Pure functions only — no Google
 * API calls in CI.
 */
import {
  ORDER_COLUMNS,
  ORDER_TYPE,
  buildRows,
  orderType,
  sheetDateSerial,
  spreadsheetIdFrom,
  STAGE_LABEL,
} from "../src/lib/gsheet-sync";
import { deriveOrderProgress } from "../src/lib/order-status";

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

  const { orderRow } = buildRows(order, "compra_confirmada", {
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

  it("never copies the original prescription document", () => {
    // It stays in the private bucket: the sheet only says it exists.
    const all = orderRow.join(" ");
    expect(all).not.toMatch(/rx\/|\.pdf|\.jpe?g|r2\./i);
    expect(String(orderRow[6])).toContain("solo en el panel");
  });
});
