import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments } from "../../../lib/establishments";
import { listTerminals } from "../../../lib/pos-data";
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
 *   POST /admin/sellers  — create one. `code` is optional: derived from the
 *                          name when absent ("Ana García" → ANA / ANAG / ANAG2).
 *
 * Authenticated like every /admin route (Medusa session/JWT). Refusals carry a
 * `reason` code — the panel is bilingual and owns the wording (adm.err.*).
 */

export interface SellerBody {
  name?: string;
  email?: string | null;
  phone?: string | null;
  code?: string | null;
  commission_pct?: number | string | null;
  notes?: string | null;
  social?: Record<string, unknown> | null;
  active?: boolean;
  establishment_id?: string | null;
  terminal_id?: string | null;
}

export class SellerInputError extends Error {
  constructor(readonly reason: "name_required" | "code_taken" | "code_invalid" | "commission_invalid" | "not_found" | SellerPlacementReason, message: string, readonly status = 400) {
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
  const live = await listSellers(req.scope);
  const taken = new Set(live.filter((s) => s.id !== current?.id).map((s) => s.code));

  if (body.name !== undefined || !current) {
    const name = str(body.name, 120);
    if (!name) throw new SellerInputError("name_required", "Seller name is required.");
    out["name"] = name;
  }
  if (body.code !== undefined) {
    const raw = String(body.code ?? "").trim();
    if (raw) {
      const code = normalizeSellerCode(raw);
      if (!code) throw new SellerInputError("code_invalid", "Code must be 3–12 letters or digits.");
      if (taken.has(code)) throw new SellerInputError("code_taken", `Code ${code} is already in use.`);
      out["code"] = code;
    } else if (!current) {
      out["code"] = deriveSellerCode(out["name"], taken);
    }
  } else if (!current) {
    out["code"] = deriveSellerCode(out["name"], taken);
  }
  if (body.commission_pct !== undefined) {
    const pct = parseCommissionPct(body.commission_pct);
    if (pct === null) throw new SellerInputError("commission_invalid", "Commission must be a percentage between 0 and 100.");
    out["commission_pct"] = pct;
  }
  if (body.email !== undefined) out["email"] = str(body.email)?.toLowerCase() ?? null;
  if (body.phone !== undefined) out["phone"] = str(body.phone, 40);
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
    res.json({ sellers: await listSellers(req.scope) });
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
      commission_pct: (data["commission_pct"] as number | undefined) ?? 0,
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
