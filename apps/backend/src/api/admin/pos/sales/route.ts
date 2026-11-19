import { localParts } from "../../../../lib/alerts";
import { recordAudit } from "../../../../lib/audit";
import { cleanSoldOn } from "../../../../lib/sale-date";
import { quoteWithPromotion } from "../../../../lib/pos-promotion";
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ONLINE_KIND } from "../../../../lib/establishments";
import { tenant } from "../../../../lib/tenant";
import {
  cleanCustomer,
  missingCustomerData,
  cleanDiscountPct,
  cleanLines,
  cleanPayments,
  cleanRxMeta,
  discountNeedsApproval,
  needsPrescription,
  sellerTillProblem,
  type PosCustomerInput,
  type PosLineInput,
} from "../../../../lib/pos";
import {
  checkPrescriptions,
  createPosSale,
  listPaymentMethods,
  listSales,
  listTerminals,
  PosError,
  rxContexts,
  rxDesigns,
  type RxInput,
  type RxMeta,
} from "../../../../lib/pos-data";
import { runAfterSale } from "../../../../lib/pos-after-sale";
import {
  customerContacts,
  limitedSale,
  ownSalesOnly,
  posHandler,
  posScope,
  saleAccessFor,
  saleWithContact,
  scopeStoreIds,
  sellableStore,
} from "../../../../lib/pos-route";
import { discountLimitFor, getPosSettings } from "../../../../lib/pos-settings";
import { listDeletedSales } from "../../../../lib/pos-sale-admin";
import { saleAdminDenied } from "../../../../lib/sale-permissions";

/**
 * VENTAS DEL PUNTO DE VENTA.
 *
 *   GET  /admin/pos/sales?store=&terminal=&number=&customer=&with_balance=1&pending=1&mine=1&from=&to=
 *        Ventas dentro del alcance de quien pregunta (matriz de permisos):
 *        dueño y superadmin todas, supervisor y encargado las de sus tiendas.
 *        El vendedor (regla del dueño, lib/pos-route.ts saleAccessFor): las
 *        suyas completas y, de sus compañeros de tienda, SOLO las que deben
 *        dinero y reducidas a lo necesario para cobrar (`limited: true`, sin
 *        artículos, receta ni economía). Nunca el estado general de la tienda.
 *        `pending=1`: solo ventas con saldo pendiente (cualquier rol, en su
 *        alcance), con nombre y teléfono del cliente para cobrar.
 *        `mine=1`: solo las ventas propias de quien pregunta (cualquier rol).
 *        Cada venta trae además de quién fue y qué se vendió, leído de las
 *        tablas de origen (lib/pos-sale-detail.ts): `customer_name`,
 *        `customer_phone`, `frame_brand`, `frame_model`, `frame_color`,
 *        `frame_sku`, `own_frame`, `has_rx`, `lens`, `lens_summary` e `items`,
 *        con los mismos nombres que la lista de analítica. La analítica
 *        (sale_fact) solo hace falta ya para la economía de la venta (costo,
 *        comisión, ganancia, margen), que vive en otra ruta.
 *   POST /admin/pos/sales — registra una venta (ver Body). El servidor vuelve a
 *        calcular precio y descuento (nunca se fía de un total del cliente);
 *        un descuento fuera de límite exige una aprobación vigente.
 *
 * Errores con `reason`; el panel traduce con adm.err.pos.<reason>.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const q = req.query as Record<string, string | undefined>;
    // Deleted (hidden) sales: owner and superadmin only, to restore them (lib/pos-sale-admin.ts).
    if (q.deleted === "1") {
      const denied = saleAdminDenied(scope);
      if (denied) throw new PosError(denied, 403);
      const storeIds = q.store ? [(await sellableStore(req, scope, q.store)).id] : null;
      const rows = await listDeletedSales(req.scope, storeIds, Math.min(200, Number(q.limit) || 100));
      const contacts = await customerContacts(req.scope, rows.map((s) => s.customer_id));
      res.json({ sales: rows.map((s) => saleWithContact(s, s.customer_id ? contacts.get(s.customer_id) : undefined)) });
      return;
    }
    const ids = q.store ? [(await sellableStore(req, scope, q.store)).id] : await scopeStoreIds(req, scope);
    const seller = ownSalesOnly(scope);
    const mine = q.mine === "1";
    const pending = q.pending === "1" || q.with_balance === "1";
    const sales =
      ids && !ids.length
        ? []
        : await listSales(
            req.scope,
            {
              establishmentIds: ids,
              // A seller never filters by another seller: their list is "mine, or owed".
              sellerId: mine ? scope.user_id : seller ? undefined : q.seller || undefined,
              ownOrPendingFor: seller && !mine ? scope.user_id : undefined,
              terminalId: q.terminal || undefined,
              customerId: q.customer || undefined,
              number: q.number?.trim() || undefined,
              withBalance: pending,
              status: q.status === "voided" || q.status === "completed" ? q.status : undefined,
              from: q.from || undefined,
              to: q.to || undefined,
            },
            Math.min(200, Number(q.limit) || 50),
            // Cliente, montura, lentes y artículos salen de las tablas de
            // origen (cliente, líneas del pedido, producto), no de la
            // analítica: el panel no tiene que completar la lista con una
            // segunda consulta a sale_fact, que no tiene fila para toda venta.
            { withDetail: true }
          );
    // Collecting needs the customer's name and phone; the plain list does not carry them.
    const contacts = pending || seller ? await customerContacts(req.scope, sales.map((s) => s.customer_id)) : new Map();
    const rows = sales.map((s) => {
      const contact = s.customer_id ? contacts.get(s.customer_id) : undefined;
      if (seller && saleAccessFor(scope, s) !== "full") return limitedSale(s, contact);
      return pending || seller ? saleWithContact(s, contact) : s;
    });
    res.json({ sales: rows });
  });
}

interface SaleBody {
  store?: string;
  terminal_id?: string;
  /** Chosen from the search; else the customer is matched by email or phone, or created. */
  customer_id?: string | null;
  customer?: PosCustomerInput;
  lines?: PosLineInput[];
  discount_pct?: unknown;
  /** A promotion of the store (lib/promotions.ts) and, for «compre N, lleve M», the paid sale(s). */
  promotion_id?: string | null;
  promotion_ref?: string | null;
  approval_id?: string | null;
  payments?: unknown;
  prescriptions?: { new?: (RxInput & Record<string, unknown>) | null; worn?: (RxInput & Record<string, unknown>) | null };
  delivery?: "pickup" | "ship";
  notify_email?: boolean;
  /** Stage notices by SMS too (default off). */
  notify_sms?: boolean;
  /** Receipt with photos and prescription. Only exactly true: the default email has neither. */
  receipt_detail?: boolean;
  /** Generated by the till per sale; a retry with the same key never records it twice. */
  idempotency_key?: string;
  /**
   * The lenses are sold now and the prescription comes later (the patient goes
   * to the exam): no new prescription is required. Ignored when one is sent or
   * nothing sold needs one.
   */
  rx_pending?: boolean;
  /**
   * The sale happened on an earlier day of the store's calendar
   * (lib/sale-date.ts): { date: "YYYY-MM-DD", time?: "HH:MM", note? }. Absent
   * or today = now. How far back depends on the role.
   */
  sold_on?: { date?: string; time?: string | null; note?: string | null } | null;
}

export async function POST(req: AuthenticatedMedusaRequest<SaleBody>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const started = Date.now();
    const body = (req.body ?? {}) as SaleBody;
    const scope = await posScope(req);
    const store = await sellableStore(req, scope, body.store);
    const terminal = (await listTerminals(req.scope, [store.id])).find((t) => t.id === body.terminal_id && t.is_active);
    if (!terminal) throw new PosError("bad_terminal");
    const till = sellerTillProblem(scope, store.id, terminal.id);
    if (till) throw new PosError(till, 403);

    // The email is optional at the counter; only a sale in THE online store needs it.
    // Lenient (owner, 17-nov-2026): a sale can be recorded with patient data missing — the till
    // warns and the sale says what is missing until it is completed from its detail.
    const customer = cleanCustomer(body.customer, new Date(), tenant().timezone, { requireEmail: store.kind === ONLINE_KIND, lenient: true });
    if ("reason" in customer) throw new PosError(customer.reason);
    const missing = missingCustomerData(customer.customer, body.delivery === "ship" ? "ship" : "pickup");
    const backdate = cleanSoldOn(body.sold_on, new Date(), tenant().timezone, scope.role);
    if (backdate && "reason" in backdate) throw new PosError(backdate.reason, 422, backdate.max ? { max: backdate.max } : {});
    const lines = cleanLines(body.lines);
    if ("reason" in lines) throw new PosError(lines.reason);
    const discount = cleanDiscountPct(body.discount_pct);
    if ("reason" in discount) throw new PosError(discount.reason);

    const prescriptions = { new: body.prescriptions?.new ?? null, worn: body.prescriptions?.worn ?? null };
    const rxMeta: { new: RxMeta | null; worn: RxMeta | null } = { new: null, worn: null };
    for (const k of ["new", "worn"] as const) {
      const p = prescriptions[k];
      if (!p) continue;
      const m = cleanRxMeta(p as never);
      if ("reason" in m) throw new PosError(m.reason);
      rxMeta[k] = m;
    }
    if (prescriptions.worn && !rxMeta.worn?.rx_date && !rxMeta.worn?.rx_date_approx) {
      // The point of recording what they wear is "how long ago" (HU-121).
      throw new PosError("worn_date_required");
    }

    const [promoted, settings, methods] = await Promise.all([
      quoteWithPromotion(req.scope, store.id, lines.lines, discount.pct, body.promotion_id, body.promotion_ref),
      getPosSettings(req.scope),
      listPaymentMethods(req.scope),
    ]);
    const { quote } = promoted;
    const needsRx = needsPrescription(lines.lines);
    // «Graduación pendiente»: sold now, the prescription is added from the sale (lib/rx-pending.ts).
    const rxPending = body.rx_pending === true && needsRx && !prescriptions.new;
    checkPrescriptions(req.scope, prescriptions, needsRx && !rxPending, rxContexts(quote), rxDesigns(quote));

    const limitPct = discountLimitFor(scope, settings.discount_limits);
    // A promotion's percentage was set up by the owner: no approval for it.
    const needsApproval = promoted.discount_source === "promotion" ? false : discountNeedsApproval({ isAdmin: scope.is_admin, pct: quote.discount_pct, limitPct, belowMinimum: quote.below_minimum });

    // No deposit is allowed: the whole total stays as balance (the till warned).
    const payments = cleanPayments(body.payments, quote.total_cents, methods, { establishmentId: store.id, allowNone: true });
    if ("reason" in payments) throw new PosError(payments.reason, 422, payments.method ? { method: payments.method } : {});

    const key = typeof body.idempotency_key === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(body.idempotency_key) ? body.idempotency_key : null;
    const sale = await createPosSale(req.scope, {
      store,
      terminal,
      sellerId: scope.user_id,
      sellerCode: scope.seller_code,
      customer: customer.customer,
      customerId: typeof body.customer_id === "string" && body.customer_id ? body.customer_id : null,
      lines: lines.lines,
      quote,
      payments,
      approvalId: typeof body.approval_id === "string" ? body.approval_id : null,
      needsApproval,
      prescriptions,
      rxMeta,
      thresholds: settings.optical_thresholds,
      delivery: body.delivery === "ship" ? "ship" : "pickup",
      notifyEmail: body.notify_email === true,
      notifySms: body.notify_sms === true,
      rxPending,
      promotion: promoted.promotion,
      missing,
      backdate,
      idempotencyKey: key,
    });
    res.json({ sale });
    if (backdate && !sale.replayed) {
      void recordAudit(req.scope, { actorId: scope.user_id, action: "sale.backdate", entity: "pos_sale", entityId: sale.id, establishmentId: store.id, before: { recorded_on: localParts(new Date(), tenant().timezone).date }, after: { number: sale.number, sold_on: backdate.date, time: backdate.time, days: backdate.days, note: backdate.note } }).catch(() => {});
    }
    // The sale is recorded and the till answered: emails go out without holding it.
    if (!sale.replayed) {
      void runAfterSale(req.scope, {
        sale,
        quote,
        store,
        sellerId: scope.user_id,
        sellerCode: scope.seller_code,
        notifyEmail: body.notify_email === true && Boolean(customer.customer.email),
        receiptDetail: body.receipt_detail === true,
        responseMs: Date.now() - started,
      });
    }
  });
}
