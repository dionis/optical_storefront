import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../lib/establishments";
import {
  cleanCustomer,
  cleanLines,
  cleanPayments,
  needsPrescription,
  sellableStores,
  type PosCustomerInput,
  type PosLineInput,
} from "../../../../lib/pos";
import {
  checkPrescriptions,
  createPosSale,
  listPaymentMethods,
  listSales,
  PosError,
  quoteSale,
  type RxInput,
} from "../../../../lib/pos-data";
import { posHandler, posScope, sellableStore } from "../../../../lib/pos-route";

/**
 * VENTAS DEL PUNTO DE VENTA.
 *
 *   GET  /admin/pos/sales?store=est_… — últimas ventas de una tienda, o de todas
 *        las que el usuario puede ver si no se indica.
 *   POST /admin/pos/sales — registra una venta:
 *        { store, customer, lines, payments, prescriptions: { new, worn }, notify_email }
 *        El servidor vuelve a calcular el precio (nunca se fía del total del
 *        cliente) y los pagos deben cubrirlo exactamente.
 *
 * Errores con `reason`; el panel traduce con adm.err.pos.<reason>.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const q = req.query as Record<string, string | undefined>;
    let ids: string[] | null;
    if (q.store) ids = [(await sellableStore(req, scope, q.store)).id];
    else if (scope.is_admin) ids = null;
    else ids = sellableStores(scope, await listEstablishments(req.scope)).map((s) => s.id);
    res.json({ sales: ids && !ids.length ? [] : await listSales(req.scope, ids, Math.min(200, Number(q.limit) || 50)) });
  });
}

interface SaleBody {
  store?: string;
  customer?: PosCustomerInput;
  lines?: PosLineInput[];
  payments?: unknown;
  prescriptions?: { new?: RxInput | null; worn?: RxInput | null };
  notify_email?: boolean;
}

export async function POST(req: AuthenticatedMedusaRequest<SaleBody>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const body = (req.body ?? {}) as SaleBody;
    const store = await sellableStore(req, await posScope(req), body.store);

    const customer = cleanCustomer(body.customer);
    if ("reason" in customer) throw new PosError(customer.reason);
    const lines = cleanLines(body.lines);
    if ("reason" in lines) throw new PosError(lines.reason);
    const prescriptions = { new: body.prescriptions?.new ?? null, worn: body.prescriptions?.worn ?? null };
    checkPrescriptions(req.scope, prescriptions, needsPrescription(lines.lines));

    const quote = await quoteSale(req.scope, store.id, lines.lines);
    const payments = cleanPayments(body.payments, quote.total_cents, await listPaymentMethods(req.scope));
    if ("reason" in payments) throw new PosError(payments.reason);

    const sale = await createPosSale(req.scope, {
      store,
      sellerId: req.auth_context?.actor_id ?? null,
      customer: customer.customer,
      lines: lines.lines,
      payments: payments.payments,
      quote,
      prescriptions,
      notifyEmail: body.notify_email === true,
    });
    res.json({ sale });
  });
}
