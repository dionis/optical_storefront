/**
 * Base de venta de una óptica nueva (terminal de Coolify, tras el primer despliegue).
 *
 *   npx medusa exec ./src/scripts/tenant-seed.js
 *       → solo informa qué falta (dry run)
 *   TENANT_SEED_CONFIRM=yes npx medusa exec ./src/scripts/tenant-seed.js
 *       → crea lo que falte e imprime la clave publicable para Vercel
 *
 * `medusa db:migrate` deja la base sin nada con lo que vender: ni moneda de la
 * tienda, ni región, ni canal de venta, ni clave publicable, ni opción de envío.
 * Sin clave el storefront no lista productos; sin opción de envío
 * `/store/carts/:id/shipping-select` responde `no_shipping_option`. Esto crea,
 * solo si falta:
 *
 *   · moneda de la tienda (TENANT_CURRENCY) y canal «Default Sales Channel»;
 *   · región del país de la tienda (TENANT_COUNTRY) con los proveedores de cobro
 *     que existan (Stripe, manual, sistema);
 *   · clave publicable enlazada al canal (la `VITE_MEDUSA_PUBLISHABLE_KEY`);
 *   · almacén, zona de envío del país, perfil y la opción de envío a domicilio
 *     al precio fijo de la tienda (el importe real lo fija shipping-select).
 *
 * Idempotente: lo que ya existe (por nombre) se deja como está. No toca el
 * catálogo (scraper) ni el dueño (tenant-bootstrap).
 */
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { FLAT_SHIPPING_RATE } from "../lib/shipping-rates";
import { tenant } from "../lib/tenant";

const CHANNEL = "Default Sales Channel";
const KEY_TITLE = "Storefront";
const LOCATION = "Main warehouse";
const FULFILLMENT_SET = "Home delivery";
const PROFILE = "Default Shipping Profile";
const OPTION = "Standard shipping";
const MANUAL_FULFILLMENT = "manual_manual";
const PAYMENT_PROVIDERS = ["pp_stripe_stripe", "pp_manual_manual", "pp_system_default"];

type Row = { id: string; [k: string]: unknown };

export default async function run({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const confirm = process.env.TENANT_SEED_CONFIRM === "yes";
  const { currency, country, name } = tenant();
  const log = (msg: string) => logger.info(`[tenant-seed] ${msg}`);
  const todo: string[] = [];
  const need = (what: string): boolean => {
    todo.push(what);
    return confirm;
  };
  const list = async (entity: string, fields: string[], filters: Record<string, unknown> = {}) =>
    ((await query.graph({ entity, fields, filters })).data ?? []) as Row[];

  log(`${name}: ${currency.toUpperCase()} / ${country.toUpperCase()} — ${confirm ? "creando lo que falte" : "dry run"}`);

  // ── Tienda (la crea Medusa al arrancar) ─────────────────────────────────────
  const [store] = await container.resolve(Modules.STORE).listStores({}, { take: 1 });
  if (!store) {
    logger.error("[tenant-seed] La base no tiene tienda: arranca el backend una vez (medusa start) y repite.");
    process.exitCode = 1;
    return;
  }

  // ── Canal de venta ──────────────────────────────────────────────────────────
  let channelId = (await list("sales_channel", ["id", "name"])).find((c) => c.name === CHANNEL)?.id;
  if (!channelId && need(`canal «${CHANNEL}»`)) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: CHANNEL, description: "Web store" }] },
    });
    channelId = result[0].id;
  }

  // ── Región ──────────────────────────────────────────────────────────────────
  let regionId = (await list("region", ["id", "currency_code"])).find((r) => r.currency_code === currency)?.id;
  if (!regionId && need(`región ${currency.toUpperCase()} (${country.toUpperCase()})`)) {
    const available = new Set((await list("payment_provider", ["id"])).map((p) => p.id));
    const providers = PAYMENT_PROVIDERS.filter((p) => available.has(p));
    const { result } = await createRegionsWorkflow(container).run({
      input: { regions: [{ name: country === "us" ? "United States" : country.toUpperCase(), currency_code: currency, countries: [country], payment_providers: providers }] },
    });
    regionId = result[0].id;
  }

  // ── Moneda y valores por defecto de la tienda ───────────────────────────────
  const storeOk =
    (store.supported_currencies ?? []).some((c) => c.currency_code === currency && c.is_default) &&
    store.default_sales_channel_id === channelId &&
    store.default_region_id === regionId;
  if (!storeOk && need("moneda, canal y región por defecto de la tienda") && channelId && regionId) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: { supported_currencies: [{ currency_code: currency, is_default: true }], default_sales_channel_id: channelId, default_region_id: regionId },
      },
    });
  }

  // ── Clave publicable ────────────────────────────────────────────────────────
  type Key = Row & { token?: string; sales_channels?: Array<{ id: string }> };
  let key = (await list("api_key", ["id", "token", "title", "type", "sales_channels.id"], { type: "publishable" }))[0] as Key | undefined;
  if (!key && need("clave publicable")) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: { api_keys: [{ title: KEY_TITLE, type: "publishable", created_by: "tenant-seed" }] },
    });
    key = { id: result[0].id, token: result[0].token };
  }
  if (key && channelId && !(key.sales_channels ?? []).some((c) => c.id === channelId) && need("enlazar la clave al canal")) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: key.id, add: [channelId] } });
  }

  // ── Almacén ─────────────────────────────────────────────────────────────────
  let location = (await list("stock_location", ["id", "name", "sales_channels.id", "fulfillment_sets.id", "fulfillment_sets.name", "fulfillment_sets.service_zones.id", "fulfillment_providers.id"]))
    .find((l) => l.name === LOCATION) as
    | (Row & {
        sales_channels?: Array<{ id: string }>;
        fulfillment_sets?: Array<{ id: string; name: string; service_zones?: Array<{ id: string }> }>;
        fulfillment_providers?: Array<{ id: string }>;
      })
    | undefined;
  if (!location && need(`almacén «${LOCATION}»`)) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: LOCATION, address: { address_1: "", country_code: country } }] },
    });
    location = { id: result[0].id };
  }
  if (location) {
    if (channelId && !(location.sales_channels ?? []).some((c) => c.id === channelId) && need("enlazar el almacén al canal")) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id: location.id, add: [channelId] } });
    }
    if (!(location.fulfillment_providers ?? []).some((p) => p.id === MANUAL_FULFILLMENT) && need("proveedor de envío manual en el almacén")) {
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: MANUAL_FULFILLMENT },
      });
    }
  }

  // ── Zona de envío del país ──────────────────────────────────────────────────
  let zoneId = location?.fulfillment_sets?.find((s) => s.name === FULFILLMENT_SET)?.service_zones?.[0]?.id;
  if (!zoneId && location && need(`zona de envío ${country.toUpperCase()}`)) {
    const fulfillment = container.resolve(Modules.FULFILLMENT);
    const set = await fulfillment.createFulfillmentSets({
      name: FULFILLMENT_SET,
      type: "shipping",
      service_zones: [{ name: country.toUpperCase(), geo_zones: [{ type: "country", country_code: country }] }],
    });
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
    });
    zoneId = set.service_zones[0].id;
  }

  // ── Perfil y opción de envío ────────────────────────────────────────────────
  const profiles = await list("shipping_profile", ["id", "name", "type"]);
  let profileId = (profiles.find((p) => p.type === "default") ?? profiles.find((p) => p.name === PROFILE))?.id;
  if (!profileId && need(`perfil «${PROFILE}»`)) {
    const { result } = await createShippingProfilesWorkflow(container).run({ input: { data: [{ name: PROFILE, type: "default" }] } });
    profileId = result[0].id;
  }
  const hasOption = (await list("shipping_option", ["id", "name"])).some((o) => o.name === OPTION);
  if (!hasOption && need(`opción de envío «${OPTION}» ($${FLAT_SHIPPING_RATE})`) && zoneId && profileId && regionId) {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: OPTION,
          price_type: "flat",
          provider_id: MANUAL_FULFILLMENT,
          service_zone_id: zoneId,
          shipping_profile_id: profileId,
          type: { label: "Standard", description: "Home delivery", code: "standard" },
          prices: [
            { currency_code: currency, amount: FLAT_SHIPPING_RATE },
            { region_id: regionId, amount: FLAT_SHIPPING_RATE },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    });
  }

  // ── Resultado ───────────────────────────────────────────────────────────────
  if (!todo.length) log("Nada que crear: la óptica ya tiene su base de venta.");
  else log(`${confirm ? "Creado" : "Falta"}: ${todo.join("; ")}.`);
  if (!confirm && todo.length) {
    logger.warn("[tenant-seed] Dry run. Para crearlo: TENANT_SEED_CONFIRM=yes npx medusa exec ./src/scripts/tenant-seed.js");
  }
  if (key?.token) log(`VITE_MEDUSA_PUBLISHABLE_KEY=${key.token}   (Vercel → Environment Variables)`);
}
