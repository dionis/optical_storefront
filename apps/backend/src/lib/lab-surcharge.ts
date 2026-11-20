/**
 * LAB SURCHARGES FOR HIGH POWERS (owner, 18-nov-2026: «cuando la base
 * positiva es por encima de +6 el costo de laboratorio aumenta en 30; debe
 * poder configurarse en la app, según referencias internacionales»). Pure.
 *
 * Labs price lenses for a standard range and add a fee beyond it ("extended
 * range" / "high power" surcharges in Essilor, Zeiss, Hoya and Shamir lab price
 * lists): high plus and high minus spheres, high cylinders, high additions and
 * prism. Here each rule is one such fee, on the LAB COST of the job (what the
 * store pays), set by the owner in Configuración del POS
 * (`pos_setting.lab_surcharges`, migration CreatePos12):
 *
 *   { id, label, scope: "sph" | "cyl" | "add" | "prism", op: "gt" | "lt",
 *     threshold, cost (dollars), active }
 *
 *  - It applies to the job when EITHER eye passes the threshold (a lab charges
 *    the pair). The cylinder and the prism are compared in absolute value
 *    (−4.25 and +4.25 are the same cylinder in the two notations).
 *  - TIERS: rules on the same power and in the same direction are steps of one
 *    surcharge, and only the furthest step reached counts (a +8.50 sphere pays
 *    the «> +8.00» fee, not «> +6.00» plus «> +8.00»).
 *  - Only the owner's first rule ships switched on (> +6.00 sphere, $30); the
 *    others are the usual steps, switched off for him to price and enable.
 *
 * The surcharge is worked out when the sale is projected for the reports
 * (lib/sale-facts.ts → `sale_fact.lab_surcharge_cents`) and is part of the
 * lenses' cost in the books (lib/financial-statement.ts) and in the Executive
 * (lib/sales-insights.ts). The patient's price does not change.
 */

export const SURCHARGE_SCOPES = ["sph", "cyl", "add", "prism"] as const;
export type SurchargeScope = (typeof SURCHARGE_SCOPES)[number];
export type SurchargeOp = "gt" | "lt";

export interface LabSurcharge {
  id: string;
  label: string;
  scope: SurchargeScope;
  op: SurchargeOp;
  threshold: number;
  /** Added to the lab cost of the job, in dollars. */
  cost: number;
  active: boolean;
}

export const DEFAULT_LAB_SURCHARGES: LabSurcharge[] = [
  { id: "plus-6", label: "Base positiva alta (más de +6.00)", scope: "sph", op: "gt", threshold: 6, cost: 30, active: true },
  { id: "plus-8", label: "Base positiva muy alta (más de +8.00)", scope: "sph", op: "gt", threshold: 8, cost: 45, active: false },
  { id: "minus-6", label: "Negativa alta (más de −6.00)", scope: "sph", op: "lt", threshold: -6, cost: 20, active: false },
  { id: "minus-10", label: "Negativa muy alta (más de −10.00)", scope: "sph", op: "lt", threshold: -10, cost: 40, active: false },
  { id: "cyl-4", label: "Cilindro alto (más de 4.00 D)", scope: "cyl", op: "gt", threshold: 4, cost: 25, active: false },
  { id: "add-3", label: "Adición alta (más de +3.00)", scope: "add", op: "gt", threshold: 3, cost: 10, active: false },
  { id: "prism", label: "Prisma (cualquier valor)", scope: "prism", op: "gt", threshold: 0, cost: 15, active: false },
];

export const MAX_SURCHARGES = 20;
const LIMITS: Record<SurchargeScope, [number, number]> = { sph: [-30, 30], cyl: [0, 10], add: [0, 4], prism: [0, 15] };

/** Validation of the owner's list; a reason code or null. */
export function surchargesDenied(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length > MAX_SURCHARGES) return "bad_surcharges";
  const ids = new Set<string>();
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") return "bad_surcharges";
    const id = String(r.id ?? "").trim();
    const label = String(r.label ?? "").trim();
    if (!/^[a-z0-9-]{1,40}$/.test(id) || ids.has(id)) return "bad_surcharges";
    ids.add(id);
    if (!label || label.length > 80) return "bad_surcharges";
    if (!(SURCHARGE_SCOPES as readonly string[]).includes(String(r.scope))) return "bad_surcharges";
    if (r.op !== "gt" && r.op !== "lt") return "bad_surcharges";
    const th = Number(r.threshold);
    const [lo, hi] = LIMITS[r.scope as SurchargeScope];
    if (!Number.isFinite(th) || th < lo || th > hi) return "bad_surcharges";
    // A cylinder, an addition or a prism is compared in absolute value: only «more than».
    if (r.scope !== "sph" && r.op !== "gt") return "bad_surcharges";
    const cost = Number(r.cost);
    if (!Number.isFinite(cost) || cost < 0 || cost > 1000) return "bad_surcharges";
  }
  return null;
}

/** The stored list → rules (bad or missing → the defaults). */
export function normalizeSurcharges(raw: unknown): LabSurcharge[] {
  if (raw == null || surchargesDenied(raw)) return DEFAULT_LAB_SURCHARGES.map((r) => ({ ...r }));
  return (raw as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id).trim(),
    label: String(r.label).trim(),
    scope: r.scope as SurchargeScope,
    op: r.op as SurchargeOp,
    threshold: Math.round(Number(r.threshold) * 100) / 100,
    cost: Math.round(Number(r.cost) * 100) / 100,
    active: r.active !== false,
  }));
}

export interface EyePower {
  sph?: number | null;
  cyl?: number | null;
  add?: number | null;
  prism?: number | null;
}

const valueOf = (eye: EyePower | null | undefined, scope: SurchargeScope): number | null => {
  const v = eye?.[scope];
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  return scope === "sph" ? Number(v) : Math.abs(Number(v));
};

const passes = (v: number | null, r: LabSurcharge) => v !== null && (r.op === "gt" ? v > r.threshold : v < r.threshold);

/**
 * The surcharges a prescription's job pays (either eye passes; per power and
 * direction only the furthest step), in cents, with what was applied.
 */
export function surchargeFor(rx: { od?: EyePower | null; os?: EyePower | null } | null | undefined, rules: readonly LabSurcharge[]): { cents: number; applied: Array<{ id: string; label: string; cents: number }> } {
  if (!rx) return { cents: 0, applied: [] };
  const best = new Map<string, LabSurcharge>();
  for (const r of rules) {
    if (!r.active || !(r.cost > 0)) continue;
    if (!passes(valueOf(rx.od, r.scope), r) && !passes(valueOf(rx.os, r.scope), r)) continue;
    const key = `${r.scope}:${r.op}`;
    const cur = best.get(key);
    const further = !cur || (r.op === "gt" ? r.threshold > cur.threshold : r.threshold < cur.threshold);
    if (further) best.set(key, r);
  }
  const applied = [...best.values()].map((r) => ({ id: r.id, label: r.label, cents: Math.round(r.cost * 100) }));
  return { cents: applied.reduce((a, x) => a + x.cents, 0), applied };
}
