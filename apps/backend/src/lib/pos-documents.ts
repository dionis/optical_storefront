import type { INotificationModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { listAudit, recordAudit } from "./audit";
import { resolveEmailLocale, type EmailLocale } from "./email/copy";
import type { PrescriptionForEmail } from "./email/order-confirmation";
import { productImageUrl } from "./email/order-enrich";
import { loadOrderImages } from "./email/order-images";
import { renderReceiptEmail } from "./email/pos-emails";
import { listEstablishments } from "./establishments";
import { loadProductMetadata } from "./frame-specs";
import { storefrontOrigin } from "./order-access";
import { getSale, listPaymentMethods, listTerminals, PosError, type SaleRow } from "./pos-data";
import { loadPrescriptionRecords } from "./prescription-read";
import { presignPrescriptionUrl } from "./s3";
import { tenant } from "./tenant";

/**
 * The two documents of a sale (functional document, "Recibo y ficha de
 * laboratorio"), as neutral data — raw values, no prose — that the panel prints
 * and the receipt email renders. Field origins follow the technical document's
 * table.
 *
 *  - Lab ticket (job): one per line with lenses. Carries the prescription the
 *    lab needs, never prices or payments. "Submitted By" is the seller code
 *    and the till, never a personal email.
 *  - Receipt: what was bought and paid, the balance and when to pick up. No
 *    prescription values on paper or in the default email. The email adds the new
 *    prescription and the frames' photos only when someone explicitly asks for
 *    the details (HIPAA, owner's decision), only to the address on the sale, and
 *    leaves a trace in the audit log. Never the worn prescription, the optical
 *    change or insurance member data.
 *  - Receipt, two copies ("receipt_duo"): the same receipt data laid out by the
 *    panel as one letter page with a customer copy and a store copy, for tills
 *    with a regular (non-thermal) printer. Same data as "receipt"; the kind only
 *    tells the audit log what came out of the printer.
 *
 * The printed documents carry the frame's photo (catalog photo, or the photo of
 * the frame the customer brought through a short-lived presigned URL — the
 * private bucket is never linked directly). The email keeps its own rule: photos
 * only in the detailed version, own-frame photos attached, never linked.
 *
 * Every print is recorded in the audit log; from the second on, the document
 * says "REPRINT" with the date (HU-105). The two receipt kinds share one counter:
 * a roll receipt after a two-copy one is still a reprint.
 */

type Bilingual = { es: string; en: string } | null;

export const DOCUMENT_KINDS = ["job", "receipt", "receipt_duo"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const isDocumentKind = (v: unknown): v is DocumentKind => DOCUMENT_KINDS.includes(v as DocumentKind);
/** Kinds whose prints count together for "REPRINT". */
const printFamily = (kind: DocumentKind): DocumentKind[] => (kind === "job" ? ["job"] : ["receipt", "receipt_duo"]);

export interface DocLine {
  kind: "frame" | "own_frame";
  title: string;
  variant_title: string | null;
  sku: string | null;
  list: number;
  unit_price: number;
  tax_amount: number;
  frame_price: number;
  lens_price: number;
  quantity: number;
  /**
   * Photo of the frame: the public catalog photo (resized) for a store frame; for
   * the customer's own frame, a short-lived presigned URL, only when the caller
   * asked for photo URLs (prints). Null when there is none — the panel draws a
   * placeholder. The email ignores it unless detailed.
   */
  image_url?: string | null;
  design_code: string | null;
  lens: { design: Bilingual; material: Bilingual; photo: Bilingual; ar: Bilingual; category: string | null } | null;
  handling: "lenses_only" | "frame_supplied" | "patient_own_frame" | null;
  frame: { brand: string | null; model: string | null; material: string | null; eye_size: number | null; bridge: number | null } | null;
  own_frame: { description: string | null; has_photo: boolean; photo_url?: string | null; photo_key?: string | null } | null;
  prescription_id: string | null;
}

export interface SaleDocument {
  kind: DocumentKind;
  /** `timezone`: the store's IANA zone; every date on a document is shown in it, never in the server's (UTC). */
  business: { name: string; legal_name: string; url: string; support_email: string | null; timezone: string };
  /** `color`: the store's brand colour (Tiendas → Editar) — every printed document carries it so the counter knows at a glance which optician sold. */
  store: { code: string; name: string; address: string | null; phone: string | null; receipt_note: string | null; color: string | null };
  /** `printer`: the till's printer as configured (free text such as "thermal 80mm" or "HP LaserJet"); null when unknown. */
  terminal: { code: string | null; receipt_locale: string; ticket_locale: string; printer: string | null };
  sale: {
    id: string;
    number: string;
    created_at: string;
    updated_at: string;
    promised_on: string | null;
    seller_code: string | null;
    tray: string | null;
    status: string;
    voided_at: string | null;
    delivery: string;
  };
  customer: { name: string; phone: string | null };
  tracking_url: string;
  print: { count: number; reprint: boolean; first_at: string | null };
  /** Receipt kinds only. */
  lines?: DocLine[];
  totals?: { list: number; discount: number; discount_pct: number; tax: number; total: number; paid: number; insurance: number; balance: number };
  payments?: Array<{ method_code: string; method: Bilingual; amount: number; kind: string; reference: string | null; created_at: string }>;
  /** Job only: one ticket per line with lenses. */
  tickets?: Array<{ line: DocLine; rx: Record<string, unknown> | null; job_type: string }>;
}

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const bi = (r: { label_es?: string; label_en?: string } | undefined): Bilingual =>
  r ? { es: String(r.label_es ?? r.label_en ?? ""), en: String(r.label_en ?? r.label_es ?? "") } : null;

async function lensLabels(pg: Knex, codes: { designs: string[]; materials: string[]; photos: string[]; ars: string[] }) {
  const fetch = async (table: string, list: string[]) => {
    if (!list.length) return new Map<string, Record<string, unknown>>();
    const rows = (await pg(table).whereIn("code", [...new Set(list)]).select("code", "label_es", "label_en", "category").catch(() =>
      pg(table).whereIn("code", [...new Set(list)]).select("code", "label_es", "label_en")
    )) as Array<Record<string, unknown>>;
    return new Map(rows.map((r) => [String(r.code), r]));
  };
  const [designs, materials, photos, ars] = await Promise.all([
    fetch("lens_design", codes.designs),
    fetch("lens_material", codes.materials),
    fetch("lens_photo_option", codes.photos),
    fetch("lens_ar_option", codes.ars),
  ]);
  return { designs, materials, photos, ars };
}

async function printCount(container: MedusaContainer, saleId: string, kind: DocumentKind): Promise<{ count: number; first_at: string | null }> {
  const family = printFamily(kind);
  const events = (await listAudit(container, { action: "document.print", entity: "pos_sale", entityId: saleId }, 500)).filter((e) =>
    family.includes((e.after as { kind?: DocumentKind } | null)?.kind as DocumentKind)
  );
  return { count: events.length, first_at: events.length ? events[events.length - 1].created_at : null };
}

/** The till's printer as free text ("thermal 80mm", "HP LaserJet"); the column is JSON, so a string or an object with a name/type/model. */
async function terminalPrinter(pg: Knex, terminalId: string | null): Promise<string | null> {
  if (!terminalId) return null;
  try {
    const row = (await pg("pos_terminal").where("id", terminalId).first("printer")) as { printer?: unknown } | undefined;
    const p = row?.printer;
    if (!p) return null;
    if (typeof p === "string") return p;
    const o = p as Record<string, unknown>;
    const text = [o.type, o.kind, o.model, o.name, o.paper].filter((v) => typeof v === "string" && v).join(" ");
    return text || null;
  } catch {
    return null;
  }
}

/** Catalog thumbnails by product id, for the frame photo on paper. Missing or unreadable: no photo. */
async function productThumbnails(pg: Knex, productIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return map;
  try {
    const rows = (await pg("product").whereIn("id", ids).select("id", "thumbnail")) as Array<Record<string, unknown>>;
    for (const r of rows) if (r.thumbnail) map.set(String(r.id), String(r.thumbnail));
  } catch {
    // Without a photo the document shows the placeholder.
  }
  return map;
}

export async function buildSaleDocument(
  container: MedusaContainer,
  saleId: string,
  kind: DocumentKind,
  opts: { withPhotoUrls?: boolean; forEmail?: boolean } = {}
): Promise<SaleDocument> {
  const sale = await getSale(container, saleId);
  if (!sale) throw new PosError("sale_not_found", 404);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pg = pgOf(container);
  const [stores, terminals, methods, prints, printer] = await Promise.all([
    listEstablishments(container),
    sale.terminal_id ? listTerminals(container, [sale.establishment_id]) : Promise.resolve([]),
    listPaymentMethods(container),
    printCount(container, sale.id, kind),
    terminalPrinter(pg, sale.terminal_id),
  ]);
  const store = stores.find((s) => s.id === sale.establishment_id);
  if (!store) throw new PosError("store_not_found", 404);
  const terminal = terminals.find((t) => t.id === sale.terminal_id) ?? null;

  const { data: orders } = sale.order_id
    ? await query.graph({
        entity: "order",
        fields: ["id", "created_at", "updated_at", "email", "shipping_address.first_name", "shipping_address.last_name", "shipping_address.phone", "items.*"],
        filters: { id: sale.order_id },
      })
    : { data: [] as unknown[] };
  const order = orders[0] as
    | { updated_at?: string; shipping_address?: { first_name?: string; last_name?: string; phone?: string | null }; items?: Array<Record<string, unknown>> }
    | undefined;
  const items = (order?.items ?? []) as Array<Record<string, unknown>>;
  const mdOf = (it: Record<string, unknown>) => (it.metadata ?? {}) as Record<string, unknown>;
  const sel = (it: Record<string, unknown>) => (mdOf(it).lens_config ?? {}) as Record<string, string | null>;

  const labels = await lensLabels(pg, {
    designs: items.map((i) => sel(i).design_code).filter((v): v is string => Boolean(v) && v !== "frame-only"),
    materials: items.map((i) => sel(i).material_code).filter((v): v is string => Boolean(v)),
    photos: items.map((i) => sel(i).photo_code).filter((v): v is string => Boolean(v)),
    ars: items.map((i) => sel(i).ar_code).filter((v): v is string => Boolean(v)),
  });
  const productIds = items.map((i) => String(i.product_id ?? "")).filter(Boolean);
  const [productMeta, thumbs] = await Promise.all([loadProductMetadata(pg, productIds), productThumbnails(pg, productIds)]);

  const lines: DocLine[] = [];
  for (const it of items) {
    const md = mdOf(it);
    const s = sel(it);
    const own = md.kind === "own-frame";
    const withLenses = Boolean(s.design_code) && s.design_code !== "frame-only";
    const pm = it.product_id ? productMeta.get(String(it.product_id)) ?? {} : {};
    const n = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
    const ownFrame = (md.own_frame ?? null) as { description?: string | null; photo_key?: string | null } | null;
    // The customer's own photo lives in the private bucket: a presigned link only when a print asked for it.
    const ownPhotoUrl = own && opts.withPhotoUrls ? await presignPrescriptionUrl(ownFrame?.photo_key ?? null) : null;
    lines.push({
      kind: own ? "own_frame" : "frame",
      title: String(own ? ownFrame?.description ?? it.title ?? "" : it.product_title ?? it.title ?? ""),
      variant_title: own ? null : ((it.variant_title as string | null) ?? null),
      sku: own ? null : ((it.variant_sku as string | null) ?? null),
      list: Number(md.list_price ?? it.unit_price ?? 0),
      unit_price: Number(it.unit_price ?? 0),
      tax_amount: Number(md.tax_amount ?? 0),
      frame_price: Number(md.frame_price ?? 0),
      lens_price: Number(md.lens_addon ?? 0),
      quantity: Math.max(1, Number(it.quantity ?? 1) || 1),
      image_url: own ? ownPhotoUrl : productImageUrl((it.thumbnail as string | null) || thumbs.get(String(it.product_id ?? "")) || null),
      design_code: s.design_code ?? null,
      lens: withLenses
        ? {
            design: bi(labels.designs.get(String(s.design_code)) as never),
            material: s.material_code ? bi(labels.materials.get(s.material_code) as never) : null,
            photo: s.photo_code ? bi(labels.photos.get(s.photo_code) as never) : null,
            ar: s.ar_code ? bi(labels.ars.get(s.ar_code) as never) : null,
            category: (labels.designs.get(String(s.design_code))?.category as string | undefined) ?? null,
          }
        : null,
      handling: own ? "patient_own_frame" : withLenses ? "frame_supplied" : null,
      frame: own
        ? null
        : {
            brand: (pm.brand as string | undefined) ?? (pm.brand_slug as string | undefined) ?? null,
            model: String(it.product_title ?? ""),
            material: (pm.material as string | undefined) ?? null,
            eye_size: n(pm.eye_size),
            bridge: n(pm.bridge_size),
          },
      own_frame: own
        ? {
            description: ownFrame?.description ?? null,
            has_photo: Boolean(ownFrame?.photo_key),
            ...(opts.withPhotoUrls ? { photo_url: ownPhotoUrl } : {}),
            ...(opts.forEmail ? { photo_key: ownFrame?.photo_key ?? null } : {}),
          }
        : null,
      prescription_id: (md.prescription_id as string | null) ?? null,
    });
  }

  const name = [order?.shipping_address?.first_name, order?.shipping_address?.last_name].filter(Boolean).join(" ");
  const t = tenant();
  const base: SaleDocument = {
    kind,
    business: { name: t.name, legal_name: t.legalName, url: t.storefrontUrl, support_email: t.supportEmail, timezone: t.timezone },
    store: { code: store.code, name: store.name, address: store.address, phone: store.phone, receipt_note: store.receipt_note, color: store.color ?? null },
    terminal: { code: terminal?.code ?? null, receipt_locale: terminal?.receipt_locale ?? "es", ticket_locale: terminal?.ticket_locale ?? "en", printer },
    sale: {
      id: sale.id,
      number: sale.number,
      created_at: sale.created_at,
      updated_at: order?.updated_at ? new Date(order.updated_at).toISOString() : sale.created_at,
      promised_on: sale.promised_on,
      seller_code: sale.seller_code,
      tray: sale.tray,
      status: sale.status,
      voided_at: sale.voided_at,
      delivery: sale.delivery,
    },
    customer: { name, phone: order?.shipping_address?.phone ?? null },
    // The QR on the receipt opens the existing order tracking — no personal data in it.
    tracking_url: `${storefrontOrigin()}/my-orders`,
    print: { count: prints.count, reprint: prints.count > 0, first_at: prints.first_at },
  };

  if (kind === "receipt" || kind === "receipt_duo") {
    const byCode = new Map(methods.map((m) => [m.code, m]));
    return {
      ...base,
      lines,
      totals: {
        list: sale.list,
        discount: sale.discount,
        discount_pct: sale.discount_pct,
        tax: Math.round(lines.reduce((s, l) => s + l.tax_amount * 100, 0)) / 100,
        total: sale.total,
        paid: sale.paid,
        insurance: sale.insurance,
        balance: sale.balance,
      },
      payments: sale.payments.map((p) => {
        const m = byCode.get(p.method_code);
        return {
          method_code: p.method_code,
          // Seeded methods: the panel and the email name them from their own dictionaries.
          method: m && !m.builtin ? { es: m.label ?? m.code, en: m.label_en ?? m.label ?? m.code } : null,
          amount: p.amount,
          kind: p.kind,
          reference: p.reference,
          created_at: p.created_at,
        };
      }),
    };
  }

  // Lab ticket: only lines with lenses, each with the prescription it is cut to.
  const rxIds = [...new Set(lines.map((l) => l.prescription_id).filter((v): v is string => Boolean(v)))];
  const rxRows = rxIds.length ? ((await pg("prescription").whereIn("id", rxIds).whereNull("deleted_at")) as Array<Record<string, unknown>>) : [];
  const rxById = new Map(rxRows.map((r) => [String(r.id), r]));
  const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const tickets = lines
    .filter((l) => l.lens)
    .map((line) => {
      const r = line.prescription_id ? rxById.get(line.prescription_id) : undefined;
      const pd = nn(r?.pd);
      return {
        line,
        job_type: "uncuts",
        rx: r
          ? {
              rx_number: (r.rx_number as string | null) ?? null,
              od: { sph: nn(r.od_sph), cyl: nn(r.od_cyl), axis: nn(r.od_axis), add: nn(r.od_add), prism: nn(r.od_prism), base: r.od_base ?? null },
              os: { sph: nn(r.os_sph), cyl: nn(r.os_cyl), axis: nn(r.os_axis), add: nn(r.os_add), prism: nn(r.os_prism), base: r.os_base ?? null },
              pd_od: nn(r.pd_od) ?? (pd === null ? null : pd / 2),
              pd_os: nn(r.pd_os) ?? (pd === null ? null : pd / 2),
              seg_height: nn(r.seg_height),
            }
          : null,
      };
    });
  return { ...base, tickets };
}

/**
 * Records a print (audit) and returns the document as printed: "REPRINT" from the
 * second time (HU-105). The audit keeps the exact kind (roll or two copies); the
 * counter is shared by both receipt kinds. Every print gets the photo URLs.
 */
export async function printSaleDocument(container: MedusaContainer, saleId: string, kind: DocumentKind, actorId: string | null): Promise<SaleDocument> {
  const sale = await getSale(container, saleId);
  if (!sale) throw new PosError("sale_not_found", 404);
  const before = await printCount(container, saleId, kind);
  await recordAudit(container, {
    actorId,
    action: "document.print",
    entity: "pos_sale",
    entityId: saleId,
    establishmentId: sale.establishment_id,
    after: { kind, copy: before.count + 1 },
  });
  const doc = await buildSaleDocument(container, saleId, kind, { withPhotoUrls: true });
  return { ...doc, print: { count: before.count + 1, reprint: before.count > 0, first_at: before.first_at ?? new Date().toISOString() } };
}

/** The prescriptions of a sale's lines, as the email shows them. Health data: only for the sale's own address. */
async function receiptPrescriptions(container: MedusaContainer, lines: DocLine[]): Promise<Record<string, PrescriptionForEmail>> {
  const pid = (l: DocLine) => l.prescription_id;
  const records = await loadPrescriptionRecords(pgOf(container), lines.map(pid).filter((v): v is string => Boolean(v)));
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const out: Record<string, PrescriptionForEmail> = {};
  for (const [id, r] of records) {
    const eye = (e: "od" | "os") => ({
      sph: n(r[`${e}_sph`]),
      cyl: n(r[`${e}_cyl`]),
      axis: n(r[`${e}_axis`]),
      add: n(r[`${e}_add`]),
      prism: n(r[`${e}_prism`]),
      base: (r[`${e}_base`] as string | null) ?? null,
    });
    out[id] = { od: eye("od"), os: eye("os"), pd: n(r.pd), pd_od: n(r.pd_od), pd_os: n(r.pd_os), seg_height: n(r.seg_height) } as PrescriptionForEmail;
  }
  return out;
}

/**
 * Sends the receipt by email (HU-27, HU-102). Simple unless `detailed` is exactly
 * true: then with the frames' photos and the prescription. Throws PosError when
 * there is no address. An address other than the sale's never gets the details.
 */
export async function emailReceipt(
  container: MedusaContainer,
  sale: SaleRow,
  opts: { to?: string | null; detailed?: boolean; actorId?: string | null } = {}
): Promise<string> {
  const to = opts.to ?? null;
  const detailed = opts.detailed === true && !to;
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const doc = await buildSaleDocument(container, sale.id, "receipt", { forEmail: detailed });
  let email = to;
  if (!email && sale.order_id) {
    const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "order", fields: ["id", "email"], filters: { id: sale.order_id } });
    email = (data[0] as { email?: string } | undefined)?.email ?? null;
  }
  if (!email) throw new PosError("no_email", 422);
  const locale: EmailLocale = resolveEmailLocale(doc.terminal.receipt_locale);
  const prescriptions = detailed ? await receiptPrescriptions(container, doc.lines ?? []) : {};
  // What the customer brought is in the private bucket: attached, never linked.
  const ownPhotos = Object.fromEntries((doc.lines ?? []).map((l, i) => [i, l.own_frame?.photo_key ?? null]));
  const images = detailed
    ? await loadOrderImages(doc.sale.number, { prescriptions: {}, items: ownPhotos }, "montura").catch((e: Error) => {
        logger.warn(`[pos] receipt ${sale.number}: own frame photos unavailable: ${e.message}`);
        return { attachments: [], prescriptions: {}, items: {} };
      })
    : { attachments: [], prescriptions: {}, items: {} };
  await container.resolve<INotificationModuleService>(Modules.NOTIFICATION).createNotifications({
    to: email,
    channel: "email",
    template: "pos-receipt",
    trigger_type: "pos.sale.receipt",
    resource_id: sale.id,
    resource_type: "pos_sale",
    content: renderReceiptEmail(doc, locale, { prescriptions, itemImages: images.items, detailed }),
    ...(images.attachments.length ? { attachments: images.attachments } : {}),
  });
  // Who sent health data by email, and when; the values and the address stay out of the log.
  await recordAudit(container, {
    actorId: opts.actorId ?? null,
    action: "document.email",
    entity: "pos_sale",
    entityId: sale.id,
    establishmentId: sale.establishment_id,
    after: { kind: "receipt", detailed },
  });
  logger.info(`[pos] receipt ${sale.number} emailed (${detailed ? "detailed" : "simple"})`);
  return email;
}
