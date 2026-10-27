import { MedusaService } from "@medusajs/framework/utils";
import { Establishment } from "./models/index";

/**
 * CRUD only — code assignment and sales-channel creation live in
 * src/lib/establishments.ts.
 */
export default class EstablishmentModuleService extends MedusaService({
  Establishment,
}) {}
