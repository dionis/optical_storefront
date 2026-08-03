/**
 * Builds the extra data the order emails need (rich lens breakdown, payment
 * method, delivery method, tracking) by reading the lens price-list tables and
 * the order's payment — WITHOUT touching the cart/checkout flow. Everything here
 * is best-effort: any lookup that fails degrades to a sensible fallback so the
 * email always sends.
 */
import type { Knex } from "@mikro-orm/knex";
import type { EmailLocale } from "./copy";

export interface EnrichedComponent {
  label: string;
  price: number;
}
export interface EnrichedItem {
  frame_name: string;
  collection: string | null;
  color: string | null;
  frame_price: number;
  design: string | null;
  material: EnrichedComponent | null;
  photo: EnrichedComponent | null;
  ar: EnrichedComponent | null;
  with_rx: boolean;
  quantity: number;
  total: number;
}

export interface PaymentInfo {
  provider: string; // "stripe" | "paypal" | "square" | ...
  method: string; // "card" | "link" | "paypal" | ...
  brand: string | null; // "visa", "mastercard"...
  last4: string | null;
}

export interface TrackingInfo {
  number: string;
  url: string | null;
}

const first = async (pg: Knex, table: string, where: Record<string, unknown>) => {
  try {
    const rows = await pg(table).where(where).whereNull("deleted_at").limit(1);
    return (rows && rows[0]) || null;
  } catch {
    return null;
  }
};

/** Rich per-line lens breakdown (name + price of each component) from the matrix. */
export async function enrichLensItems(
  pg: Knex,
  items: Array<Record<string, unknown>>,
  locale: EmailLocale
): Promise<EnrichedItem[]> {
  const col = locale === "en" ? "label_en" : "label_es";
  const out: EnrichedItem[] = [];

  for (const item of items) {
    const md = (item["metadata"] as Record<string, unknown>) || {};
    const cfg = (md["lens_config"] as Record<string, unknown>) || {};
    const designCode = cfg["design_code"] as string | undefined;

    let design: string | null = null;
    let material: EnrichedComponent | null = null;
    let photo: EnrichedComponent | null = null;
    let ar: EnrichedComponent | null = null;

    if (designCode && designCode !== "frame-only") {
      const d = await first(pg, "lens_design", { code: designCode });
      design = (d?.[col] as string) ?? designCode;
      const category = (d?.["category"] as string) ?? "sv";

      const materialCode = cfg["material_code"] as string | undefined;
      if (materialCode) {
        const m = await first(pg, "lens_material", { code: materialCode });
        const bp = await first(pg, "lens_base_price", {
          design_code: designCode,
          material_code: materialCode,
        });
        material = {
          label: (m?.[col] as string) ?? materialCode,
          price: Number(bp?.["price_cents"] ?? 0) / 100,
        };
      }

      const photoCode = cfg["photo_code"] as string | undefined;
      if (photoCode) {
        const p = await first(pg, "lens_photo_option", { code: photoCode });
        const priceCents =
          category === "bifocal"
            ? p?.["price_bifocal_cents"]
            : category === "prog"
              ? p?.["price_prog_cents"]
              : p?.["price_sv_cents"];
        photo = {
          label: (p?.[col] as string) ?? photoCode,
          price: Number(priceCents ?? 0) / 100,
        };
      }

      const arCode = cfg["ar_code"] as string | undefined;
      if (arCode) {
        const a = await first(pg, "lens_ar_option", { code: arCode });
        ar = {
          label: (a?.[col] as string) ?? arCode,
          price: Number(a?.["price_cents"] ?? 0) / 100,
        };
      }
    }

    out.push({
      frame_name: (item["product_title"] as string) || (item["title"] as string) || "",
      collection: (item["product_collection"] as string) || null,
      color: (item["variant_title"] as string) || null,
      frame_price: Number(md["frame_price"] ?? item["unit_price"] ?? 0),
      design,
      material,
      photo,
      ar,
      with_rx: Boolean(md["prescription_id"]),
      quantity: Number(item["quantity"] ?? 1),
      total: Number(item["total"] ?? item["unit_price"] ?? 0),
    });
  }

  return out;
}

import Stripe from "stripe";

/**
 * Payment method used, for the ADMIN copy (dispute triage): whether it was a
 * card or Stripe Link, the brand, and the last 4 digits. Reads the stored
 * PaymentIntent first; if the card details weren't captured there, asks Stripe
 * directly (when STRIPE_SECRET_KEY is set). Never throws.
 */
export async function extractPaymentInfo(
  payments: Array<Record<string, unknown>>,
  stripeSecretKey?: string
): Promise<PaymentInfo | null> {
  if (!payments || !payments.length) return null;
  const p = payments[0];
  const providerId = String(p["provider_id"] ?? "");
  const provider = providerId.includes("stripe")
    ? "stripe"
    : providerId.includes("paypal")
      ? "paypal"
      : providerId.includes("square")
        ? "square"
        : providerId || "unknown";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (p["data"] as Record<string, any>) || {};

  let method = provider === "stripe" ? "card" : provider;
  let brand: string | null = null;
  let last4: string | null = null;

  // 1) Straight from the stored PaymentIntent, if the charge is embedded.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charge: any =
    data.latest_charge && typeof data.latest_charge === "object"
      ? data.latest_charge
      : data.charges?.data?.[0] ?? null;
  const pmd = charge?.payment_method_details;
  if (pmd) {
    method = pmd.type ?? method;
    const card = pmd.card ?? pmd[method];
    if (card) {
      brand = card.brand ?? card.network ?? null;
      last4 = card.last4 ?? null;
    }
  }

  // 2) Otherwise ask Stripe for the card details (best-effort).
  if (provider === "stripe" && !last4 && stripeSecretKey) {
    const piId =
      (typeof data.id === "string" && data.id.startsWith("pi_") && data.id) ||
      (typeof data.payment_intent === "string" ? data.payment_intent : undefined);
    if (piId) {
      try {
        const stripe = new Stripe(stripeSecretKey);
        const pi = await stripe.paymentIntents.retrieve(piId, {
          expand: ["latest_charge"],
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ch = pi.latest_charge as any;
        const d = ch?.payment_method_details;
        if (d) {
          method = d.type ?? method;
          const card = d.card ?? d[d.type];
          if (card) {
            brand = card.brand ?? null;
            last4 = card.last4 ?? null;
          }
        }
      } catch {
        /* keep best-effort values */
      }
    }
  }

  return { provider, method, brand, last4 };
}

/** Shipping tracking numbers/links, if the order already has fulfillments. */
export function extractTracking(
  fulfillments: Array<Record<string, unknown>> | undefined
): TrackingInfo[] {
  if (!fulfillments) return [];
  const out: TrackingInfo[] = [];
  for (const f of fulfillments) {
    const labels = (f["labels"] as Array<Record<string, unknown>>) || [];
    for (const l of labels) {
      const number = l["tracking_number"] as string | undefined;
      if (number) {
        out.push({ number, url: (l["tracking_url"] as string) || null });
      }
    }
  }
  return out;
}
