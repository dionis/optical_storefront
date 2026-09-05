/**
 * The spending configuration: the ladder, the three ceilings, and the video scope.
 *
 * Resolution mirrors `resolveOcrSettings` — the stored row wins, the environment
 * fills the gaps, and a deployment with no row still works. What differs is that
 * everything here gates a spend, so the resolver also computes what has already
 * been spent and whether the next asset is allowed at all.
 */
import { MedusaContainer } from "@medusajs/framework/types";
import { FRAME_MEDIA_MODULE } from "../modules/frame-media/index";
import type FrameMediaModuleService from "../modules/frame-media/service";

export const FRAME_MEDIA_BUDGET_ID = "default";

export interface FrameMediaSettings {
  tier: number;
  monthly_ceiling_usd_views: number;
  monthly_ceiling_usd_video: number;
  daily_ceiling_usd: number;
  max_batch_per_run: number;
  max_concurrency: number;
  video_scope: "list" | "all";
  video_sku_list: string[];
  video_unit: "product" | "colorway";
  video_prompt: string | null;
  image_model_id: string;
  video_model_id: string;
  source: "database" | "environment";
  updated_by?: string | null;
}

/**
 * The ladder. A level never rises on its own: each step is an explicit admin
 * action, recorded with `updated_by`, and only offered once its condition holds.
 *
 * The conditions are objective on purpose — "≥90% accepted" and "cost within
 * 10% of estimate" are read off the assets table, not off an impression. The
 * panel shows the pending condition next to the disabled button so an operator
 * sees WHAT is missing, not merely that they cannot proceed.
 */
export interface Tier {
  level: number;
  /** Dictionary key, never prose: this module cannot know the language. */
  label_key: string;
  monthly_ceiling_usd_views: number;
  monthly_ceiling_usd_video: number;
  /** Max frames a single run may touch at this level. null = unlimited. */
  max_frames: number | null;
  /** Machine-readable gate for the NEXT level; the panel renders the wording. */
  advance_condition_key: string;
}

export const TIERS: Tier[] = [
  {
    level: 0,
    label_key: "adm.media.tier.0",
    monthly_ceiling_usd_views: 5,
    monthly_ceiling_usd_video: 2,
    max_frames: 2,
    advance_condition_key: "adm.media.tierCond.calibrated",
  },
  {
    level: 1,
    label_key: "adm.media.tier.1",
    monthly_ceiling_usd_views: 15,
    monthly_ceiling_usd_video: 0,
    max_frames: 20,
    advance_condition_key: "adm.media.tierCond.pilotBrand",
  },
  {
    level: 2,
    label_key: "adm.media.tier.2",
    monthly_ceiling_usd_views: 40,
    monthly_ceiling_usd_video: 10,
    max_frames: 70,
    advance_condition_key: "adm.media.tierCond.pilotFull",
  },
  {
    level: 3,
    label_key: "adm.media.tier.3",
    monthly_ceiling_usd_views: Number(process.env.FRAME_MEDIA_MONTHLY_USD_VIEWS ?? 60),
    monthly_ceiling_usd_video: Number(process.env.FRAME_MEDIA_MONTHLY_USD_VIDEO ?? 40),
    max_frames: null,
    advance_condition_key: "adm.media.tierCond.none",
  },
];

export function tierFor(level: number): Tier {
  return TIERS.find((t) => t.level === level) ?? TIERS[0];
}

function envDefaults(): FrameMediaSettings {
  const level = Number(process.env.FRAME_MEDIA_TIER ?? 0);
  const tier = tierFor(Number.isFinite(level) ? level : 0);
  return {
    tier: tier.level,
    monthly_ceiling_usd_views: tier.monthly_ceiling_usd_views,
    monthly_ceiling_usd_video: tier.monthly_ceiling_usd_video,
    daily_ceiling_usd: Number(process.env.FRAME_MEDIA_DAILY_USD ?? 10),
    max_batch_per_run: Number(process.env.FRAME_MEDIA_BATCH ?? 8),
    max_concurrency: Number(process.env.FRAME_MEDIA_CONCURRENCY ?? 2),
    video_scope: "list",
    video_sku_list: [],
    video_unit: "product",
    video_prompt: null,
    image_model_id: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",
    video_model_id: process.env.GEMINI_VIDEO_MODEL ?? "veo-3.1-fast-generate-preview",
    source: "environment",
  };
}

/**
 * Effective settings. A stored tier still reads its ceilings from TIERS rather
 * than from the row, so tightening the ladder in code takes effect immediately
 * instead of waiting for somebody to re-save — the same reasoning that makes
 * `resolveOcrSettings` re-check its allowlist on every read.
 */
export async function resolveFrameMediaSettings(
  container: MedusaContainer
): Promise<FrameMediaSettings> {
  const defaults = envDefaults();

  let rows: Record<string, unknown>[] = [];
  try {
    const svc = container.resolve<FrameMediaModuleService>(FRAME_MEDIA_MODULE);
    rows = (await svc.listFrameMediaBudgets({
      id: FRAME_MEDIA_BUDGET_ID,
    })) as unknown as Record<string, unknown>[];
  } catch {
    // Module unavailable or the table has not been migrated yet — env wins.
    return defaults;
  }

  const row = rows[0];
  if (!row) return defaults;

  const level = Number(row["tier"] ?? defaults.tier);
  const tier = tierFor(Number.isFinite(level) ? level : 0);

  return {
    tier: tier.level,
    monthly_ceiling_usd_views: tier.monthly_ceiling_usd_views,
    monthly_ceiling_usd_video: tier.monthly_ceiling_usd_video,
    daily_ceiling_usd: Number(row["daily_ceiling_usd"] ?? defaults.daily_ceiling_usd),
    max_batch_per_run: Number(row["max_batch_per_run"] ?? defaults.max_batch_per_run),
    max_concurrency: Number(row["max_concurrency"] ?? defaults.max_concurrency),
    video_scope: (row["video_scope"] as "list" | "all") ?? "list",
    video_sku_list: Array.isArray(row["video_sku_list"])
      ? (row["video_sku_list"] as string[])
      : [],
    video_unit: (row["video_unit"] as "product" | "colorway") ?? "product",
    video_prompt: (row["video_prompt"] as string | null) ?? null,
    image_model_id: (row["image_model_id"] as string) || defaults.image_model_id,
    video_model_id: (row["video_model_id"] as string) || defaults.video_model_id,
    source: "database",
    updated_by: (row["updated_by"] as string | null) ?? null,
  };
}

export interface SpendWindow {
  month_to_date_usd: number;
  today_usd: number;
  by_kind: Record<string, number>;
}

/**
 * What has actually been spent, from the receipts — not from an estimate.
 *
 * Counts every asset with a recorded cost, including failed ones: a request that
 * came back unusable was still billed, and a ceiling that ignores those is a
 * ceiling that can be walked straight through by a run that fails a lot.
 */
export async function resolveSpend(container: MedusaContainer): Promise<SpendWindow> {
  const empty: SpendWindow = { month_to_date_usd: 0, today_usd: 0, by_kind: {} };
  let rows: Record<string, unknown>[] = [];
  try {
    const svc = container.resolve<FrameMediaModuleService>(FRAME_MEDIA_MODULE);
    rows = (await svc.listFrameMediaAssets(
      {},
      { select: ["kind", "cost_usd", "finished_at"], take: null }
    )) as unknown as Record<string, unknown>[];
  } catch {
    return empty;
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  return rows.reduce<SpendWindow>((acc, row) => {
    const cost = Number(row["cost_usd"] ?? 0);
    if (!cost) return acc;
    const finished = row["finished_at"] ? new Date(row["finished_at"] as string) : null;
    if (!finished) return acc;
    if (finished >= monthStart) {
      acc.month_to_date_usd = round2(acc.month_to_date_usd + cost);
      const kind = String(row["kind"]);
      acc.by_kind[kind] = round2((acc.by_kind[kind] ?? 0) + cost);
    }
    if (finished >= dayStart) acc.today_usd = round2(acc.today_usd + cost);
    return acc;
  }, structuredClone(empty));
}

export type BudgetVerdict =
  | { allowed: true; remaining_usd: number }
  | { allowed: false; reason: "monthly_ceiling" | "daily_ceiling" | "tier_locked"; remaining_usd: number };

/**
 * Whether one more batch of this size may run.
 *
 * Enforced HERE, on the server, at claim time — never in the panel or the CLI.
 * The estimate a client shows is informative; this is the decision.
 */
export function checkBudget(input: {
  settings: FrameMediaSettings;
  spend: SpendWindow;
  kind: "view" | "video" | "model3d";
  estimatedUsd: number;
  frames?: number;
}): BudgetVerdict {
  // 3D costs no API money — it is a work order, not a generation. Never blocked.
  if (input.kind === "model3d") return { allowed: true, remaining_usd: Infinity };

  const tier = tierFor(input.settings.tier);
  if (input.frames != null && tier.max_frames != null && input.frames > tier.max_frames) {
    return { allowed: false, reason: "tier_locked", remaining_usd: 0 };
  }

  const monthlyCeiling =
    input.kind === "video"
      ? input.settings.monthly_ceiling_usd_video
      : input.settings.monthly_ceiling_usd_views;
  const spentThisKind = input.spend.by_kind[input.kind] ?? 0;
  const monthlyRemaining = monthlyCeiling - spentThisKind;
  if (input.estimatedUsd > monthlyRemaining) {
    return {
      allowed: false,
      reason: "monthly_ceiling",
      remaining_usd: Math.max(0, round2(monthlyRemaining)),
    };
  }

  const dailyRemaining = input.settings.daily_ceiling_usd - input.spend.today_usd;
  if (input.estimatedUsd > dailyRemaining) {
    return {
      allowed: false,
      reason: "daily_ceiling",
      remaining_usd: Math.max(0, round2(dailyRemaining)),
    };
  }

  return {
    allowed: true,
    remaining_usd: round2(Math.min(monthlyRemaining, dailyRemaining)),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
