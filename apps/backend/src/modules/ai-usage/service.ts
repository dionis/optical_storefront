import { MedusaService } from "@medusajs/framework/utils";
import { AiCreditAlert, AiCreditEntry, AiUsageEvent } from "./models/index";

/**
 * CRUD only — pricing, balances, alerts and the report live in
 * `src/lib/ai-usage.ts` (pure) and `src/lib/ai-usage-data.ts` (database).
 */
export default class AiUsageModuleService extends MedusaService({
  AiUsageEvent,
  AiCreditEntry,
  AiCreditAlert,
}) {}
