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
}

export interface PosPayment {
  method_code: string;
  amount_cents: number;
  reference: string | null;
}

/**
 * Payments must cover the total exactly: no partial payments yet (the owner
 * has not decided on deposits), and no change — cash change is the clerk's,
 * the sale records what the store keeps.
 */
export function cleanPayments(
  input: unknown,
  totalCents: number,
  methods: PaymentMethodLike[]
): { reason: string } | { payments: PosPayment[] } {
  if (!Array.isArray(input) || input.length === 0) return { reason: "no_payments" };
  if (input.length > 6) return { reason: "bad_payment" };
  const active = new Map(methods.filter((m) => m.is_active).map((m) => [m.code, m]));
  const payments: PosPayment[] = [];
  for (const raw of input as Array<{ method_code?: unknown; amount?: unknown; reference?: unknown }>) {
    const method_code = text(raw?.method_code, 40);
    if (!active.has(method_code)) return { reason: "bad_method" };
    const amount = Number(raw?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return { reason: "bad_payment" };
    payments.push({ method_code, amount_cents: toCents(amount), reference: text(raw?.reference, 80) || null });
  }
  const paid = payments.reduce((s, p) => s + p.amount_cents, 0);
  if (paid !== totalCents) return { reason: "payments_mismatch" };
  return { payments };
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
