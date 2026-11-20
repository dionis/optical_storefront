import { MedusaService } from "@medusajs/framework/utils";
import {
  PricingSetting,
  StoreCostToggle,
  StoreFrameCost,
  StoreFrameCostVariation,
  StorePriceBand,
  StorePriceBandVariation,
  StorePriceRule,
  StoreItemDiscount,
  CatalogBrand,
} from "./models/index";

/**
 * CRUD only — the price rules' semantics live in src/lib/store-pricing.ts, the
 * writes (close + create) in src/lib/store-pricing-data.ts, the per-store
 * cost switches in src/lib/store-cost-toggle.ts and the cost of each frame
 * model — the chain-wide master and each store's own variation of it — in
 * src/lib/frame-cost.ts. The floor and ceiling a converted price is held
 * between (`store_price_band` + its per-store variation) are applied by the
 * pure functions in src/lib/pricing.ts and loaded in src/lib/store-pricing-data.ts.
 * The owner's per-article promotion of each store (`store_item_discount`) is
 * applied by src/lib/price-matrix.ts and moved by src/lib/price-matrix-data.ts.
 */
export default class StorePricingModuleService extends MedusaService({
  StorePriceRule,
  StoreCostToggle,
  PricingSetting,
  StoreFrameCost,
  StoreFrameCostVariation,
  StorePriceBand,
  StorePriceBandVariation,
  StoreItemDiscount,
  // v2: the brand registry of «Productos y precios» (lib/catalog-brand-data.ts).
  CatalogBrand,
}) {}
