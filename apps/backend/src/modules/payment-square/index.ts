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

  constructor(container: Record<string, unknown>, options: SquareOptions) {
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
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    // Square doesn't have a server-side "create payment intent" like Stripe.
    // We store the amount and currency, then charge when the nonce arrives.
    return {
      id: `sq_pending_${Date.now()}`,
      data: {
        amount: toNumber(input.amount),
        currency_code: input.currency_code,
        location_id: this.locationId,
        status: "pending",
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
    // Cancelling the authorization is the closest equivalent to discarding
    // a Square session; an un-authorized session has no server-side state.
    return this.cancelPayment(input);
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const squarePaymentId = input.data?.["square_payment_id"] as string | undefined;
    if (!squarePaymentId) return { data: input.data ?? {} };

    const result = (await this.squareRequest(
      "GET",
      `/v2/payments/${squarePaymentId}`
    )) as { payment: Record<string, unknown> };
    return { data: result.payment };
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const sessionData = input.data ?? {};
    const sourceId = sessionData["source_id"] as string | undefined;
    if (!sourceId) {
      throw new Error(
        "Square: source_id (payment nonce) is required to authorize. Frontend must provide the Square payment token."
      );
    }

    const idempotencyKey = crypto.randomUUID();
    const result = (await this.squareRequest("POST", "/v2/payments", {
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      amount_money: {
        amount: sessionData["amount"],
        currency: ((sessionData["currency_code"] as string) ?? "USD").toUpperCase(),
      },
      location_id: this.locationId,
      autocomplete: false, // authorize only; capture separately
    })) as { payment: { id: string; status: string } };

    return {
      status: result.payment.status === "APPROVED" ? "authorized" : "pending",
      data: { square_payment_id: result.payment.id, ...sessionData },
    };
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const sessionData = input.data ?? {};
    const squarePaymentId = sessionData["square_payment_id"] as string | undefined;
    if (!squarePaymentId) {
      throw new Error("Square: square_payment_id missing.");
    }

    await this.squareRequest("POST", `/v2/payments/${squarePaymentId}/complete`, {});
    return { data: { ...sessionData, status: "captured" } };
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const sessionData = input.data ?? {};
    const squarePaymentId = sessionData["square_payment_id"] as string | undefined;
    if (!squarePaymentId) {
      throw new Error("Square: square_payment_id missing.");
    }

    const refundAmount = toNumber(input.amount);
    const idempotencyKey = crypto.randomUUID();
    await this.squareRequest("POST", "/v2/refunds", {
      idempotency_key: idempotencyKey,
      payment_id: squarePaymentId,
      amount_money: {
        amount: refundAmount,
        currency: ((sessionData["currency_code"] as string) ?? "USD").toUpperCase(),
      },
    });
    return { data: { ...sessionData, refunded_amount: refundAmount } };
  }

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    const sessionData = input.data ?? {};
    const squarePaymentId = sessionData["square_payment_id"] as string | undefined;
    if (!squarePaymentId) {
      // Nothing to cancel server-side if we never authorized
      return { data: { ...sessionData, status: "canceled" } };
    }

    await this.squareRequest("POST", `/v2/payments/${squarePaymentId}/cancel`, {});
    return { data: { ...sessionData, status: "canceled" } };
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const squarePaymentId = input.data?.["square_payment_id"] as string | undefined;
    if (!squarePaymentId) return { status: "pending" };

    try {
      const result = (await this.squareRequest(
        "GET",
        `/v2/payments/${squarePaymentId}`
      )) as { payment: { status: string } };

      const statusMap: Record<string, PaymentSessionStatus> = {
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
      // Medusa's PaymentActions has no "refunded" member — refunds are driven
      // from the admin via refundPayment, not reconciled from webhooks.
      case "refund.completed":
        return { action: "not_supported" };
      default:
        return { action: "not_supported" };
    }
  }
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [SquarePaymentProvider],
});
