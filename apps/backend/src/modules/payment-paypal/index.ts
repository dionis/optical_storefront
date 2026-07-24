/**
 * PayPal custom payment provider for Medusa v2.
 *
 * Uses PayPal REST API v2 (Orders + Payments APIs).
 * Flow:
 *   1. initiatePayment  → POST /v2/checkout/orders  (AUTHORIZE intent)
 *   2. Client-side: PayPal button redirects user to approve the order
 *   3. authorizePayment → POST /v2/checkout/orders/{id}/authorize
 *   4. capturePayment   → POST /v2/authorizations/{id}/capture
 */

import {
  AbstractPaymentProvider,
  MathBN,
  ModuleProvider,
  Modules,
} from "@medusajs/framework/utils";
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  BigNumberInput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  PaymentSessionStatus,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types";
import crypto from "node:crypto";

/** Normalizes any BigNumberInput variant into a plain JS number. */
function toNumber(amount: BigNumberInput): number {
  return MathBN.convert(amount).toNumber();
}

interface PayPalOptions {
  client_id: string;
  client_secret: string;
  environment: "sandbox" | "production";
  webhook_id: string;
}

interface PayPalTokenResponse {
  access_token: string;
  expires_in: number;
}

class PayPalPaymentProvider extends AbstractPaymentProvider<PayPalOptions> {
  static identifier = "paypal";

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly environment: "sandbox" | "production";
  private readonly webhookId: string;
  private readonly baseUrl: string;

  constructor(container: Record<string, unknown>, options: PayPalOptions) {
    super(container, options);
    this.clientId = options.client_id ?? process.env.PAYPAL_CLIENT_ID ?? "";
    this.clientSecret = options.client_secret ?? process.env.PAYPAL_CLIENT_SECRET ?? "";
    this.environment =
      options.environment ??
      (process.env.PAYPAL_ENVIRONMENT as "sandbox" | "production") ??
      "sandbox";
    this.webhookId = options.webhook_id ?? process.env.PAYPAL_WEBHOOK_ID ?? "";
    this.baseUrl =
      this.environment === "sandbox"
        ? "https://api-m.sandbox.paypal.com"
        : "https://api-m.paypal.com";
  }

  private async getAccessToken(): Promise<string> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`
    ).toString("base64");
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(`PayPal auth failed: ${res.status}`);
    }
    const data = (await res.json()) as PayPalTokenResponse;
    return data.access_token;
  }

  private async paypalRequest(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<unknown> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) {
      headers["PayPal-Request-Id"] = idempotencyKey;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PayPal API error ${res.status}: ${err}`);
    }
    if (res.status === 204) return {};
    return res.json() as Promise<unknown>;
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const idempotencyKey = crypto.randomUUID();
    const amountCents = toNumber(input.amount);
    const amountStr = (amountCents / 100).toFixed(2);
    const currency = (input.currency_code ?? "USD").toUpperCase();

    const order = (await this.paypalRequest(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            amount: { currency_code: currency, value: amountStr },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
              user_action: "PAY_NOW",
              return_url: `${process.env.STOREFRONT_URL ?? "http://localhost:3000"}/checkout?step=confirm`,
              cancel_url: `${process.env.STOREFRONT_URL ?? "http://localhost:3000"}/checkout?step=cancel`,
            },
          },
        },
      },
      idempotencyKey
    )) as { id: string; status: string; links?: Array<{ rel: string; href: string }> };

    const approveLink = order.links?.find((l) => l.rel === "payer-action")?.href;
    return {
      id: order.id,
      data: {
        paypal_order_id: order.id,
        amount: amountCents,
        currency_code: currency,
        status: order.status,
        approve_url: approveLink ?? null,
      },
    };
  }

  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    const { data } = await this.initiatePayment(input);
    return { data };
  }

  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    // PayPal orders expire on their own; voiding any pending authorization is
    // the closest equivalent to discarding the session.
    return this.cancelPayment(input);
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const orderId = input.data?.["paypal_order_id"] as string | undefined;
    if (!orderId) return { data: input.data ?? {} };

    const order = (await this.paypalRequest(
      "GET",
      `/v2/checkout/orders/${orderId}`
    )) as Record<string, unknown>;
    return { data: order };
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const sessionData = input.data ?? {};
    const orderId = sessionData["paypal_order_id"] as string | undefined;
    if (!orderId) {
      throw new Error("PayPal: paypal_order_id missing.");
    }

    const idempotencyKey = crypto.randomUUID();
    const result = (await this.paypalRequest(
      "POST",
      `/v2/checkout/orders/${orderId}/authorize`,
      {},
      idempotencyKey
    )) as { status: string; purchase_units?: Array<{ payments?: { authorizations?: Array<{ id: string }> } }> };

    const authorizationId =
      result.purchase_units?.[0]?.payments?.authorizations?.[0]?.id ?? null;

    return {
      status: result.status === "COMPLETED" ? "authorized" : "pending",
      data: {
        ...sessionData,
        paypal_authorization_id: authorizationId,
        paypal_status: result.status,
      },
    };
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const sessionData = input.data ?? {};
    const authorizationId = sessionData["paypal_authorization_id"] as string | undefined;
    if (!authorizationId) {
      throw new Error("PayPal: paypal_authorization_id missing.");
    }

    const idempotencyKey = crypto.randomUUID();
    const result = (await this.paypalRequest(
      "POST",
      `/v2/payments/authorizations/${authorizationId}/capture`,
      {},
      idempotencyKey
    )) as { id: string; status: string };

    return {
      data: {
        ...sessionData,
        paypal_capture_id: result.id,
        status: "captured",
      },
    };
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const sessionData = input.data ?? {};
    const captureId = sessionData["paypal_capture_id"] as string | undefined;
    if (!captureId) {
      throw new Error("PayPal: paypal_capture_id missing.");
    }

    const refundAmount = toNumber(input.amount);
    const currency = ((sessionData["currency_code"] as string) ?? "USD").toUpperCase();
    const idempotencyKey = crypto.randomUUID();
    await this.paypalRequest(
      "POST",
      `/v2/payments/captures/${captureId}/refund`,
      {
        amount: {
          value: (refundAmount / 100).toFixed(2),
          currency_code: currency,
        },
      },
      idempotencyKey
    );
    return { data: { ...sessionData, refunded_amount: refundAmount } };
  }

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    const sessionData = input.data ?? {};
    const authorizationId = sessionData["paypal_authorization_id"] as string | undefined;
    if (!authorizationId) {
      return { data: { ...sessionData, status: "canceled" } };
    }

    await this.paypalRequest(
      "POST",
      `/v2/payments/authorizations/${authorizationId}/void`,
      {}
    );
    return { data: { ...sessionData, status: "canceled" } };
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const orderId = input.data?.["paypal_order_id"] as string | undefined;
    if (!orderId) return { status: "pending" };

    try {
      const result = (await this.paypalRequest(
        "GET",
        `/v2/checkout/orders/${orderId}`
      )) as { status: string };

      const statusMap: Record<string, PaymentSessionStatus> = {
        CREATED: "pending",
        SAVED: "pending",
        APPROVED: "pending",
        VOIDED: "canceled",
        COMPLETED: "captured",
        PAYER_ACTION_REQUIRED: "requires_more",
      };
      return { status: statusMap[result.status] ?? "pending" };
    } catch {
      return { status: "error" };
    }
  }

  /**
   * Verify PayPal webhook using their signature verification API.
   * Reference: https://developer.paypal.com/api/rest/webhooks/rest/
   */
  async getWebhookActionAndData(
    webhookData: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const { rawData, headers } = webhookData;

    // Verify using PayPal's verification endpoint
    if (this.webhookId) {
      try {
        const body = typeof rawData === "string" ? rawData : JSON.stringify(rawData);
        const token = await this.getAccessToken();
        const verifyRes = await fetch(
          `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              auth_algo: headers["paypal-auth-algo"],
              cert_url: headers["paypal-cert-url"],
              transmission_id: headers["paypal-transmission-id"],
              transmission_sig: headers["paypal-transmission-sig"],
              transmission_time: headers["paypal-transmission-time"],
              webhook_id: this.webhookId,
              webhook_event: JSON.parse(body) as unknown,
            }),
          }
        );
        if (verifyRes.ok) {
          const verifyData = (await verifyRes.json()) as { verification_status: string };
          if (verifyData.verification_status !== "SUCCESS") {
            return { action: "not_supported" };
          }
        }
      } catch {
        // Verification failed — reject
        return { action: "not_supported" };
      }
    }

    const event = rawData as {
      event_type?: string;
      resource?: { id?: string; amount?: { value?: string } };
    };

    const amountCents = event.resource?.amount?.value
      ? Math.round(parseFloat(event.resource.amount.value) * 100)
      : 0;

    switch (event.event_type) {
      case "PAYMENT.AUTHORIZATION.CREATED":
        return {
          action: "authorized",
          data: { session_id: event.resource?.id ?? "", amount: amountCents },
        };
      case "PAYMENT.CAPTURE.COMPLETED":
        return {
          action: "captured",
          data: { session_id: event.resource?.id ?? "", amount: amountCents },
        };
      // Medusa's PaymentActions has no "refunded" member — refunds are driven
      // from the admin via refundPayment, not reconciled from webhooks.
      case "PAYMENT.CAPTURE.REFUNDED":
        return { action: "not_supported" };
      case "PAYMENT.AUTHORIZATION.VOIDED":
        return {
          action: "canceled",
          data: { session_id: event.resource?.id ?? "", amount: 0 },
        };
      default:
        return { action: "not_supported" };
    }
  }
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [PayPalPaymentProvider],
});
