/**
 * Whether the notification channels can actually DELIVER, as opposed to merely
 * resolving.
 *
 * This exists because the failure it describes is invisible. `medusa-config.ts`
 * registers the real Resend/Twilio providers only when their credentials are
 * present, and falls back to `notification-local` — which writes the message to
 * the server log and reports success — for whatever is missing. That is the
 * right call at boot (the backend must start either way), but it means an order
 * can be paid for, the subscriber can run, every call can return OK, and no
 * email is ever sent. The only clue is one warning printed at startup, long
 * scrolled away by the time anyone wonders where the confirmation went.
 *
 * Reading the env here mirrors exactly what medusa-config checks. Keep the two
 * in sync: this module must never claim a channel is live when the config
 * decided otherwise.
 */

export interface ChannelHealth {
  /** True when a real provider is registered for this channel. */
  configured: boolean;
  /** Provider that will handle it: the real one, or the logging fallback. */
  provider: string;
  /** Env vars that are missing, so the message says what to go and set. */
  missing: string[];
}

export interface NotificationHealth {
  email: ChannelHealth;
  sms: ChannelHealth;
}

function check(provider: string, vars: Record<string, string | undefined>): ChannelHealth {
  const missing = Object.entries(vars)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return {
    configured: missing.length === 0,
    provider: missing.length === 0 ? provider : "notification-local (logs only)",
    missing,
  };
}

export function notificationHealth(env: NodeJS.ProcessEnv = process.env): NotificationHealth {
  return {
    email: check("resend", {
      RESEND_API_KEY: env.RESEND_API_KEY,
      RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL,
    }),
    sms: check("twilio", {
      TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
      TWILIO_FROM_NUMBER: env.TWILIO_FROM_NUMBER,
    }),
  };
}

/**
 * One-line explanation for a channel that cannot deliver, suitable for a log
 * line or the admin dashboard. Returns null when the channel is healthy.
 */
export function undeliverableReason(channel: ChannelHealth): string | null {
  if (channel.configured) return null;
  return `not delivered — no provider configured (missing ${channel.missing.join(", ")}); the message was only written to the server log`;
}
