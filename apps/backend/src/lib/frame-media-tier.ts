/**
 * Whether the spending ladder may be climbed, measured rather than judged.
 *
 * The conditions in §6 of the plan are deliberately objective — "≥90% accepted",
 * "cost within 10% of estimate" — so this reads them off the assets table. The
 * panel renders each check next to the disabled button, so an operator sees WHAT
 * is missing rather than merely that they cannot proceed.
 *
 * Nothing here advances a tier on its own. It only reports eligibility; the
 * change is always an explicit admin action recorded with `updated_by`.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { FRAME_MEDIA_MODULE } from "../modules/frame-media/index";
import type FrameMediaModuleService from "../modules/frame-media/service";
import {
  PILOT_CONTROL_HANDLES,
  PILOT_HANDLES,
  pilotHandlesForBrand,
} from "./frame-media-pilot";
import { viewCostUsd } from "./frame-media-cost";

/** Views accepted, out of views attempted. */
const PASS_RATE = 0.9;
/** How far actual spend may drift from the estimate before the model is untrusted. */
const COST_DRIFT = 0.1;
/** The rear view is measured on its own: it is the angle that invents frames. */
const BACK_PASS_RATE = 0.75;

export interface TierCheck {
  /** Dictionary key. This module cannot know the language. */
  key: string;
  passed: boolean;
  /** Measured value and the threshold, so the panel can show "0.82 / 0.90". */
  value: number | null;
  threshold: number;
  /** How many assets the measurement is based on — a rate over 3 items is noise. */
  sample: number;
}

export interface TierEligibility {
  current: number;
  next: number | null;
  eligible: boolean;
  checks: TierCheck[];
}

interface AssetRow {
  product_handle: string;
  kind: string;
  slot: string | null;
  status: string;
  cost_usd: number | null;
}

function rate(done: number, failed: number): number | null {
  const total = done + failed;
  return total === 0 ? null : done / total;
}

/**
 * Reads the whole assets table once. At catalogue scale that is 5,760 rows of
 * five columns — small enough to aggregate in memory, and it keeps every check
 * below reading the same consistent snapshot instead of racing each other.
 */
async function loadAssets(container: MedusaContainer): Promise<AssetRow[]> {
  try {
    const svc = container.resolve<FrameMediaModuleService>(FRAME_MEDIA_MODULE);
    return (await svc.listFrameMediaAssets(
      {},
      { select: ["product_handle", "kind", "slot", "status", "cost_usd"], take: null }
    )) as unknown as AssetRow[];
  } catch {
    return [];
  }
}

function tally(rows: AssetRow[], handles?: string[], slot?: string) {
  const scope = new Set(handles ?? []);
  let done = 0;
  let failed = 0;
  let cost = 0;
  for (const row of rows) {
    if (row.kind !== "view") continue;
    if (handles && !scope.has(row.product_handle)) continue;
    if (slot && row.slot !== slot) continue;
    if (row.status === "done") {
      done += 1;
      cost += row.cost_usd ?? 0;
    } else if (row.status === "failed") {
      failed += 1;
      cost += row.cost_usd ?? 0; // a failed request was still billed
    }
  }
  return { done, failed, cost };
}

export async function evaluateTier(
  container: MedusaContainer,
  current: number
): Promise<TierEligibility> {
  const rows = await loadAssets(container);
  const next = current >= 3 ? null : current + 1;
  const checks: TierCheck[] = [];

  if (next === 1) {
    // Calibration: two frames generated and PRICED. The gate is not "it worked",
    // it is "we now know what it costs" — which is the entire purpose of phase 0.
    const all = tally(rows);
    const priced = rows.filter(
      (r) => r.kind === "view" && r.status === "done" && r.cost_usd != null
    ).length;
    checks.push({
      key: "adm.media.tierCond.calibrated",
      passed: priced >= 8,
      value: priced,
      threshold: 8,
      sample: all.done + all.failed,
    });
  }

  if (next === 2) {
    const brand = pilotHandlesForBrand("simplylite");
    const t = tally(rows, brand);
    const r = rate(t.done, t.failed);
    checks.push({
      key: "adm.media.tierCond.pilotBrand",
      passed: (r ?? 0) >= PASS_RATE && t.done + t.failed >= 100,
      value: r,
      threshold: PASS_RATE,
      sample: t.done + t.failed,
    });
  }

  if (next === 3) {
    const t = tally(rows, PILOT_HANDLES);
    const overall = rate(t.done, t.failed);
    checks.push({
      key: "adm.media.tierCond.pilotFull",
      passed: (overall ?? 0) >= PASS_RATE && t.done + t.failed >= 500,
      value: overall,
      threshold: PASS_RATE,
      sample: t.done + t.failed,
    });

    const controls = tally(rows, PILOT_CONTROL_HANDLES);
    const controlRate = rate(controls.done, controls.failed);
    checks.push({
      key: "adm.media.tierCond.controls",
      passed: (controlRate ?? 0) >= PASS_RATE && controls.done + controls.failed >= 40,
      value: controlRate,
      threshold: PASS_RATE,
      sample: controls.done + controls.failed,
    });

    const back = tally(rows, PILOT_HANDLES, "back");
    const backRate = rate(back.done, back.failed);
    checks.push({
      key: "adm.media.tierCond.backView",
      passed: (backRate ?? 0) >= BACK_PASS_RATE && back.done + back.failed >= 100,
      value: backRate,
      threshold: BACK_PASS_RATE,
      sample: back.done + back.failed,
    });

    // A cost model that cannot predict the pilot cannot be trusted to authorise
    // the catalogue, which is 10x the money on the same arithmetic.
    const attempted = t.done + t.failed;
    const expected = viewCostUsd() * attempted;
    const drift = expected > 0 ? Math.abs(t.cost - expected) / expected : null;
    checks.push({
      key: "adm.media.tierCond.costDrift",
      passed: drift != null && drift < COST_DRIFT,
      value: drift,
      threshold: COST_DRIFT,
      sample: attempted,
    });
  }

  return {
    current,
    next,
    eligible: next != null && checks.length > 0 && checks.every((c) => c.passed),
    checks,
  };
}
