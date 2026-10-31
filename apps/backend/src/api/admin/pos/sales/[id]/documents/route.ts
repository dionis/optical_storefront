import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PosError } from "../../../../../../lib/pos-data";
import { buildSaleDocument, isDocumentKind, printSaleDocument, type DocumentKind } from "../../../../../../lib/pos-documents";
import { posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";

/**
 * DOCUMENTOS de una venta (HU-85, HU-101, HU-105).
 *
 *   GET  /admin/pos/sales/:id/documents?kind=job|receipt|receipt_duo — los datos, para ver.
 *   POST /admin/pos/sales/:id/documents { kind } — los datos para IMPRIMIR: la
 *        impresión queda en la auditoría y, desde la segunda, el documento dice
 *        «REIMPRESIÓN» con la fecha. Los dos tipos de recibo («receipt», rollo
 *        de 80 mm; «receipt_duo», carta con dos copias) comparten el contador.
 *        Las fotos de la montura del cliente van con un enlace prefirmado de
 *        15 minutos (bucket privado); las del catálogo, con su URL pública.
 *
 * Cualquier rol, en las ventas de sus tiendas.
 */
const kindOf = (v: unknown): DocumentKind => {
  if (isDocumentKind(v)) return v;
  throw new PosError("bad_document");
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const kind = kindOf((req.query as Record<string, unknown>).kind);
    res.json({ document: await buildSaleDocument(req.scope, sale.id, kind, { withPhotoUrls: true }) });
  });
}

export async function POST(req: AuthenticatedMedusaRequest<{ kind?: string }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    res.json({ document: await printSaleDocument(req.scope, sale.id, kindOf((req.body ?? {}).kind), scope.user_id) });
  });
}
