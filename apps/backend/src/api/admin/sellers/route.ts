import { loadDefaultCommissionPct } from "../../../lib/store-cost-toggle";
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments } from "../../../lib/establishments";
import { sellerWithAddress } from "../../../lib/seller-address";
import { takenCodes } from "../../../lib/staff-code";
import { listTerminals } from "../../../lib/pos-data";
import { isValidEmail, isValidName, isValidPhone } from "../../../lib/field-rules";
import {
  deriveSellerCode,
  listSellers,
  normalizeSellerCode,
  normalizeSocial,
  parseCommissionPct,
  projectSeller,
  sellerPlacementProblem,
  sellerService,
  type Seller,
  type SellerPlacementReason,
} from "../../../lib/sellers";

/**
 * Vendedores (sellers with a referral link).
 *
 *   GET  /admin/sellers  — every live seller, with referral_url + dashboard_url.
 *   POST /admin/sellers  — create one. The code is always generated from the
 *                          name ("Ana García" → ANA / ANAG / ANAG2), never typed,
 *                          and never changes: shared referral links carry it.
 *
 * Authenticated like every /admin route (Medusa session/JWT). Refusals carry a
 * `reason` code — the panel is bilingual and owns the wording (adm.err.*).
 */

export interface SellerBody {
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** How to settle an address that differs from the person's profile (lib/seller-address.ts). */
  address_choice?: string | null;
  code?: string | null;
  commission_pct?: number | string | null;
  notes?: string | null;
  social?: Record<string, unknown> | null;
  active?: boolean;
  establishment_id?: string | null;
  terminal_id?: string | null;
}

export class SellerInputError extends Error {
  constructor(readonly reason: "name_required" | "name_invalid" | "email_invalid" | "phone_invalid" | "code_taken" | "code_invalid" | "commission_invalid" | "not_found" | SellerPlacementReason, message: string, readonly status = 400) {
    super(message);
    this.name = "SellerInputError";
  }
}

const str = (v: unknown, max = 200): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

/** Shared by POST and PATCH: validated fields for the module service. */
export async function validateSellerBody(
  req: AuthenticatedMedusaRequest<SellerBody>,
  body: SellerBody,
  current: Seller | null
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined || !current) {
    const name = str(body.name, 120);
    if (!name) throw new SellerInputError("name_required", "Seller name is required.");
    if (!isValidName(name)) throw new SellerInputError("name_invalid", "The seller's name has characters a name cannot have.");
    out["name"] = name;
  }
  // Codes are generated, never typed (lib/staff-code.ts): a sent `code` is ignored.
  if (!current) out["code"] = deriveSellerCode(out["name"], await takenCodes(req.scope));
  if (body.commission_pct !== undefined) {
    const pct = parseCommissionPct(body.commission_pct);
    if (pct === null) throw new SellerInputError("commission_invalid", "Commission must be a percentage between 0 and 100.");
    out["commission_pct"] = pct;
  }
  if (body.email !== undefined) {
    const email = str(body.email, 255)?.toLowerCase() ?? null;
    if (email && !isValidEmail(email)) throw new SellerInputError("email_invalid", "The seller's email is not valid.");
    out["email"] = email;
  }
  if (body.phone !== undefined) {
    const phone = str(body.phone, 40);
    if (phone && !isValidPhone(phone)) throw new SellerInputError("phone_invalid", "The seller's phone is not valid.");
    out["phone"] = phone;
  }
  if (body.address !== undefined) out["address"] = str(body.address, 200);
  if (body.notes !== undefined) out["notes"] = str(body.notes, 2000);
  if (body.social !== undefined) out["social"] = normalizeSocial(body.social);
  if (body.active !== undefined) out["active"] = body.active !== false;
  if (body.establishment_id !== undefined) out["establishment_id"] = str(body.establishment_id, 64);
  if (body.terminal_id !== undefined) out["terminal_id"] = str(body.terminal_id, 64);

  // Checked on the state after the save, on every save: an active seller
  // without store and till cannot be saved until both are set.
  const next = {
    active: (out["active"] as boolean | undefined) ?? current?.active ?? true,
    establishment_id: out["establishment_id"] !== undefined ? (out["establishment_id"] as string | null) : current?.establishment_id ?? null,
    terminal_id: out["terminal_id"] !== undefined ? (out["terminal_id"] as string | null) : current?.terminal_id ?? null,
  };
  const [stores, terminals] = await Promise.all([
    next.establishment_id ? listEstablishments(req.scope) : Promise.resolve([]),
    next.establishment_id ? listTerminals(req.scope, [next.establishment_id]) : Promise.resolve([]),
  ]);
  const problem = sellerPlacementProblem(next, stores, terminals);
  if (problem) throw new SellerInputError(problem, `Seller placement refused: ${problem}.`);
  out["establishment_id"] = next.establishment_id;
  out["terminal_id"] = next.terminal_id;
  return out;
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  try {
    res.json({ sellers: await Promise.all((await listSellers(req.scope)).map((s) => sellerWithAddress(req.scope, s))) });
  } catch (error) {
    logger.error(`[sellers] list failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "list_failed", message: "Could not list sellers." });
  }
}

export async function POST(req: AuthenticatedMedusaRequest<SellerBody>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as SellerBody;
  try {
    const data = await validateSellerBody(req, body, null);
    const svc = sellerService(req.scope);
    const created = (await svc.createSellers({
      name: data["name"] as string,
      code: data["code"] as string,
      email: (data["email"] as string | null) ?? null,
      phone: (data["phone"] as string | null) ?? null,
      address: (data["address"] as string | null) ?? null,
      // Not sent (or empty) = the owner's default commission («Reglas y comisiones»), the single source.
      commission_pct: body.commission_pct === undefined || body.commission_pct === null || body.commission_pct === ""
        ? (await loadDefaultCommissionPct(req.scope)) ?? 0
        : (data["commission_pct"] as number | undefined) ?? 0,
      notes: (data["notes"] as string | null) ?? null,
      social: (data["social"] as Record<string, unknown> | null) ?? null,
      active: (data["active"] as boolean | undefined) ?? true,
      establishment_id: (data["establishment_id"] as string | null) ?? null,
      terminal_id: (data["terminal_id"] as string | null) ?? null,
      token_version: 1,
    })) as unknown as Record<string, unknown>;
    console.info(JSON.stringify({ event: "seller.created", seller_id: created["id"], code: created["code"], admin_user_id: req.auth_context?.actor_id ?? null, timestamp: new Date().toISOString() }));
    res.status(201).json({ seller: projectSeller(created) });
  } catch (error) {
    if (error instanceof SellerInputError) {
      res.status(error.status).json({ type: "invalid_data", reason: error.reason, message: error.message });
      return;
    }
    logger.error(`[sellers] create failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "create_failed", message: "Could not create the seller." });
  }
}
