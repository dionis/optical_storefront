import { MedusaService } from "@medusajs/framework/utils";
import { AlertDelivery, AlertRule } from "./models/index";

/** CRUD only — evaluation is in src/lib/alerts.ts, sending in src/lib/alerts-data.ts. */
export default class SalesAlertModuleService extends MedusaService({
  AlertRule,
  AlertDelivery,
}) {}
