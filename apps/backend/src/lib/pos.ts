/**
 * Point-of-sale rules. Pure — no I/O; the sale itself (cart, payment, Medusa
 * order, number) is in pos-data.ts.
 *
 * Every validator returns a reason code (the panel shows
 * `adm.err.pos.<reason>`) or the cleaned value — never prose.
 */

/** `Op2-000147`: the store's code and its own six-digit sequence. */
export function saleNumber(storeCode: string, seq: number): string {
  return `${storeCode}-${String(seq).padStart(6, "0")}`;
}

/** Codes of the seeded methods; anything else was added by the owner. */
export const BUILTIN_METHOD_CODES = ["debit", "credit", "zelle", "cash", "insurance"] as const;

export const toCents = (v: unknown): number => Math.round(Number(v) * 100);

/** Whether a panel user may sell in (and look at the sales of) a store. */
export function canSellAt(
  scope: { is_admin: boolean; role: string | null; establishment_ids: string[] | null },
  establishmentId: string
): boolean {
  if (scope.is_admin) return true;
  if (!scope.role) return false;
  return scope.establishment_ids === null || scope.establishment_ids.includes(establishmentId);
}

/** Stores a user may sell in, out of the active ones. */
export function sellableStores<T extends { id: string; is_active: boolean }>(
  scope: { is_admin: boolean; role: string | null; establishment_ids: string[] | null },
  stores: T[]
): T[] {
  return stores.filter((s) => s.is_active && canSellAt(scope, s.id));
}

/** The seller record behind a user with the `seller` role (StaffScope.seller). */
export interface CounterSeller {
  id: string;
  code: string;
  active: boolean;
  establishment_id: string | null;
  terminal_id: string | null;
}

export type SellerTillReason = "seller_not_linked" | "seller_inactive" | "seller_wrong_till";

/**
 * A user with the `seller` role sells only as their seller record says: that
 * record active, from its store and its one till. Other roles are not bound to
 * a till (a manager covers whichever is free). Null = may sell there.
 */
export function sellerTillProblem(
  scope: { is_admin: boolean; role: string | null; seller?: CounterSeller | null },
  establishmentId: string | null,
  terminalId: string | null
): SellerTillReason | null {
  if (scope.is_admin || scope.role !== "seller") return null;
  const s = scope.seller;
  if (!s) return "seller_not_linked";
  if (!s.active || !s.establishment_id || !s.terminal_id) return "seller_inactive";
  if (establishmentId !== s.establishment_id || terminalId !== s.terminal_id) return "seller_wrong_till";
  return null;
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export interface PosCustomerInput {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  phone?: unknown;
  birth_date?: unknown;
  address?: {
    address_1?: unknown;
    city?: unknown;
    province?: unknown;
    postal_code?: unknown;
    country_code?: unknown;
  } | null;
}

export interface PosCustomer {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  /** YYYY-MM-DD */
  birth_date: string;
  /** Only for shipping; optional (owner's decision). */
  address: { address_1: string; city: string; province: string | null; postal_code: string; country_code: string } | null;
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The customer data the owner asked for: full name, email, phone and birth
 * date, required; the address only when the glasses are shipped.
 */
export function cleanCustomer(input: PosCustomerInput | null | undefined, now = new Date()): { reason: string } | { customer: PosCustomer } {
  const c = input ?? {};
  const first_name = text(c.first_name, 80);
  const last_name = text(c.last_name, 80);
  if (!first_name || !last_name) return { reason: "customer_name" };

  const email = text(c.email, 200).toLowerCase();
  if (!EMAIL.test(email)) return { reason: "customer_email" };

  const phone = text(c.phone, 30);
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return { reason: "customer_phone" };

  const birth_date = text(c.birth_date, 10);
  const born = /^\d{4}-\d{2}-\d{2}$/.test(birth_date) ? new Date(`${birth_date}T00:00:00Z`) : null;
  if (!born || Number.isNaN(born.getTime()) || born.toISOString().slice(0, 10) !== birth_date) {
    return { reason: "customer_birth_date" };
  }
  const age = (now.getTime() - born.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 0 || age > 120) return { reason: "customer_birth_date" };

  let address: PosCustomer["address"] = null;
  const a = c.address;
  if (a && (text(a.address_1, 160) || text(a.city, 80) || text(a.postal_code, 20))) {
    const address_1 = text(a.address_1, 160);
    const city = text(a.city, 80);
    const postal_code = text(a.postal_code, 20);
    if (!address_1 || !city || !postal_code) return { reason: "customer_address" };
    address = {
      address_1,
      city,
      province: text(a.province, 80) || null,
      postal_code,
      country_code: (text(a.country_code, 2) || "us").toLowerCase(),
    };
  }
  return { customer: { first_name, last_name, email, phone, birth_date, address } };
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export interface PosLineInput {
  /** "frame": a catalog frame (variant); "own_frame": lenses for a frame the customer brought. */
  kind?: unknown;
  variant_id?: unknown;
  selection?: {
    design_code?: unknown;
    material_code?: unknown;
    photo_code?: unknown;
    ar_code?: unknown;
  } | null;
  /** Own frame: what the customer brought, for the lab ticket ("Ray-Ban negro"). */
  description?: unknown;
  /** Own frame: photo as a `data:` URL, stored in the private bucket. */
  photo?: unknown;
}

export interface PosLine {
  kind: "frame" | "own_frame";
  variant_id: string | null;
  selection: { design_code: string; material_code: string | null; photo_code: string | null; ar_code: string | null };
  description: string | null;
  photo: string | null;
}

export const MAX_LINES = 10;

const code = (v: unknown): string | null => {
  const s = text(v, 40);
  return /^[a-z0-9-]+$/i.test(s) ? s : null;
};

export function cleanLines(input: unknown): { reason: string } | { lines: PosLine[] } {
  if (!Array.isArray(input) || input.length === 0) return { reason: "no_lines" };
  if (input.length > MAX_LINES) return { reason: "too_many_lines" };
  const lines: PosLine[] = [];
  for (const raw of input as PosLineInput[]) {
    const kind = raw?.kind === "own_frame" ? "own_frame" : raw?.kind === "frame" ? "frame" : null;
    if (!kind) return { reason: "bad_line" };
    const design_code = code(raw.selection?.design_code);
    if (!design_code) return { reason: "bad_line" };
    const variant_id = kind === "frame" ? text(raw.variant_id, 80) : "";
    if (kind === "frame" && !variant_id) return { reason: "bad_line" };
    // A frame the customer brought only makes sense with lenses for it.
    if (kind === "own_frame" && design_code === "frame-only") return { reason: "own_frame_needs_lenses" };
    const photo = typeof raw.photo === "string" && raw.photo.startsWith("data:image/") ? raw.photo : null;
    lines.push({
      kind,
      variant_id: kind === "frame" ? variant_id : null,
      selection: {
        design_code,
        material_code: code(raw.selection?.material_code),
        photo_code: code(raw.selection?.photo_code),
        ar_code: code(raw.selection?.ar_code),
      },
      description: kind === "own_frame" ? text(raw.description, 160) || null : null,
      photo: kind === "own_frame" ? photo : null,
    });
  }
  return { lines };
}

/** Lines that carry prescription lenses (everything but a bare frame). */
export const needsPrescription = (lines: PosLine[]): boolean =>
  lines.some((l) => l.selection.design_code !== "frame-only");

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface PaymentMethodLike {
  code: string;
  is_active: boolean;
  receivable: boolean;
  kind?: string;
  fee_pct?: number;
  fee_fixed_cents?: number;
  counts_as_cash?: boolean;
  /** Stores where it is accepted; null/empty = all. */
  establishment_ids?: string[] | null;
  reference_fields?: Array<{ key: string; required?: boolean }> | null;
}

export interface PosPayment {
  method_code: string;
  amount_cents: number;
  /** One-line summary of the reference data, for lists. */
  reference: string | null;
  details: Record<string, string | number>;
  fee_cents: number;
  counts_as_cash: boolean;
  /** Insurer's part: owed by the insurer, not paid by the customer. */
  insurance: boolean;
}

export interface CleanedPayments {
  payments: PosPayment[];
  /** Paid by the customer now. */
  paid_cents: number;
  /** Covered by insurers. */
  insurance_cents: number;
  /** Left for the customer to pay on pickup. */
  balance_cents: number;
}

/** Whether a method may be used in a store. */
export const acceptedAt = (m: PaymentMethodLike, establishmentId: string): boolean =>
  m.is_active && (!m.establishment_ids || m.establishment_ids.length === 0 || m.establishment_ids.includes(establishmentId));

/** Processor fee of a payment, in cents: percentage plus fixed amount. */
export const paymentFee = (m: PaymentMethodLike, amountCents: number): number =>
  amountCents <= 0 ? 0 : Math.round((amountCents * (Number(m.fee_pct) || 0)) / 100) + (Number(m.fee_fixed_cents) || 0);

/**
 * Payments at a sale or when collecting a balance (HU-24, HU-25, HU-113).
 *
 * A deposit and a balance are normal in optics, so the payments may cover
 * part of the total, never more of it (cash change is computed from the amount
 * tendered and recorded, the store keeps `amount`). Each method's required
 * reference data must be there; an insurer's part is recorded apart so the
 * customer's balance and what the insurer owes are seen separately.
 *
 * `dueCents` is what is still to be paid: the total at a sale, the balance
 * when collecting later.
 */
export function cleanPayments(
  input: unknown,
  dueCents: number,
  methods: PaymentMethodLike[],
  opts: { establishmentId: string; requireFull?: boolean; allowInsurance?: boolean } = { establishmentId: "" }
): { reason: string; method?: string } | CleanedPayments {
  const list = Array.isArray(input) ? input : [];
  if (list.length === 0 && dueCents > 0) return { reason: "no_payments" };
  if (list.length > 6) return { reason: "bad_payment" };
  const byCode = new Map(methods.map((m) => [m.code, m]));
  const payments: PosPayment[] = [];
  for (const raw of list as Array<{ method_code?: unknown; amount?: unknown; details?: unknown }>) {
    const method_code = text(raw?.method_code, 40);
    const m = byCode.get(method_code);
    if (!m || !acceptedAt(m, opts.establishmentId)) return { reason: "bad_method", method: method_code };
    const amount = Number(raw?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return { reason: "bad_payment", method: method_code };
    const amount_cents = toCents(amount);
    const insurance = m.kind === "insurance" || m.receivable;
    if (insurance && opts.allowInsurance === false) return { reason: "insurance_at_sale_only", method: method_code };

    const rawDetails = (raw?.details && typeof raw.details === "object" ? raw.details : {}) as Record<string, unknown>;
    const details: Record<string, string | number> = {};
    for (const f of m.reference_fields ?? []) {
      const v = text(rawDetails[f.key], 80);
      if (f.required && !v) return { reason: "missing_reference", method: method_code };
      if (v) details[f.key] = v;
    }
    if (m.counts_as_cash && rawDetails.tendered !== undefined && rawDetails.tendered !== "") {
      const tendered = toCents(rawDetails.tendered);
      if (!Number.isFinite(tendered) || tendered < amount_cents) return { reason: "bad_tendered", method: method_code };
      details.tendered_cents = tendered;
      details.change_cents = tendered - amount_cents;
    }
    const summary = Object.entries(details)
      .filter(([k]) => k !== "tendered_cents" && k !== "change_cents")
      .map(([, v]) => v)
      .join(" · ");
    payments.push({
      method_code,
      amount_cents,
      reference: summary || null,
      details,
      fee_cents: paymentFee(m, amount_cents),
      counts_as_cash: Boolean(m.counts_as_cash),
      insurance,
    });
  }
  const insurance_cents = payments.filter((p) => p.insurance).reduce((s, p) => s + p.amount_cents, 0);
  const paid_cents = payments.filter((p) => !p.insurance).reduce((s, p) => s + p.amount_cents, 0);
  if (paid_cents + insurance_cents > dueCents) return { reason: "overpaid" };
  if (opts.requireFull && paid_cents + insurance_cents !== dueCents) return { reason: "payments_mismatch" };
  return { payments, paid_cents, insurance_cents, balance_cents: dueCents - paid_cents - insurance_cents };
}

// ---------------------------------------------------------------------------
// Prescriptions at the counter
// ---------------------------------------------------------------------------

export const WORN_SOURCES = ["previous_rx", "lensometer", "prior_sale"] as const;
export type WornSource = (typeof WORN_SOURCES)[number];

/**
 * Date and origin of a prescription (HU-120, HU-121). An approximate date
 * ("about 3 years ago") is sent as `approx_months_ago` and turned into a date
 * here, flagged as approximate.
 */
export function cleanRxMeta(
  input: { rx_date?: unknown; approx_months_ago?: unknown; worn_source?: unknown } | null | undefined,
  now = new Date()
): { reason: string } | { rx_date: string | null; rx_date_approx: boolean; worn_source: WornSource | null } {
  const i = input ?? {};
  const source = i.worn_source == null || i.worn_source === "" ? null : String(i.worn_source);
  if (source !== null && !(WORN_SOURCES as readonly string[]).includes(source)) return { reason: "bad_worn_source" };
  const worn_source = source as WornSource | null;

  if (i.approx_months_ago !== undefined && i.approx_months_ago !== null && i.approx_months_ago !== "") {
    const months = Number(i.approx_months_ago);
    if (!Number.isInteger(months) || months < 0 || months > 600) return { reason: "bad_rx_date" };
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
    return { rx_date: d.toISOString().slice(0, 10), rx_date_approx: true, worn_source };
  }
  const raw = i.rx_date == null || i.rx_date === "" ? null : String(i.rx_date);
  if (raw === null) return { rx_date: null, rx_date_approx: false, worn_source };
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw || d > now) return { reason: "bad_rx_date" };
  return { rx_date: raw, rx_date_approx: false, worn_source };
}

/** RX-2026-00812 */
export const rxNumber = (year: number, seq: number): string => `RX-${year}-${String(seq).padStart(5, "0")}`;

/** Op2-POS1 */
export function nextTerminalCode(storeCode: string, existing: string[]): string {
  let max = 0;
  for (const c of existing) {
    const m = new RegExp(`^${storeCode}-POS(\\d+)$`).exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${storeCode}-POS${max + 1}`;
}

/** Lowest tray number not in use: released trays are reused. */
export function lowestFreeTray(inUse: number[]): number {
  const used = new Set(inUse);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Payment method code for one the owner adds: lowercase slug of the label. */
export function methodCodeFor(label: string, taken: string[]): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "method";
  let candidate = base;
  for (let i = 2; taken.includes(candidate); i++) candidate = `${base}-${i}`;
  return candidate;
}

// ---------------------------------------------------------------------------
// Discounts (HU-16, HU-26)
// ---------------------------------------------------------------------------

/** A sale-wide percentage, 0 to 100, two decimals. */
export function cleanDiscountPct(v: unknown): { reason: string } | { pct: number } {
  if (v === undefined || v === null || v === "") return { pct: 0 };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { reason: "bad_discount" };
  return { pct: Math.round(n * 100) / 100 };
}

/**
 * A line after the discount. The percentage applies to the frame and to the
 * lenses alike, before sales tax (the tax is computed on what is charged).
 */
export function discountLine(line: { frame: number; lenses: number }, pct: number): { frame: number; lenses: number; total: number } {
  const off = (v: number) => Math.round(v * (100 - pct)) / 100;
  const frame = off(line.frame);
  const lenses = off(line.lenses);
  return { frame, lenses, total: Math.round((frame + lenses) * 100) / 100 };
}

/**
 * Whether a discount needs the owner or a superadmin: above the person's
 * limit, or taking a line under its minimum price. They never need approval
 * themselves — they are who approves (owner's decision, not delegable).
 */
export function discountNeedsApproval(args: { isAdmin: boolean; pct: number; limitPct: number | null; belowMinimum: boolean }): boolean {
  if (args.isAdmin || args.pct <= 0) return false;
  if (args.limitPct !== null && args.pct > args.limitPct) return true;
  return args.belowMinimum;
}

// ---------------------------------------------------------------------------
// Payment-method settings (HU-111, HU-112)
// ---------------------------------------------------------------------------

export const METHOD_KINDS = ["cash", "debit", "credit", "zelle", "insurance", "other"] as const;

export interface MethodPatch {
  label?: string;
  label_en?: string | null;
  kind?: string;
  receivable?: boolean;
  fee_pct?: number;
  fee_fixed_cents?: number;
  counts_as_cash?: boolean;
  establishment_ids?: string[] | null;
  reference_fields?: Array<{ key: string; label: string | null; label_en: string | null; required: boolean }>;
  is_active?: boolean;
}

/**
 * Validates a payment-method edit. The seeded methods keep their name (it comes
 * from the dictionary, in the chosen language) and their kind; their fee, the
 * stores where they are accepted and whether they are active can change.
 */
export function cleanMethodPatch(
  body: Record<string, unknown> | null | undefined,
  opts: { builtin: boolean; creating: boolean; knownStores: string[] }
): { reason: string } | { patch: MethodPatch } {
  const b = body ?? {};
  const out: MethodPatch = {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  if (!opts.builtin) {
    if (b.label !== undefined || opts.creating) {
      const label = str(b.label, 40);
      if (!label) return { reason: "label_required" };
      out.label = label;
    }
    if (b.label_en !== undefined) out.label_en = str(b.label_en, 40) || null;
    if (b.kind !== undefined) {
      if (!(METHOD_KINDS as readonly string[]).includes(String(b.kind))) return { reason: "bad_kind" };
      out.kind = String(b.kind);
    }
    if (b.receivable !== undefined) out.receivable = b.receivable === true;
    if (b.counts_as_cash !== undefined) out.counts_as_cash = b.counts_as_cash === true;
    if (b.reference_fields !== undefined) {
      if (!Array.isArray(b.reference_fields) || b.reference_fields.length > 6) return { reason: "bad_reference_fields" };
      const fields = [];
      for (const f of b.reference_fields as Array<Record<string, unknown>>) {
        const label = str(f?.label, 40);
        if (!label) return { reason: "bad_reference_fields" };
        const key = str(f?.key, 30) || label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
        if (!/^[a-z0-9_]{1,30}$/.test(key)) return { reason: "bad_reference_fields" };
        fields.push({ key, label, label_en: str(f?.label_en, 40) || null, required: f?.required === true });
      }
      if (new Set(fields.map((f) => f.key)).size !== fields.length) return { reason: "bad_reference_fields" };
      out.reference_fields = fields;
    }
  }
  if (b.fee_pct !== undefined) {
    const n = Number(b.fee_pct);
    if (!Number.isFinite(n) || n < 0 || n > 30) return { reason: "bad_fee" };
    out.fee_pct = Math.round(n * 100) / 100;
  }
  if (b.fee_fixed !== undefined) {
    const n = Number(b.fee_fixed);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { reason: "bad_fee" };
    out.fee_fixed_cents = toCents(n);
  }
  if (b.establishment_ids !== undefined) {
    if (b.establishment_ids === null) out.establishment_ids = null;
    else {
      if (!Array.isArray(b.establishment_ids)) return { reason: "bad_store" };
      const ids = [...new Set(b.establishment_ids.map(String))];
      if (ids.some((id) => !opts.knownStores.includes(id))) return { reason: "bad_store" };
      out.establishment_ids = ids.length ? ids : null;
    }
  }
  if (b.is_active !== undefined) out.is_active = b.is_active === true;
  return { patch: out };
}
