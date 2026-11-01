/**
 * Simulated history for the STAGING dashboards: sellers in every store, months
 * of till sales through the real sale code (quote, approvals, deposits, lab
 * stages, pickups, voids, insurers, registers), the stores' costs and the cost
 * rules left at zero. Nothing is sent to anyone: this script calls no
 * notification, and customers and sellers use @example.com and 555-01xx.
 *
 * Refuses any database but the staging one (lib/demo-seed.ts). Dry run unless
 * DEMO_SEED_CONFIRM is exactly the target it prints:
 *
 *   npx medusa exec ./src/scripts/seed-demo-sales.ts
 *   DEMO_SEED_CONFIRM=<target> npx medusa exec ./src/scripts/seed-demo-sales.ts
 *   DEMO_SEED_MODE=clean DEMO_SEED_CONFIRM=<target> npx medusa exec ./src/scripts/seed-demo-sales.ts
 *
 * Optional: DEMO_SEED_DAYS (60), DEMO_SEED_SALES_PER_STORE (25), DEMO_SEED_PASSWORD.
 */
import { randomBytes } from "crypto";
import type { ExecArgs, IAuthModuleService, IOrderModuleService, IUserModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { localParts } from "../lib/alerts";
import { loadCostCatalog, listCostRules, seedCostRulesIfEmpty, costingService, type CostRule } from "../lib/costing";
import {
  between,
  databaseTarget,
  DEMO_ACTOR,
  demoAddress,
  DEMO_AR_COST,
  demoCostItems,
  DEMO_EMAIL_DOMAIN,
  DEMO_FRAME_COST,
  DEMO_MARKER,
  DEMO_METHOD_FEES,
  DEMO_NOTE,
  demoPerson,
  demoPhone,
  DEMO_PHOTO_COST,
  DEMO_RULE_COSTS,
  demoRx,
  demoSeedConfirmed,
  demoSeedRefusal,
  olderRx,
  pick,
  rxPower,
  salesPerDay,
  SCENARIO_WEIGHTS,
  seededRng,
  weighted,
  type DemoPerson,
  type DemoRx,
  type Scenario,
} from "../lib/demo-seed";
import { listEstablishments, type EstablishmentRow } from "../lib/establishments";
import { loadProductMetadata } from "../lib/frame-specs";
import { fetchBoardOrder } from "../lib/order-board";
import { addBusinessDays, LAB_BUSINESS_DAYS } from "../lib/order-status";
import { transitionOrderStage } from "../lib/order-stage-transition";
import { cleanCustomer, cleanLines, cleanPayments, cleanRxMeta, discountNeedsApproval, needsPrescription } from "../lib/pos";
import {
  checkPrescriptions,
  collectPayment,
  createApproval,
  createPosSale,
  createTerminal,
  decideApproval,
  getSale,
  listPaymentMethods,
  listTerminals,
  markDelivered,
  quoteSale,
  requestVoid,
  rxContexts,
  setClaimStatus,
  voidSale,
  type CreatedSale,
  type PaymentMethodRow,
  type RxInput,
  type TerminalRow,
} from "../lib/pos-data";
import { discountLimitFor, getPosSettings } from "../lib/pos-settings";
import { monthPnl } from "../lib/store-pnl";
import { salesBreakdown, salesSummary } from "../lib/sales-analytics";
import { projectOrder } from "../lib/sale-facts";
import { prepareSellerLink, applySellerLink } from "../lib/seller-link";
import { deriveSellerCode, sellerService } from "../lib/sellers";
import { takenCodes } from "../lib/staff-code";
import { saveProfile } from "../lib/staff-profile-data";
import { ownerUserId, writeStaffAssignment } from "../lib/staff-scope";
import { brandOf, isExposed } from "../lib/store-assortment";
import { listAssortmentRules } from "../lib/store-assortment-data";
import { productPrices } from "../lib/store-pricing-data";
import { tenant } from "../lib/tenant";
import { POS_MODULE } from "../modules/pos";
import type PosModuleService from "../modules/pos/service";
import { STORE_COST_MODULE } from "../modules/store-cost";
import type StoreCostModuleService from "../modules/store-cost/service";

const DAY_MS = 86400_000;
const SEED = 20261030;

interface Frame { variantId: string; productId: string; brand: string; price: number }
interface Lens {
  designs: Array<{ code: string; category: string }>;
  materials: Array<{ code: string; max_abs: number }>;
  cells: Set<string>;
  photos: Array<{ code: string; sv: unknown; bifocal: unknown; prog: unknown }>;
  ars: Array<{ code: string; group: string }>;
}
interface Staff { userId: string; code: string; terminal: TerminalRow }
interface StoreCtx { store: EstablishmentRow; terminals: TerminalRow[]; sellers: Staff[]; referral: string; frames: Frame[]; counts: number[] }
interface Client { id: string; person: DemoPerson; rx: DemoRx | null }
type Job = () => Promise<void>;

const MATERIAL_FOR_POWER = (lens: Lens, design: string, power: number, thinner: boolean): string | null => {
  const fit = lens.materials.filter((m) => m.max_abs >= power && lens.cells.has(`${design}:${m.code}`));
  return (thinner ? fit[1] ?? fit[0] : fit[0])?.code ?? null;
};

export default async function seedDemoSales({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE);
  const databaseUrl = String(config.projectConfig.databaseUrl ?? "");
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  // Before anything else, and before reading a single row.
  const early = demoSeedRefusal({ databaseUrl, stripeKey, env: process.env });
  if (early) throw new Error(`[demo-seed] refused: ${early}. This script only runs on the staging database.`);

  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const stores = (await listEstablishments(container)).filter((s) => s.is_active && s.sales_channel_id);
  const demoIds = (await pg("order").whereRaw(`metadata->>? = 'true'`, [DEMO_MARKER]).select("id")) as Array<{ id: string }>;
  const [{ n: total }] = await pg("order").count<Array<{ n: string }>>("* as n");
  const foreign = Number(total) - demoIds.length;
  const refusal = demoSeedRefusal({ databaseUrl, stripeKey, env: process.env, foreignOrders: foreign, stores: stores.length });
  if (refusal) throw new Error(`[demo-seed] refused: ${refusal}.`);

  const clean = process.env.DEMO_SEED_MODE === "clean";
  const target = databaseTarget(databaseUrl);
  const confirmed = demoSeedConfirmed(databaseUrl, process.env.DEMO_SEED_CONFIRM);
  logger.info(`[demo-seed] target ${target}: ${stores.length} store(s) (${stores.map((s) => s.code).join(", ")}), ${foreign} other order(s), ${demoIds.length} demo order(s).`);
  if (!confirmed) {
    logger.warn(`[demo-seed] DRY RUN, nothing written. To ${clean ? "clean" : "seed"}: DEMO_SEED_CONFIRM=${target}`);
    return;
  }
  if (clean) {
    // A run cut short can leave an order without its marker: the address is ours either way.
    const byEmail = (await pg("order").where("email", "like", `%@${DEMO_EMAIL_DOMAIN}`).select("id")) as Array<{ id: string }>;
    return cleanDemo(container, pg, logger, [...new Set([...demoIds, ...byEmail].map((o) => o.id))]);
  }
  if (demoIds.length) throw new Error("[demo-seed] already seeded; run with DEMO_SEED_MODE=clean first.");

  const days = Math.max(7, Number(process.env.DEMO_SEED_DAYS) || 60);
  const perStore = Math.max(5, Number(process.env.DEMO_SEED_SALES_PER_STORE) || 25);
  await seed(container, pg, logger, stores, days, perStore);
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(container: MedusaContainer, pg: Knex, logger: Logger, stores: EstablishmentRow[], days: number, perStore: number): Promise<void> {
  // medusa exec runs subscribers: order.placed would email every administrator
  // per sale (the guard already keeps the credentials out) and takes most of the
  // time of a sale. On any other bus the guard is what stands.
  (container.resolve(Modules.EVENT_BUS) as unknown as { eventEmitter_?: { removeAllListeners(): void } }).eventEmitter_?.removeAllListeners();
  const rng = seededRng(SEED);
  const tz = tenant().timezone;
  const pos = container.resolve<PosModuleService>(POS_MODULE);
  const orders = container.resolve<IOrderModuleService>(Modules.ORDER);
  const ownerId = await ownerUserId(container);
  if (!ownerId) throw new Error("[demo-seed] the database has no owner user.");

  // Rows written by this run are newer than this; everything is then moved to
  // its simulated moment, so "newer than runStart" always means "not moved yet".
  const { rows: clock } = (await pg.raw("select now() as now")) as { rows: Array<{ now: Date }> };
  const runStart = new Date(clock[0].now);
  const latest = new Date(runStart.getTime() - 60_000);

  const lens = await loadLens(pg);
  const allFrames = await loadFrames(container, pg);
  if (allFrames.length < 5) throw new Error(`[demo-seed] only ${allFrames.length} sellable frames in the catalog.`);
  const methods = await prepareMethods(container, pos);
  await prepareCostRules(container, lens, allFrames);
  await prepareCostItems(container, stores, rng, days);

  // Oldest first; the last one is today.
  const today = localParts(latest, tz).date;
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
  const weekdays = dates.map((d) => new Date(`${d}T12:00:00Z`).getUTCDay());

  const password = process.env.DEMO_SEED_PASSWORD || `Demo-${randomBytes(9).toString("base64url")}`;
  const ctxs: StoreCtx[] = [];
  for (const [i, store] of stores.entries()) ctxs.push(await prepareStore(container, store, i, rng, password, allFrames, salesPerDay(rng, weekdays, perStore)));

  const settings = await getPosSettings(container);
  const limitPct = discountLimitFor({ is_admin: false, role: "seller", discount_limit_pct: null }, settings.discount_limits);
  const later = new Map<number, Job[]>();
  const schedule = (day: number, job: Job) => {
    if (day < dates.length) later.set(day, [...(later.get(day) ?? []), job]);
  };
  const clients: Client[] = [];
  const stats = { sales: 0, failed: 0, voided: 0, void_requests: 0, approvals: 0, delivered: 0, stage_errors: 0, last_error: "" };
  let idx = 0;

  /** A moment of that day, in opening hours for the Americas, never in the future. */
  const moment = (day: number, startHour = 15): Date => {
    const hh = String(between(rng, startHour, 23)).padStart(2, "0");
    const mm = String(between(rng, 0, 59)).padStart(2, "0");
    const d = new Date(`${dates[day]}T${hh}:${mm}:00Z`);
    return d > latest ? latest : d;
  };
  const moveNew = async (table: string, where: Record<string, string>, ts: Date, extra: Record<string, unknown> = {}) => {
    await pg(table).where(where).where("created_at", ">=", runStart).update({ created_at: ts, updated_at: ts, ...extra });
  };
  const moveApproval = async (id: string, ts: Date) => {
    await pg("discount_approval").where({ id }).update({ created_at: ts, updated_at: ts, decided_at: ts, expires_at: new Date(ts.getTime() + DAY_MS) });
    await moveNew("audit_event", { entity_id: id }, ts);
  };
  const moveSaleEvents = async (saleId: string, ts: Date) => {
    await moveNew("pos_sale_payment", { sale_id: saleId }, ts);
    await moveNew("audit_event", { entity_id: saleId }, ts);
    await moveNew("insurance_claim", { sale_id: saleId }, ts);
  };

  // Registers: ONE per store (CreatePos5: the till is the store's, not a terminal's),
  // opened on first use of the day, closed at the end of it.
  const open = new Map<string, string>();
  const ensureCash = async (ctx: StoreCtx, terminal: TerminalRow, day: number, actor: string) => {
    if (open.has(ctx.store.id)) return;
    const at = new Date(Date.parse(`${dates[day]}T14:30:00Z`));
    const row = await pos.createCashSessions({ establishment_id: ctx.store.id, terminal_id: terminal.id, opened_by: actor, opened_at: at > latest ? latest : at, opening_cents: between(rng, 10, 20) * 1000, status: "open", opened_signature: "DEMO" } as never);
    open.set(ctx.store.id, row.id);
    await pg("cash_session").where({ id: row.id }).update({ created_at: at > latest ? latest : at });
    if (rng() < 0.2) {
      const mv = await pos.createCashMovements({ session_id: row.id, kind: "out", amount_cents: between(rng, 8, 45) * 100, note: "Compra de insumos", created_by: actor });
      await pg("cash_movement").where({ id: mv.id }).update({ created_at: at > latest ? latest : at });
    }
  };
  const closeRegisters = async (day: number) => {
    for (const [storeId, sessionId] of open) {
      const [s] = await pos.listCashSessions({ id: sessionId }, { take: 1 });
      const payments = await pos.listPosSalePayments({ cash_session_id: sessionId } as never, { take: 5000 });
      const movements = await pos.listCashMovements({ session_id: sessionId }, { take: 500 });
      const expected =
        Number(s.opening_cents) +
        payments.filter((p) => p.counts_as_cash).reduce((sum, p) => sum + Number(p.amount_cents), 0) +
        movements.reduce((sum, m) => sum + (m.kind === "in" ? 1 : -1) * Number(m.amount_cents), 0);
      const diff = rng() < 0.1 ? between(rng, -500, 300) : 0;
      const at = new Date(`${dates[day]}T23:45:00Z`);
      await pg("cash_session").where({ id: sessionId }).update({
        closed_at: at,
        closed_by: s.opened_by,
        expected_cents: expected,
        counted_cents: expected + diff,
        diff_cents: diff,
        note: diff ? "Diferencia al contar" : null,
        status: "closed",
        closed_signature: "DEMO",
        updated_at: at,
      });
      open.delete(storeId);
    }
  };

  const stage = async (orderId: string, target: string, ts: Date, actor: string, tracking?: string) => {
    try {
      await transitionOrderStage(container, orderId, { stage: target, actorId: actor, noNotification: true, trackingNumber: tracking });
    } catch (e) {
      // A lens order already reads as "in the lab" without the note: nothing to do.
      if (target === "in_lab" && (e as { reason?: string }).reason === "not_allowed") return true;
      stats.stage_errors++;
      stats.last_error = `stage ${target}: ${(e as Error).message}`;
      logger.warn(`[demo-seed] ${stats.last_error}`);
      return false;
    }
    // The fulfillment's dates and the history entry happened on the simulated day.
    const links = (await pg("order_fulfillment").where({ order_id: orderId }).select("fulfillment_id")) as Array<{ fulfillment_id: string }>;
    for (const { fulfillment_id: id } of links) {
      const [f] = (await pg("fulfillment").where({ id }).select("created_at", "packed_at", "shipped_at", "delivered_at")) as Array<Record<string, Date | null>>;
      if (!f) continue;
      const patch: Record<string, Date> = {};
      for (const k of ["created_at", "packed_at", "shipped_at", "delivered_at"]) if (f[k] && new Date(f[k] as Date) >= runStart) patch[k] = ts;
      if (Object.keys(patch).length) await pg("fulfillment").where({ id }).update(patch);
    }
    const order = await orders.retrieveOrder(orderId, { select: ["id", "metadata"] });
    const md = (order.metadata ?? {}) as Record<string, unknown>;
    if (Array.isArray(md.stage_history)) {
      const history = (md.stage_history as Array<{ stage: string; at: string }>).map((h) => (new Date(h.at) >= runStart ? { ...h, at: ts.toISOString() } : h));
      await orders.updateOrders(orderId, { metadata: { ...md, stage_history: history } });
    }
    return true;
  };

  const pay = (method: PaymentMethodRow, cents: number, tag: number) => {
    const details: Record<string, string | number> = {};
    if (method.kind === "zelle") {
      details.confirmation = `ZL${String(100000 + tag)}`;
      details.sender = "Cuenta del cliente";
    } else if (method.kind === "debit" || method.kind === "credit") {
      details.last4 = String(between(rng, 1000, 9999));
      details.auth_no = String(between(rng, 100000, 999999));
    } else if (method.counts_as_cash) {
      details.tendered = Math.ceil(cents / 500) * 5;
    }
    return { method_code: method.code, amount: cents / 100, details };
  };
  const byKind = (kinds: string[]) => methods.filter((m) => kinds.includes(m.kind) && m.is_active);
  const customerMethod = () => pick(rng, byKind(weighted(rng, { cash: 30, credit: 35, debit: 25, zelle: 10 }) === "cash" ? ["cash"] : pick(rng, [["credit"], ["debit"], ["zelle"]])));

  const sellOne = async (ctx: StoreCtx, day: number) => {
    const n = ++idx;
    const seller = pick(rng, ctx.sellers);
    const ts = moment(day);
    const scenario = weighted(rng, SCENARIO_WEIGHTS) as Scenario;
    const multifocal = scenario === "bifocal" || scenario === "progressive" || (scenario === "insurance" && rng() < 0.3);
    const withLenses = scenario !== "frame_only";
    const frame = ctx.frames[Math.floor(rng() * rng() * ctx.frames.length)];

    // Customer: one in five comes back.
    const returning = clients.length > 3 && rng() < 0.2 ? pick(rng, clients) : null;
    const person = returning?.person ?? demoPerson(rng, n);
    const shipIt = rng() < 0.1;
    const customerIn = cleanCustomer({ ...person, address: shipIt ? demoAddress(rng) : null });
    if ("reason" in customerIn) throw new Error(`customer: ${customerIn.reason}`);

    const rx = withLenses ? demoRx(rng, multifocal) : null;
    let selection = { design_code: "frame-only", material_code: null as string | null, photo_code: null as string | null, ar_code: null as string | null };
    if (rx) {
      const category = multifocal ? (scenario === "bifocal" ? "bifocal" : "prog") : "sv";
      const design = pick(rng, lens.designs.filter((d) => d.category === category));
      const material = MATERIAL_FOR_POWER(lens, design.code, rxPower(rx), scenario === "sv_premium");
      if (!material) throw new Error(`no material for ${design.code}`);
      const photoKey = category as "sv" | "bifocal" | "prog";
      const photos = lens.photos.filter((p) => p[photoKey] != null);
      const wantsPhoto = rng() < (scenario === "sv_premium" ? 0.6 : scenario === "progressive" ? 0.3 : 0.08);
      const ars = lens.ars.filter((a) => a.group === "all" || a.group === (category === "sv" ? "sv" : "bifprog"));
      const wantsAr = rng() < (scenario === "sv_basic" ? 0.3 : 0.7);
      selection = { design_code: design.code, material_code: material, photo_code: wantsPhoto && photos.length ? pick(rng, photos).code : null, ar_code: wantsAr && ars.length ? pick(rng, ars).code : null };
    }

    const lines = cleanLines([
      scenario === "own_frame"
        ? { kind: "own_frame", selection, description: pick(rng, ["Ray-Ban negro", "Montura de metal dorada", "Oakley de pasta", "Montura de carey"]) }
        : { kind: "frame", variant_id: frame.variantId, selection },
    ]);
    if ("reason" in lines) throw new Error(`lines: ${lines.reason}`);

    // Discount: most pay list price; some get what the seller may give; a few ask for more.
    const r = rng();
    let pct = r < 0.2 ? pick(rng, [5, 10]) : r < 0.27 ? pick(rng, [15, 20]) : 0;
    let quote = await quoteSale(container, ctx.store.id, lines.lines, pct);
    let approvalId: string | null = null;
    if (discountNeedsApproval({ isAdmin: false, pct, limitPct, belowMinimum: quote.below_minimum })) {
      const approval = await createApproval(container, { store: ctx.store, terminalId: seller.terminal.id, requestedBy: seller.userId, quote, limitPct, reason: pick(rng, ["Cliente frecuente", "Iguala precio de la competencia", "Compra familiar"]) });
      stats.approvals++;
      const approved = rng() < 0.75;
      const decided = await decideApproval(container, approval.id, approved ? "approved" : "rejected", ownerId as string, approved ? null : "Fuera de la política de descuentos");
      // An approved request moves only after the sale uses it, or it would read as expired.
      if (approved) approvalId = decided.id;
      else {
        await moveApproval(decided.id, ts);
        pct = 10;
        quote = await quoteSale(container, ctx.store.id, lines.lines, pct);
      }
    }

    // Prescriptions: what they will wear, and often what they arrived with.
    const prescriptions: { new: RxInput | null; worn: RxInput | null } = { new: null, worn: null };
    if (rx) {
      const rxDate = new Date(ts.getTime() - between(rng, 3, 120) * DAY_MS).toISOString().slice(0, 10);
      prescriptions.new = { rx: rx as never, rx_date: rxDate };
      if (returning?.rx || rng() < 0.25) {
        const wornDate = new Date(ts.getTime() - between(rng, 300, 900) * DAY_MS).toISOString().slice(0, 10);
        prescriptions.worn = { rx: olderRx(rng, returning?.rx ?? rx) as never, rx_date: wornDate, worn_source: returning ? "prior_sale" : pick(rng, ["previous_rx", "lensometer"] as const) };
      }
    }
    const rxMeta = { new: null as never, worn: null as never } as { new: ReturnType<typeof cleanRxMeta> | null; worn: ReturnType<typeof cleanRxMeta> | null };
    for (const k of ["new", "worn"] as const) if (prescriptions[k]) rxMeta[k] = cleanRxMeta(prescriptions[k] as never);
    checkPrescriptions(container, prescriptions, needsPrescription(lines.lines), rxContexts(quote));

    // Payments: full, a deposit (normal in optics), or an insurer plus a copay.
    const total = quote.total_cents;
    const raw: unknown[] = [];
    const insurer = byKind(["insurance"])[0];
    if (scenario === "insurance" && insurer) {
      const covered = Math.round(total * (between(rng, 40, 70) / 100));
      raw.push({ method_code: insurer.code, amount: covered / 100, details: { payer: pick(rng, ["VSP Vision", "EyeMed", "Davis Vision", "Blue Cross"]), member_id: `M${between(rng, 1000000, 9999999)}`, authorization_no: `A${between(rng, 10000, 99999)}` } });
      if (rng() < 0.7) raw.push(pay(customerMethod(), total - covered, n));
    } else if (withLenses && (multifocal || rng() < 0.3) && rng() < 0.7) {
      raw.push(pay(customerMethod(), Math.round(total * pick(rng, [0.3, 0.5])), n));
    } else if (rng() < 0.1 && total > 200) {
      const first = Math.round(total * 0.6);
      raw.push(pay(customerMethod(), first, n), pay(customerMethod(), total - first, n + 1000));
    } else {
      raw.push(pay(customerMethod(), total, n));
    }
    const payments = cleanPayments(raw, total, methods, { establishmentId: ctx.store.id });
    if ("reason" in payments) throw new Error(`payments: ${payments.reason} (total ${total}, ${JSON.stringify(selection)})`);

    await ensureCash(ctx, seller.terminal, day, seller.userId);
    const needsApproval = discountNeedsApproval({ isAdmin: false, pct, limitPct, belowMinimum: quote.below_minimum }) && approvalId !== null;
    const sale: CreatedSale = await createPosSale(container, {
      store: ctx.store,
      terminal: seller.terminal,
      sellerId: seller.userId,
      sellerCode: seller.code,
      customer: customerIn.customer,
      customerId: returning?.id ?? null,
      lines: lines.lines,
      quote,
      payments,
      approvalId,
      needsApproval,
      prescriptions,
      rxMeta: rxMeta as never,
      thresholds: settings.optical_thresholds,
      delivery: shipIt ? "ship" : "pickup",
      notifyEmail: false,
      idempotencyKey: `demo-${ctx.store.code}-${n}`,
    });

    // Everything this sale wrote, moved to its moment.
    const row = await getSale(container, sale.id);
    const customerId = row?.customer_id as string;
    const promised = (withLenses ? addBusinessDays(ts, LAB_BUSINESS_DAYS) : ts).toISOString().slice(0, 10);
    const order = await orders.retrieveOrder(sale.order_id, { select: ["id", "metadata"] });
    const referred = rng() < 0.15;
    await orders.updateOrders(sale.order_id, {
      metadata: {
        ...(order.metadata ?? {}),
        [DEMO_MARKER]: true,
        promised_on: promised,
        ...(referred ? { seller_code: ctx.referral, seller_source: pick(rng, ["instagram", "facebook", "tiktok", "whatsapp", "link"]) } : {}),
      },
    });
    await pg("order").where({ id: sale.order_id }).update({ created_at: ts, updated_at: ts });
    await pg("order_summary").where({ order_id: sale.order_id }).update({ created_at: ts, updated_at: ts });
    await pg("order_item").where({ order_id: sale.order_id }).update({ created_at: ts, updated_at: ts });
    const [{ cart_id: cartId } = { cart_id: null }] = (await pg("pos_sale").where({ id: sale.id }).select("cart_id")) as Array<{ cart_id: string | null }>;
    if (cartId) await pg("cart").where({ id: cartId }).update({ created_at: ts, updated_at: ts, completed_at: ts });
    await pg("pos_sale").where({ id: sale.id }).update({ created_at: ts, updated_at: ts, promised_on: promised });
    await pg("pos_tray").where({ sale_id: sale.id }).update({ created_at: ts, updated_at: ts, assigned_at: ts });
    await moveSaleEvents(sale.id, ts);
    await moveNew("prescription", { customer_id: customerId }, ts);
    await moveNew("customer", { id: customerId }, ts);
    if (approvalId) await moveApproval(approvalId, ts);
    if (returning) returning.rx = rx ?? returning.rx;
    else clients.push({ id: customerId, person, rx });
    stats.sales++;

    // What happens next. A job due after today simply never runs, so recent
    // sales stay in the lab, with their balance and tray, like real ones.
    const state = { voided: false };
    const dueBalance = () => getSale(container, sale.id);
    const voidIt = rng() < 0.04;
    if (voidIt) {
      const voidDay = day + between(rng, 0, 2);
      schedule(voidDay, async () => {
        const at = moment(voidDay);
        const current = await dueBalance();
        if (!current) return;
        await ensureCash(ctx, seller.terminal, voidDay, seller.userId);
        await voidSale(container, current, ownerId as string, pick(rng, ["customer_changed_mind", "wrong_entry", "price_error", "lab_cannot_make"] as const), "Venta simulada");
        state.voided = true;
        stats.voided++;
        await pg("pos_sale").where({ id: sale.id }).update({ voided_at: at, voided_by: ownerId, updated_at: at });
        await pg("pos_tray").where({ sale_id: sale.id }).whereNotNull("released_at").update({ released_at: at });
        await moveSaleEvents(sale.id, at);
      });
    }

    const handOver = (d: number) => async () => {
      if (state.voided) return;
      const at = moment(d);
      const current = await dueBalance();
      if (!current || current.status === "voided") return;
      if (current.balance > 0) {
        // One in ten has not come back to pay: "ready, balance due" on the status page.
        if (rng() < 0.1) return;
        await ensureCash(ctx, seller.terminal, d, seller.userId);
        const paid = cleanPayments([pay(customerMethod(), Math.round(current.balance * 100), n + 2000)], Math.round(current.balance * 100), methods, { establishmentId: ctx.store.id, allowInsurance: false });
        if ("reason" in paid) throw new Error(`balance: ${paid.reason}`);
        await collectPayment(container, current, paid, seller.userId);
        await moveSaleEvents(sale.id, at);
      }
      const reached = await fetchBoardOrder(container, sale.order_id);
      if (!reached?.next_stages.includes("in_transit")) return;
      const tracking = shipIt ? `1Z${between(rng, 100000000, 999999999)}` : undefined;
      await stage(sale.order_id, "in_transit", at, seller.userId, tracking);
      await stage(sale.order_id, "delivered", at, seller.userId);
      const fresh = await dueBalance();
      if (!fresh) return;
      await markDelivered(container, fresh);
      stats.delivered++;
      await pg("pos_sale").where({ id: sale.id }).update({ delivered_at: at, updated_at: at });
      await pg("pos_tray").where({ sale_id: sale.id }).whereNotNull("released_at").update({ released_at: at });
    };

    if (!withLenses) {
      schedule(day, async () => {
        if (!state.voided && (await stage(sale.order_id, "shipped", ts, seller.userId))) await handOver(day)();
      });
    } else {
      const labIn = day + between(rng, 0, 1);
      const labOut = labIn + between(rng, 4, 9);
      schedule(labIn, async () => {
        if (!state.voided) await stage(sale.order_id, "in_lab", moment(labIn), ownerId as string);
      });
      schedule(labOut, async () => {
        if (!state.voided) await stage(sale.order_id, "shipped", moment(labOut), ownerId as string);
      });
      const pickup = labOut + between(rng, 1, 4);
      schedule(pickup, handOver(pickup));
    }

    if (scenario === "insurance") {
      const claimAt = day + between(rng, 3, 8);
      const paidAt = claimAt + between(rng, 10, 30);
      const claimRows = async () => (await pos.listInsuranceClaims({ sale_id: sale.id } as never, { take: 5 }))[0];
      schedule(claimAt, async () => {
        const claim = await claimRows();
        if (!claim || state.voided) return;
        await setClaimStatus(container, claim.id, "submitted", null, ownerId as string);
        await moveNew("audit_event", { entity_id: claim.id }, moment(claimAt));
      });
      schedule(paidAt, async () => {
        const claim = await claimRows();
        if (!claim || state.voided) return;
        const at = moment(paidAt);
        const rejected = rng() < 0.1;
        await setClaimStatus(container, claim.id, rejected ? "rejected" : "paid", null, ownerId as string);
        await moveNew("audit_event", { entity_id: claim.id }, at);
        if (!rejected) await pg("insurance_claim").where({ id: claim.id }).update({ paid_at: at, updated_at: at });
      });
    }

  };

  for (let day = 0; day < dates.length; day++) {
    for (const job of pendingFor(later, day)) {
      try {
        await job();
      } catch (e) {
        stats.stage_errors++;
        stats.last_error = (e as Error).message;
        logger.warn(`[demo-seed] job: ${stats.last_error}`);
      }
    }
    for (const ctx of ctxs) {
      for (let k = 0; k < ctx.counts[day]; k++) {
        try {
          await sellOne(ctx, day);
        } catch (e) {
          stats.failed++;
          stats.last_error = (e as Error).message;
          logger.warn(`[demo-seed] ${dates[day]} ${ctx.store.code}: ${stats.last_error}`);
          // Something is wrong, not unlucky: stop rather than write half a story.
          if (stats.failed >= 10 && stats.failed > stats.sales) throw new Error(`[demo-seed] too many failed sales; last: ${stats.last_error}`);
        }
      }
    }
    // Same-day jobs scheduled by the sales above (frames handed over, voids).
    for (const job of pendingFor(later, day)) {
      try {
        await job();
      } catch (e) {
        stats.stage_errors++;
        stats.last_error = (e as Error).message;
        logger.warn(`[demo-seed] job: ${stats.last_error}`);
      }
    }
    // Today's registers stay open: the shift is not over.
    if (day < dates.length - 1) await retrying(() => closeRegisters(day), logger);
    logger.info(`[demo-seed] ${dates[day]}: ${stats.sales} sales so far (${stats.failed} failed, ${stats.stage_errors} stage errors).`);
  }

  // Waiting on someone right now, in every store: a discount to approve and a void to decide.
  for (const ctx of ctxs) {
    const seller = ctx.sellers[0];
    const lines = cleanLines([{ kind: "frame", variant_id: ctx.frames[0].variantId, selection: { design_code: "frame-only" } }]);
    if (!("reason" in lines)) {
      const quote = await quoteSale(container, ctx.store.id, lines.lines, 25);
      await createApproval(container, { store: ctx.store, terminalId: seller.terminal.id, requestedBy: seller.userId, quote, limitPct, reason: "Cliente frecuente" });
      stats.approvals++;
    }
    const [recent] = await pos.listPosSales({ establishment_id: ctx.store.id, status: "completed", delivered_at: null } as never, { take: 1, order: { created_at: "DESC" } });
    const current = recent ? await getSale(container, recent.id) : null;
    if (current) {
      await requestVoid(container, current, seller.userId, "customer_changed_mind", "Venta simulada");
      stats.void_requests++;
    }
  }

  // Dashboards: every order once more, now with its final date, status and payments.
  const demo = (await pg("order").whereRaw(`metadata->>? = 'true'`, [DEMO_MARKER]).select("id")) as Array<{ id: string }>;
  for (const o of demo) await retrying(() => projectOrder(container, o.id), logger);

  logger.info(`[demo-seed] done: ${JSON.stringify(stats)}`);
  logger.info(`[demo-seed] sellers can sign in with their @${DEMO_EMAIL_DOMAIN} address; password: ${process.env.DEMO_SEED_PASSWORD ? "DEMO_SEED_PASSWORD" : password}`);
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
  const filter = { from, to: today, stores: null };
  logger.info(`[demo-seed] last 30 days: ${JSON.stringify(await salesSummary(container, filter))}`);
  logger.info(`[demo-seed] by store: ${JSON.stringify(await salesBreakdown(container, filter, "establishment"))}`);
  const pnl = await monthPnl(container, today.slice(0, 7), null);
  logger.info(`[demo-seed] P&L ${pnl.month}: ${JSON.stringify(pnl.total)}`);
}

/** Retries what a dropped database connection interrupted; the pool reconnects by itself. */
async function retrying<T>(work: () => Promise<T>, logger: Logger, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await work();
    } catch (e) {
      if (i >= attempts) throw e;
      logger.warn(`[demo-seed] retrying (${i}): ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 15_000 * i));
    }
  }
}

/** Jobs added to `day` while it was being processed. */
function pendingFor(later: Map<number, Job[]>, day: number): Job[] {
  const jobs = later.get(day) ?? [];
  later.delete(day);
  return jobs;
}

async function loadLens(pg: Knex): Promise<Lens> {
  const designs = (await pg("lens_design").whereNull("deleted_at").where({ is_active: true }).select("code", "category")) as Lens["designs"];
  const materials = (await pg("lens_material").whereNull("deleted_at").select("code", "max_abs").orderBy("max_abs", "asc")) as Array<{ code: string; max_abs: unknown }>;
  const cells = (await pg("lens_base_price").whereNull("deleted_at").where("price_cents", ">", 0).select("design_code", "material_code")) as Array<{ design_code: string; material_code: string }>;
  const photos = (await pg("lens_photo_option").whereNull("deleted_at").where({ is_active: true }).select("code", "price_sv_cents", "price_bifocal_cents", "price_prog_cents")) as Array<Record<string, unknown>>;
  const ars = (await pg("lens_ar_option").whereNull("deleted_at").where({ is_active: true }).select("code", "ar_group")) as Array<{ code: string; ar_group: string }>;
  if (!designs.length || !cells.length) throw new Error("[demo-seed] the lens price matrix is empty.");
  return {
    designs,
    materials: materials.map((m) => ({ code: m.code, max_abs: Number(m.max_abs) })),
    cells: new Set(cells.map((c) => `${c.design_code}:${c.material_code}`)),
    photos: photos.map((p) => ({ code: String(p.code), sv: p.price_sv_cents, bifocal: p.price_bifocal_cents, prog: p.price_prog_cents })),
    ars: ars.map((a) => ({ code: a.code, group: a.ar_group })),
  };
}

/** Sellable frames: published, priced, and not tracked by inventory (the seed never moves stock). */
async function loadFrames(container: MedusaContainer, pg: Knex): Promise<Frame[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "variants.id", "variants.manage_inventory"],
    filters: { status: "published" } as never,
    pagination: { take: 400 },
  });
  const products = data as Array<{ id: string; variants?: Array<{ id: string; manage_inventory?: boolean }> }>;
  const prices = new Map((await productPrices(container, products.map((p) => p.id))).map((p) => [p.product_id, p.price]));
  const meta = await loadProductMetadata(pg, products.map((p) => p.id));
  const frames: Frame[] = [];
  for (const p of products) {
    const price = prices.get(p.id);
    const variant = (p.variants ?? []).find((v) => v.manage_inventory === false);
    if (!variant || price == null || price <= 0) continue;
    frames.push({ variantId: variant.id, productId: p.id, brand: brandOf(meta.get(p.id)), price });
  }
  return frames;
}

/** Card fees, only where the owner left them at zero; the clean mode knows them by `updated_by`. */
async function prepareMethods(container: MedusaContainer, pos: PosModuleService): Promise<PaymentMethodRow[]> {
  const methods = await listPaymentMethods(container);
  for (const m of methods) {
    const fee = DEMO_METHOD_FEES[m.kind];
    if (fee && !m.fee_pct && !m.fee_fixed_cents) await pos.updatePosPaymentMethods({ id: m.id, ...fee, updated_by: DEMO_ACTOR } as never);
  }
  return listPaymentMethods(container);
}

/** Fills cost rules left at zero; an amount the owner set is never touched. */
async function prepareCostRules(container: MedusaContainer, lens: Lens, frames: Frame[]): Promise<void> {
  await seedCostRulesIfEmpty(container, await loadCostCatalog(container));
  const svc = costingService(container);
  const existing = await listCostRules(container);
  const byKey = new Map(existing.map((r) => [`${r.kind}:${r.match_key}`, r]));
  const brandPrice = new Map<string, number[]>();
  for (const f of frames) if (f.brand) brandPrice.set(f.brand, [...(brandPrice.get(f.brand) ?? []), f.price]);

  const wanted: Array<[string, string, string, number]> = [];
  for (const [brand, prices] of brandPrice) {
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    wanted.push(["frame_brand", brand, `Montura ${brand}`, Math.round(avg * 0.4) || DEMO_FRAME_COST]);
  }
  for (const [kind, rows] of Object.entries(DEMO_RULE_COSTS)) for (const [key, amount] of Object.entries(rows)) wanted.push([kind, key, byKey.get(`${kind}:${key}`)?.label ?? key, amount]);
  for (const p of lens.photos) wanted.push(["lens_photo", p.code, p.code, DEMO_PHOTO_COST]);
  for (const a of lens.ars) wanted.push(["lens_ar", a.code, a.code, DEMO_AR_COST]);

  let sort = existing.reduce((m, r: CostRule) => Math.max(m, r.sort_order), 0);
  for (const [kind, match_key, label, amount] of wanted) {
    const current = byKey.get(`${kind}:${match_key}`);
    if (current?.id) {
      if (!current.amount) await svc.updateCostRules({ id: current.id, amount, notes: DEMO_NOTE } as never);
    } else {
      await svc.createCostRules({ kind, match_key, label, amount, unit: "fixed", active: true, sort_order: ++sort, notes: DEMO_NOTE } as never);
    }
  }
}

/** Each store's costs (a category it already has is left alone), plus two shared ones. */
async function prepareCostItems(container: MedusaContainer, stores: EstablishmentRow[], rng: () => number, days: number): Promise<void> {
  const svc = container.resolve<StoreCostModuleService>(STORE_COST_MODULE);
  const existing = await svc.listCostItems({}, { take: 5000 });
  const start = new Date(Date.now() - (days + 31) * DAY_MS);
  const startsOn = `${start.toISOString().slice(0, 7)}-01`;
  for (const [i, store] of stores.entries()) {
    const taken = new Set(existing.filter((c) => c.establishment_id === store.id).map((c) => c.category));
    // The simulated stores sell a dozen pairs a month: costs in proportion, so the result varies around break-even.
    const scale = ([1, 0.85, 1.15, 0.7, 0.95, 1.05][i % 6] + rng() * 0.05) * 0.13;
    const items = demoCostItems(store.kind, scale, startsOn).filter((c) => !taken.has(c.category)).map((c) => ({ ...c, establishment_id: store.id }));
    for (const { amount, ...item } of items) await svc.createCostItems({ ...item, amount_cents: amount * 100, created_by: DEMO_ACTOR, updated_by: DEMO_ACTOR } as never);
  }
  const shared = new Set(existing.filter((c) => !c.establishment_id).map((c) => c.category));
  if (!shared.has("accounting")) await svc.createCostItems({ establishment_id: null, kind: "fixed", category: "accounting", description: "Contabilidad", amount_cents: 45000, frequency: "monthly", starts_on: startsOn, vendor: "Contadores Asociados", allocation: { method: "sales" }, notes: DEMO_NOTE, created_by: DEMO_ACTOR, updated_by: DEMO_ACTOR } as never);
  if (!shared.has("subscriptions")) {
    const shares: Record<string, number> = {};
    stores.forEach((s, i) => (shares[s.id] = i === stores.length - 1 ? 100 - Math.floor(100 / stores.length) * (stores.length - 1) : Math.floor(100 / stores.length)));
    await svc.createCostItems({ establishment_id: null, kind: "fixed", category: "subscriptions", description: "Software de la óptica", amount_cents: 29900, frequency: "monthly", starts_on: startsOn, vendor: "Software Óptico", allocation: { method: "percent", shares }, notes: DEMO_NOTE, created_by: DEMO_ACTOR, updated_by: DEMO_ACTOR } as never);
  }
}

/** Two tills, three counter sellers and one referral seller for the store. */
async function prepareStore(container: MedusaContainer, store: EstablishmentRow, index: number, rng: () => number, password: string, allFrames: Frame[], counts: number[]): Promise<StoreCtx> {
  const pos = container.resolve<PosModuleService>(POS_MODULE);
  const assortment = await listAssortmentRules(container, store.id);
  const frames = allFrames.filter((f) => isExposed(assortment, { id: f.productId, brand: f.brand }));
  if (!frames.length) throw new Error(`[demo-seed] ${store.code} exposes no sellable frame.`);
  // A store's own best sellers: a different slice of the catalog first.
  const shuffled = [...frames].sort(() => rng() - 0.5);

  const openSessions = await pos.listCashSessions({ establishment_id: store.id, closed_at: null } as never, { take: 50 });
  const busy = new Set(openSessions.map((s) => s.terminal_id));
  let terminals = (await listTerminals(container, [store.id])).filter((t) => t.is_active && !busy.has(t.id));
  while (terminals.length < 2) {
    terminals = [...terminals, await createTerminal(container, store, { name: `Caja ${terminals.length + 1}` }, DEMO_ACTOR)];
  }

  const users = container.resolve<IUserModuleService>(Modules.USER);
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  const svc = sellerService(container);
  const sellers: Staff[] = [];
  for (let i = 0; i < 3; i++) {
    const p = demoPerson(rng, 9000 + index * 10 + i);
    const terminal = terminals[i % terminals.length];
    const name = `${p.first_name} ${p.last_name}`;
    const commission = pick(rng, [3, 4, 5, 6]);
    const link = await prepareSellerLink(container, null, { create: { establishment_id: store.id, terminal_id: terminal.id, commission_pct: commission } }, { name, email: p.email });
    const reg = await auth.register("emailpass", { body: { email: p.email, password } });
    if (!reg.success || !reg.authIdentity) throw new Error(`[demo-seed] could not register ${p.email}: ${reg.error ?? "unknown"}`);
    const user = await users.createUsers({ email: p.email, first_name: p.first_name, last_name: p.last_name, metadata: { [DEMO_MARKER]: true, must_change_password: false } });
    await auth.updateAuthIdentities([{ id: reg.authIdentity.id, app_metadata: { user_id: user.id } }]);
    const seller = await applySellerLink(container, user.id, link);
    await svc.updateSellers([{ id: seller.id, phone: p.phone, notes: DEMO_NOTE }]);
    await writeStaffAssignment(container, { userId: user.id, role: "seller", establishmentIds: [store.id], actorId: null });
    await saveProfile(
      container,
      user.id,
      {
        display_name: name,
        phone_mobile: p.phone,
        phone_whatsapp: p.phone,
        locale: "es",
        hire_date: `${2021 + between(rng, 0, 4)}-${String(between(rng, 1, 12)).padStart(2, "0")}-${String(between(rng, 1, 28)).padStart(2, "0")}`,
        commission_pct: commission,
        monthly_goal: between(rng, 5, 12) * 1000,
        emergency_name: "Contacto de emergencia",
        emergency_relation: "Familiar",
        emergency_phone: demoPhone(rng),
      },
      null
    );
    sellers.push({ userId: user.id, code: seller.code, terminal });
  }

  // Someone who brings customers through a referral link (Sellers tab, Costs).
  const r = demoPerson(rng, 9500 + index);
  const code = deriveSellerCode(`${r.first_name} ${r.last_name}`, await takenCodes(container));
  await svc.createSellers({ name: `${r.first_name} ${r.last_name}`, email: r.email, phone: r.phone, code, commission_pct: pick(rng, [7, 8, 10]), active: true, establishment_id: store.id, terminal_id: terminals[0].id, notes: DEMO_NOTE, token_version: 1, social: { instagram: `@${code.toLowerCase()}.opticas` } } as never);

  return { store, terminals, sellers, referral: code, frames: shuffled.slice(0, 60), counts };
}

// ---------------------------------------------------------------------------
// Clean: removes exactly what the seed wrote
// ---------------------------------------------------------------------------

async function cleanDemo(container: MedusaContainer, pg: Knex, logger: Logger, orderIds: string[]): Promise<void> {
  const existing = new Set(((await pg("information_schema.tables").where({ table_schema: "public" }).select("table_name")) as Array<{ table_name: string }>).map((r) => r.table_name));
  const ids = async (table: string, column: string, where: (q: Knex.QueryBuilder) => void): Promise<string[]> =>
    existing.has(table) ? ((await pg(table).where(where).select(column)) as Array<Record<string, string>>).map((r) => r[column]).filter(Boolean) : [];
  const among = (column: string, values: string[]) => (q: Knex.QueryBuilder) => void q.whereIn(column, values.length ? values : ["-"]);

  const users = await ids("user", "id", (q) => void q.whereRaw(`metadata->>? = 'true'`, [DEMO_MARKER]));
  const emails = await ids("user", "email", among("id", users));
  const customers = await ids("customer", "id", (q) => void q.where("email", "like", `%@${DEMO_EMAIL_DOMAIN}`));
  const sales = await ids("pos_sale", "id", among("order_id", orderIds));
  const items = await ids("order_item", "item_id", among("order_id", orderIds));
  const carts = [...new Set([...(await ids("order_cart", "cart_id", among("order_id", orderIds))), ...(await ids("cart", "id", (q) => void q.where("email", "like", `%@${DEMO_EMAIL_DOMAIN}`)))])];
  const collections = [...new Set([...(await ids("order_payment_collection", "payment_collection_id", among("order_id", orderIds))), ...(await ids("cart_payment_collection", "payment_collection_id", among("cart_id", carts)))])];
  const fulfillments = await ids("order_fulfillment", "fulfillment_id", among("order_id", orderIds));
  const payments = await ids("payment", "id", among("payment_collection_id", collections));
  const cartItems = await ids("cart_line_item", "id", among("cart_id", carts));
  const terminals = await ids("pos_terminal", "id", (q) => void q.where("created_by", DEMO_ACTOR));
  const sessions = await ids("cash_session", "id", among("opened_by", users));
  const approvals = await ids("discount_approval", "id", among("requested_by", users));
  const claims = await ids("insurance_claim", "id", among("sale_id", sales));
  const addresses = [
    ...(await ids("order", "shipping_address_id", among("id", orderIds))),
    ...(await ids("order", "billing_address_id", among("id", orderIds))),
  ];
  const cartAddresses = [...(await ids("cart", "shipping_address_id", among("id", carts))), ...(await ids("cart", "billing_address_id", among("id", carts)))];
  const fulfillmentAddresses = await ids("fulfillment", "delivery_address_id", among("id", fulfillments));
  const auths = await ids("provider_identity", "auth_identity_id", among("entity_id", emails));

  // Children before parents; each list names exactly the rows found above.
  const steps: Array<[string, string, string[]]> = [
    ["reservation_item", "line_item_id", [...items, ...cartItems]],
    ["sale_fact", "order_id", orderIds],
    ["pos_sale_payment", "sale_id", sales],
    ["insurance_claim", "sale_id", sales],
    ["pos_tray", "sale_id", sales],
    ["pos_sale", "id", sales],
    ["discount_approval", "id", approvals],
    ["cash_movement", "session_id", sessions],
    ["cash_session", "id", sessions],
    ["order_change_action", "order_id", orderIds],
    ["order_change", "order_id", orderIds],
    ["order_line_item_adjustment", "item_id", items],
    ["order_line_item_tax_line", "item_id", items],
    ["order_item", "order_id", orderIds],
    ["order_shipping", "order_id", orderIds],
    ["order_transaction", "order_id", orderIds],
    ["order_credit_line", "order_id", orderIds],
    ["order_summary", "order_id", orderIds],
    ["order_line_item", "id", items],
    ["order_cart", "order_id", orderIds],
    ["order_payment_collection", "order_id", orderIds],
    ["order_fulfillment", "order_id", orderIds],
    ["order_promotion", "order_id", orderIds],
    ["order", "id", orderIds],
    ["order_address", "id", addresses],
    ["refund", "payment_id", payments],
    ["capture", "payment_id", payments],
    ["payment", "id", payments],
    ["payment_session", "payment_collection_id", collections],
    ["payment_collection_payment_providers", "payment_collection_id", collections],
    ["cart_payment_collection", "cart_id", carts],
    ["payment_collection", "id", collections],
    ["fulfillment_label", "fulfillment_id", fulfillments],
    ["fulfillment_item", "fulfillment_id", fulfillments],
    ["fulfillment", "id", fulfillments],
    ["fulfillment_address", "id", fulfillmentAddresses],
    ["cart_line_item_adjustment", "item_id", cartItems],
    ["cart_line_item_tax_line", "item_id", cartItems],
    ["cart_line_item", "cart_id", carts],
    ["cart_shipping_method", "cart_id", carts],
    ["credit_line", "cart_id", carts],
    ["cart", "id", carts],
    ["cart_address", "id", cartAddresses],
    ["prescription", "customer_id", customers],
    ["customer_address", "customer_id", customers],
    ["customer_group_customer", "customer_id", customers],
    ["customer", "id", customers],
    ["audit_event", "entity_id", [...sales, ...approvals, ...claims, ...sessions, ...users]],
    ["audit_event", "actor_user_id", users],
    ["staff_assignment", "user_id", users],
    ["staff_profile", "user_id", users],
    ["seller", "user_id", users],
    ["provider_identity", "auth_identity_id", auths],
    ["auth_identity", "id", auths],
    ["user", "id", users],
    ["pos_terminal", "id", terminals],
  ];

  await pg.transaction(async (trx) => {
    for (const [table, column, values] of steps) {
      if (!existing.has(table) || !values.length) continue;
      for (let i = 0; i < values.length; i += 500) {
        const n = await trx(table).whereIn(column, values.slice(i, i + 500)).del();
        if (i === 0 && n) logger.info(`[demo-seed] ${table}: removed rows.`);
      }
    }
    await trx("seller").where("notes", DEMO_NOTE).del();
    await trx("cost_item").where("notes", DEMO_NOTE).del();
    await trx("cost_rule").where("notes", DEMO_NOTE).update({ amount: 0, notes: null });
    await trx("pos_payment_method").where("updated_by", DEMO_ACTOR).update({ fee_pct: 0, fee_fixed_cents: 0, updated_by: null });
    // The numbering carries on from what is left, so the next real sale has no gap.
    await trx("pos_sale_counter").del();
    await trx.raw(`INSERT INTO pos_sale_counter (establishment_id, last_seq) SELECT establishment_id, MAX(seq) FROM pos_sale GROUP BY establishment_id`);
    await trx("rx_sequence").del();
    await trx.raw(`INSERT INTO rx_sequence (year, last_value)
      SELECT split_part(rx_number, '-', 2)::int, MAX(split_part(rx_number, '-', 3)::int)
      FROM prescription WHERE rx_number IS NOT NULL GROUP BY 1`);
  });
  logger.info(`[demo-seed] cleaned: ${orderIds.length} order(s), ${customers.length} customer(s), ${users.length} seller(s).`);
}
