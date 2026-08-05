import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { notificationHealth } from "../../../lib/notification-health";
import { STORE_SETTINGS_MODULE } from "../../../modules/store-settings/index";
import type StoreSettingsModuleService from "../../../modules/store-settings/service";
import {
  KNOWN_PAYMENT_PROVIDERS,
  STORE_SETTING_ID,
  isKnownPaymentProvider,
  parseEmailList,
  parseTaxRate,
  resolveStoreSettings,
} from "../../../lib/store-settings";

// A permissive but real email check — enough to reject a typo, without pretending
// to fully validate RFC 5322.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UpdateBody {
  owner_notification_email?: string | null;
  owner_notification_sms?: string | null;
  /** Free-form list (commas / newlines) of extra administrators to copy. */
  admin_notification_emails?: string | string[] | null;
  support_email?: string | null;
  active_payment_provider?: string | null;
  frame_tax_rate?: string | number | null;
}

function buildPayload(
  settings: Awaited<ReturnType<typeof resolveStoreSettings>>
) {
  return {
    settings,
    payment_providers: KNOWN_PAYMENT_PROVIDERS,
    // Whether email/SMS can actually be delivered. Configuring a recipient here
    // does nothing if no provider is wired: the notification module quietly
    // falls back to writing messages to the server log. Surfacing it next to
    // the very fields it makes useless is the point.
    notification_health: notificationHealth(),
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

  // The admin list is stored normalized ("a@x.com,b@y.com") so reads never have
  // to re-guess the separator the owner happened to type.
  const adminList =
    body.admin_notification_emails == null
      ? null
      : parseEmailList(
          Array.isArray(body.admin_notification_emails)
            ? body.admin_notification_emails.join(",")
            : body.admin_notification_emails
        );
  const support =
    body.support_email == null ? null : String(body.support_email).trim() || null;

  if (email && !EMAIL_RE.test(email)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `'${email}' is not a valid email address.`
    );
  }
  // Reject the whole list on one bad entry rather than silently dropping it —
  // a typo'd administrator would otherwise never be notified and nobody would
  // find out until an order went unanswered.
  const badAdmin = adminList?.find((value) => !EMAIL_RE.test(value));
  if (badAdmin) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `'${badAdmin}' is not a valid email address.`
    );
  }
  if (support && !EMAIL_RE.test(support)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `'${support}' is not a valid email address.`
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
    admin_notification_emails: adminList === null ? null : adminList.join(","),
    support_email: support,
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
      admin_notification_emails: adminList,
      support_email: support,
      active_payment_provider: provider,
      admin_user_id: req.auth_context?.actor_id ?? null,
      timestamp: new Date().toISOString(),
    })
  );

  const settings = await resolveStoreSettings(req.scope);
  res.json(buildPayload(settings));
}
