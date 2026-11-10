/**
 * After the sale: correcting its details, hiding it, bringing it back and
 * moving it to another store (owner, 8-nov-2026). Who may do each one is
 * decided in lib/sale-permissions.ts; the routes under
 * /admin/pos/sales/:id check it before calling these.
 *
 *  - updateSaleDetails  customer data, the new prescription's values,
 *                       delivery, promised date, internal note. Never the
 *                       lines, prices or payments: the money stays as recorded
 *                       (balances go through «collect», mistakes through «void»).
 *  - deleteSale         soft delete. The sale, its payments, cash-ledger lines
 *                       and insurer claims get the same `deleted_at`, the
 *                       Medusa order is soft-deleted and the dashboards' rows
 *                       (sale_fact) are dropped, so the sale disappears from
 *                       lists, totals, the register and the order board. The
 *                       prescription stays in the patient's file (health
 *                       record, not a sale). A register already closed keeps
 *                       the figures it was closed with.
 *  - restoreSale        undoes exactly that delete (the rows carrying the
 *                       sale's `deleted_at` instant) and re-projects the order.
 *  - moveSale           the sale takes the next number of the destination store
 *                       (the old one is kept in `previous_numbers`), a till of
 *                       that store, a tray there if it was holding one, and the
 *                       store's sales channel on the order. Payments stay where
 *                       the money was received: the cash is in that store's
 *                       drawer, and moving the rows would break its register.
 */
import type { ICustomerModuleService, IOrderModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import type { Prescription } from "@eyewear/shared";
import { POS_MODULE } from "../modules/pos";
import type PosModuleService from "../modules/pos/service";
import { recordAudit } from "./audit";
import type { EstablishmentRow } from "./establishments";
import { loadProductMetadata } from "./frame-specs";
import { syncOrderToSheet } from "./gsheet-sync";
import { cleanCustomer, saleNumber, type PosCustomerInput } from "./pos";
import { tenant } from "./tenant";
import {
  checkPrescriptions,
  ensureTerminal,
  getSale,
  nextSaleSeq,
  PosError,
  releaseTray,
  stampOrder,
  takeTray,
  toSale,
  type SaleRow,
} from "./pos-data";
import { storedVerifiedByUser, type LensRxDesign } from "./pos-lens-rules";
import { prescriptionColumns } from "./prescription-write";
import { projectOrder } from "./sale-facts";
import { DELETE_REASON_MAX, DELETE_REASONS, INTERNAL_NOTE_MAX, type DeleteReason } from "./sale-permissions";

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const pos = (c: MedusaContainer) => c.resolve<PosModuleService>(POS_MODULE);
const logOf = (c: MedusaContainer) => c.resolve<Logger>(ContainerRegistrationKeys.LOGGER);

/** A sale by id, deleted or not (only owners and superadmins ever see a deleted one). */
export async function getSaleAnyState(container: MedusaContainer, id: string): Promise<SaleRow | null> {
  const svc = pos(container);
  const [s] = await svc.listPosSales({ id }, { take: 1, withDeleted: true } as never);
  if (!s) return null;
  const payments = await svc.listPosSalePayments({ sale_id: id }, { take: 100, order: { created_at: "ASC" }, withDeleted: true } as never);
  const row = s as unknown as Record<string, unknown>;
  // A deleted sale shows the payments that were hidden with it.
  const live = (payments as unknown as Array<Record<string, unknown>>).filter((p) => (row.deleted_at ? sameInstant(p.deleted_at, row.deleted_at) : !p.deleted_at));
  return toSale(row, live);
}

/** Deleted sales, newest deletion first, in the given stores (null = all). */
export async function listDeletedSales(container: MedusaContainer, establishmentIds: string[] | null, take = 100): Promise<SaleRow[]> {
  const q = pgOf(container)("pos_sale").whereNotNull("deleted_at").orderBy("deleted_at", "desc").limit(take).select("*");
  if (establishmentIds) q.whereIn("establishment_id", establishmentIds.length ? establishmentIds : ["-"]);
  const rows = (await q) as Array<Record<string, unknown>>;
  return rows.map((r) => toSale(r, []));
}

const sameInstant = (a: unknown, b: unknown): boolean => Boolean(a && b) && new Date(a as string).getTime() === new Date(b as string).getTime();

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export interface SaleDetailsPatch {
  /** The whole customer as the till sends it (cleanCustomer rules); absent = unchanged. */
  customer?: PosCustomerInput;
  delivery?: unknown;
  /** YYYY-MM-DD, or null to clear. */
  promised_on?: unknown;
  /** Free text, or null/"" to clear. */
  internal_note?: unknown;
  /** New values of the sale's new prescription (same shape as at the till). */
  prescription?: { rx?: Prescription & Record<string, unknown>; rx_date?: unknown } | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (v: string): boolean => DAY_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Pure: the patch cleaned, or the reason it is refused. Exported for the tests. */
export function cleanDetailsPatch(body: SaleDetailsPatch): { reason: string } | { patch: CleanPatch } {
  const patch: CleanPatch = {};
  if (body.customer !== undefined) {
    const c = cleanCustomer(body.customer, new Date(), tenant().timezone);
    if ("reason" in c) return { reason: c.reason };
    patch.customer = c.customer;
  }
  if (body.delivery !== undefined) {
    if (body.delivery !== "pickup" && body.delivery !== "ship") return { reason: "bad_delivery" };
    patch.delivery = body.delivery;
  }
  if (body.promised_on !== undefined) {
    if (body.promised_on === null || body.promised_on === "") patch.promised_on = null;
    else if (typeof body.promised_on === "string" && realDay(body.promised_on)) patch.promised_on = body.promised_on;
    else return { reason: "bad_promised_on" };
  }
  if (body.internal_note !== undefined) {
    const note = typeof body.internal_note === "string" ? body.internal_note.trim() : body.internal_note === null ? "" : null;
    if (note === null) return { reason: "bad_note" };
    // Longer than allowed is refused, not cut (same rule as every other field).
    if (note.length > INTERNAL_NOTE_MAX) return { reason: "note_too_long" };
    patch.internal_note = note || null;
  }
  if (body.prescription !== undefined && body.prescription !== null) {
    const rx = body.prescription.rx;
    if (!rx || typeof rx !== "object" || !rx.od || !rx.os) return { reason: "prescription_required" };
    const d = body.prescription.rx_date;
    if (d !== undefined && d !== null && d !== "" && !(typeof d === "string" && realDay(d))) return { reason: "bad_rx_date" };
    patch.prescription = { rx, rx_date: typeof d === "string" && d ? d : null };
  }
  if (!Object.keys(patch).length) return { reason: "nothing_to_change" };
  return { patch };
}

interface CleanPatch {
  customer?: ReturnType<typeof cleanCustomer> extends infer R ? (R extends { customer: infer C } ? C : never) : never;
  delivery?: "pickup" | "ship";
  promised_on?: string | null;
  internal_note?: string | null;
  prescription?: { rx: Prescription & Record<string, unknown>; rx_date: string | null };
}

interface OrderForEdit {
  id: string;
  email: string | null;
  metadata: Record<string, unknown> | null;
  shipping_address?: { id: string; address_1?: string | null } | null;
  billing_address?: { id: string } | null;
  items?: Array<{ product_id?: string | null; metadata?: Record<string, unknown> | null }>;
}

async function orderForEdit(container: MedusaContainer, orderId: string): Promise<OrderForEdit | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "email", "metadata", "shipping_address.id", "shipping_address.address_1", "billing_address.id", "items.product_id", "items.metadata"],
    filters: { id: orderId },
  });
  return (data[0] as OrderForEdit | undefined) ?? null;
}

/** The lens designs and frame sizes of the sale's lines, for the same prescription checks as at the till. */
async function rxChecksOf(container: MedusaContainer, items: NonNullable<OrderForEdit["items"]>): Promise<{ contexts: Array<{ usage_type?: string; eye_size?: number }>; designs: LensRxDesign[] }> {
  const pg = pgOf(container);
  const withLens = items.filter((i) => {
    const code = (i.metadata?.lens_config as { design_code?: string } | undefined)?.design_code;
    return code && code !== "frame-only";
  });
  const codes = [...new Set(withLens.map((i) => String((i.metadata?.lens_config as { design_code: string }).design_code)))];
  const rows = codes.length ? ((await pg("lens_design").whereIn("code", codes).whereNull("deleted_at").select("code", "category", "requires_add")) as Array<{ code: string; category: string; requires_add: boolean }>) : [];
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const meta = await loadProductMetadata(pg, [...new Set(withLens.map((i) => String(i.product_id ?? "")).filter(Boolean))]);
  const contexts: Array<{ usage_type?: string; eye_size?: number }> = [];
  const designs: LensRxDesign[] = [];
  for (const i of withLens) {
    const code = String((i.metadata?.lens_config as { design_code: string }).design_code);
    const d = byCode.get(code);
    const eye = Number(meta.get(String(i.product_id ?? ""))?.["eye_size"]);
    contexts.push({ ...(d?.category === "prog" ? { usage_type: "progressive" } : {}), ...(Number.isFinite(eye) && eye > 0 ? { eye_size: eye } : {}) });
    designs.push({ code, category: d?.category ?? null, requires_add: Boolean(d?.requires_add) } as LensRxDesign);
  }
  return { contexts, designs };
}

export async function updateSaleDetails(container: MedusaContainer, sale: SaleRow, body: SaleDetailsPatch, actorId: string): Promise<{ sale: SaleRow; changed: string[] }> {
  const cleaned = cleanDetailsPatch(body);
  if ("reason" in cleaned) throw new PosError(cleaned.reason);
  const p = cleaned.patch;
  const order = sale.order_id ? await orderForEdit(container, sale.order_id) : null;

  const delivery = p.delivery ?? (sale.delivery === "ship" ? "ship" : "pickup");
  if (delivery === "ship" && !(p.customer?.address ?? order?.shipping_address?.address_1)) throw new PosError("address_required_to_ship");

  // The prescription is checked before anything is written: an Rx the lab cannot cut never replaces a good one.
  let rxId: string | null = null;
  if (p.prescription) {
    rxId = (order?.items ?? []).map((i) => i.metadata?.prescription_id).find((v): v is string => typeof v === "string" && v.length > 0) ?? null;
    if (!rxId) throw new PosError("no_prescription_on_sale", 409);
    const { contexts, designs } = await rxChecksOf(container, order?.items ?? []);
    checkPrescriptions(container, { new: { rx: p.prescription.rx } as never, worn: null }, true, contexts, designs);
  }

  const changed: string[] = [];
  if (p.customer) {
    if (!sale.customer_id) throw new PosError("customer_not_found", 404);
    const customers = container.resolve<ICustomerModuleService>(Modules.CUSTOMER);
    const [existing] = await customers.listCustomers({ id: sale.customer_id }, { take: 1 });
    if (!existing) throw new PosError("customer_not_found", 404);
    // An explicit correction overwrites (unlike the till, which only fills blanks).
    await customers.updateCustomers(existing.id, {
      first_name: p.customer.first_name,
      last_name: p.customer.last_name,
      email: p.customer.email,
      phone: p.customer.phone,
      metadata: { ...(existing.metadata ?? {}), birth_date: p.customer.birth_date },
    });
    if (order) {
      const orders = container.resolve<IOrderModuleService>(Modules.ORDER);
      const address = {
        first_name: p.customer.first_name,
        last_name: p.customer.last_name,
        phone: p.customer.phone,
        ...(p.customer.address
          ? { address_1: p.customer.address.address_1, city: p.customer.address.city, province: p.customer.address.province ?? undefined, postal_code: p.customer.address.postal_code, country_code: p.customer.address.country_code }
          : {}),
      };
      await orders.updateOrders(order.id, { email: p.customer.email, metadata: { ...(order.metadata ?? {}), patient_phone: p.customer.phone } });
      const ids = [order.shipping_address?.id, order.billing_address?.id].filter((v): v is string => Boolean(v));
      if (ids.length) await orders.updateOrderAddresses(ids.map((id) => ({ id, ...address })) as never);
    }
    changed.push("customer");
  }
  if (p.prescription && rxId) {
    await pgOf(container)("prescription")
      .where({ id: rxId })
      .update({
        ...prescriptionColumns(p.prescription.rx),
        source: p.prescription.rx.source === "ocr" ? "ocr" : "manual",
        verified_by_user: storedVerifiedByUser(p.prescription.rx),
        ...(p.prescription.rx_date ? { rx_date: new Date(`${p.prescription.rx_date}T12:00:00Z`) } : {}),
        updated_at: new Date(),
      });
    changed.push("prescription");
  }
  const salePatch: Record<string, unknown> = {};
  if (p.delivery !== undefined && p.delivery !== sale.delivery) { salePatch.delivery = p.delivery; changed.push("delivery"); }
  if (p.promised_on !== undefined && p.promised_on !== sale.promised_on) { salePatch.promised_on = p.promised_on; changed.push("promised_on"); }
  if (p.internal_note !== undefined && p.internal_note !== sale.internal_note) { salePatch.internal_note = p.internal_note; changed.push("internal_note"); }
  if (!changed.length) throw new PosError("nothing_to_change");

  await pos(container).updatePosSales({ id: sale.id, ...salePatch, edited_at: new Date(), edited_by: actorId } as never);
  if (order && ("delivery" in salePatch || "promised_on" in salePatch)) {
    await stampOrder(container, order.id, { ...("delivery" in salePatch ? { delivery: salePatch.delivery } : {}), ...("promised_on" in salePatch ? { promised_on: salePatch.promised_on } : {}) }).catch((e) =>
      logOf(container).warn(`[pos] edit ${sale.number}: order ${order.id} not stamped: ${(e as Error).message}`)
    );
  }
  // Field names only: never the prescription values or the customer's data (lib/audit.ts).
  await recordAudit(container, { actorId, action: "sale.edit", entity: "pos_sale", entityId: sale.id, establishmentId: sale.establishment_id, before: { number: sale.number }, after: { changed } });
  if (order && (changed.includes("customer") || changed.includes("delivery") || changed.includes("promised_on"))) {
    void syncOrderToSheet(container, order.id, "venta editada", undefined, { history: true });
  }
  return { sale: (await getSale(container, sale.id)) as SaleRow, changed };
}

// ---------------------------------------------------------------------------
// Delete / restore
// ---------------------------------------------------------------------------

/** Pure: the delete reason and note, or the reason it is refused. */
export function cleanDeleteInput(body: { reason?: unknown; note?: unknown }): { reason: string } | { why: DeleteReason; note: string | null } {
  const why = (DELETE_REASONS as readonly string[]).includes(String(body.reason)) ? (body.reason as DeleteReason) : null;
  if (!why) return { reason: "bad_delete_reason" };
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > DELETE_REASON_MAX) return { reason: "note_too_long" };
  if (why === "other" && !note) return { reason: "delete_note_required" };
  return { why, note: note || null };
}

const SALE_CHILD_TABLES = ["pos_sale_payment", "cash_movement", "insurance_claim"] as const;

export async function deleteSale(container: MedusaContainer, sale: SaleRow, actorId: string, why: DeleteReason, note: string | null): Promise<SaleRow> {
  const pg = pgOf(container);
  const at = new Date();
  const reasonText = note ? `${why}: ${note}` : why;
  // The Sheet row says it went away while the order can still be read.
  if (sale.order_id) await syncOrderToSheet(container, sale.order_id, "venta eliminada", undefined, { note: `Eliminada (${reasonText})` });
  await pg.transaction(async (trx) => {
    const hit = await trx("pos_sale").where({ id: sale.id }).whereNull("deleted_at").update({ deleted_at: at, deleted_by: actorId, delete_reason: reasonText, updated_at: at });
    if (!hit) throw new PosError("sale_not_found", 404);
    for (const t of SALE_CHILD_TABLES) await trx(t).where({ sale_id: sale.id }).whereNull("deleted_at").update({ deleted_at: at });
    if (sale.order_id) await trx("sale_fact").where({ order_id: sale.order_id }).del();
  });
  await releaseTray(container, sale.id);
  if (sale.order_id) {
    try {
      await container.resolve<IOrderModuleService>(Modules.ORDER).softDeleteOrders([sale.order_id]);
    } catch (e) {
      logOf(container).error(`[pos] delete ${sale.number}: order ${sale.order_id} not hidden: ${(e as Error).message}`);
    }
  }
  await recordAudit(container, { actorId, action: "sale.delete", entity: "pos_sale", entityId: sale.id, establishmentId: sale.establishment_id, before: { number: sale.number, total: sale.total, paid: sale.paid, status: sale.status }, after: { reason: why, note } });
  logOf(container).info(`[pos] sale ${sale.number} deleted by ${actorId} (${reasonText}).`);
  return (await getSaleAnyState(container, sale.id)) as SaleRow;
}

export async function restoreSale(container: MedusaContainer, sale: SaleRow, actorId: string): Promise<SaleRow> {
  if (!sale.deleted_at) throw new PosError("sale_not_deleted", 409);
  const pg = pgOf(container);
  const at = new Date(sale.deleted_at);
  await pg.transaction(async (trx) => {
    // Only what this delete hid: a payment removed earlier for another reason stays removed.
    for (const t of SALE_CHILD_TABLES) await trx(t).where({ sale_id: sale.id, deleted_at: at }).update({ deleted_at: null });
    const hit = await trx("pos_sale").where({ id: sale.id, deleted_at: at }).update({ deleted_at: null, deleted_by: null, delete_reason: null, updated_at: new Date() });
    if (!hit) throw new PosError("sale_not_deleted", 409);
  });
  if (sale.order_id) {
    try {
      await container.resolve<IOrderModuleService>(Modules.ORDER).restoreOrders([sale.order_id]);
    } catch (e) {
      logOf(container).error(`[pos] restore ${sale.number}: order ${sale.order_id} not restored: ${(e as Error).message}`);
    }
  }
  // Glasses still at the lab need a tray again (the old number may have been reused meanwhile).
  if (sale.tray && !sale.delivered_at && sale.status !== "voided") {
    try {
      const n = await takeTray(container, sale.establishment_id, sale.id);
      await pos(container).updatePosSales({ id: sale.id, tray_number: n });
      if (sale.order_id) await stampOrder(container, sale.order_id, { tray: `${sale.number.split("-")[0]}-${n}` }).catch(() => null);
    } catch (e) {
      logOf(container).warn(`[pos] restore ${sale.number}: no tray: ${(e as Error).message}`);
    }
  }
  if (sale.order_id) {
    await projectOrder(container, sale.order_id);
    void syncOrderToSheet(container, sale.order_id, "venta restaurada", undefined, { note: "Restaurada" });
  }
  await recordAudit(container, { actorId, action: "sale.restore", entity: "pos_sale", entityId: sale.id, establishmentId: sale.establishment_id, before: { deleted_at: sale.deleted_at, reason: sale.delete_reason }, after: { number: sale.number } });
  return (await getSale(container, sale.id)) as SaleRow;
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

export async function moveSale(container: MedusaContainer, sale: SaleRow, target: EstablishmentRow, actorId: string): Promise<SaleRow> {
  const pg = pgOf(container);
  const [terminal] = (await ensureTerminal(container, target, actorId)).filter((t) => t.is_active);
  if (!terminal) throw new PosError("bad_terminal", 409);
  const seq = await nextSaleSeq(container, target.id);
  const number = saleNumber(target.code, seq);
  const history = [...sale.previous_numbers, { number: sale.number, establishment_id: sale.establishment_id, moved_at: new Date().toISOString(), moved_by: actorId }];

  // The claim: only the sale as the caller saw it (same store, not deleted) moves, once.
  const hit = await pg("pos_sale")
    .where({ id: sale.id, establishment_id: sale.establishment_id })
    .whereNull("deleted_at")
    .update({ establishment_id: target.id, seq, number, terminal_id: terminal.id, previous_numbers: JSON.stringify(history), updated_at: new Date() });
  if (!hit) throw new PosError("sale_changed", 409);
  await pg("insurance_claim").where({ sale_id: sale.id }).whereNull("deleted_at").update({ establishment_id: target.id });

  // A tray belongs to a store's lab shelf: free the old one, take one in the destination.
  let tray: string | null = null;
  const held = await pos(container).listPosTrays({ sale_id: sale.id, released_at: null } as never, { take: 1 });
  if (held.length) {
    await releaseTray(container, sale.id);
    try {
      const n = await takeTray(container, target.id, sale.id);
      await pos(container).updatePosSales({ id: sale.id, tray_number: n });
      tray = `${target.code}-${n}`;
    } catch (e) {
      await pos(container).updatePosSales({ id: sale.id, tray_number: null });
      logOf(container).warn(`[pos] move ${sale.number}: no tray in ${target.code}: ${(e as Error).message}`);
    }
  }

  if (sale.order_id) {
    try {
      const orders = container.resolve<IOrderModuleService>(Modules.ORDER);
      const order = await orders.retrieveOrder(sale.order_id, { select: ["id", "metadata"] });
      await orders.updateOrders(sale.order_id, {
        sales_channel_id: target.sales_channel_id as string,
        metadata: {
          ...(order.metadata ?? {}),
          establishment_id: target.id,
          establishment_code: target.code,
          terminal_id: terminal.id,
          terminal_code: terminal.code,
          pos_sale_number: number,
          ...(held.length ? { tray } : {}),
          moved_from: sale.number,
        },
      });
    } catch (e) {
      logOf(container).error(`[pos] move ${sale.number} → ${number}: order ${sale.order_id} not updated: ${(e as Error).message}`);
    }
    await projectOrder(container, sale.order_id);
    void syncOrderToSheet(container, sale.order_id, "venta movida", undefined, { note: `Movida de ${sale.number} a ${number}` });
  }
  await recordAudit(container, { actorId, action: "sale.move", entity: "pos_sale", entityId: sale.id, establishmentId: target.id, before: { number: sale.number, establishment_id: sale.establishment_id }, after: { number, establishment_id: target.id } });
  logOf(container).info(`[pos] sale ${sale.number} moved to ${target.code} as ${number} by ${actorId}.`);
  return (await getSale(container, sale.id)) as SaleRow;
}
