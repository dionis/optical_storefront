import { MedusaService } from "@medusajs/framework/utils";
import { CashMovement, CashSession, DiscountApproval, InsuranceClaim, PosPaymentMethod, PosSale, PosSalePayment, PosSetting, PosTerminal, PosTray } from "./models/index";

/**
 * CRUD only — the sale rules live in src/lib/pos.ts and the sale itself (cart,
 * payment, order, number) in src/lib/pos-data.ts.
 */
export default class PosModuleService extends MedusaService({
  PosPaymentMethod,
  PosSale,
  PosSalePayment,
  PosTerminal,
  PosTray,
  PosSetting,
  InsuranceClaim,
  DiscountApproval,
  CashSession,
  CashMovement,
}) {}
