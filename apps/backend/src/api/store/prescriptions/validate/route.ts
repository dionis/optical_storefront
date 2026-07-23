import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PRESCRIPTION_MODULE } from "../../../modules/prescription/index";
import type PrescriptionModuleService from "../../../modules/prescription/service";
import type { Prescription } from "@eyewear/shared";

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const prescriptionService = req.scope.resolve<PrescriptionModuleService>(
    PRESCRIPTION_MODULE
  );

  const body = req.body as {
    prescription: Prescription;
    usage_type?: string;
    eye_size?: number;
  };

  if (!body.prescription) {
    res.status(400).json({ error: "Campo 'prescription' requerido." });
    return;
  }

  const result = prescriptionService.validate(body.prescription, {
    usage_type: body.usage_type,
    eye_size: body.eye_size,
  });

  res.json(result);
}
