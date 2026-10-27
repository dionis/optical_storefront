import { ORDER_DATA_TABLES } from "../src/lib/purge-orders";

/**
 * The purge wipes order DATA only. Configuration tables (reasons, providers,
 * shipping setup) and the catalog/customers must never be in the list — a
 * typo here would erase the store's setup, not just its test orders.
 */
describe("purge-orders table list", () => {
  const NEVER = [
    "return_reason", "refund_reason", "payment_provider", "payment_method_token", "account_holder",
    "fulfillment_provider", "fulfillment_set", "service_zone", "geo_zone", "shipping_option",
    "shipping_option_rule", "shipping_option_type", "shipping_profile", "region", "region_payment_provider",
    "customer", "customer_address", "customer_account_holder", "product", "product_variant", "price_set",
    "product_review", "store_setting", "lens_option", "ocr_setting", "frame_media_asset", "user", "invite",
    // Vendedores y reglas de costo son configuración del dueño, no pedidos.
    "seller", "cost_rule",
    // Tiendas, roles, precios por tienda y formas de pago del punto de venta.
    "establishment", "staff_assignment", "staff_profile", "price_rule", "pos_payment_method", "audit_event", "pos_terminal", "pos_setting",
    "stock_location", "inventory_item", "promotion", "tax_rate", "api_key", "sales_channel",
  ];

  it("contains only order, cart, payment, fulfillment, return/claim/exchange, link, prescription and point-of-sale tables", () => {
    const allowed = /^(order(_|$)|return(_item|_fulfillment)?$|cart(_|$)|credit_line$|payment_collection|payment_session$|payment$|capture$|refund$|fulfillment(_item|_label|_address)?$|prescription$|rx_sequence$|pos_sale(_payment|_counter)?$|pos_tray$|insurance_claim$|discount_approval$)/;
    const offenders = ORDER_DATA_TABLES.filter((t) => !allowed.test(t));
    expect(offenders).toEqual([]);
  });

  it("never touches configuration, catalog or customer tables", () => {
    expect(ORDER_DATA_TABLES.filter((t) => NEVER.includes(t))).toEqual([]);
  });

  it("has no duplicates", () => {
    expect(new Set(ORDER_DATA_TABLES).size).toBe(ORDER_DATA_TABLES.length);
  });
});
