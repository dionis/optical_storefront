import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows";
import type { Knex } from "@mikro-orm/knex";
import type { CatalogProduct, ImportPlan, LensKnown } from "./price-import";
import { replaceRule } from "./store-pricing-data";

/**
 * Reads what planOwnerPriceImport needs and applies its plan. The plan is
 * computed and shown first (dry run); applying is a separate, explicit request.
 */

export async function loadImportContext(container: MedusaContainer): Promise<{ catalog: CatalogProduct[]; known: LensKnown }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const catalog: CatalogProduct[] = [];
  for (let skip = 0; ; skip += 500) {
    const { data } = await query.graph({ entity: "product", fields: ["id", "title"], pagination: { skip, take: 500 } });
    catalog.push(...(data as Array<{ id: string; title: string }>).map((p) => ({ id: p.id, title: p.title })));
    if (data.length < 500) break;
  }

  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const [base, photo, ar] = await Promise.all([
    pg("lens_base_price").select("design_code", "material_code").whereNull("deleted_at"),
    pg("lens_photo_option").select("code").whereNull("deleted_at"),
    pg("lens_ar_option").select("code").whereNull("deleted_at"),
  ]);
  return {
    catalog,
    known: {
      base: new Set((base as Array<{ design_code: string; material_code: string }>).map((r) => `${r.design_code}:${r.material_code}`)),
      photo: new Set((photo as Array<{ code: string }>).map((r) => r.code)),
      ar: new Set((ar as Array<{ code: string }>).map((r) => r.code)),
    },
  };
}

export interface ApplyResult {
  products: number;
  variants: number;
  lens_cells: number;
}

/**
 * Applies the plan:
 *  - one global price rule per product (history kept by replaceRule), then the
 *    variants' Medusa price right away, so the web shows and charges it now
 *    instead of at the next price-sync run;
 *  - the lens matrix cells, in one transaction.
 */
export async function applyImportPlan(container: MedusaContainer, plan: ImportPlan, actorId: string | null): Promise<ApplyResult> {
  for (const p of plan.products) {
    await replaceRule(
      container,
      { establishmentId: null, scope: p.scope, target: p.product_id },
      { mode: "override", value: p.price, source: "owner-import" },
      actorId
    );
  }

  let variants = 0;
  if (plan.products.length) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const price = new Map(plan.products.map((p) => [p.product_id, p.price]));
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "variants.id"],
      filters: { id: [...price.keys()] },
    });
    const updates = (data as Array<{ id: string; variants?: Array<{ id: string }> }>).flatMap((p) =>
      (p.variants ?? []).map((v) => ({ id: v.id, prices: [{ amount: price.get(p.id) as number, currency_code: "usd" }] }))
    );
    for (let i = 0; i < updates.length; i += 100) {
      await updateProductVariantsWorkflow(container).run({ input: { product_variants: updates.slice(i, i + 100) as never } });
    }
    variants = updates.length;
  }

  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  let lensCells = 0;
  await pg.transaction(async (trx) => {
    for (const b of plan.lens.base) {
      lensCells += await trx("lens_base_price")
        .where({ design_code: b.design_code, material_code: b.material_code })
        .whereNull("deleted_at")
        .update({ price_cents: b.price_cents, updated_at: trx.fn.now() });
    }
    for (const p of plan.lens.photo) {
      lensCells += await trx("lens_photo_option")
        .where({ code: p.code })
        .whereNull("deleted_at")
        .update({ [`price_${p.category}_cents`]: p.price_cents, updated_at: trx.fn.now() });
    }
    for (const a of plan.lens.ar) {
      lensCells += await trx("lens_ar_option")
        .where({ code: a.code })
        .whereNull("deleted_at")
        .update({ price_cents: a.price_cents, updated_at: trx.fn.now() });
    }
  });

  return { products: plan.products.length, variants, lens_cells: lensCells };
}
