import { MedusaService } from "@medusajs/framework/utils";
import { Seller } from "./models/index";

/**
 * CRUD only — code derivation, token signing and stats live in
 * `src/lib/sellers.ts`, mirroring how store-settings is structured.
 */
export default class SellerModuleService extends MedusaService({
  Seller,
}) {}
