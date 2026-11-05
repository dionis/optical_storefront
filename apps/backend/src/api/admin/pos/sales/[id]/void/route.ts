import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { MedusaContainer } from "@medusajs/framework/types";
import { emitAlert } from "../../../../../../lib/alerts-data";
import { cleanText, listEstablishments } from "../../../../../../lib/establishments";
import { PosError, requestVoid, VOID_REASONS, voidSale, type VoidReason } from "../../../../../../lib/pos-data";
import { canVoid, posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";
import { profileOf } from "../../../../../../lib/staff-profile-data";
import type { StaffScope } from "../../../../../../lib/staff-scope";

/**
 * POST /admin/pos/sales/:id/void — { reason, note? } (HU-28).
 *
 * Whoever may void (owner, superadmin, supervisor, the store's manager, or a
 * person with the sale.void privilege) voids; a seller's call records the
 * request with its reason for one of them to confirm. A sale is never deleted:
 * it stays, marked voided, with its number, who, when and why.
 */
interface Body {
  reason?: string;
  note?: string;
}

/** Who asked, for the alert: their seller code, else their display name; never an email. Best-effort. */
async function requesterLabel(container: MedusaContainer, scope: StaffScope): Promise<string> {
  if (scope.seller_code) return scope.seller_code;
  try {
    const p = await profileOf(container, scope.user_id);
    if (p.display_name) return p.display_name;
  } catch { /* the request stands without the name */ }
  return scope.user_id;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const body = (req.body ?? {}) as Body;
    const reason = (VOID_REASONS as readonly string[]).includes(String(body.reason)) ? (body.reason as VoidReason) : null;
    if (!reason) throw new PosError("bad_void_reason");
    const note = cleanText(body.note, 300);
    if (reason === "other" && !note) throw new PosError("void_note_required");

    const store = (await listEstablishments(req.scope)).find((s) => s.id === sale.establishment_id);
    const storeData = { store_code: store?.code ?? null, store_name: store?.name ?? null, seller_code: sale.seller_code };
    if (!canVoid(scope)) {
      const requested = await requestVoid(req.scope, sale, scope.user_id, reason, note);
      // Somebody has to answer (HU-28): the request reaches the rules for
      // "void requested" (admins by default), once per sale (the key); a
      // repeat with another reason does not mail again.
      await emitAlert(req.scope, {
        event: "sale.void_requested",
        key: `void_request:${sale.id}`,
        establishment_id: sale.establishment_id,
        seller_id: sale.seller_id,
        data: { number: sale.number, total: sale.total, reason, note, requested_by: await requesterLabel(req.scope, scope), sale_id: sale.id, ...storeData },
      });
      res.json({ requested: true, sale: requested });
      return;
    }
    const { sale: voided, order_canceled } = await voidSale(req.scope, sale, scope.user_id, reason, note);
    await emitAlert(req.scope, {
      event: "sale.voided",
      key: `void:${sale.id}`,
      establishment_id: sale.establishment_id,
      seller_id: sale.seller_id,
      data: { number: sale.number, total: sale.total, reason, ...storeData },
    });
    res.json({ requested: false, sale: voided, order_canceled });
  });
}
