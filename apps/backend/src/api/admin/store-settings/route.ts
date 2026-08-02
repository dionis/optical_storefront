import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { STORE_SETTINGS_MODULE } from "../../../modules/store-settings/index";
import type StoreSettingsModuleService from "../../../modules/store-settings/service";
import {
  KNOWN_PAYMENT_PROVIDERS,
  STORE_SETTING_ID,
  isKnownPaymentProvider,
  parseTaxRate,
  resolveStoreSettings,
} from "../../../lib/store-settings";

// A permissive but real email check — enough to reject a typo, without pretending
// to fully validate RFC 5322.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UpdateBody {
  owner_notification_email?: string | null;
  owner_notification_sms?: string | null;
  active_payment_provider?: string | null;
  frame_tax_rate?: string | number | null;
}

function buildPayload(
  settings: Awaited<ReturnType<typeof resolveStoreSettings>>
) {
  return {
    settings,
    payment_providers: KNOWN_PAYMENT_PROVIDERS,
  };
}

/** GET /admin/store-settings — current configuration + selectable providers. */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const settings = await resolveStoreSettings(req.scope);
  res.json(buildPayload(settings));
}

/** POST /admin/store-settings — owner email / SMS / active payment provider. */
export async function POST(
  req: AuthenticatedMedusaRequest<UpdateBody>,
  res: MedusaResponse
): Promise<void> {
  const body = (req.body ?? {}) as UpdateBody;

  // Normalize: empty string clears the field (stored as null).
  const email =
    body.owner_notification_email == null
      ? null
      : String(body.owner_notification_email).trim() || null;
  const sms =
    body.owner_notification_sms == null
      ? null
      : String(body.owner_notification_sms).trim() || null;
  const provider =
    body.active_payment_provider == null
      ? null
      : String(body.active_payment_provider).trim() || null;
  // Store the frame tax rate as a normalized decimal string ("0.07"); empty clears it.
  const taxRaw =
    body.frame_tax_rate == null ? null : String(body.frame_tax_rate).trim() || null;
  const frameTaxRate = taxRaw == null ? null : String(parseTaxRate(taxRaw));

  if (email && !EMAIL_RE.test(email)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `'${email}' is not a valid email address.`
    );
  }
  if (sms && !/^\+?[0-9()\-\s]{7,20}$/.test(sms)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `'${sms}' is not a valid phone number (use E.164, e.g. +13055551234).`
    );
  }
  if (provider && !isKnownPaymentProvider(provider)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown payment provider '${provider}'. Allowed: ${KNOWN_PAYMENT_PROVIDERS.join(", ")}.`
    );
  }

  const svc = req.scope.resolve<StoreSettingsModuleService>(STORE_SETTINGS_MODULE);
  const existing = (await svc.listStoreSettings({
    id: STORE_SETTING_ID,
  })) as unknown as Record<string, unknown>[];

  const data = {
    id: STORE_SETTING_ID,
    owner_notification_email: email,
    owner_notification_sms: sms,
    active_payment_provider: provider,
    frame_tax_rate: frameTaxRate,
    updated_by: req.auth_context?.actor_id ?? null,
  };

  if (existing[0]) {
    await svc.updateStoreSettings(data);
  } else {
    await svc.createStoreSettings(data);
  }

  console.info(
    JSON.stringify({
      event: "store_settings.updated",
      owner_notification_email: email,
      owner_notification_sms: sms,
      active_payment_provider: provider,
      admin_user_id: req.auth_context?.actor_id ?? null,
      timestamp: new Date().toISOString(),
    })
  );

  const settings = await resolveStoreSettings(req.scope);
  res.json(buildPayload(settings));
}
