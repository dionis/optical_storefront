import { MedusaService } from "@medusajs/framework/utils";
import { PosPaymentMethod, PosSale, PosSalePayment } from "./models/index";

/**
 * CRUD only — the sale rules live in src/lib/pos.ts and the sale itself (cart,
 * payment, order, number) in src/lib/pos-data.ts.
 */
export default class PosModuleService extends MedusaService({
  PosPaymentMethod,
  PosSale,
  PosSalePayment,
}) {}
