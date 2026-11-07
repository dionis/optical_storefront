import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IFileModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { checkLogoUpload, LOGO_KINDS, type LogoKind } from "../../../../../lib/tenant-brand";
import { requireTenantAdmin } from "../../../../../lib/tenant-guard";

/**
 * POST /admin/tenant/brand/logo — { kind: "logo" | "logo_mark", data_url }.
 *
 * Sube el archivo al bucket PÚBLICO (carpeta brand/) y devuelve su `url`; no
 * cambia la marca: el panel la guarda después con POST /admin/tenant/brand, así
 * una subida a medias nunca deja la tienda sin logo. PNG, WebP, JPEG o SVG, como
 * mucho 300 KB; un SVG con scripts, eventos o enlaces externos se rechaza
 * (`unsafe_svg`), no se limpia. El cuerpo va en JSON (sizeLimit en middlewares.ts).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await requireTenantAdmin(req, res))) return;
  const body = (req.body ?? {}) as { kind?: unknown; data_url?: unknown };
  const kind = String(body.kind ?? "") as LogoKind;
  if (!LOGO_KINDS.includes(kind)) {
    res.status(422).json({ type: "invalid_data", reason: "bad_kind", message: "kind must be logo or logo_mark." });
    return;
  }
  const check = checkLogoUpload(body.data_url);
  if (!check.ok) {
    res.status(422).json({ type: "invalid_data", reason: check.reason, message: `Logo rejected: ${check.reason}` });
    return;
  }
  try {
    const files = req.scope.resolve<IFileModuleService>(Modules.FILE);
    const [file] = await files.createFiles([
      {
        filename: `brand/${kind}-${Date.now()}.${check.ext}`,
        mimeType: check.mime,
        content: check.bytes.toString("binary"),
        access: "public" as const,
      },
    ]);
    res.status(201).json({ url: file.url });
  } catch (e) {
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[tenant-brand] logo upload failed: ${(e as Error).message}`);
    res.status(503).json({ type: "unexpected_state", reason: "upload_failed", message: "The logo could not be stored." });
  }
}
