import type { MedusaContainer } from "@medusajs/framework/types";
import { listEstablishments } from "./establishments";
import { listTerminals } from "./pos-data";
import {
  deriveSellerCode,
  listSellers,
  normalizeSellerCode,
  parseSellerLink,
  sellerLinkProblem,
  sellerPlacementProblem,
  sellerService,
  type Seller,
  type SellerLinkReason,
} from "./sellers";
import { invalidateStaffScope } from "./staff-scope";

/**
 * Panel user (Equipo) ↔ seller record. A user with the `seller` role always
 * has exactly one seller record, and that record fixes the store and the one
 * till they sell from. Given in two steps so the Equipo routes can refuse
 * BEFORE creating a user: `prepareSellerLink` only reads and validates,
 * `applySellerLink` writes.
 */

export class SellerLinkError extends Error {
  constructor(readonly reason: SellerLinkReason | "code_invalid" | "code_taken", readonly status = 422) {
    super(`Seller link refused: ${reason}`);
    this.name = "SellerLinkError";
  }
}

export type PreparedSellerLink =
  | { kind: "existing"; seller: Seller }
  | { kind: "new"; data: { name: string; email: string | null; code: string; commission_pct: number; establishment_id: string; terminal_id: string } };

/** Seller record linked to a user, or null. */
export async function sellerOfUser(container: MedusaContainer, userId: string): Promise<Seller | null> {
  return (await listSellers(container)).find((s) => s.user_id === userId) ?? null;
}

export async function prepareSellerLink(
  container: MedusaContainer,
  userId: string | null,
  raw: unknown,
  person: { name: string; email: string | null }
): Promise<PreparedSellerLink> {
  const link = parseSellerLink(raw);
  if ("reason" in link) throw new SellerLinkError(link.reason);
  const live = await listSellers(container);

  if ("seller_id" in link) {
    const seller = live.find((s) => s.id === link.seller_id) ?? null;
    const problem = sellerLinkProblem(seller, userId);
    if (problem) throw new SellerLinkError(problem);
    // An active record already passed the store/till rule when it was saved,
    // but the store or till may have been deactivated since.
    const placement = sellerPlacementProblem(
      seller!,
      await listEstablishments(container),
      await listTerminals(container, [seller!.establishment_id!])
    );
    if (placement) throw new SellerLinkError(placement);
    return { kind: "existing", seller: seller! };
  }

  const { establishment_id, terminal_id, commission_pct } = link.create;
  const placement = sellerPlacementProblem(
    { active: true, establishment_id, terminal_id },
    await listEstablishments(container),
    await listTerminals(container, [establishment_id])
  );
  if (placement) throw new SellerLinkError(placement);
  const taken = new Set(live.map((s) => s.code));
  let code: string;
  if (link.create.code) {
    const c = normalizeSellerCode(link.create.code);
    if (!c) throw new SellerLinkError("code_invalid");
    if (taken.has(c)) throw new SellerLinkError("code_taken");
    code = c;
  } else {
    code = deriveSellerCode(person.name, taken);
  }
  return {
    kind: "new",
    data: { name: person.name.slice(0, 120) || code, email: person.email, code, commission_pct, establishment_id, terminal_id },
  };
}

/**
 * Writes the link: the user's previous record (if another) is released first.
 * Returns the linked record; the caller sets the user's Equipo store to its
 * store (a counter seller works in that one store only).
 */
export async function applySellerLink(container: MedusaContainer, userId: string, prepared: PreparedSellerLink): Promise<Seller> {
  const svc = sellerService(container);
  const previous = await sellerOfUser(container, userId);
  if (previous && (prepared.kind === "new" || previous.id !== prepared.seller.id)) {
    await svc.updateSellers([{ id: previous.id, user_id: null }]);
  }
  let row: Record<string, unknown>;
  if (prepared.kind === "existing") {
    [row] = (await svc.updateSellers([{ id: prepared.seller.id, user_id: userId }])) as unknown as Record<string, unknown>[];
  } else {
    row = (await svc.createSellers({ ...prepared.data, user_id: userId, active: true, notes: null, phone: null, social: null, token_version: 1 })) as unknown as Record<string, unknown>;
  }
  invalidateStaffScope(userId);
  console.info(JSON.stringify({ event: "seller.linked", seller_id: row?.["id"] ?? null, user_id: userId, kind: prepared.kind, timestamp: new Date().toISOString() }));
  return (await sellerOfUser(container, userId))!;
}

/** Frees the user's seller record (role changed away from seller, or user deleted). */
export async function unlinkSellerOf(container: MedusaContainer, userId: string): Promise<void> {
  const current = await sellerOfUser(container, userId);
  if (!current) return;
  await sellerService(container).updateSellers([{ id: current.id, user_id: null }]);
  invalidateStaffScope(userId);
}
