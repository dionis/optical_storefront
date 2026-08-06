import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import type { Knex } from "@mikro-orm/knex";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows";
import { readSessionToken, verifyToken } from "../../../lib/order-access";
import { cancelEligibility, deriveOrderProgress, stageIndex } from "../../../lib/order-status";
import { loadProductMetadata, rawFrameSpecs, type RawFrameSpecs } from "../../../lib/frame-specs";
import { PRESCRIPTION_MODULE } from "../../../modules/prescription/index";
import type PrescriptionModuleService from "../../../modules/prescription/service";

/**
 * GET /store/my-orders — every order belonging to the session token's address.
 *
 * This is the endpoint that makes the feature worth having: one call, all the
 * shopper's orders, no inbox archaeology. It replaces Medusa's own
 * `GET /store/orders/:id`, which we block in middlewares.ts because it
 * authenticates nobody.
 *
 * The response is a deliberate projection, not the raw order.
 *
 * PRESCRIPTION VALUES: this route used to send only a boolean per line. It now
 * returns the shopper's own Rx — the same values the order confirmation email
 * already puts in their inbox in plaintext — because a customer who cannot see
 * what was ordered cannot check it, explain it to an optician, or reuse it.
 * The guard rails that make that safe:
 *   · the session token is signed and proves control of the order's email;
 *   · `prescription_id` never crosses the boundary, so nothing here is a handle
 *     to another endpoint;
 *   · `file_url` (the R2 key of the uploaded photo) never crosses it either —
 *     that bucket is private and only reachable through presigned URLs.
 * Anything beyond that — an id, a file, another shopper's order — stays out.
 */

/**
 * Order totals are COMPUTED, not stored. The order module only runs
 * `decorateCartTotals` when the selection asks for a total field, and it can
 * only produce a correct number when the rows those totals are summed from came
 * back with it: the `items.detail` join (which holds quantity and unit price),
 * the tax lines, the adjustments, the shipping methods and the credit lines.
 *
 * Ask for `total` without them and the response is not an error — it is a
 * plausible-looking wrong number. Every line lands at 0 and the order total
 * collapses to whatever shipping cost survived, which is identical across
 * orders and reads as "the page shows the same price for every order".
 *
 * So this list mirrors Medusa's own `defaultStoreRetrieveOrderFields`
 * (@medusajs/medusa/dist/api/store/orders/query-config.js) — translated to the
 * dot syntax — plus the product fallback for thumbnails. Do not prune it down
 * to "the fields we render".
 *
 * `payment_status` and `fulfillment_status` are deliberately NOT here: they do
 * not exist on the `Order` graph type at all (only on `OrderDetail`), so asking
 * for them silently yields `undefined` — which reads as "not paid" and pinned
 * every order on the tracking page to "Payment pending". They are aggregated
 * from payment collections and fulfillments by `getOrdersListWorkflow`, which
 * is why this route goes through that workflow instead of `query.graph`.
 */
const ORDER_FIELDS = [
  "id",
  "status",
  "display_id",
  "created_at",
  "currency_code",
  "email",
  "total",
  "subtotal",
  "discount_total",
  "shipping_total",
  "tax_total",
  "item_total",
  "item_subtotal",
  "metadata",
  // Relations the totals are summed from — see the note above.
  "items.*",
  "items.detail.*",
  "items.tax_lines.*",
  "items.adjustments.*",
  "shipping_methods.*",
  "shipping_methods.tax_lines.*",
  "shipping_methods.adjustments.*",
  "credit_lines.*",
  // Fallback image source: the line item's own thumbnail is a snapshot taken at
  // add-to-cart time and is empty for anything added before it was populated.
  "items.variant.product.thumbnail",
  "shipping_address.*",
];

/**
 * Ceiling on one shopper's history. The page renders every order it is given,
 * so this bounds the response rather than paginating a list nobody scrolls.
 */
const MAX_ORDERS = 100;

interface RawItem {
  id?: string;
  title?: string | null;
  subtitle?: string | null;
  product_id?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  variant_sku?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
  subtotal?: number | null;
  thumbnail?: string | null;
  metadata?: Record<string, unknown> | null;
  variant?: { product?: { thumbnail?: string | null } | null } | null;
}

/**
 * The shopper's own prescription as the tracking page shows it. Mirrors the
 * stored record minus the two fields that must not travel — see the route
 * header — and adds nothing the customer did not themselves provide.
 */
interface ProjectedRx {
  od: Record<string, number | string | null>;
  os: Record<string, number | string | null>;
  pd: number | null;
  pd_od: number | null;
  pd_os: number | null;
  seg_height: number | null;
  /** "manual" | "ocr" — how the values got here, so the page can explain them. */
  source: string;
  verified_by_user: boolean;
  created_at: string | null;
  /** Whether a photo of the original is on file — never the key to it. */
  has_file: boolean;
}

function projectItem(
  item: RawItem,
  specs: RawFrameSpecs | null,
  prescription: ProjectedRx | null
) {
  const lens = (item.metadata?.["lens_config"] ?? {}) as Record<string, unknown>;
  return {
    id: item.id,
    title: item.title ?? "",
    variant_title: item.variant_title ?? null,
    quantity: item.quantity ?? 1,
    unit_price: item.unit_price ?? 0,
    total: item.total ?? 0,
    // Bare R2 key or absolute URL — the storefront prefixes it with
    // VITE_R2_PUBLIC_URL, exactly as it does for the catalog.
    thumbnail: item.thumbnail || item.variant?.product?.thumbnail || null,
    // Codes only — the storefront already knows how to label these (DESIGN_LBL
    // in the checkout).
    lens: {
      design_code: (lens["design_code"] as string) ?? null,
      material_code: (lens["material_code"] as string) ?? null,
      photo_code: (lens["photo_code"] as string) ?? null,
      ar_code: (lens["ar_code"] as string) ?? null,
    },
    // Frame attributes as raw slugs, localized in the browser like every other
    // catalog value (see lib/frame-specs.ts on why the labels are not applied
    // server-side).
    frame: specs,
    // The values the customer entered or confirmed from an OCR reading.
    prescription,
    // Price breakdown the shopper actually paid, so "why does it cost that"
    // has an answer on the page instead of over email. Filler/presentation
    // fields never appear here — these are the numbers the server charged.
    breakdown: {
      frame_price: numberOrNull(item.metadata?.["frame_price"]),
      lens_addon: numberOrNull(item.metadata?.["lens_addon"]),
      tax_amount: numberOrNull(item.metadata?.["tax_amount"]),
    },
    has_prescription: Boolean(item.metadata?.["prescription_id"]),
  };
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface RawShippingMethod {
  name?: string | null;
  amount?: number | null;
}

interface RawAddress {
  first_name?: string | null;
  last_name?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
}

/** Postal address only — the phone stays out of a token-authenticated read. */
function projectAddress(address: RawAddress | null | undefined) {
  if (!address) return null;
  return {
    name: [address.first_name, address.last_name].filter(Boolean).join(" ") || null,
    address_1: address.address_1 ?? null,
    address_2: address.address_2 ?? null,
    city: address.city ?? null,
    province: address.province ?? null,
    postal_code: address.postal_code ?? null,
    country_code: address.country_code ?? null,
  };
}

/**
 * Every distinct prescription referenced by these line items, keyed by id.
 *
 * The id itself is only used here, as a join key; it is dropped from the
 * response. A prescription that cannot be read is skipped rather than failing
 * the request — a shopper checking a delivery date should not get an error page
 * because one health record is unavailable.
 */
async function loadPrescriptions(
  req: MedusaRequest,
  items: RawItem[],
  logger: Logger
): Promise<Map<string, ProjectedRx>> {
  const out = new Map<string, ProjectedRx>();
  const ids = new Set(
    items
      .map((i) => i.metadata?.["prescription_id"])
      .filter(Boolean)
      .map(String)
  );
  if (!ids.size) return out;

  try {
    // One query for the whole page. Retrieving them one by one would mean up to
    // MAX_ORDERS round trips before the shopper sees anything.
    const rxService = req.scope.resolve<PrescriptionModuleService>(PRESCRIPTION_MODULE);
    const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
    const rows = (await pg("prescription")
      .whereIn("id", [...ids])
      .whereNull("deleted_at")) as Array<Record<string, unknown>>;

    for (const record of rows) {
      const rx = rxService.recordToRx(record);
      out.set(String(record["id"]), {
        od: { ...rx.od },
        os: { ...rx.os },
        pd: rx.pd,
        pd_od: rx.pd_od,
        pd_os: rx.pd_os,
        seg_height: rx.seg_height ?? null,
        source: rx.source,
        verified_by_user: rx.verified_by_user,
        created_at: rx.created_at ?? null,
        has_file: Boolean(rx.file_url),
      });
    }
  } catch (error) {
    // The page falls back to the plain "with prescription" badge.
    logger.warn(`[my-orders] prescriptions unavailable: ${(error as Error).message}`);
  }
  return out;
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const session = verifyToken(
    readSessionToken({ headers: req.headers as Record<string, unknown>, query: req.query }),
    "session"
  );

  if (!session) {
    res.status(401).json({
      type: "unauthorized",
      message: "Tu sesión de seguimiento caducó. Pide un enlace nuevo.",
    });
    return;
  }

  let rawOrders: Record<string, unknown>[] = [];
  try {
    const { result } = await getOrdersListWorkflow(req.scope).run({
      input: {
        fields: ORDER_FIELDS,
        variables: {
          // The token's email is the only filter — it is signed, so it cannot
          // be swapped for someone else's by editing the request.
          filters: { email: session.email, is_draft_order: false },
          skip: 0,
          take: MAX_ORDERS,
        },
      },
    });
    rawOrders = (Array.isArray(result) ? result : result.rows) as unknown as Record<
      string,
      unknown
    >[];
  } catch (error) {
    logger.error(`[my-orders] could not list orders: ${(error as Error).message}`);
    res.status(500).json({ type: "error", message: "No se pudieron cargar tus pedidos." });
    return;
  }

  // Frame attributes and prescriptions for every line in the whole response, in
  // two round trips rather than two per line. Both are best-effort: an order
  // still renders (stage, totals, items) if either lookup fails.
  const allItems = rawOrders.flatMap((o) => ((o["items"] as RawItem[]) ?? []));
  let productMeta = new Map<string, Record<string, unknown>>();
  try {
    const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
    productMeta = await loadProductMetadata(pg, allItems.map((i) => String(i.product_id ?? "")));
  } catch (error) {
    logger.warn(`[my-orders] frame specs unavailable: ${(error as Error).message}`);
  }
  const prescriptions = await loadPrescriptions(req, allItems, logger);

  const orders = rawOrders
    .map((order) => {
      const rawItems = (order["items"] as RawItem[]) ?? [];
      const items = rawItems.map((item) =>
        projectItem(
          item,
          rawFrameSpecs(productMeta.get(String(item.product_id ?? "")), item as Record<string, unknown>),
          prescriptions.get(String(item.metadata?.["prescription_id"] ?? "")) ?? null
        )
      );
      const orderLike = {
        payment_status: order["payment_status"] as string,
        fulfillment_status: order["fulfillment_status"] as string,
        status: order["status"] as string,
        metadata: order["metadata"] as Record<string, unknown>,
        items: rawItems,
      };
      const progress = deriveOrderProgress(orderLike);
      const cancel = cancelEligibility(orderLike);
      const shippingMethod = ((order["shipping_methods"] as RawShippingMethod[]) ?? [])[0];

      return {
        id: order["id"] as string,
        display_id: order["display_id"] ?? null,
        created_at: order["created_at"] ?? null,
        currency_code: order["currency_code"] ?? "usd",
        total: order["total"] ?? 0,
        subtotal: order["subtotal"] ?? 0,
        // Medusa's `subtotal` already includes shipping, so the line-items-only
        // figure the summary needs is `item_total`, not a subtraction.
        item_total: order["item_total"] ?? 0,
        discount_total: order["discount_total"] ?? 0,
        shipping_total: order["shipping_total"] ?? 0,
        tax_total: order["tax_total"] ?? 0,
        stage: progress.stage,
        stage_index: stageIndex(progress.stage),
        terminal: progress.terminal,
        paid: progress.paid,
        has_prescription: progress.has_prescription,
        shipping_method: shippingMethod?.name ?? null,
        shipping_address: projectAddress(order["shipping_address"] as RawAddress),
        // Everything the storefront needs to decide whether to offer the cancel
        // button, and what to warn about before it does.
        cancelable: cancel.cancelable,
        cancel_blocked_by: cancel.blocked_by,
        refund_outcome: cancel.refund_outcome,
        lab_started: cancel.lab_started,
        // Surfaced so the shopper can see a courier reference when the owner
        // records one; absent for every order until then.
        tracking_number:
          (order["metadata"] as Record<string, unknown>)?.["tracking_number"] ?? null,
        items,
      };
    })
    // Newest first: the order someone just placed is the one they came to check.
    .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());

  res.status(200).json({ email: session.email, orders, count: orders.length });
}
