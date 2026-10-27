import { MedusaService } from "@medusajs/framework/utils";
import { AuditEvent } from "./models/index";

/** Use src/lib/audit.ts to write — it never updates or deletes. */
export default class AuditModuleService extends MedusaService({
  AuditEvent,
}) {}
