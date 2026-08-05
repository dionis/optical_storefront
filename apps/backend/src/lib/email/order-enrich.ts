/**
 * Builds the extra data the order emails need (rich lens breakdown, payment
 * method, delivery method, tracking) by reading the lens price-list tables and
 * the order's payment — WITHOUT touching the cart/checkout flow. Everything here
 * is best-effort: any lookup that fails degrades to a sensible fallback so the
 * email always sends.
 */
import type { Knex } from "@mikro-orm/knex";
import type { EmailLocale } from "./copy";
import {
  frameSizeNotation,
  loadProductMetadata,
  rawFrameSpecs,
  type RawFrameSpecs,
} from "../frame-specs";

export interface EnrichedComponent {
  label: string;
  price: number;
}
/**
 * Technical sheet of the frame that was actually bought, with every attribute
 * already localized for the message. The raw values come from
 * `lib/frame-specs.ts`, which the tracking page shares — see the note there on
 * why the labels are applied at the edge instead of in the shared reader.
 */
export interface FrameSpecs {
  sku: string | null; // variant SKU / UPC of the color actually ordered
  /** Standard optical notation: eye □ bridge - temple, in mm. */
  size: string | null;
  lens_width: number | null; // A
  lens_height: number | null; // B
  bridge: number | null;
  temple: number | null;
  shape: string | null;
  style: string | null; // full-rim, semi-rimless…
  material: string | null;
  gender: string | null;
  age_group: string | null;
  features: string[];
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
  specs: FrameSpecs | null;
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

// Frame attribute values arrive from the scraper as English slugs (parser.py).
// The storefront localizes them in medusaCatalog.js; the emails need the same
// wording, so the tables are mirrored here — server-side code cannot reach the
// browser dictionary. An unknown slug falls through as-is rather than vanishing.
const SHAPE_LABELS: Record<EmailLocale, Record<string, string>> = {
  es: {
    square: "Cuadrado", round: "Redondo", "cat-eye": "Ojo de gato", navigator: "Navegador",
    rectangle: "Rectángulo", aviator: "Aviador", geometric: "Geométrico", oval: "Oval",
    "modified-oval": "Óvalo modificado", "modified-round": "Ronda modificada",
    combo: "Combo", "full-frame": "Marco completo",
  },
  en: {
    square: "Square", round: "Round", "cat-eye": "Cat eye", navigator: "Navigator",
    rectangle: "Rectangle", aviator: "Aviator", geometric: "Geometric", oval: "Oval",
    "modified-oval": "Modified oval", "modified-round": "Modified round",
    combo: "Combo", "full-frame": "Full frame",
  },
};
// `injection-2` is a supplier code for the same injected plastic as `injection`
// — it is the second most common material in the catalog, so it gets a name
// rather than leaking the raw slug into a customer's inbox.
const MATERIAL_LABELS: Record<EmailLocale, Record<string, string>> = {
  es: {
    acetate: "Acetato", plastic: "Plástica", metal: "Metal", "stainless-steel": "Acero inoxidable",
    memory: "Memoria", titanium: "Titanio", injection: "Inyección", "injection-2": "Inyección",
    tr90: "TR-90", ultem: "Ultem",
  },
  en: {
    acetate: "Acetate", plastic: "Plastic", metal: "Metal", "stainless-steel": "Stainless steel",
    memory: "Memory metal", titanium: "Titanium", injection: "Injection", "injection-2": "Injection",
    tr90: "TR-90", ultem: "Ultem",
  },
};
/** Rim construction (`style` in the scraped metadata), not the frame's outline. */
const STYLE_LABELS: Record<EmailLocale, Record<string, string>> = {
  es: {
    "full-frame": "Marco completo", "full-rim": "Marco completo", combo: "Combinado",
    "semi-rimless": "Semi al aire", "3-piece-rimless": "Al aire (3 piezas)",
    rimless: "Al aire", wireless: "Sin alambre", sunglasses: "Gafas de sol",
  },
  en: {
    "full-frame": "Full rim", "full-rim": "Full rim", combo: "Combo",
    "semi-rimless": "Semi-rimless", "3-piece-rimless": "3-piece rimless",
    rimless: "Rimless", wireless: "Wireless", sunglasses: "Sunglasses",
  },
};
const GENDER_LABELS: Record<EmailLocale, Record<string, string>> = {
  es: { men: "Hombres", women: "Señoras", unisex: "Unisexo", kids: "Niños" },
  en: { men: "Men", women: "Women", unisex: "Unisex", kids: "Kids" },
};
const AGE_LABELS: Record<EmailLocale, Record<string, string>> = {
  es: { adult: "Adulto", kids: "Niños" },
  en: { adult: "Adult", kids: "Kids" },
};

const label = (
  table: Record<EmailLocale, Record<string, string>>,
  value: unknown,
  locale: EmailLocale
): string | null => {
  if (value == null || value === "") return null;
  const key = String(value).toLowerCase();
  return table[locale][key] ?? String(value);
};

/** Localizes the raw technical sheet for the message's language. */
function localizeSpecs(raw: RawFrameSpecs | null, locale: EmailLocale): FrameSpecs | null {
  if (!raw) return null;
  return {
    sku: raw.sku,
    size: frameSizeNotation(raw),
    lens_width: raw.lens_width,
    lens_height: raw.lens_height,
    bridge: raw.bridge_size,
    temple: raw.temple_length,
    shape: label(SHAPE_LABELS, raw.shape, locale),
    style: label(STYLE_LABELS, raw.style, locale),
    material: label(MATERIAL_LABELS, raw.material, locale),
    gender: label(GENDER_LABELS, raw.gender, locale),
    age_group: label(AGE_LABELS, raw.age_group, locale),
    features: raw.features,
  };
}

/** Rich per-line lens breakdown (name + price of each component) from the matrix. */
export async function enrichLensItems(
  pg: Knex,
  items: Array<Record<string, unknown>>,
  locale: EmailLocale
): Promise<EnrichedItem[]> {
  const col = locale === "en" ? "label_en" : "label_es";
  const out: EnrichedItem[] = [];

  const productMeta = await loadProductMetadata(
    pg,
    items.map((i) => String(i["product_id"] ?? ""))
  );

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
      specs: localizeSpecs(
        rawFrameSpecs(productMeta.get(String(item["product_id"] ?? "")), item),
        locale
      ),
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
