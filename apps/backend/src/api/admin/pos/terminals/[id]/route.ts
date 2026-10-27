import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanText } from "../../../../../lib/establishments";
import { listTerminals, PosError } from "../../../../../lib/pos-data";
import { managesStore, posHandler, posScope } from "../../../../../lib/pos-route";
import { POS_MODULE } from "../../../../../modules/pos";
import type PosModuleService from "../../../../../modules/pos/service";

/**
 * POST /admin/pos/terminals/:id — { name?, receipt_locale?, ticket_locale?, is_active? }.
 * Same permission as creating one. Never deleted: old sales point at it.
 */
interface Body {
  name?: string;
  receipt_locale?: string;
  ticket_locale?: string;
  is_active?: boolean;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const id = String(req.params.id ?? "");
    const [terminal] = (await listTerminals(req.scope, null)).filter((t) => t.id === id);
    if (!terminal) throw new PosError("terminal_not_found", 404);
    if (!managesStore(scope, terminal.establishment_id)) throw new PosError("forbidden_role", 403);
    const body = (req.body ?? {}) as Body;
    const update: Record<string, unknown> = { id, updated_by: scope.user_id };
    if (body.name !== undefined) update.name = cleanText(body.name, 60);
    if (body.receipt_locale === "es" || body.receipt_locale === "en") update.receipt_locale = body.receipt_locale;
    if (body.ticket_locale === "es" || body.ticket_locale === "en") update.ticket_locale = body.ticket_locale;
    if (typeof body.is_active === "boolean") update.is_active = body.is_active;
    await req.scope.resolve<PosModuleService>(POS_MODULE).updatePosTerminals(update as never);
    res.json({ terminals: await listTerminals(req.scope, [terminal.establishment_id]) });
  });
}
