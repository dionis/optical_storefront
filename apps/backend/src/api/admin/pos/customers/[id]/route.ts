import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getCustomer, lastPrescription, listSales, opticalHistory, PosError } from "../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../lib/pos-route";
import { getPosSettings } from "../../../../../lib/pos-settings";

/**
 * GET /admin/pos/customers/:id — a customer at the counter:
 *  - their last prescription, proposed as the one they wear today (HU-120);
 *  - how their prescription changed purchase after purchase (HU-124);
 *  - their purchases in every store (HU-70).
 *
 * Prescriptions are health data: this is for the person selling to them, who
 * needs it to make the glasses. It never goes to receipts, emails or Sheets.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    await posScope(req);
    const id = String(req.params.id ?? "");
    const customer = await getCustomer(req.scope, id);
    if (!customer) throw new PosError("customer_not_found", 404);
    const settings = await getPosSettings(req.scope);
    const [last, history, sales] = await Promise.all([
      lastPrescription(req.scope, id),
      opticalHistory(req.scope, id, settings.optical_thresholds),
      listSales(req.scope, { establishmentIds: null, customerId: id }, 50),
    ]);
    res.json({
      customer,
      last_prescription: last,
      history,
      // Purchase history across stores: what, where, when, how much — no payments detail.
      sales: sales.map((s) => ({
        id: s.id,
        number: s.number,
        establishment_id: s.establishment_id,
        total: s.total,
        balance: s.balance,
        status: s.status,
        created_at: s.created_at,
      })),
    });
  });
}
