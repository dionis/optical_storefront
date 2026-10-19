import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { PRESCRIPTION_MODULE } from "../../../modules/prescription/index";
import type PrescriptionModuleService from "../../../modules/prescription/service";
import { uploadTryonImage } from "../../../lib/tryon-image";
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
    /** AI try-on render as a base64 `data:` URL (saved with the order and attached to its emails). */
    tryon_image?: string;
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

  // Una receta NO FABRICABLE no se guarda: antes `validation` se calculaba y
  // se insertaba igual, así que el laboratorio podía recibir valores que la
  // propia validación declara imposibles de tallar.
  if (validation && validation.fulfillable === false) {
    res.status(422).json({
      error_code: "invalid_prescription",
      error: "The prescription failed validation and was not stored.",
      validation,
    });
    return;
  }

  // `file_url` lo escribe el OCR de ESTA tienda como una CLAVE de objeto del
  // bucket privado ("rx/<uuid>.<ext>", ver ocr/route.ts). Aceptar aquí
  // cualquier cadena del cliente permitía presignar después un objeto
  // arbitrario del bucket. Solo se admite esa forma; lo demás se descarta.
  const safeFileKey =
    typeof rx.file_url === "string" && /^rx\/[A-Za-z0-9._-]{1,200}$/.test(rx.file_url)
      ? rx.file_url
      : null;

  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

  // Save the AI try-on render (if any) to the private bucket first, so the row
  // carries its key. Best-effort — a failed upload leaves tryon_image_url null
  // without failing the prescription.
  const tryonImageKey = await uploadTryonImage(body.tryon_image);

  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const [row] = await pg("prescription")
    .insert({
      od_sph: num(rx.od.sph), od_cyl: num(rx.od.cyl), od_axis: num(rx.od.axis),
      od_add: num(rx.od.add), od_prism: num(rx.od.prism), od_base: rx.od.base ?? null,
      os_sph: num(rx.os.sph), os_cyl: num(rx.os.cyl), os_axis: num(rx.os.axis),
      os_add: num(rx.os.add), os_prism: num(rx.os.prism), os_base: rx.os.base ?? null,
      pd: num(rx.pd), pd_od: num(rx.pd_od), pd_os: num(rx.pd_os),
      // Fitting height: mandatory for multifocals (the lab cuts the corridor to
      // it) and used by the try-on to place the segment. Was being dropped here.
      seg_height: num(rx.seg_height),
      source,
      verified_by_user: verifiedByUser,
      file_url: safeFileKey,
      tryon_image_url: tryonImageKey,
      // Para quién son (elegido en el probador). Solo se guarda el nombre cuando es
      // "other"; se recorta a 120 caracteres.
      patient_for: rx.patient_for === "me" || rx.patient_for === "other" ? rx.patient_for : null,
      patient_name:
        rx.patient_for === "other" && typeof rx.patient_name === "string"
          ? rx.patient_name.trim().slice(0, 120) || null
          : null,
      // Medidas de encaje calculadas por la IA del probador (y no editadas).
      measurement_source: rx.measurement_source === "ai" ? "ai" : null,
      measurement_quality:
        rx.measurement_source === "ai" && typeof rx.measurement_quality === "string"
          ? rx.measurement_quality.trim().slice(0, 40) || null
          : null,
      customer_id: null,
    })
    .returning("id");

  res.json({ prescription_id: (row as { id: string }).id, validation });
}
