import { MedusaService } from "@medusajs/framework/utils";
import { CostRule } from "./models/index";

/**
 * CRUD only — rule validation, seeding and the cost-sheet math live in
 * `src/lib/costing.ts`.
 */
export default class CostingModuleService extends MedusaService({
  CostRule,
}) {}
