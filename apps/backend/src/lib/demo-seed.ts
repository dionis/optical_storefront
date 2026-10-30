import { createHash } from "crypto";

/**
 * Simulated sales for the staging environment (src/scripts/seed-demo-sales.ts).
 * Pure — no I/O: the guard that keeps it off production, the marker every demo
 * row carries, and the random data it invents.
 *
 * The guard is an allowlist and fails closed: the script writes only to a
 * database listed here by fingerprint. A new staging database has to be added
 * on purpose, in a commit.
 */

/** Marks orders and customers (metadata), and sellers and costs (notes). */
export const DEMO_MARKER = "demo_seed";
export const DEMO_NOTE = "[demo-seed]";
/** `updated_by` / `created_by` of the configuration the seed touches. */
export const DEMO_ACTOR = "demo-seed";
/** Reserved for documentation (RFC 2606): mail to it can never reach anyone. */
export const DEMO_EMAIL_DOMAIN = "example.com";

/** A demo order never leaves the database: no Sheet, no notification. */
export function isDemoOrder(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.[DEMO_MARKER] === true;
}

/** `user@host/db`, hashed: identifies a database without storing its address in the repo. */
export function databaseFingerprint(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  return createHash("sha256").update(`${decodeURIComponent(u.username)}@${u.hostname}/${u.pathname.slice(1)}`).digest("hex");
}

/** What the operator has to type: the host and database of the actual connection. */
export function databaseTarget(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  return `${u.hostname}${u.port ? `:${u.port}` : ""}/${u.pathname.slice(1)}`;
}

/** The only databases that may be seeded: the staging project on Supabase. */
export const STAGING_DATABASES = ["dae9efc426f7950b04a739cb38ee26541d7a30023b8aa496458f8453500a512d"];

/** Never, whatever else is configured: the Supabase project that holds real customers' orders. */
export const FORBIDDEN_DATABASES = ["83d107c093777e8080b9aa14586dfefe31e947dc21a85cd8b37037c75f54e719"];

/** More orders than this that are not ours means live data, not a staging sandbox. */
export const MAX_FOREIGN_ORDERS = 50;

export type DemoRefusal = "bad_database_url" | "forbidden_database" | "not_staging_database" | "live_stripe_key" | "live_notifications" | "too_many_foreign_orders" | "no_stores";

/** Credentials that would make a subscriber reach someone. */
export const NOTIFICATION_VARS = ["RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "GSHEET_SERVICE_ACCOUNT_KEY", "GSHEET_FILE_URL", "GSHEET_SPREADSHEET_ID"];

const isLoopback = (host: string) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);

export interface GuardInput {
  databaseUrl: string | null | undefined;
  stripeKey?: string | null;
  /**
   * The process's env. `medusa exec` runs subscribers, so each sale fires
   * order.placed: with mail, SMS or Sheet credentials loaded it would really
   * notify the administrators. They have to be empty for the run.
   */
  env?: Record<string, string | undefined>;
  /** Live orders that are not demo ones; null = not read yet. */
  foreignOrders?: number | null;
  /** Active stores with a sales channel; null = not read yet. */
  stores?: number | null;
}

/**
 * Null only when this is provably the staging database (or a throwaway one on
 * this machine, for testing the script). The first checks need no connection;
 * the script calls it again once it can count.
 */
export function demoSeedRefusal(input: GuardInput): DemoRefusal | null {
  let url: URL;
  let fingerprint: string;
  try {
    url = new URL(String(input.databaseUrl ?? ""));
    fingerprint = databaseFingerprint(url.toString());
  } catch {
    return "bad_database_url";
  }
  if (FORBIDDEN_DATABASES.includes(fingerprint)) return "forbidden_database";
  if (!STAGING_DATABASES.includes(fingerprint) && !isLoopback(url.hostname)) return "not_staging_database";
  if (/^(sk|rk)_live_/.test(String(input.stripeKey ?? ""))) return "live_stripe_key";
  if (input.env && NOTIFICATION_VARS.some((k) => input.env?.[k]?.trim())) return "live_notifications";
  if (input.foreignOrders != null && input.foreignOrders > MAX_FOREIGN_ORDERS) return "too_many_foreign_orders";
  if (input.stores != null && input.stores < 1) return "no_stores";
  return null;
}

/** Only an exact match of the real connection's target writes; anything else is a dry run. */
export function demoSeedConfirmed(databaseUrl: string, confirm: string | undefined): boolean {
  return Boolean(confirm) && confirm === databaseTarget(databaseUrl);
}

// ---------------------------------------------------------------------------
// Random data: seeded, so two runs tell the same story
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** mulberry32 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
export const between = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

/** A key of `weights`, in proportion to its weight. */
export function weighted<K extends string>(rng: Rng, weights: Record<K, number>): K {
  const entries = Object.entries(weights) as Array<[K, number]>;
  let r = rng() * entries.reduce((s, [, w]) => s + (w as number), 0);
  for (const [k, w] of entries) {
    r -= w as number;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** How busy a weekday is (0 = Sunday, closed; Saturday is the busiest). */
export const WEEKDAY_WEIGHT = [0, 0.8, 0.9, 1, 1, 1.3, 1.7];

/**
 * Sales per day of a store, oldest first: `total` spread by weekday with a
 * slight upward trend. The last day always has at least one, so "today" is
 * never empty on the dashboards.
 */
export function salesPerDay(rng: Rng, weekdays: number[], total: number): number[] {
  const weights = weekdays.map((w, i) => WEEKDAY_WEIGHT[w] * (0.8 + (0.4 * i) / Math.max(1, weekdays.length - 1)));
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const counts = weights.map((w) => {
    const expected = (w / sum) * total;
    return Math.floor(expected) + (rng() < expected - Math.floor(expected) ? 1 : 0);
  });
  if (counts.length && counts[counts.length - 1] === 0) counts[counts.length - 1] = 1;
  return counts;
}

const FIRST = ["María", "José", "Ana", "Luis", "Carmen", "Carlos", "Rosa", "Juan", "Elena", "Miguel", "Sofía", "Pedro", "Laura", "Andrés", "Isabel", "Diego", "Patricia", "Javier", "Lucía", "Roberto", "Gabriela", "Fernando", "Valeria", "Ricardo", "Daniela", "Héctor", "Natalia", "Manuel", "Paula", "Óscar"];
const LAST = ["García", "Rodríguez", "Martínez", "Hernández", "López", "González", "Pérez", "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz", "Reyes", "Morales", "Cruz", "Ortiz", "Gutiérrez", "Chávez", "Ramos", "Vargas", "Castillo", "Jiménez", "Mendoza", "Silva", "Rojas", "Medina", "Aguilar", "Herrera"];
const STREETS = ["Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Elm St", "Pine Rd", "Lakeview Dr", "Sunset Blvd"];
const CITIES = [
  { city: "Houston", province: "TX", postal_code: "77002" },
  { city: "Dallas", province: "TX", postal_code: "75201" },
  { city: "San Antonio", province: "TX", postal_code: "78205" },
  { city: "Austin", province: "TX", postal_code: "78701" },
];

const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** 555-01xx numbers are reserved for fiction: they never reach a real phone. */
export const demoPhone = (rng: Rng): string => `+1 (713) 555-01${String(between(rng, 0, 99)).padStart(2, "0")}`;

export interface DemoPerson {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  birth_date: string;
}

/** `n` makes the address unique: there are more customers than names. */
export function demoPerson(rng: Rng, n: number, now = new Date()): DemoPerson {
  const first_name = pick(rng, FIRST);
  const last_name = pick(rng, LAST);
  const year = now.getUTCFullYear() - between(rng, 18, 78);
  const birth_date = `${year}-${String(between(rng, 1, 12)).padStart(2, "0")}-${String(between(rng, 1, 28)).padStart(2, "0")}`;
  return { first_name, last_name, email: `${ascii(first_name)}.${ascii(last_name)}.${n}@${DEMO_EMAIL_DOMAIN}`, phone: demoPhone(rng), birth_date };
}

export function demoAddress(rng: Rng) {
  return { address_1: `${between(rng, 100, 9800)} ${pick(rng, STREETS)}`, ...pick(rng, CITIES), country_code: "us" };
}

const step = (rng: Rng, min: number, max: number): number => between(rng, Math.round(min * 4), Math.round(max * 4)) / 4;

export interface DemoEye {
  sph: number;
  cyl: number;
  axis: number | null;
  add: number | null;
  prism: null;
  base: null;
}

export interface DemoRx {
  od: DemoEye;
  os: DemoEye;
  pd: number;
  pd_od: null;
  pd_os: null;
  seg_height: number | null;
  source: "manual";
  verified_by_user: true;
  file_url: null;
}

/** A plausible prescription; `multifocal` adds the ADD and the fitting height. */
export function demoRx(rng: Rng, multifocal: boolean): DemoRx {
  const base = rng() < 0.75 ? step(rng, -5.5, -0.5) : step(rng, 0.5, 3.5);
  const add = multifocal ? step(rng, 1, 2.75) : null;
  const eye = (): DemoEye => {
    const cyl = rng() < 0.65 ? step(rng, -2, -0.25) : 0;
    return { sph: Math.round((base + step(rng, -0.5, 0.5)) * 4) / 4, cyl, axis: cyl === 0 ? null : between(rng, 1, 180), add, prism: null, base: null };
  };
  return { od: eye(), os: eye(), pd: between(rng, 58, 70), pd_od: null, pd_os: null, seg_height: multifocal ? between(rng, 16, 22) : null, source: "manual", verified_by_user: true, file_url: null };
}

/** The same eyes a while ago: usually a little less graduated. */
export function olderRx(rng: Rng, rx: DemoRx): DemoRx {
  const shift = (sph: number) => Math.round((sph + (sph < 0 ? 1 : -1) * step(rng, 0, 0.75)) * 4) / 4;
  return { ...rx, od: { ...rx.od, sph: shift(rx.od.sph) }, os: { ...rx.os, sph: shift(rx.os.sph) } };
}

/** Largest power of the prescription, which decides the thinnest material it needs. */
export const rxPower = (rx: DemoRx): number => Math.max(Math.abs(rx.od.sph), Math.abs(rx.os.sph), Math.abs(rx.od.cyl), Math.abs(rx.os.cyl));

/** The real store's sale mix. */
export const SCENARIO_WEIGHTS = { sv_basic: 34, sv_premium: 12, bifocal: 8, progressive: 18, insurance: 10, own_frame: 9, frame_only: 9 };
export type Scenario = keyof typeof SCENARIO_WEIGHTS;

/** What the store pays a supplier, in dollars (Costs tab rules left at zero). */
export const DEMO_RULE_COSTS: Record<string, Record<string, number>> = {
  lens_design: { sv: 8, bifocal: 16, "prog-mid": 30, "prog-high": 45 },
  lens_material: { cr39: 3, poly: 6, "1.67": 16, "1.74": 30 },
  order_fixed: { lab: 12, packaging: 2.5 },
};
export const DEMO_PHOTO_COST = 22;
export const DEMO_AR_COST = 9;
export const DEMO_FRAME_COST = 28;

/** Processor fees of the till's methods, when the owner has not set any. */
export const DEMO_METHOD_FEES: Record<string, { fee_pct: number; fee_fixed_cents: number }> = {
  credit: { fee_pct: 2.9, fee_fixed_cents: 30 },
  debit: { fee_pct: 1.5, fee_fixed_cents: 10 },
};

/**
 * One store's costs. `scale` varies them from store to store; a family, partner
 * or consignment store pays no rent to the business.
 */
export function demoCostItems(kind: string, scale: number, startsOn: string) {
  const c = (dollars: number) => Math.round(dollars * scale);
  return [
    ...(kind === "own" ? [{ kind: "fixed", category: "rent", description: "Alquiler del local", amount: c(1850), frequency: "monthly", vendor: "Plaza Inmobiliaria LLC" }] : []),
    { kind: "fixed", category: "salaries", description: "Nómina del equipo", amount: c(4200), frequency: "monthly", vendor: null },
    { kind: "fixed", category: "utilities", description: "Luz, agua e internet", amount: c(340), frequency: "monthly", vendor: "CenterPoint Energy" },
    { kind: "fixed", category: "insurance", description: "Seguro del local", amount: c(540), frequency: "quarterly", vendor: "Lone Star Insurance" },
    { kind: "fixed", category: "licenses", description: "Licencia de óptica", amount: c(1200), frequency: "annual", vendor: "Estado de Texas" },
    { kind: "fixed", category: "equipment", description: "Biseladora (a 12 meses)", amount: c(3600), frequency: "one_time", amortize_months: 12, vendor: "Optical Supply Co." },
    { kind: "variable", category: "supplies", description: "Estuches, paños y limpiador", amount: c(165), frequency: "monthly", vendor: "Optical Supply Co." },
    { kind: "variable", category: "remakes", description: "Lentes rehechos", amount: c(95), frequency: "monthly", vendor: null },
  ].map((i) => ({ amortize_months: null, ...i, establishment_id: null as string | null, starts_on: startsOn, ends_on: null, notes: DEMO_NOTE }));
}
