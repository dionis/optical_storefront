/**
 * Square custom payment provider for Medusa v2.
 *
 * Implements the AbstractPaymentProvider interface:
 *   initiatePayment, authorizePayment, capturePayment, refundPayment,
 *   cancelPayment, getPaymentStatus, webhook handler.
 *
 * Client-side tokenization: Square Web Payments SDK generates a nonce in the browser.
 * Server-side: Payments API charges the nonce.
 *
 * Phase gating: Stripe ships first (Phase 5). This module is stubbed and will be
 * completed after Stripe + PayPal are shipping.
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

interface SquareOptions {
  access_token: string;
  location_id: string;
  environment: "sandbox" | "production";
  webhook_signature_key: string;
}

// TODO(blocked): Complete Square integration after Stripe + PayPal ship (Phase 5)
class SquarePaymentProvider extends AbstractPaymentProvider<SquareOptions> {
  static identifier = "square";

  private readonly accessToken: string;
  private readonly locationId: string;
  private readonly environment: "sandbox" | "production";
  private readonly webhookSignatureKey: string;
  private readonly baseUrl: string;

  constructor(container: MedusaContainer, options: SquareOptions) {
    super(container, options);
    this.accessToken = options.access_token ?? process.env.SQUARE_ACCESS_TOKEN ?? "";
    this.locationId = options.location_id ?? process.env.SQUARE_LOCATION_ID ?? "";
    this.environment = options.environment ?? (process.env.SQUARE_ENVIRONMENT as "sandbox" | "production") ?? "sandbox";
    this.webhookSignatureKey = options.webhook_signature_key ?? process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "";
    this.baseUrl =
      this.environment === "sandbox"
        ? "https://connect.squareupsandbox.com"
        : "https://connect.squareup.com";
  }

  private async squareRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": "2024-11-20",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `Square API error ${response.status}: ${JSON.stringify(data["errors"])}`
      );
    }
    return data;
  }

  async initiatePayment(
    context: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    // Square doesn't have a server-side "create payment intent" like Stripe.
    // We store the amount and currency, then charge when the nonce arrives.
    return {
      id: `sq_pending_${Date.now()}`,
      data: {
        amount: context.amount,
        currency_code: context.currency_code,
        location_id: this.locationId,
        status: "pending",
      },
    };
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<PaymentProviderError | { status: string; data: Record<string, unknown> }> {
    const sourceId = paymentSessionData["source_id"] as string | undefined;
    if (!sourceId) {
      return {
        error: "Square: source_id (payment nonce) is required to authorize.",
        code: "missing_source_id",
        detail: "Frontend must provide the Square payment token.",
      };
    }

    const idempotencyKey = crypto.randomUUID();
    try {
      const result = await this.squareRequest("POST", "/v2/payments", {
        source_id: sourceId,
        idempotency_key: idempotencyKey,
        amount_money: {
          amount: paymentSessionData["amount"],
          currency: (paymentSessionData["currency_code"] as string ?? "USD").toUpperCase(),
        },
        location_id: this.locationId,
        autocomplete: false, // authorize only; capture separately
      }) as { payment: { id: string; status: string } };

      return {
        status: result.payment.status === "APPROVED" ? "authorized" : "pending",
        data: { square_payment_id: result.payment.id, ...paymentSessionData },
      };
    } catch (err: unknown) {
      return {
        error: (err as Error).message,
        code: "square_authorize_failed",
        detail: err,
      };
    }
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const squarePaymentId = paymentSessionData["square_payment_id"] as string;
    if (!squarePaymentId) {
      return { error: "Square: square_payment_id missing.", code: "missing_payment_id", detail: "" };
    }

    try {
      await this.squareRequest("POST", `/v2/payments/${squarePaymentId}/complete`, {});
      return { ...paymentSessionData, status: "captured" };
    } catch (err: unknown) {
      return { error: (err as Error).message, code: "square_capture_failed", detail: err };
    }
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const squarePaymentId = paymentSessionData["square_payment_id"] as string;
    if (!squarePaymentId) {
      return { error: "Square: square_payment_id missing.", code: "missing_payment_id", detail: "" };
    }

    const idempotencyKey = crypto.randomUUID();
    try {
      await this.squareRequest("POST", "/v2/refunds", {
        idempotency_key: idempotencyKey,
        payment_id: squarePaymentId,
        amount_money: {
          amount: refundAmount,
          currency: (paymentSessionData["currency_code"] as string ?? "USD").toUpperCase(),
        },
      });
      return { ...paymentSessionData, refunded_amount: refundAmount };
    } catch (err: unknown) {
      return { error: (err as Error).message, code: "square_refund_failed", detail: err };
    }
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const squarePaymentId = paymentSessionData["square_payment_id"] as string;
    if (!squarePaymentId) {
      // Nothing to cancel server-side if we never authorized
      return { ...paymentSessionData, status: "canceled" };
    }

    try {
      await this.squareRequest("POST", `/v2/payments/${squarePaymentId}/cancel`, {});
      return { ...paymentSessionData, status: "canceled" };
    } catch (err: unknown) {
      return { error: (err as Error).message, code: "square_cancel_failed", detail: err };
    }
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<{ status: string }> {
    const squarePaymentId = paymentSessionData["square_payment_id"] as string;
    if (!squarePaymentId) return { status: "pending" };

    try {
      const result = await this.squareRequest(
        "GET",
        `/v2/payments/${squarePaymentId}`
      ) as { payment: { status: string } };

      const statusMap: Record<string, string> = {
        APPROVED: "authorized",
        COMPLETED: "captured",
        CANCELED: "canceled",
        FAILED: "error",
      };
      return { status: statusMap[result.payment.status] ?? "pending" };
    } catch {
      return { status: "error" };
    }
  }

  /**
   * Verify and handle Square webhook events.
   * Square uses HMAC-SHA256 with the signature key.
   */
  async getWebhookActionAndData(
    webhookData: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const { rawData, headers } = webhookData;
    const signature = headers["x-square-hmacsha256-signature"] as string;

    // Verify webhook signature
    if (this.webhookSignatureKey && signature) {
      const body = typeof rawData === "string" ? rawData : JSON.stringify(rawData);
      const expected = crypto
        .createHmac("sha256", this.webhookSignatureKey)
        .update(body)
        .digest("base64");

      if (signature !== expected) {
        return { action: "not_supported" };
      }
    }

    const event = rawData as { type?: string; data?: { object?: { payment?: { id: string; status: string } } } };
    const payment = event.data?.object?.payment;

    switch (event.type) {
      case "payment.completed":
        return {
          action: "captured",
          data: { session_id: payment?.id ?? "", amount: 0 },
        };
      case "payment.canceled":
        return {
          action: "canceled",
          data: { session_id: payment?.id ?? "", amount: 0 },
        };
      case "refund.completed":
        return {
          action: "refunded",
          data: { session_id: payment?.id ?? "", amount: 0 },
        };
      default:
        return { action: "not_supported" };
    }
  }
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [SquarePaymentProvider],
});
