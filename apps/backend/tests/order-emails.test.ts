/**
 * Unit tests for the order confirmation emails.
 *
 * What these protect: the customer and the store must be able to read, from the
 * message alone, exactly which glasses were bought — frame specs included — and
 * the lab must find the fitting height without opening the admin. Both templates
 * are pure functions over already-computed data, so no DB and no HTTP here (same
 * "no live I/O in CI" rule as the other suites).
 */

import { enrichLensItems, type EnrichedItem } from "../src/lib/email/order-enrich";
import type { OrderEmailData, PrescriptionForEmail } from "../src/lib/email/order-confirmation";
import {
  renderAdminOrderNotification,
  renderCustomerOrderConfirmation,
} from "../src/lib/email/order-confirmation";

const order: OrderEmailData = {
  id: "order_01",
  display_id: 42,
  email: "shopper@example.com",
  currency_code: "usd",
  created_at: "2026-08-05T15:00:00.000Z",
  subtotal: 432,
  shipping_total: 0,
  tax_total: 0,
  discount_total: 0,
  total: 432,
  items: [
    {
      title: "Flexure 2043",
      product_title: "Flexure 2043",
      variant_title: "Black",
      quantity: 1,
      unit_price: 432,
      total: 432,
      metadata: { prescription_id: "rx_01", lens_config: { design_code: "prog-high" } },
    },
  ],
  shipping_address: { first_name: "Ana", last_name: "Pérez", address_1: "Calle 1", city: "Miami" },
};

const enriched: EnrichedItem[] = [
  {
    frame_name: "Flexure 2043",
    collection: "Flexure",
    color: "Black",
    frame_price: 32,
    design: "Progresivo · Premium",
    material: { label: "Índice 1.67", price: 280 },
    photo: null,
    ar: { label: "Flawless", price: 120 },
    specs: {
      sku: "889756112094",
      size: "52□18-140",
      lens_width: 52,
      lens_height: 34,
      bridge: 18,
      temple: 140,
      shape: "Rectángulo",
      style: "Marco completo",
      material: "Acetato",
      gender: "Unisexo",
      age_group: "Adulto",
      features: ["Spring Hinge"],
    },
    with_rx: true,
    quantity: 1,
    total: 432,
  },
];

const prescriptions: Record<string, PrescriptionForEmail> = {
  rx_01: {
    od: { sph: 1.5, cyl: -0.5, axis: 170, add: 2, prism: null, base: null },
    os: { sph: 1.25, cyl: -0.5, axis: 170, add: 2, prism: null, base: null },
    pd: null,
    pd_od: 31.5,
    pd_os: 31.5,
    seg_height: 22,
    source: "ocr",
    verified_by_user: true,
  },
};

const extras = { items: enriched, shippingMethod: { name: "Standard", amount: 0 }, tracking: [] };

describe("order confirmation emails", () => {
  for (const locale of ["es", "en"] as const) {
    describe(`locale ${locale}`, () => {
      const customer = renderCustomerOrderConfirmation(order, locale, prescriptions, extras);
      const admin = renderAdminOrderNotification(order, locale, prescriptions, extras);

      it("prints the frame technical sheet in both copies", () => {
        for (const mail of [customer, admin]) {
          for (const part of [mail.html, mail.text]) {
            expect(part).toContain("889756112094"); // SKU/UPC of the color bought
            expect(part).toContain("52□18-140"); // optical measurements
            expect(part).toContain("34 mm"); // B (lens height)
            expect(part).toContain("Marco completo");
            expect(part).toContain("Spring Hinge");
          }
        }
      });

      it("prints the lens configuration with its prices", () => {
        for (const mail of [customer, admin]) {
          for (const part of [mail.html, mail.text]) {
            expect(part).toContain("Índice 1.67");
            expect(part).toContain("Flawless");
            expect(part).toContain("Progresivo · Premium");
          }
        }
      });

      it("carries the fitting height, which the lab cannot cut a progressive without", () => {
        for (const mail of [customer, admin]) {
          expect(mail.html).toContain("22");
          expect(mail.text).toContain("22 mm");
        }
      });

      it("repeats the measurements the shopper saw in the funnel summary", () => {
        // PD, addition and fitting height, each as its own labelled measurement —
        // that is how the customer met them on screen and how they look for them.
        const pd = locale === "es" ? "Distancia pupilar" : "Pupillary distance";
        const add = locale === "es" ? "Adición (ADD)" : "Addition (ADD)";
        const height = locale === "es" ? "Altura de montaje" : "Fitting height";
        for (const mail of [customer, admin]) {
          for (const part of [mail.html, mail.text]) {
            expect(part).toContain(pd);
            expect(part).toContain(add);
            expect(part).toContain(height);
          }
        }
        // Both eyes share the addition, so it prints once, not per eye.
        expect(customer.text).toContain(`${add}: +2.00`);
      });

      it("shows the brand, which the line item snapshot never carries", () => {
        const brandLabel = locale === "es" ? "Marca / colección" : "Brand / collection";
        for (const mail of [customer, admin]) {
          expect(mail.html).toContain(brandLabel);
          expect(mail.html).toContain("Flexure");
        }
      });

      it("says where the prescription came from, in both copies", () => {
        // A value read by a model from a photo is not the same claim as one the
        // customer typed — both the lab and the buyer need to know which it was.
        const ocr = locale === "es" ? "OCR" : "OCR";
        const confirmed = locale === "es" ? "confirmada por el cliente" : "confirmed by the customer";
        for (const mail of [customer, admin]) {
          for (const part of [mail.html, mail.text]) {
            expect(part).toContain(ocr);
            expect(part).toContain(confirmed);
          }
        }
      });

      it("explains the prescription terms to the customer but not to the lab", () => {
        const title = locale === "es" ? "Cómo leer tu receta" : "How to read your prescription";
        expect(customer.html).toContain(title);
        expect(customer.text).toContain(title);
        // The store copy goes to people who read these values for a living.
        expect(admin.html).not.toContain(title);
        expect(admin.text).not.toContain(title);
      });

      it("keeps the per-eye prescription values", () => {
        for (const mail of [customer, admin]) {
          expect(mail.text).toContain("SPH +1.50");
          expect(mail.text).toContain("SPH +1.25");
          expect(mail.text).toContain("AXIS 170");
          expect(mail.text).toContain("ADD +2.00");
        }
      });
    });
  }

  // Mirrors a real catalog row (product.metadata written by the scraper): `a`/`b`
  // are frequently null, `style`/`material` come in as supplier slugs.
  it("maps scraped product metadata onto the technical sheet", async () => {
    const productRow = {
      id: "prod_1",
      metadata: {
        brand: "Di Caprio", brand_slug: "di-caprio",
        eye_size: 52, bridge_size: 16, temple_length: 140,
        a: null, b: null,
        shape: "cat-eye", style: "full-frame", material: "injection-2",
        gender: "women", age_group: "adult", features: ["Spring Hinge"],
      },
    };
    // Minimal Knex stand-in: only the two call shapes enrichLensItems uses.
    const pg = ((table: string) =>
      table === "product"
        ? { whereIn: () => ({ select: async () => [productRow] }) }
        : { where: () => ({ whereNull: () => ({ limit: async () => [] }) }) }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    const [it0] = await enrichLensItems(
      pg,
      [{ product_id: "prod_1", variant_sku: "US134-0", product_title: "DC407", quantity: 1 }],
      "es"
    );
    // `product_collection` is null on every order in this store, so the brand row
    // can only come from product metadata — without this fallback it never shows.
    expect(it0.collection).toBe("Di Caprio");
    expect(it0.specs).toEqual({
      sku: "US134-0",
      size: "52□16-140",
      lens_width: 52, // falls back to eye_size when the A measurement is missing
      lens_height: null,
      bridge: 16,
      temple: 140,
      shape: "Ojo de gato",
      style: "Marco completo",
      material: "Inyección",
      gender: "Señoras",
      age_group: "Adulto",
      features: ["Spring Hinge"],
    });
  });

  it("still renders when the frame has no scraped attributes", () => {
    const bare = [{ ...enriched[0], specs: null }];
    const mail = renderCustomerOrderConfirmation(order, "es", prescriptions, { items: bare });
    expect(mail.html).toContain("Flexure 2043");
    expect(mail.html).not.toContain("Ficha técnica");
  });
});
