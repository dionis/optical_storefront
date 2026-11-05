import { renderReceiptEmail } from "../src/lib/email/pos-emails";
import type { PrescriptionForEmail } from "../src/lib/email/order-confirmation";
import type { SaleDocument } from "../src/lib/pos-documents";

const rx: PrescriptionForEmail = {
  od: { sph: -2.25, cyl: -0.5, axis: 90, add: null, prism: null, base: null },
  os: { sph: -2, cyl: null, axis: null, add: null, prism: null, base: null },
  pd: 63, pd_od: null, pd_os: null, seg_height: 18,
} as PrescriptionForEmail;

const doc = {
  kind: "receipt",
  business: { name: "RUBI LENS", legal_name: "RUBI", url: "https://x", support_email: null, timezone: "America/Chicago" },
  store: { code: "Op1", name: "Tienda Norte", address: "1 Main St", phone: "+1 713 555 0100", receipt_note: null },
  terminal: { code: "Op1-POS1", receipt_locale: "es", ticket_locale: "en" },
  sale: { id: "s1", number: "Op1-000001", created_at: "2026-10-01T15:00:00Z", updated_at: "2026-10-01T15:00:00Z", promised_on: "2026-10-15", seller_code: "ANA", tray: "Op1-3", status: "completed", voided_at: null, delivery: "pickup" },
  customer: { name: "Dionis Nota" },
  tracking_url: "https://x/my-orders",
  print: { count: 0, reprint: false, first_at: null },
  lines: [
    { kind: "frame", title: "Di Caprio 407", variant_title: "Negro", sku: "DC407", list: 166, unit_price: 166, tax_amount: 0, frame_price: 70, lens_price: 96, image_url: "https://cdn.example.com/dc407.webp", design_code: "sv", lens: { design: { es: "Visión sencilla", en: "Single vision" }, material: { es: "Policarbonato", en: "Polycarbonate" }, photo: null, ar: null, category: "sv" }, handling: "frame_supplied", frame: { brand: "Di Caprio", model: "407", material: null, eye_size: 52, bridge: 18 }, own_frame: null, prescription_id: "rx_1" },
    { kind: "own_frame", title: "Ray-Ban negro", variant_title: null, sku: null, list: 80, unit_price: 80, tax_amount: 0, frame_price: 0, lens_price: 80, design_code: "sv", lens: null, handling: "patient_own_frame", frame: null, own_frame: { description: "Ray-Ban negro", has_photo: true }, prescription_id: "rx_1" },
  ],
  totals: { list: 260, discount: 14, discount_pct: 5, tax: 0, total: 246, paid: 100, insurance: 0, balance: 146 },
  payments: [{ method_code: "cash", method: null, amount: 100, kind: "deposit", created_at: "2026-10-01T15:00:00Z" }],
} as unknown as SaleDocument;

describe("the detailed receipt email", () => {
  const extras = { detailed: true, prescriptions: { rx_1: rx }, itemImages: { 1: { cid: "montura-1@rubilens", filename: "m.jpg", isImage: true } } };
  const es = renderReceiptEmail(doc, "es", extras);

  it("has what was bought, with the frames' photos", () => {
    expect(es.html).toContain('src="https://cdn.example.com/dc407.webp"');
    expect(es.html).toContain('src="cid:montura-1@rubilens"');
    for (const v of ["Di Caprio 407", "Negro", "DC407", "52-18", "Policarbonato", "Tienda Norte", "1 Main St", "Op1-000001", "Op1-3"]) expect(es.html).toContain(v);
    expect(es.html).toContain("Recoger en la tienda");
  });

  it("has the prescription, in both versions", () => {
    for (const body of [es.html, es.text]) {
      expect(body).toContain("-2.25");
      expect(body).toContain("63");
    }
    expect(es.html).toContain("Cómo leer tu receta");
    expect(es.html).toContain("guárdalo");
  });

  it("speaks the receipt's language", () => {
    const en = renderReceiptEmail(doc, "en", { detailed: true, prescriptions: { rx_1: rx } });
    expect(en.html).toContain("Pick up at the store");
    expect(en.html).toContain("How to read your prescription");
    expect(en.html).not.toContain("Recoger en la tienda");
  });

  it("a frame without prescription says nothing about one", () => {
    const frameOnly = { ...doc, lines: [{ ...doc.lines![0], prescription_id: null, lens: null, design_code: "frame-only" }] } as SaleDocument;
    const r = renderReceiptEmail(frameOnly, "es", { detailed: true });
    expect(r.html).toContain("Solo montura");
    expect(r.html).not.toContain("Cómo leer tu receta");
  });

  it("escapes what comes from the catalog", () => {
    const evil = { ...doc, lines: [{ ...doc.lines![0], title: "<script>x</script>", prescription_id: null }] } as SaleDocument;
    expect(renderReceiptEmail(evil, "es", { detailed: true }).html).not.toContain("<script>x");
  });
});

describe("the simple receipt email, the default", () => {
  const withAll = { prescriptions: { rx_1: rx }, itemImages: { 1: { cid: "montura-1@rubilens", filename: "m.jpg", isImage: true } } };

  it("has no prescription or photos, even with them at hand", () => {
    for (const r of [renderReceiptEmail(doc, "es", withAll), renderReceiptEmail(doc, "es", { ...withAll, detailed: false })]) {
      for (const body of [r.html, r.text]) {
        expect(body).not.toContain("-2.25");
        expect(body).not.toContain("Cómo leer tu receta");
        expect(body).not.toContain("guárdalo");
      }
      expect(r.html).not.toContain("cdn.example.com");
      expect(r.html).not.toContain("cid:");
    }
  });

  it("only true opens the details", () => {
    for (const detailed of [undefined, false, "true", 1, {}]) {
      const r = renderReceiptEmail(doc, "es", { ...withAll, detailed: detailed as never });
      expect(r.html).not.toContain("-2.25");
    }
  });

  it("still has what was bought and paid, and says where the prescription is", () => {
    const r = renderReceiptEmail(doc, "es");
    for (const v of ["Di Caprio 407", "Policarbonato", "Op1-000001", "Op1-3"]) expect(r.html).toContain(v);
    expect(r.html).toContain("no incluye los valores de tu receta");
    expect(r.text).toContain("no incluye los valores de tu receta");
    expect(renderReceiptEmail(doc, "en").html).toContain("does not include your prescription values");
  });
});

describe("dates and money on the receipt", () => {
  it("shows the sale's time in the store's timezone, not the server's (UTC)", () => {
    // 2026-10-01T23:30Z is 6:30 pm in Chicago (CDT) — still October 1st there.
    const evening = { ...doc, sale: { ...doc.sale, created_at: "2026-10-01T23:30:00Z" } } as SaleDocument;
    const es = renderReceiptEmail(evening, "es");
    expect(es.text).toMatch(/1 oct 2026, 6:30\s?p\.?\s?m\.?/i);
    expect(es.text).not.toContain("2 oct");
    const en = renderReceiptEmail(evening, "en");
    expect(en.text).toMatch(/Oct 1, 2026, 6:30\s?PM/);
  });

  it("prints list prices per line, then subtotal, discount and total once", () => {
    const es = renderReceiptEmail(doc, "es");
    // Lines at list price (166 + 80 = 260), subtotal 260, −14 discount, total 246.
    expect(es.text).toContain("Di Caprio 407 · Negro: $166.00");
    expect(es.text).toContain("Subtotal (precio de lista): $260.00");
    expect(es.text).toContain("Descuento 5 %: −$14.00");
    expect(es.text).toContain("Total: $246.00");
    const idxSub = es.text.indexOf("Subtotal"), idxDisc = es.text.indexOf("Descuento"), idxTot = es.text.indexOf("Total: $246");
    expect(idxSub).toBeLessThan(idxDisc);
    expect(idxDisc).toBeLessThan(idxTot);
  });

  it("without discount or tax there is no subtotal row", () => {
    const plain = { ...doc, totals: { ...doc.totals!, discount: 0, discount_pct: 0, list: 246 } } as SaleDocument;
    expect(renderReceiptEmail(plain, "es").text).not.toContain("Subtotal");
  });
});
