/**
 * Manual / test payment provider for Medusa v2.
 *
 * Allows completing an order without a real payment gateway. Useful for:
 *   - Testing the checkout + email-notification flow end-to-end
 *   - Cash-on-delivery or bank-transfer scenarios
 *   - Development environments without Stripe keys
 *
 * The provider immediately marks payment as captured — no external API calls.
 */

import {
  AbstractPaymentProvider,
  ModuleProvider,
  Modules,
} from "@medusajs/framework/utils";
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
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

// Sin opciones: el proveedor no habla con ningún servicio externo.
type ManualOptions = Record<string, unknown>;

class ManualPaymentProvider extends AbstractPaymentProvider<ManualOptions> {
  static identifier = "manual";

  // El constructor explícito NO es decorativo. Sin él, TypeScript infiere para la
  // clase la firma de construcción de la base abstracta y `ModuleProvider` la
  // rechaza ("typeof ManualPaymentProvider is not assignable to Constructor<any>").
  // Ese error rompía `medusa build` en Coolify en cada push a main, y el
  // contenedor viejo seguía sirviendo sin que nada lo avisara.
  constructor(container: Record<string, unknown>, options: ManualOptions = {}) {
    super(container, options);
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const id = `manual_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    return {
      id,
      data: {
        manual_id: id,
        status: "pending",
        amount: input.amount,
        currency_code: input.currency_code,
      },
    };
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    return {
      status: "captured",
      data: { ...(input.data ?? {}), status: "captured" },
    };
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    return {
      data: { ...(input.data ?? {}), status: "captured" },
    };
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    return {
      data: { ...(input.data ?? {}), status: "refunded" },
    };
  }

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    return {
      data: { ...(input.data ?? {}), status: "canceled" },
    };
  }

  async deletePayment(
    _input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    return { data: {} };
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const status = (input.data?.["status"] as string) ?? "captured";
    const map: Record<string, "pending" | "captured" | "canceled"> = {
      pending: "pending",
      captured: "captured",
      canceled: "canceled",
    };
    return { status: map[status] ?? "captured" };
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data ?? {} };
  }

  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    return {
      data: {
        ...(input.data ?? {}),
        amount: input.amount,
        currency_code: input.currency_code,
      },
    };
  }

  async getWebhookActionAndData(
    _webhookData: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" };
  }
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [ManualPaymentProvider],
});
