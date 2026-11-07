import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createProductsWorkflow } from "@medusajs/medusa/core-flows";
import type { Knex } from "@mikro-orm/knex";
import { LENS_CONFIG_MODULE } from "../modules/lens-config/index";
import type LensConfigModuleService from "../modules/lens-config/service";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import type StorePricingModuleService from "../modules/store-pricing/service";
import { recordAudit } from "./audit";
import { buildCatalogFrameProduct, handleOfSku, type CatalogFrameInput } from "./catalog-frame";
import { listBrands } from "./catalog-brand-data";
import type { BrandView } from "./catalog-brand";
import { KNOWN_BRANDS } from "./costing";
import { listEstablishments } from "./establishments";
import {
  clearFrameCostCache,
  frameCostAudit,
  frameCostKeyOf,
  listFrameCosts,
  setOwnerFrameCost,
  type FrameCostRow,
} from "./frame-cost";
import { clearLensCellCostCache } from "./lens-cost";
import { parseLensFinish } from "./lens-finish";
import { loadLensMatrix, type LensMatrixRow } from "./lens-matrix";
import { writeLensMaster } from "./lens-price-write";
import { assortmentByStore } from "./pricing-across";
import { clearPriceBandCache } from "./pricing";
import { lensBaseKey, parseLensBaseKey, upsertStoreLensPrice, type LensStorePriceLike } from "./pricing-overview";
import {
  BRAND_DISCOUNT_KIND,
  brandScopeOf,
  buildFrameRows,
  buildImportPlan,
  buildLensGroups,
  buildTreatmentGroups,
  caseProductIdsOf,
  changeAsCellWrite,
  deriveTreatmentCode,
  groupFrameRows,
  indexImportBrands,
  indexImportRows,
  indexItemDiscounts,
  planCellWrite,
  SECTION_OF_KIND,
  toMatrixProduct,
  type CellOp,
  type DiscountIndex,
  type ImportBrand,
  type ImportPlan,
  type ItemDiscountLike,
  type ItemKind,
  type MatrixGroup,
  type MatrixProductRaw,
  type MatrixRow,
  type MatrixSection,
  type MatrixStore,
  type TreatmentInput,
  withBrandExposure,
} from "./price-matrix";
import { brandTarget, type PriceRuleLike } from "./store-pricing";
import { openRules, productPrices, replaceRule } from "./store-pricing-data";

/**
 * Reads and writes of «Productos y precios» (docs/PRICE-MATRIX.md). The
 * semantics — every builder, the discount math, the write plan and the import
 * plan — are pure in lib/price-matrix.ts; this file only moves rows, always
 * through the writers the rest of the pricing panel already uses:
 *
 *   frame / case cost    setOwnerFrameCost   (lib/frame-cost.ts)
 *   frame / case price   replaceRule         (lib/store-pricing-data.ts)
 *   lens cell price      upsertStoreLensPrice (lib/pricing-overview.ts)
 *   lens / option cost   writeLensMaster     (lib/lens-price-write.ts)
 *   discount             setItemDiscount     (below, store_item_discount)
 *
 * PERFORMANCE. The frames section is ~600 models × every store, and it must
 * answer well under a second: ONE catalogue query (products with every SKU and
 * the USD base price, Knex), ONE `openRules` for all stores, ONE discount
 * query, ONE assortment query and — for a cost viewer — ONE cost query. Never a
 * query per model or per store.
 */

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const pricingSvc = (c: MedusaContainer) => c.resolve<StorePricingModuleService>(STORE_PRICING_MODULE);
const lensSvc = (c: MedusaContainer) => c.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);

/** The statuses the matrix lists: what is on sale and what the owner discontinued. */
const LISTED_STATUSES = ["published", "draft"];

// ── Stores ───────────────────────────────────────────────────────────────────

/** Active stores, in creation order, as the matrix columns. */
export async function loadMatrixStores(container: MedusaContainer): Promise<MatrixStore[]> {
  const rows = await listEstablishments(container);
  return rows.filter((s) => s.is_active).map((s) => ({ id: s.id, code: String(s.code ?? ""), name: String(s.name ?? ""), color: String(s.color ?? "") }));
}

// ── Discounts ────────────────────────────────────────────────────────────────

export interface ItemDiscountRow extends ItemDiscountLike {
  id: string;
}

const toDiscount = (r: Record<string, unknown>): ItemDiscountRow => ({
  id: String(r["id"]),
  establishment_id: String(r["establishment_id"] ?? ""),
  item_kind: String(r["item_kind"] ?? ""),
  item_key: String(r["item_key"] ?? ""),
  pct: Math.round(Number(r["pct"]) * 100) / 100,
});

/**
 * Live discounts of the given stores, ONE query. Never throws: an un-migrated
 * table is "no discounts", which is what every store sold at before.
 */
export async function loadItemDiscounts(container: MedusaContainer, storeIds: string[]): Promise<ItemDiscountRow[]> {
  if (!storeIds.length) return [];
  try {
    const rows = (await pricingSvc(container).listStoreItemDiscounts({ establishment_id: storeIds } as never, { take: 50000 })) as unknown as Record<string, unknown>[];
    return rows.filter((r) => !r["deleted_at"]).map(toDiscount);
  } catch {
    return [];
  }
}

/** The same for one store through the shared Postgres connection (the lens list reads with Knex). Never throws. */
export async function loadItemDiscountsPg(pg: Knex, storeId: string | null | undefined): Promise<ItemDiscountRow[]> {
  if (!storeId) return [];
  try {
    const rows = (await pg("store_item_discount").whereNull("deleted_at").where({ establishment_id: storeId })) as Array<Record<string, unknown>>;
    return rows.map(toDiscount);
  } catch {
    return [];
  }
}

/** A store's discounts indexed for the pure functions. Never throws. */
export async function storeDiscountIndex(container: MedusaContainer, storeIds: string[]): Promise<DiscountIndex> {
  return indexItemDiscounts(await loadItemDiscounts(container, storeIds));
}

/**
 * Sets (or with `pct` null / 0 removes) a store's discount on one article.
 * Removing is a soft delete: the partial unique index then lets a later
 * discount on the same article be a fresh row. Audited as `price.change` on
 * `item_discount` with the figure before and after.
 */
export async function setItemDiscount(
  container: MedusaContainer,
  input: { storeId: string; kind: ItemKind | typeof BRAND_DISCOUNT_KIND; key: string; pct: number | null },
  actorId: string | null
): Promise<{ before: number | null; after: number | null }> {
  const service = pricingSvc(container);
  const existing = (await service.listStoreItemDiscounts(
    { establishment_id: input.storeId, item_kind: input.kind, item_key: input.key } as never,
    { take: 10 }
  )) as unknown as Record<string, unknown>[];
  const live = existing.filter((r) => !r["deleted_at"]);
  const current = live[0] ?? null;
  const before = current ? toDiscount(current).pct : null;
  const pct = input.pct && input.pct > 0 ? Math.round(input.pct * 100) / 100 : null;

  if (pct === null) {
    if (live.length) await service.softDeleteStoreItemDiscounts(live.map((r) => String(r["id"])));
  } else if (current) {
    await service.updateStoreItemDiscounts([{ id: current["id"], pct, updated_by: actorId }] as never);
  } else {
    await service.createStoreItemDiscounts({
      establishment_id: input.storeId,
      item_kind: input.kind,
      item_key: input.key,
      pct,
      created_by: actorId,
      updated_by: actorId,
    } as never);
  }
  if (before !== pct) {
    await recordAudit(container, {
      actorId,
      action: "price.change",
      entity: "item_discount",
      entityId: `${input.kind}:${input.key}`,
      establishmentId: input.storeId,
      before: before === null ? null : { kind: input.kind, key: input.key, pct: before },
      after: pct === null ? null : { kind: input.kind, key: input.key, pct },
    });
  }
  return { before, after: pct };
}

// ── The catalogue ────────────────────────────────────────────────────────────

/** `%`, `_` and `\` typed by the owner are characters to find, not wildcards. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const SKUS_SQL = `(select coalesce(array_agg(v.sku order by v.id), '{}') from product_variant v
  where v.product_id = product.id and v.deleted_at is null and v.sku is not null) as skus`;

/**
 * The model's USD price (Medusa keeps it on the variants' price sets, the
 * same figure on every colour — price-sync): the first variant's plain USD
 * price, no price list, no rules first.
 */
const BASE_SQL = `(select pr.amount from product_variant v2
  join product_variant_price_set pvps on pvps.variant_id = v2.id and pvps.deleted_at is null
  join price pr on pr.price_set_id = pvps.price_set_id and pr.deleted_at is null
    and pr.currency_code = 'usd' and pr.price_list_id is null
  where v2.product_id = product.id and v2.deleted_at is null
  order by v2.id, pr.rules_count asc nulls first
  limit 1) as base_usd`;

/**
 * Every listed model (published or draft, not deleted) matching `q` — title,
 * any colour's SKU, or brand — or exactly `ids`. ONE query; when the price
 * subquery cannot run (a Medusa that names its link table differently) the
 * prices come from `productPrices` instead, in pages.
 */
export async function loadProductRows(container: MedusaContainer, opts: { q?: string; ids?: string[]; brand?: string } = {}): Promise<MatrixProductRaw[]> {
  const pg = pgOf(container);
  const q = (opts.q ?? "").trim().slice(0, 80);
  const build = (withBase: boolean) => {
    let sql = pg("product")
      .whereNull("product.deleted_at")
      .whereIn("product.status", LISTED_STATUSES)
      .select("product.id", "product.title", "product.thumbnail", "product.status", "product.metadata")
      .select(pg.raw(SKUS_SQL));
    if (withBase) sql = sql.select(pg.raw(BASE_SQL));
    if (opts.ids) sql = sql.whereIn("product.id", opts.ids.length ? opts.ids : ["__none__"]);
    if (opts.brand) sql = sql.whereRaw(`lower(coalesce(product.metadata->>'brand_slug', product.metadata->>'collection_slug', '')) = ?`, [opts.brand]);
    if (q) {
      const pattern = like(q);
      sql = sql.where((b) => {
        b.whereILike("product.title", pattern)
          .orWhereRaw(`coalesce(product.metadata->>'brand_slug', product.metadata->>'collection_slug', '') ilike ?`, [pattern])
          .orWhereRaw(`coalesce(product.metadata->>'brand', '') ilike ?`, [pattern])
          .orWhereExists(pg("product_variant as v").whereRaw("v.product_id = product.id").whereNull("v.deleted_at").whereILike("v.sku", pattern));
      });
    }
    return sql.orderBy("product.title");
  };
  let rows: Array<Record<string, unknown>>;
  let prices: Map<string, number | null> | null = null;
  try {
    rows = (await build(true)) as Array<Record<string, unknown>>;
  } catch (error) {
    container.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[price-matrix] base price subquery failed, using the graph: ${(error as Error).message}`);
    rows = (await build(false)) as Array<Record<string, unknown>>;
    prices = new Map();
    const ids = rows.map((r) => String(r["id"]));
    for (let i = 0; i < ids.length; i += 200) {
      for (const p of await productPrices(container, ids.slice(i, i + 200))) prices.set(p.product_id, p.price);
    }
  }
  return rows.map((r) => {
    const id = String(r["id"]);
    const usd = prices ? prices.get(id) ?? null : r["base_usd"] == null ? null : Number(r["base_usd"]);
    return {
      product_id: id,
      title: String(r["title"] ?? ""),
      thumbnail: (r["thumbnail"] as string | null) ?? null,
      status: String(r["status"] ?? ""),
      metadata: (r["metadata"] as Record<string, unknown> | null) ?? null,
      skus: Array.isArray(r["skus"]) ? (r["skus"] as unknown[]).map(String).filter(Boolean) : [],
      base_cents: usd == null || !Number.isFinite(usd) ? null : Math.round(usd * 100),
    };
  });
}

/** Display names: the registry's (the owner may rename a brand), over the known list. */
const brandNames = (registry: readonly BrandView[] = []): Map<string, string> =>
  new Map([...KNOWN_BRANDS.map((b) => [b.slug, b.name] as [string, string]), ...registry.map((b) => [b.slug, b.name] as [string, string])]);

/** The brand registry for the matrix headers (names, logos). Never throws: without it, the catalogue's names. */
async function registryOrEmpty(container: MedusaContainer): Promise<BrandView[]> {
  try {
    return await listBrands(container);
  } catch {
    return [];
  }
}

// ── Sections ─────────────────────────────────────────────────────────────────

export interface MatrixSectionResult {
  stores: MatrixStore[];
  groups: MatrixGroup[];
}

/**
 * The frames or cases section. Five queries for the whole of it, whatever the
 * number of models and stores (see the module doc).
 */
async function loadProductSection(
  container: MedusaContainer,
  section: "frames" | "cases" | null,
  stores: MatrixStore[],
  opts: { q?: string; ids?: string[]; brand?: string; withCosts: boolean }
): Promise<MatrixGroup[]> {
  const ids = stores.map((s) => s.id);
  // A single row (`ids`, the cell route's answer) needs no registry: no header is drawn for it.
  const wantsHeaders = !opts.ids;
  const [raw, rules, discounts, assortment, costRows, registry] = await Promise.all([
    loadProductRows(container, { q: opts.q, ids: opts.ids, brand: opts.brand }),
    openRules(container, ids).catch(() => [] as PriceRuleLike[]),
    storeDiscountIndex(container, ids),
    assortmentByStore(container, ids),
    opts.withCosts ? listFrameCosts(container).catch(() => [] as FrameCostRow[]) : Promise.resolve([] as FrameCostRow[]),
    wantsHeaders ? registryOrEmpty(container) : Promise.resolve([] as BrandView[]),
  ]);
  const caseIds = caseProductIdsOf(rules);
  const products = raw
    .map((r) => toMatrixProduct(r, caseIds))
    .filter((p) => section === null || (section === "cases" ? p.is_case : !p.is_case));
  const rows = buildFrameRows(
    products,
    stores,
    rules,
    discounts,
    assortment,
    opts.withCosts ? { rows: new Map(costRows.map((c) => [c.sku, c])), variations: new Map() } : null
  );
  // v2: each brand header carries, per store, the brand price and the brand
  // discount (the cases section reads case-scoped brand prices), and the logo.
  return withBrandExposure(groupFrameRows(rows, products, brandNames(registry)), stores, assortment, {
    rules,
    discounts,
    scope: section === "cases" ? "case" : "frame",
    logos: wantsHeaders ? new Map(registry.map((b) => [b.slug, b.logo_url])) : undefined,
  });
}

/**
 * ONE brand's group as the frames (or cases) section shows it — the answer of
 * a `kind: "brand"` cell write, so the screen repaints the header and every
 * row under it. Null when the brand has no listed model.
 */
export async function loadBrandGroup(
  container: MedusaContainer,
  slug: string,
  scope: "frame" | "case",
  opts: { withCosts: boolean; stores?: MatrixStore[] }
): Promise<MatrixGroup | null> {
  const stores = opts.stores ?? (await loadMatrixStores(container));
  const groups = await loadProductSection(container, scope === "case" ? "cases" : "frames", stores, { brand: slug, withCosts: opts.withCosts });
  return groups.find((g) => g.key === slug) ?? groups[0] ?? null;
}

/** Whether a brand slug exists: some listed model carries it, or the registry has it. */
export async function brandExists(container: MedusaContainer, slug: string): Promise<boolean> {
  const brands = await registryOrEmpty(container);
  if (brands.some((b) => b.slug === slug)) return true;
  return (await loadProductRows(container, { brand: slug })).length > 0;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

/** Every store's `lens_store_price` rows in ONE query, by store. Never throws. */
async function lensStoreRows(pg: Knex, storeIds: string[]): Promise<Map<string, LensStorePriceLike[]>> {
  const out = new Map<string, LensStorePriceLike[]>(storeIds.map((id) => [id, []]));
  if (!storeIds.length) return out;
  try {
    const rows = (await pg("lens_store_price").whereNull("deleted_at").whereIn("establishment_id", storeIds)) as Array<Record<string, unknown>>;
    for (const r of rows) {
      out.get(String(r["establishment_id"]))?.push({
        establishment_id: String(r["establishment_id"]),
        item_kind: String(r["item_kind"] ?? ""),
        item_key: String(r["item_key"] ?? ""),
        value: Number(r["value"]),
      });
    }
  } catch {
    // No variations: every store quotes the master.
  }
  return out;
}

const labelRow = (r: LensMatrixRow) => ({
  code: String(r["code"] ?? ""),
  label_es: String(r["label_es"] ?? ""),
  label_en: String(r["label_en"] ?? ""),
  category: String(r["category"] ?? ""),
});

/** The lenses section: the master list (`loadLensMatrix`), its lab costs and every store's variations. */
async function loadLensSection(container: MedusaContainer, stores: MatrixStore[], withCosts: boolean): Promise<MatrixGroup[]> {
  const pg = pgOf(container);
  const ids = stores.map((s) => s.id);
  const [matrix, costs, storeRows, discounts] = await Promise.all([
    loadLensMatrix(pg),
    withCosts
      ? (pg("lens_base_price").whereNull("deleted_at").select("design_code", "material_code", "finish", "cost_cents") as Promise<Array<Record<string, unknown>>>).catch(
          () => [] as Array<Record<string, unknown>>
        )
      : Promise.resolve([] as Array<Record<string, unknown>>),
    lensStoreRows(pg, ids),
    storeDiscountIndex(container, ids),
  ]);
  const costOf = new Map(costs.map((c) => [`${c["design_code"]}|${c["material_code"]}|${parseLensFinish(c["finish"]) ?? ""}`, num(c["cost_cents"])]));
  return buildLensGroups(
    {
      designs: matrix.designs.map(labelRow),
      materials: matrix.materials.map(labelRow),
      cells: matrix.base_prices.map((c) => ({
        design_code: c.design_code,
        material_code: c.material_code,
        finish: c.finish ?? null,
        price_cents: c.price_cents,
        cost_cents: costOf.get(`${c.design_code}|${c.material_code}|${c.finish ?? ""}`) ?? null,
      })),
      storeRows,
    },
    stores,
    discounts,
    withCosts
  );
}

/** The treatments section: photochromics × category and ARs, with the options' lab costs. */
async function loadTreatmentSection(container: MedusaContainer, stores: MatrixStore[], withCosts: boolean): Promise<MatrixGroup[]> {
  const pg = pgOf(container);
  const ids = stores.map((s) => s.id);
  const costsOf = (table: string) =>
    withCosts
      ? (pg(table).whereNull("deleted_at").select("code", "cost_cents") as Promise<Array<Record<string, unknown>>>).catch(() => [] as Array<Record<string, unknown>>)
      : Promise.resolve([] as Array<Record<string, unknown>>);
  const [matrix, photoCosts, arCosts, storeRows, discounts] = await Promise.all([
    loadLensMatrix(pg),
    costsOf("lens_photo_option"),
    costsOf("lens_ar_option"),
    lensStoreRows(pg, ids),
    storeDiscountIndex(container, ids),
  ]);
  return buildTreatmentGroups(
    {
      photos: matrix.photos,
      ars: matrix.ars,
      photoCosts: new Map(photoCosts.map((r) => [String(r["code"]), num(r["cost_cents"])])),
      arCosts: new Map(arCosts.map((r) => [String(r["code"]), num(r["cost_cents"])])),
      storeRows,
      photoByMaterial: matrix.treatment_prices.some((t) => t["treatment_code"] === "photo"),
    },
    stores,
    discounts,
    withCosts
  );
}

/** The whole read of `GET /admin/pricing/matrix`. Cost keys only `withCosts`. */
export async function loadMatrixSection(
  container: MedusaContainer,
  section: MatrixSection,
  opts: { q?: string; withCosts: boolean; stores?: MatrixStore[] }
): Promise<MatrixSectionResult> {
  const stores = opts.stores ?? (await loadMatrixStores(container));
  let groups: MatrixGroup[];
  if (section === "frames" || section === "cases") groups = await loadProductSection(container, section, stores, { q: opts.q, withCosts: opts.withCosts });
  else if (section === "lenses") groups = await loadLensSection(container, stores, opts.withCosts);
  else groups = await loadTreatmentSection(container, stores, opts.withCosts);
  const q = (opts.q ?? "").trim().toLowerCase();
  if (q && section !== "frames" && section !== "cases") {
    // The lens list is small: the filter is the same for every section, done here.
    groups = groups
      .map((g) => ({ ...g, rows: g.label.toLowerCase().includes(q) ? g.rows : g.rows.filter((r) => `${r.title} ${r.key}`.toLowerCase().includes(q)) }))
      .filter((g) => g.rows.length);
  }
  return { stores, groups };
}

/** ONE row as `GET /admin/pricing/matrix` would give it; null when the article does not exist. */
export async function loadMatrixRow(
  container: MedusaContainer,
  kind: ItemKind,
  key: string,
  opts: { withCosts: boolean; stores?: MatrixStore[] }
): Promise<MatrixRow | null> {
  const stores = opts.stores ?? (await loadMatrixStores(container));
  const groups =
    kind === "frame" || kind === "case"
      ? await loadProductSection(container, null, stores, { ids: [key], withCosts: opts.withCosts })
      : (await loadMatrixSection(container, SECTION_OF_KIND[kind], { withCosts: opts.withCosts, stores })).groups;
  const sameKind = (r: MatrixRow) => r.kind === kind || ((kind === "frame" || kind === "case") && (r.kind === "frame" || r.kind === "case"));
  // A lens cell may be named with its finish spelled out ("prog-mid:cr39:digital",
  // "sv:cr39:stock"); the row's key is the stored spelling (`lensBaseKey`).
  const named = (r: MatrixRow) => r.key === key || (r.kind === "lens" && `${r.design_code}:${r.material_code}:${r.finish}` === key);
  for (const g of groups) {
    const hit = g.rows.find((r) => sameKind(r) && named(r));
    if (hit) return hit;
  }
  return null;
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Drop every process cache a price or a cost answer comes from: the frame
 * cost cache (margins), the lens cell cost cache, the price band (re-warmed by
 * the next `openRules`). The lens list itself is read fresh on every request.
 */
export function invalidatePriceCaches(): void {
  clearFrameCostCache();
  clearLensCellCostCache();
  clearPriceBandCache();
}

/**
 * Runs one planned cell write (`planCellWrite`) on the row it names, through
 * the panel's existing writers. Returns a `reason` code when the item cannot
 * take it, null when written. Every branch is audited (`replaceRule` and
 * `setItemDiscount` audit themselves; costs as `cost.change`, lens cells as
 * `price.change`, the same entities the older routes use).
 */
export async function executeCellOp(container: MedusaContainer, op: CellOp, rowIn: MatrixRow | null, actorId: string | null): Promise<string | null> {
  if (op.op === "brand_price" || op.op === "brand_discount") return executeBrandOp(container, op, actorId);
  if (!rowIn) return "unknown_item";
  const row = rowIn;
  switch (op.op) {
    case "frame_cost": {
      // v2: the MODEL's key (row.cost_key, e.g. DC50), never a slug SKU's.
      const costKey = row.cost_key || row.sku;
      if (!costKey) return "unknown_item";
      const { row: after, before } = await setOwnerFrameCost(container, { sku: costKey, costCents: op.cents }, actorId);
      await recordAudit(container, {
        actorId,
        action: "cost.change",
        entity: "frame_cost",
        entityId: frameCostKeyOf(costKey),
        before: frameCostAudit(before),
        after: frameCostAudit(after),
      });
      return null;
    }
    case "frame_price": {
      // The scope the till reads for this product (lib/pos-data.ts caseProductIds):
      // a case row writes a case rule, which is what makes the till price it
      // as one. An exact price left open in the OTHER scope would come back the
      // moment this one is cleared (the product would fall back to that scope),
      // so it is closed too.
      const scope = op.kind === "case" ? "case" : "frame";
      const other = scope === "case" ? "frame" : "case";
      const open = await openRules(container, [op.storeId]).catch(() => [] as PriceRuleLike[]);
      if (open.some((r) => r.establishment_id === op.storeId && r.scope === other && r.target === op.productId && r.mode === "override")) {
        await replaceRule(container, { establishmentId: op.storeId, scope: other, target: op.productId, family: "price" }, null, actorId);
      }
      await replaceRule(
        container,
        { establishmentId: op.storeId, scope, target: op.productId, family: "price" },
        op.usd === null ? null : { mode: "override", value: Math.round(op.usd * 100) / 100, source: "price-matrix" },
        actorId
      );
      return null;
    }
    case "lens_cost": {
      // Nothing to attach a lab cost to until the digital cell has a price.
      if (row.kind === "lens" && row.available === false) return "price_first";
      // The master writer reads the finish from the key: spell it out, or a
      // progressive's short key ("prog-mid:cr39") would read as a stock cell.
      const masterKey = row.kind === "lens" && row.design_code && row.material_code && row.finish ? `${row.design_code}:${row.material_code}:${row.finish}` : row.key;
      const failed = await writeLensMaster(container, op.storeKind, masterKey, "cost", op.cents);
      if (failed) return failed === "bad_key" ? "unknown_item" : failed;
      await recordAudit(container, {
        actorId,
        action: "cost.change",
        entity: "lens_price",
        entityId: `${op.storeKind}:${row.key}`,
        before: { kind: op.storeKind, key: row.key, field: "cost", value: row.cost_cents ?? null },
        after: { kind: op.storeKind, key: row.key, field: "cost", value: op.cents },
      });
      return null;
    }
    case "lens_price": {
      // An unpriced «digital» cell (`available: false`): the price creates the
      // master cell, which is what makes the till offer the finish at all.
      if (row.kind === "lens" && row.available === false) {
        if (op.cents === null) return null;
        const failed = await writeLensMaster(container, "base", `${row.design_code}:${row.material_code}:digital`, "price", op.cents);
        if (failed) return failed === "bad_key" ? "unknown_item" : failed;
        await recordAudit(container, {
          actorId,
          action: "price.change",
          entity: "lens_price",
          entityId: `base:${row.key}`,
          before: null,
          after: { kind: "base", key: row.key, field: "price", value: op.cents, master: true },
        });
        return null;
      }
      const cell = row.stores[op.storeId];
      await upsertStoreLensPrice(container, { establishmentId: op.storeId, kind: op.storeKind, key: row.key, value: op.cents }, actorId);
      await recordAudit(container, {
        actorId,
        action: "price.change",
        entity: "lens_price",
        entityId: `${op.storeKind}:${row.key}`,
        establishmentId: op.storeId,
        before: cell?.exact ? { kind: op.storeKind, key: row.key, field: "price", value: cell.price_cents } : null,
        after: op.cents === null ? null : { kind: op.storeKind, key: row.key, field: "price", value: op.cents },
      });
      return null;
    }
    case "discount": {
      // A frame and a case share the product id and the till reads either
      // (`productDiscountOf`): the discount lives under the row's own kind and
      // a figure left under the other one is removed, so there is one answer.
      if (row.kind === "frame" || row.kind === "case") {
        const other = row.kind === "frame" ? "case" : "frame";
        await setItemDiscount(container, { storeId: op.storeId, kind: other, key: row.key, pct: null }, actorId);
      }
      await setItemDiscount(container, { storeId: op.storeId, kind: row.kind, key: row.key, pct: op.pct }, actorId);
      return null;
    }
  }
}

/**
 * A brand's price or discount in one store (v2). The price is a
 * `store_price_rule` on `brand:<slug>` (family price, mode override — closing
 * the open one, as every price write does); the discount a
 * `store_item_discount` of kind `brand`. Both audited by their writers.
 */
async function executeBrandOp(
  container: MedusaContainer,
  op: Extract<CellOp, { op: "brand_price" } | { op: "brand_discount" }>,
  actorId: string | null
): Promise<string | null> {
  if (op.op === "brand_discount") {
    await setItemDiscount(container, { storeId: op.storeId, kind: BRAND_DISCOUNT_KIND, key: op.slug, pct: op.pct }, actorId);
    return null;
  }
  await replaceRule(
    container,
    { establishmentId: op.storeId, scope: op.scope, target: brandTarget(op.slug), family: "price" },
    op.usd === null ? null : { mode: "override", value: Math.round(op.usd * 100) / 100, source: "price-matrix-brand" },
    actorId
  );
  return null;
}

// ── Import ───────────────────────────────────────────────────────────────────

export interface ImportContext {
  stores: MatrixStore[];
  /** Rows by "kind|key", for applying a change to the row it names. */
  rows: Map<string, MatrixRow>;
  plan: ImportPlan;
}

const rowKey = (kind: string, key: string) => `${kind}|${key}`;

/**
 * Loads the current matrix of every section the request names (with costs:
 * the plan compares against them) and builds the plan. Reads only.
 */
export async function planMatrixImport(container: MedusaContainer, rows: unknown): Promise<ImportContext> {
  const stores = await loadMatrixStores(container);
  const list = Array.isArray(rows) ? rows : [];
  const sections = new Set<MatrixSection>();
  let wantsBrands = false;
  for (const r of list) {
    const s = (r as Record<string, unknown> | null)?.["section"];
    if (s === "frames" || s === "cases") sections.add("frames");
    else if (s === "lenses" || s === "treatments") sections.add(s);
    else if (s === "brands") wantsBrands = true;
  }
  const index = { products: new Map<string, MatrixRow>(), lenses: new Map<string, MatrixRow>(), treatments: new Map<string, MatrixRow>() };
  const byKey = new Map<string, MatrixRow>();
  const categoryOf = new Map<string, string>();
  const loaded = await Promise.all(
    [...sections].map(async (section) =>
      section === "frames"
        ? loadProductSection(container, null, stores, { withCosts: true })
        : (await loadMatrixSection(container, section, { withCosts: true, stores })).groups
    )
  );
  for (const groups of loaded) {
    indexImportRows(groups, index);
    for (const g of groups) {
      for (const r of g.rows) {
        byKey.set(rowKey(r.kind, r.key), r);
        if (r.kind === "lens" && r.design_code) categoryOf.set(r.design_code, r.category ?? "");
      }
    }
  }
  // «Marcas» (v2): the brand headers of the frames section, then the cases'
  // (the case brand's price is case-scoped), as they are today.
  let brands: Map<string, ImportBrand> | undefined;
  if (wantsBrands) {
    brands = new Map();
    const [frameGroups, caseGroups] = await Promise.all([
      loadProductSection(container, "frames", stores, { withCosts: false }),
      loadProductSection(container, "cases", stores, { withCosts: false }),
    ]);
    indexImportBrands(caseGroups.filter((g) => brandScopeOf(g.key) === "case"), "case", brands);
    indexImportBrands(frameGroups, "frame", brands);
    indexImportBrands(caseGroups, "case", brands);
  }
  // "prog-mid:cr39:digital" (as a book may spell it) → the stored "prog-mid:cr39".
  const canonical = (key: string): string => {
    const parts = parseLensBaseKey(key);
    if (!parts) return key;
    return lensBaseKey(parts.design_code, parts.material_code, parts.finish, categoryOf.get(parts.design_code) ?? null);
  };
  return { stores, rows: byKey, plan: buildImportPlan(list, { ...index, brands, stores }, canonical) };
}

/**
 * Applies a plan with no errors, a few writes at a time (each change is a
 * different cell, so they never race on one rule). Returns how many were
 * written and the ones an item refused.
 */
export async function applyMatrixImport(
  container: MedusaContainer,
  ctx: ImportContext,
  actorId: string | null
): Promise<{ applied: number; failed: Array<{ row: number; reason: string }> }> {
  const failed: Array<{ row: number; reason: string }> = [];
  let applied = 0;
  const queue = [...ctx.plan.changes];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const planned = planCellWrite(changeAsCellWrite(c));
      // A brand change has no article row: its writer only needs the slug.
      const row = c.kind === "brand" ? null : ctx.rows.get(rowKey(c.kind, c.key)) ?? null;
      if ("reason" in planned || (!row && c.kind !== "brand")) {
        failed.push({ row: c.row, reason: "reason" in planned ? planned.reason : "unknown_item" });
        continue;
      }
      try {
        const reason = await executeCellOp(container, planned.op, row, actorId);
        if (reason) failed.push({ row: c.row, reason });
        else applied++;
      } catch {
        failed.push({ row: c.row, reason: "save_failed" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  invalidatePriceCaches();
  await recordAudit(container, {
    actorId,
    action: "price.import",
    entity: "price_matrix",
    after: { ...ctx.plan.counts, applied, failed: failed.length },
  });
  return { applied, failed };
}

// ── Brands ───────────────────────────────────────────────────────────────────

export interface CatalogBrand {
  slug: string;
  name: string;
  models: number;
}

/**
 * v2: the brand registry merged with the catalogue (lib/catalog-brand-data.ts
 * `listBrands`) — slug, name, models, plus logo_url, kind, active, source,
 * sort — with the known brands that have no model yet. Falls back to the
 * catalogue-only list (v1) when the registry cannot be read.
 */
export async function catalogBrands(container: MedusaContainer): Promise<Array<CatalogBrand & Partial<BrandView>>> {
  try {
    const brands = await listBrands(container);
    const seen = new Set(brands.map((b) => b.slug));
    const extra = KNOWN_BRANDS.filter((b) => !seen.has(b.slug)).map((b) => ({ slug: b.slug, name: b.name, models: 0 }));
    return [...brands, ...extra].sort((a, b) => ((a as Partial<BrandView>).sort ?? 0) - ((b as Partial<BrandView>).sort ?? 0) || a.name.localeCompare(b.name));
  } catch {
    return catalogBrandsV1(container);
  }
}

/** The v1 list: catalogue brands with their models, plus the known ones. ONE query. Sorted by name. */
export async function catalogBrandsV1(container: MedusaContainer): Promise<CatalogBrand[]> {
  const pg = pgOf(container);
  const rows = (await pg("product")
    .whereNull("deleted_at")
    .whereIn("status", LISTED_STATUSES)
    .select(pg.raw(`lower(coalesce(metadata->>'brand_slug', metadata->>'collection_slug', '')) as slug`))
    .select(pg.raw(`max(metadata->>'brand') as name`))
    .count({ models: "*" })
    .groupByRaw("1")) as Array<Record<string, unknown>>;
  const names = brandNames();
  const out = new Map<string, CatalogBrand>();
  for (const b of KNOWN_BRANDS) out.set(b.slug, { slug: b.slug, name: b.name, models: 0 });
  for (const r of rows) {
    const slug = String(r["slug"] ?? "").trim();
    if (!slug) continue;
    out.set(slug, { slug, name: names.get(slug) || String(r["name"] ?? "").trim() || slug, models: Number(r["models"]) || 0 });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── New frames and cases ─────────────────────────────────────────────────────

/** Whether the handle or any of the SKUs is already in the catalogue (live rows). */
export async function catalogSkuTaken(container: MedusaContainer, handle: string, skus: string[]): Promise<boolean> {
  const pg = pgOf(container);
  const [byHandle, bySku] = await Promise.all([
    pg("product").whereNull("deleted_at").where("handle", handle).first("id"),
    skus.length
      ? pg("product_variant")
          .whereNull("deleted_at")
          .whereRaw(`upper(sku) in (${skus.map(() => "?").join(", ")})`, skus.map((s) => s.toUpperCase()))
          .first("id")
      : Promise.resolve(undefined),
  ]);
  return Boolean(byHandle || bySku);
}

/** The default sales channel and every store's, deduplicated. */
export async function catalogChannelIds(container: MedusaContainer): Promise<string[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const [{ data: storesData }, establishments] = await Promise.all([
    query.graph({ entity: "store", fields: ["id", "default_sales_channel_id"] }),
    listEstablishments(container),
  ]);
  const ids = [
    ...(storesData as Array<{ default_sales_channel_id?: string | null }>).map((s) => s.default_sales_channel_id ?? ""),
    ...establishments.map((e) => e.sales_channel_id ?? ""),
  ].filter(Boolean);
  return [...new Set(ids)];
}

/**
 * Creates the model (`buildCatalogFrameProduct`) and then, through the
 * matrix's own writers, its cost and each store's price and discount.
 * `sku_taken` when the handle or the SKU already exists. Returns the new
 * product id.
 */
export async function createCatalogFrame(
  container: MedusaContainer,
  frame: CatalogFrameInput,
  actorId: string | null
): Promise<{ product_id: string } | { reason: string }> {
  const handle = handleOfSku(frame.sku);
  const product = buildCatalogFrameProduct(frame, { channelIds: await catalogChannelIds(container), now: new Date(), actorId });
  const skus = ((product["variants"] as Array<{ sku: string }>) ?? []).map((v) => v.sku);
  if (await catalogSkuTaken(container, handle, skus)) return { reason: "sku_taken" };
  const { result } = await createProductsWorkflow(container).run({ input: { products: [product as never] } });
  const productId = String((result as Array<{ id: string }>)[0]?.id ?? "");
  if (!productId) throw new Error("createProductsWorkflow returned no product");

  await recordAudit(container, {
    actorId,
    action: "catalog.create",
    entity: "product",
    entityId: productId,
    after: { kind: frame.kind, sku: frame.sku, brand_slug: frame.brand_slug, colors: frame.colors.length, source: "manual" },
  });
  if (frame.cost_cents !== null) {
    const { row, before } = await setOwnerFrameCost(container, { sku: frame.sku, costCents: frame.cost_cents }, actorId);
    await recordAudit(container, { actorId, action: "cost.change", entity: "frame_cost", entityId: frameCostKeyOf(frame.sku), before: frameCostAudit(before), after: frameCostAudit(row) });
  }
  for (const [storeId, cell] of Object.entries(frame.prices)) {
    if (cell.price_cents !== null) {
      await replaceRule(
        container,
        { establishmentId: storeId, scope: frame.kind, target: productId, family: "price" },
        { mode: "override", value: cell.price_cents / 100, source: "price-matrix" },
        actorId
      );
    }
    if (cell.discount_pct !== null) await setItemDiscount(container, { storeId, kind: frame.kind, key: productId, pct: cell.discount_pct }, actorId);
  }
  invalidatePriceCaches();
  return { product_id: productId };
}

// ── New treatments ───────────────────────────────────────────────────────────

/**
 * Creates a photochromic (`lens_photo_option`) or an AR (`lens_ar_option`),
 * active, at the end of the list. The code is the one asked for (`code_taken`
 * when another option has it, live or deleted: the column is unique) or one
 * derived from the label.
 */
export async function createTreatment(container: MedusaContainer, t: TreatmentInput, actorId: string | null): Promise<{ code: string } | { reason: string }> {
  const pg = pgOf(container);
  const table = t.type === "photo" ? "lens_photo_option" : "lens_ar_option";
  const existing = (await pg(table).select("code", "sort")) as Array<{ code: string; sort: number | null }>;
  const taken = new Set(existing.map((r) => String(r.code)));
  if (t.code && taken.has(t.code)) return { reason: "code_taken" };
  const code = t.code ?? deriveTreatmentCode(t.type, t.label_en || t.label_es, taken);
  const sort = existing.reduce((m, r) => Math.max(m, Number(r.sort) || 0), 0) + 10;
  const svc = lensSvc(container);
  if (t.type === "photo") {
    const p = t.prices as { sv: number | null; bifocal: number | null; prog: number | null };
    await svc.createLensPhotoOptions({
      code,
      label_es: t.label_es,
      label_en: t.label_en,
      colors: [],
      price_sv_cents: p.sv,
      price_bifocal_cents: p.bifocal,
      price_prog_cents: p.prog,
      cost_cents: t.cost_cents,
      sort,
      is_active: true,
    } as never);
  } else {
    await svc.createLensArOptions({
      code,
      label_es: t.label_es,
      label_en: t.label_en,
      ar_group: t.ar_group,
      price_cents: (t.prices as { ar: number }).ar,
      cost_cents: t.cost_cents,
      sort,
      is_active: true,
    } as never);
  }
  await recordAudit(container, {
    actorId,
    action: "catalog.create",
    entity: table,
    entityId: code,
    after: { type: t.type, code, prices: t.prices, cost_cents: t.cost_cents, ar_group: t.type === "ar" ? t.ar_group : null },
  });
  invalidatePriceCaches();
  return { code };
}
