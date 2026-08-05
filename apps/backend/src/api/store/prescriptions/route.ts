import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { PRESCRIPTION_MODULE } from "../../../modules/prescription/index";
import type PrescriptionModuleService from "../../../modules/prescription/service";
import type { Prescription } from "@eyewear/shared";

/**
 * POST /store/prescriptions
 * Persist a prescription as a health record (PHI) and return only its id. The raw
 * Rx values are stored server-side in Postgres — NEVER in cart metadata or the
 * browser. The cart/order references the prescription by `prescription_id`.
 *
 * Body: { prescription: Prescription, usage_type?, eye_size? }
 * OCR-extracted values require explicit human confirmation (verified_by_user=true)
 * before this call. Written via the shared PG connection (the module ORM manager is
 * not available in this project — same pattern as the lens-config routes).
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const body = req.body as {
    prescription?: Prescription;
    usage_type?: string;
    eye_size?: number;
  };

  const rx = body.prescription;
  if (!rx || !rx.od || !rx.os) {
    res.status(400).json({ error_code: "prescription_required", error: "Body must carry 'prescription' with 'od' and 'os'." });
    return;
  }

  const source = rx.source === "ocr" ? "ocr" : "manual";

  // OCR output is a model's reading of a health document, not an authoritative
  // record: it is only persistable once a human has reviewed the values on
  // screen and confirmed them. The OCR route always emits verified_by_user
  // false, so an unconfirmed payload reaching here means the confirmation step
  // was bypassed.
  if (source === "ocr" && rx.verified_by_user !== true) {
    res.status(400).json({
      error_code: "ocr_not_confirmed",
      error: "An OCR prescription must be confirmed by the user before it is stored.",
    });
    return;
  }

  const verifiedByUser = source === "ocr" ? true : rx.verified_by_user ?? true;

  // Validation is a pure function on the service (no ORM manager needed).
  const svc = req.scope.resolve<PrescriptionModuleService>(PRESCRIPTION_MODULE);
  const validation = svc.validate(
    { ...rx, source, verified_by_user: verifiedByUser, file_url: rx.file_url ?? null },
    { usage_type: body.usage_type, eye_size: body.eye_size }
  );

  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const [row] = await pg("prescription")
    .insert({
      od_sph: num(rx.od.sph), od_cyl: num(rx.od.cyl), od_axis: num(rx.od.axis),
      od_add: num(rx.od.add), od_prism: num(rx.od.prism), od_base: rx.od.base ?? null,
      os_sph: num(rx.os.sph), os_cyl: num(rx.os.cyl), os_axis: num(rx.os.axis),
      os_add: num(rx.os.add), os_prism: num(rx.os.prism), os_base: rx.os.base ?? null,
      pd: num(rx.pd), pd_od: num(rx.pd_od), pd_os: num(rx.pd_os),
      source,
      verified_by_user: verifiedByUser,
      file_url: rx.file_url ?? null,
      customer_id: null,
    })
    .returning("id");

  res.json({ prescription_id: (row as { id: string }).id, validation });
}
