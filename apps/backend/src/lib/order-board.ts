/**
 * The order board: everything the shop owner's panel needs about an order, in
 * the same vocabulary the customer's tracking page speaks.
 *
 * The panel and `/store/my-orders` deliberately share `deriveOrderProgress`, so
 * the stage the owner sees on a row is byte-for-byte the stage the shopper sees
 * on the timeline. Anything that computes a stage a second way will drift.
 *
 * The projection here is wider than the shopper's: this is an authenticated
 * staff route, so phone numbers and the prescription id belong on it (the owner
 * has `/admin/prescriptions/:id` to open the actual document). Prescription
 * *values* still never cross this boundary — they are health data and the panel
 * has no reason to render them.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows";
import {
  ORDER_STAGES,
  cancelEligibility,
  deriveOrderProgress,
  stageIndex,
  type OrderStage,
} from "./order-status";

/**
 * Fields to select. The long tail of relations is NOT optional: order totals are
 * computed, not stored, and the order module only produces a correct number when
 * the rows they are summed from came back too. Prune this list and every row on
 * the board quietly shows the same wrong total — see the much longer note in
 * `src/api/store/my-orders/route.ts`, which this mirrors.
 *
 * On top of that list the board adds what the shopper's page has no business
 * seeing but the owner needs to actually work an order: the customer's phone,
 * the fulfillment records (which drive the "advance" button), and the per-item
 * fulfilled/shipped quantities the stage transitions are computed from.
 */
export const ORDER_BOARD_FIELDS = [
  "id",
  "status",
  "display_id",
  "created_at",
  "updated_at",
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
  "items.variant.product.thumbnail",
  "shipping_address.*",
  "billing_address.*",
  "customer.*",
  // Fulfillment records: which one to ship, which one to mark delivered.
  "fulfillments.id",
  "fulfillments.packed_at",
  "fulfillments.shipped_at",
  "fulfillments.delivered_at",
  "fulfillments.canceled_at",
  "fulfillments.items.id",
  "fulfillments.items.quantity",
  "fulfillments.items.line_item_id",
  "fulfillments.labels.*",
];

/**
 * How many orders one board query is allowed to read.
 *
 * The stage a row shows is DERIVED — from payment status, fulfillment status and
 * a manual `metadata.lab_stage` — and none of those three is a column the
 * database can filter on. So filtering by stage necessarily happens after the
 * rows are in memory, which means the window has to be bounded somewhere.
 *
 * 300 is chosen for a single optician's shop: it covers months of orders, and
 * the date filter (which IS pushed to the database) is what the owner reaches
 * for when they need to go further back. The response says `truncated` when the
 * window was actually hit, so the panel can tell the owner rather than silently
 * showing a partial answer.
 */
export const MAX_BOARD_SCAN = 300;

/** Page size when the caller doesn't ask for one. */
export const DEFAULT_BOARD_LIMIT = 20;

export interface BoardQuery {
  /** Free text across id, customer, city, email, phone and item titles. */
  q?: string;
  /** ISO date (inclusive) — orders created on or after this instant. */
  from?: string;
  /** ISO date (inclusive) — orders created on or before this instant. */
  to?: string;
  /** Derived stage to keep. */
  stage?: OrderStage;
  /** Keep only orders that ended (canceled / refunded / awaiting payment). */
  terminal?: "canceled" | "refunded" | "payment_pending";
  /** Keep only orders carrying a prescription. */
  has_prescription?: boolean;
  limit?: number;
  offset?: number;
}

interface RawItem {
  id?: string;
  title?: string | null;
  variant_title?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
  thumbnail?: string | null;
  metadata?: Record<string, unknown> | null;
  detail?: {
    quantity?: number | null;
    fulfilled_quantity?: number | null;
    shipped_quantity?: number | null;
    delivered_quantity?: number | null;
  } | null;
  variant?: { product?: { thumbnail?: string | null } | null } | null;
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
  phone?: string | null;
}

export interface RawFulfillment {
  id?: string;
  packed_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  canceled_at?: string | null;
  items?: { id?: string; quantity?: number | null; line_item_id?: string | null }[] | null;
  labels?: { tracking_number?: string | null; tracking_url?: string | null }[] | null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function projectItem(item: RawItem) {
  const lens = (item.metadata?.["lens_config"] ?? {}) as Record<string, unknown>;
  const detail = item.detail ?? {};
  return {
    id: item.id,
    title: item.title ?? "",
    variant_title: item.variant_title ?? null,
    quantity: item.quantity ?? 1,
    unit_price: item.unit_price ?? 0,
    total: item.total ?? 0,
    thumbnail: item.thumbnail || item.variant?.product?.thumbnail || null,
    // Codes only — the panel already knows how to label these, exactly as the
    // checkout and the tracking page do.
    lens: {
      design_code: (lens["design_code"] as string) ?? null,
      material_code: (lens["material_code"] as string) ?? null,
      photo_code: (lens["photo_code"] as string) ?? null,
      ar_code: (lens["ar_code"] as string) ?? null,
    },
    // How much of this line is already out the door — what the "advance" button
    // computes its payload from.
    fulfilled_quantity: num(detail.fulfilled_quantity),
    shipped_quantity: num(detail.shipped_quantity),
    has_prescription: Boolean(item.metadata?.["prescription_id"]),
    // The id, never the values. The owner opens the document through
    // `/admin/prescriptions/:id`, which serves a presigned URL.
    prescription_id: (item.metadata?.["prescription_id"] as string) ?? null,
  };
}

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
    // Staff route: the phone is the whole point of having captured it.
    phone: address.phone ?? null,
  };
}

/**
 * Fulfillments that can still move.
 *
 * A canceled fulfillment is history — it must not be picked up as "the one to
 * ship", or advancing an order whose fulfillment was voided would fail deep
 * inside the workflow with a message the owner cannot act on.
 */
export function liveFulfillments(order: { fulfillments?: RawFulfillment[] | null }) {
  return (order.fulfillments ?? []).filter((f) => !f.canceled_at);
}

/**
 * Which stages this order can be moved to right now, and why not otherwise.
 *
 * The panel renders exactly this — it never decides for itself what is legal —
 * so the buttons it offers and the transitions the POST route accepts cannot
 * disagree.
 */
export function availableTransitions(
  order: { fulfillments?: RawFulfillment[] | null; items?: RawItem[] | null },
  progress: ReturnType<typeof deriveOrderProgress>
): OrderStage[] {
  if (progress.terminal === "canceled" || progress.terminal === "refunded") return [];

  const live = liveFulfillments(order);
  const unfulfilled = (order.items ?? []).some(
    (i) => num(i.detail?.quantity ?? i.quantity) - num(i.detail?.fulfilled_quantity) > 0
  );
  const awaitingShipment = live.some((f) => !f.shipped_at);
  const awaitingDelivery = live.some((f) => f.shipped_at && !f.delivered_at);

  const next: OrderStage[] = [];

  // The lab step is a note, not an event — it can be set and unset freely, but
  // only while nothing has been fulfilled. Once a box exists, claiming the order
  // is still "in the lab" would contradict Medusa's own record.
  if (live.length === 0) {
    if (progress.stage !== "confirmed") next.push("confirmed");
    if (progress.stage !== "in_lab") next.push("in_lab");
  }
  // Everything below is a real event and only moves forward.
  if (unfulfilled) next.push("shipped");
  if (awaitingShipment) next.push("in_transit");
  if (awaitingDelivery) next.push("delivered");

  return next;
}

export type BoardOrder = ReturnType<typeof projectBoardOrder>;

/** One row of the board. */
export function projectBoardOrder(order: Record<string, unknown>) {
  const rawItems = (order["items"] as RawItem[]) ?? [];
  const metadata = (order["metadata"] as Record<string, unknown>) ?? {};
  const fulfillments = (order["fulfillments"] as RawFulfillment[]) ?? [];

  const orderLike = {
    payment_status: order["payment_status"] as string,
    fulfillment_status: order["fulfillment_status"] as string,
    status: order["status"] as string,
    metadata,
    items: rawItems,
  };
  const progress = deriveOrderProgress(orderLike);
  const cancel = cancelEligibility(orderLike);

  const shippingAddress = projectAddress(order["shipping_address"] as RawAddress);
  const customer = (order["customer"] ?? null) as Record<string, unknown> | null;
  const shippingMethod = ((order["shipping_methods"] as { name?: string }[]) ?? [])[0];

  // The courier reference can live in two places: on a fulfillment label (set
  // when the owner shipped through the panel) or on order metadata (set by hand,
  // and the only one `/store/my-orders` reads). Prefer the label, fall back.
  const labelTracking = fulfillments
    .flatMap((f) => f.labels ?? [])
    .map((l) => l?.tracking_number)
    .find(Boolean);

  return {
    id: order["id"] as string,
    display_id: order["display_id"] ?? null,
    created_at: order["created_at"] ?? null,
    status: order["status"] ?? null,
    email: order["email"] ?? null,
    currency_code: order["currency_code"] ?? "usd",
    total: order["total"] ?? 0,
    item_total: order["item_total"] ?? 0,
    discount_total: order["discount_total"] ?? 0,
    shipping_total: order["shipping_total"] ?? 0,
    tax_total: order["tax_total"] ?? 0,

    // The single stage, from the same function the shopper's timeline uses.
    stage: progress.stage,
    stage_index: stageIndex(progress.stage),
    terminal: progress.terminal,
    paid: progress.paid,
    has_prescription: progress.has_prescription,
    // Raw manual note, so the panel can show the owner whether the lab step was
    // pinned by hand or merely inferred.
    lab_stage: (metadata["lab_stage"] as string) ?? null,
    payment_status: order["payment_status"] ?? null,
    fulfillment_status: order["fulfillment_status"] ?? null,

    customer: {
      name:
        shippingAddress?.name ||
        [customer?.["first_name"], customer?.["last_name"]].filter(Boolean).join(" ") ||
        null,
      email: (order["email"] as string) ?? (customer?.["email"] as string) ?? null,
      phone:
        shippingAddress?.phone ??
        (customer?.["phone"] as string) ??
        (metadata["patient_phone"] as string) ??
        null,
    },
    shipping_address: shippingAddress,
    shipping_method: shippingMethod?.name ?? null,
    tracking_number: labelTracking ?? (metadata["tracking_number"] as string) ?? null,

    fulfillments: fulfillments.map((f) => ({
      id: f.id,
      packed_at: f.packed_at ?? null,
      shipped_at: f.shipped_at ?? null,
      delivered_at: f.delivered_at ?? null,
      canceled_at: f.canceled_at ?? null,
    })),

    cancelable: cancel.cancelable,
    next_stages: availableTransitions({ fulfillments, items: rawItems }, progress),

    items: rawItems.map(projectItem),
  };
}

/** Lowercased blob a free-text query is matched against. */
function haystack(row: BoardOrder): string {
  return [
    row.id,
    row.display_id == null ? "" : `#${row.display_id}`,
    row.customer.name,
    row.customer.email,
    row.customer.phone,
    row.shipping_address?.city,
    row.shipping_address?.address_1,
    row.shipping_address?.postal_code,
    row.shipping_method,
    row.tracking_number,
    row.stage,
    ...row.items.map((i) => i.title),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export interface BoardResult {
  orders: BoardOrder[];
  /** Rows matching the filters, within the scanned window. */
  count: number;
  /** Rows read from the database before filtering. */
  scanned: number;
  /** True when the window was full, so older orders may exist unseen. */
  truncated: boolean;
  limit: number;
  offset: number;
}

/**
 * Read the board.
 *
 * The date range goes to the database (it is a real column and the owner's main
 * tool for narrowing history). Stage, text and prescription filters are applied
 * to the projected rows, because none of them exists as a column — see
 * `MAX_BOARD_SCAN` for why that is bounded rather than unlimited.
 */
export async function fetchBoardOrders(
  scope: MedusaContainer,
  params: BoardQuery
): Promise<BoardResult> {
  const limit = Math.min(Math.max(Number(params.limit) || DEFAULT_BOARD_LIMIT, 1), 100);
  const offset = Math.max(Number(params.offset) || 0, 0);

  const createdAt: Record<string, string> = {};
  if (params.from) createdAt["$gte"] = params.from;
  if (params.to) createdAt["$lte"] = params.to;

  const { result } = await getOrdersListWorkflow(scope).run({
    input: {
      fields: ORDER_BOARD_FIELDS,
      variables: {
        filters: {
          is_draft_order: false,
          ...(Object.keys(createdAt).length ? { created_at: createdAt } : {}),
        },
        order: { created_at: "DESC" },
        skip: 0,
        take: MAX_BOARD_SCAN,
      },
    },
  });

  const rawOrders = (Array.isArray(result) ? result : result.rows) as unknown as Record<
    string,
    unknown
  >[];

  const projected = rawOrders.map(projectBoardOrder);

  const q = String(params.q ?? "").trim().toLowerCase();
  const filtered = projected.filter((row) => {
    if (params.stage && row.stage !== params.stage) return false;
    if (params.terminal && row.terminal !== params.terminal) return false;
    if (params.has_prescription === true && !row.has_prescription) return false;
    if (params.has_prescription === false && row.has_prescription) return false;
    if (q && !haystack(row).includes(q)) return false;
    return true;
  });

  return {
    orders: filtered.slice(offset, offset + limit),
    count: filtered.length,
    scanned: rawOrders.length,
    truncated: rawOrders.length >= MAX_BOARD_SCAN,
    limit,
    offset,
  };
}

/** Re-read one order after a transition, so the panel repaints from the truth. */
export async function fetchBoardOrder(
  scope: MedusaContainer,
  id: string
): Promise<BoardOrder | null> {
  const { result } = await getOrdersListWorkflow(scope).run({
    input: {
      fields: ORDER_BOARD_FIELDS,
      variables: { filters: { id }, skip: 0, take: 1 },
    },
  });
  const rows = (Array.isArray(result) ? result : result.rows) as unknown as Record<
    string,
    unknown
  >[];
  return rows[0] ? projectBoardOrder(rows[0]) : null;
}

/** Type guard so a hand-typed query string can't smuggle in an unknown stage. */
export function isOrderStage(value: unknown): value is OrderStage {
  return typeof value === "string" && (ORDER_STAGES as readonly string[]).includes(value);
}
