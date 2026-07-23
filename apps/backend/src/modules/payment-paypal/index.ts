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
  ModuleProvider,
  Modules,
  PaymentProviderError,
  PaymentProviderSessionResponse,
  MedusaContainer,
} from "@medusajs/framework/utils";
import type {
  CreatePaymentProviderSession,
  UpdatePaymentProviderSession,
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/types";
import crypto from "node:crypto";

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

  constructor(container: MedusaContainer, options: PayPalOptions) {
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
    context: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const idempotencyKey = crypto.randomUUID();
    const amountStr = (context.amount / 100).toFixed(2);
    const currency = (context.currency_code ?? "USD").toUpperCase();

    try {
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
          amount: context.amount,
          currency_code: currency,
          status: order.status,
          approve_url: approveLink ?? null,
        },
      };
    } catch (err: unknown) {
      return {
        error: (err as Error).message,
        code: "paypal_initiate_failed",
        detail: err,
      };
    }
  }

  async updatePayment(
    context: UpdatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    return this.initiatePayment(context);
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<PaymentProviderError | { status: string; data: Record<string, unknown> }> {
    const orderId = paymentSessionData["paypal_order_id"] as string;
    if (!orderId) {
      return { error: "PayPal: paypal_order_id missing.", code: "missing_order_id", detail: "" };
    }

    const idempotencyKey = crypto.randomUUID();
    try {
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
          ...paymentSessionData,
          paypal_authorization_id: authorizationId,
          paypal_status: result.status,
        },
      };
    } catch (err: unknown) {
      return { error: (err as Error).message, code: "paypal_authorize_failed", detail: err };
    }
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const authorizationId = paymentSessionData["paypal_authorization_id"] as string;
    if (!authorizationId) {
      return { error: "PayPal: paypal_authorization_id missing.", code: "missing_auth_id", detail: "" };
    }

    const idempotencyKey = crypto.randomUUID();
    try {
      const result = (await this.paypalRequest(
        "POST",
        `/v2/payments/authorizations/${authorizationId}/capture`,
        {},
        idempotencyKey
      )) as { id: string; status: string };

      return {
        ...paymentSessionData,
        paypal_capture_id: result.id,
        status: "captured",
      };
    } catch (err: unknown) {
      return { error: (err as Error).message, code: "paypal_capture_failed", detail: err };
    }
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const captureId = paymentSessionData["paypal_capture_id"] as string;
    if (!captureId) {
      return { error: "PayPal: paypal_capture_id missing.", code: "missing_capture_id", detail: "" };
    }

    const currency = (paymentSessionData["currency_code"] as string ?? "USD").toUpperCase();
    const idempotencyKey = crypto.randomUUID();
    try {
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
      return { ...paymentSessionData, refunded_amount: refundAmount };
    } catch (err: unknown) {
      return { error: (err as Error).message, code: "paypal_refund_failed", detail: err };
    }
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const authorizationId = paymentSessionData["paypal_authorization_id"] as string;
    if (!authorizationId) {
      return { ...paymentSessionData, status: "canceled" };
    }

    try {
      await this.paypalRequest(
        "POST",
        `/v2/payments/authorizations/${authorizationId}/void`,
        {}
      );
      return { ...paymentSessionData, status: "canceled" };
    } catch (err: unknown) {
      return { error: (err as Error).message, code: "paypal_cancel_failed", detail: err };
    }
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<{ status: string }> {
    const orderId = paymentSessionData["paypal_order_id"] as string;
    if (!orderId) return { status: "pending" };

    try {
      const result = (await this.paypalRequest(
        "GET",
        `/v2/checkout/orders/${orderId}`
      )) as { status: string };

      const statusMap: Record<string, string> = {
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
      case "PAYMENT.CAPTURE.REFUNDED":
        return {
          action: "refunded",
          data: { session_id: event.resource?.id ?? "", amount: amountCents },
        };
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
