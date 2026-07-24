import { MedusaService } from "@medusajs/framework/utils";
import { PrescriptionRecord } from "./models/index";
import {
  validatePrescription,
  DEFAULT_RX_RANGES,
  type RxRanges,
} from "./validation";
import type {
  Prescription,
  PrescriptionValidationResult,
} from "@eyewear/shared";

export default class PrescriptionModuleService extends MedusaService({
  PrescriptionRecord,
}) {
  private ranges: RxRanges = DEFAULT_RX_RANGES;

  validate(
    rx: Prescription,
    context: { usage_type?: string; eye_size?: number } = {}
  ): PrescriptionValidationResult {
    return validatePrescription(rx, this.ranges, context);
  }

  async createFromRx(
    rx: Prescription,
    customer_id: string | null = null
  ): Promise<{ id: string }> {
    const record = await this.createPrescriptionRecords({
      od_sph: rx.od.sph,
      od_cyl: rx.od.cyl,
      od_axis: rx.od.axis,
      od_add: rx.od.add,
      od_prism: rx.od.prism,
      od_base: rx.od.base,
      os_sph: rx.os.sph,
      os_cyl: rx.os.cyl,
      os_axis: rx.os.axis,
      os_add: rx.os.add,
      os_prism: rx.os.prism,
      os_base: rx.os.base,
      pd: rx.pd,
      pd_od: rx.pd_od,
      pd_os: rx.pd_os,
      source: rx.source,
      verified_by_user: rx.verified_by_user,
      file_url: rx.file_url,
      customer_id,
    });
    return { id: (record as { id: string }).id };
  }

  /** Map DB record back to shared Prescription type */
  recordToRx(record: Record<string, unknown>): Prescription {
    return {
      id: record["id"] as string,
      od: {
        sph: (record["od_sph"] as number | null) ?? null,
        cyl: (record["od_cyl"] as number | null) ?? null,
        axis: (record["od_axis"] as number | null) ?? null,
        add: (record["od_add"] as number | null) ?? null,
        prism: (record["od_prism"] as number | null) ?? null,
        base: (record["od_base"] as string | null) ?? null,
      },
      os: {
        sph: (record["os_sph"] as number | null) ?? null,
        cyl: (record["os_cyl"] as number | null) ?? null,
        axis: (record["os_axis"] as number | null) ?? null,
        add: (record["os_add"] as number | null) ?? null,
        prism: (record["os_prism"] as number | null) ?? null,
        base: (record["os_base"] as string | null) ?? null,
      },
      pd: (record["pd"] as number | null) ?? null,
      pd_od: (record["pd_od"] as number | null) ?? null,
      pd_os: (record["pd_os"] as number | null) ?? null,
      source: (record["source"] as "manual" | "ocr") ?? "manual",
      verified_by_user: (record["verified_by_user"] as boolean) ?? false,
      file_url: (record["file_url"] as string | null) ?? null,
      created_at: record["created_at"] as string | undefined,
      updated_at: record["updated_at"] as string | undefined,
    };
  }
}
