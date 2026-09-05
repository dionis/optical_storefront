/**
 * Unit tests for generated-media identity, freshness and cost.
 *
 * These are the two things CLAUDE.md says must be covered — validation and
 * pricing — and here they are the same thing: every rule below either stops the
 * pipeline paying twice for an asset it already has, or decides how much a batch
 * is about to cost. Both are pure functions, no database and no HTTP, so they
 * are pinned here rather than discovered on a bill.
 */
import {
  CLAIMABLE,
  MAX_ATTEMPTS,
  canTransition,
  colorSlug,
  fingerprint,
  isRetryable,
  leaseExpired,
  leaseUntil,
  medusaHandle,
  nextStatusForFingerprint,
  outputKey,
  sha256,
  slotsFor,
} from "../src/lib/frame-media";
import {
  estimateBatch,
  imageCostFromTokens,
  videoCostUsd,
  videoRateUsd,
  viewCostUsd,
} from "../src/lib/frame-media-cost";
import { checkBudget, tierFor, TIERS } from "../src/lib/frame-media-settings";

describe("identity: R2 keys follow the scraper's existing convention", () => {
  it("puts views under products/{handle}/views with the try-on colour slug", () => {
    expect(
      outputKey({
        kind: "view",
        handle: "dc-50-di-caprio",
        colorway: "Light Blue",
        slot: "front",
      })
    ).toBe("products/dc-50-di-caprio/views/dc-50-di-caprio_light_blue_front.webp");
  });

  it("uses the same colour slug images.py uses for try-on assets", () => {
    // images.py: `color.lower().replace(' ', '_')`
    expect(colorSlug("Black Antique Tortoise")).toBe("black_antique_tortoise");
    expect(colorSlug(null)).toBe("default");
  });

  it("keeps video and 3D on their own prefixes", () => {
    expect(
      outputKey({ kind: "video", handle: "sl107-simplylite", colorway: "Silver", slot: null })
    ).toBe("products/sl107-simplylite/video/sl107-simplylite_silver.mp4");
    expect(
      outputKey({ kind: "model3d", handle: "sl107-simplylite", colorway: "Silver", slot: null })
    ).toBe("models/sl107-simplylite/sl107-simplylite_silver.glb");
  });
});

describe("identity: the Medusa handle, not the storefront seed slug", () => {
  // parser.py:193 replaces runs of non-alphanumerics with a hyphen; the
  // storefront seed (products.js) DELETES them. Four pilot SKUs have a space, so
  // using the wrong rule silently drops 6% of the cohort.
  it("replaces separators rather than deleting them", () => {
    expect(medusaHandle("DC 50", "di-caprio")).toBe("dc-50-di-caprio");
    expect(medusaHandle("DC400 CLIP", "di-caprio")).toBe("dc400-clip-di-caprio");
    expect(medusaHandle("SL107", "simplylite")).toBe("sl107-simplylite");
  });
});

describe("freshness: never pay twice for the same input", () => {
  const bytes = Buffer.from("a frame photograph");
  const fpA = fingerprint({ sourceBytesSha256: sha256(bytes), modelId: "gemini-2.5-flash-image" });

  it("leaves a done asset alone when the input has not changed", () => {
    expect(nextStatusForFingerprint("done", fpA, fpA)).toBeNull();
  });

  it("marks done stale — never pending — when the source photo changes", () => {
    const fpB = fingerprint({
      sourceBytesSha256: sha256(Buffer.from("a different photograph")),
      modelId: "gemini-2.5-flash-image",
    });
    // Stale, not pending: the old file keeps being served, because an
    // out-of-date view beats a hole in the gallery. Regenerating is a
    // deliberate click with the cost on screen.
    expect(nextStatusForFingerprint("done", fpA, fpB)).toBe("stale");
  });

  it("treats a model change as a different input", () => {
    const other = fingerprint({ sourceBytesSha256: sha256(bytes), modelId: "some-other-model" });
    expect(other).not.toBe(fpA);
  });

  it("treats a prompt-version bump as a different input", () => {
    const bumped = fingerprint({
      sourceBytesSha256: sha256(bytes),
      modelId: "gemini-2.5-flash-image",
      promptVersion: 2,
    });
    expect(bumped).not.toBe(fpA);
  });

  it("never disturbs an asset that is mid-flight", () => {
    expect(nextStatusForFingerprint("running", fpA, "anything")).toBeNull();
    expect(nextStatusForFingerprint("awaiting_external", fpA, "anything")).toBeNull();
  });
});

describe("state machine", () => {
  it("refuses to walk a done asset back to pending", () => {
    // The one transition that would silently re-bill an asset that is finished.
    expect(canTransition("done", "pending")).toBe(false);
    expect(canTransition("done", "running")).toBe(false);
    expect(canTransition("done", "stale")).toBe(true);
  });

  it("lets a stale or failed asset be picked up again", () => {
    expect(canTransition("stale", "running")).toBe(true);
    expect(canTransition("failed", "running")).toBe(true);
  });

  it("only ever claims pending or failed", () => {
    expect(CLAIMABLE).toEqual(["pending", "failed"]);
    expect(CLAIMABLE).not.toContain("done");
  });

  it("returns a budget-blocked asset to the queue rather than failing it", () => {
    expect(canTransition("pending", "blocked_budget")).toBe(true);
    expect(canTransition("blocked_budget", "pending")).toBe(true);
  });
});

describe("retry policy mirrors the module's own contract", () => {
  it("does not retry a bad key or an unknown model", () => {
    // gemini_media.py refuses to retry a 403/404 so a bad key surfaces as a bad
    // key instead of three identical failures.
    expect(isRetryable("auth_failed")).toBe(false);
    expect(isRetryable("model_not_found")).toBe(false);
  });

  it("retries transient provider trouble", () => {
    expect(isRetryable("provider_rejected")).toBe(true);
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable(null)).toBe(true);
  });

  it("gives up after three attempts", () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

describe("lease: a killed run must not strand its assets", () => {
  const now = new Date("2026-09-05T12:00:00.000Z");

  it("treats a missing lease as expired", () => {
    expect(leaseExpired(null, now)).toBe(true);
  });

  it("holds a fresh lease", () => {
    expect(leaseExpired(leaseUntil(now), now)).toBe(false);
  });

  it("outlasts the slowest single operation", () => {
    // A Veo call can take 15 minutes. A lease shorter than that lets a second
    // run claim an asset still being generated — paid for twice, neither aware.
    const held = leaseUntil(now).getTime() - now.getTime();
    expect(held).toBeGreaterThan(15 * 60_000);
  });

  it("expires so the work can be recovered", () => {
    const later = new Date(now.getTime() + 21 * 60_000);
    expect(leaseExpired(leaseUntil(now), later)).toBe(true);
  });
});

describe("fan-out", () => {
  it("gives views four slots and everything else exactly one", () => {
    expect(slotsFor("view")).toEqual(["front", "left", "right", "back"]);
    expect(slotsFor("video")).toEqual([null]);
    expect(slotsFor("model3d")).toEqual([null]);
  });
});

describe("cost arithmetic", () => {
  it("prices a view from the published token rate", () => {
    // 1290 output tokens at $30/1M is Google's documented figure for <=1024px.
    const oneK = viewCostUsd("1K");
    expect(oneK).toBeGreaterThan(0.038);
    expect(oneK).toBeLessThan(0.041);
  });

  it("charges more for 2K than 1K", () => {
    // The whole point of phase 0: 2K bills more tokens, and R2 stores at 1600px
    // regardless, so the difference has to be visible before a batch is run.
    expect(viewCostUsd("2K")).toBeGreaterThan(viewCostUsd("1K"));
  });

  it("bills video by the second, not by tokens", () => {
    expect(videoRateUsd("veo-3.1-fast-generate-preview", "720p")).toBe(0.1);
    expect(videoCostUsd("veo-3.1-fast-generate-preview", "720p", 8)).toBeCloseTo(0.8, 5);
  });

  it("returns null rather than a guess for an unknown model/resolution pair", () => {
    // A fabricated number here would be worse than no number: it would read as
    // authoritative in a receipt.
    expect(videoRateUsd("veo-3.1-fast-generate-preview", "8k")).toBeNull();
    expect(videoCostUsd("veo-3.1-fast-generate-preview", "8k")).toBeNull();
  });

  it("prices the pilot cohort in the right ballpark", () => {
    // 608 views. At the 1K anchor this is ~$23.5 — the number the whole ladder
    // is built around.
    const { total_usd } = estimateBatch({ views: 608, imageSize: "1K" });
    expect(total_usd).toBeGreaterThan(20);
    expect(total_usd).toBeLessThan(30);
  });

  it("reports the rate it used, so an estimate can be checked", () => {
    const { views } = estimateBatch({ views: 10, imageSize: "1K" });
    expect(views?.rates.usd_per_1m_output_tokens).toBe(30);
    expect(views?.rates.image_size).toBe("1K");
    expect(views?.units).toBe(10);
  });

  it("charges nothing for 3D, which costs no API money", () => {
    expect(estimateBatch({}).total_usd).toBe(0);
  });

  it("converts a reported token count back to dollars", () => {
    expect(imageCostFromTokens(0, 1_000_000)).toBeCloseTo(30, 5);
  });
});

describe("budget: the ceiling is enforced, not advertised", () => {
  const settings = {
    tier: 2,
    monthly_ceiling_usd_views: 40,
    monthly_ceiling_usd_video: 10,
    daily_ceiling_usd: 10,
    max_batch_per_run: 8,
    max_concurrency: 2,
    video_scope: "list" as const,
    video_sku_list: [],
    video_unit: "product" as const,
    video_prompt: null,
    image_model_id: "gemini-2.5-flash-image",
    video_model_id: "veo-3.1-fast-generate-preview",
    source: "database" as const,
  };
  const noSpend = { month_to_date_usd: 0, today_usd: 0, by_kind: {} };

  it("allows a batch that fits", () => {
    expect(
      checkBudget({ settings, spend: noSpend, kind: "view", estimatedUsd: 1 }).allowed
    ).toBe(true);
  });

  it("refuses once the monthly ceiling for that kind is used up", () => {
    const verdict = checkBudget({
      settings,
      spend: { month_to_date_usd: 39, today_usd: 0, by_kind: { view: 39 } },
      kind: "view",
      estimatedUsd: 5,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe("monthly_ceiling");
  });

  it("keeps views and video on separate ceilings", () => {
    // Spending the view budget must not close the video budget, or a big image
    // run would silently cancel a video the owner had already authorised.
    const verdict = checkBudget({
      settings,
      spend: { month_to_date_usd: 39, today_usd: 0, by_kind: { view: 39 } },
      kind: "video",
      estimatedUsd: 0.8,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("stops a run that fits the month but blows today", () => {
    const verdict = checkBudget({
      settings,
      spend: { month_to_date_usd: 5, today_usd: 9.5, by_kind: { view: 5 } },
      kind: "view",
      estimatedUsd: 2,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe("daily_ceiling");
  });

  it("refuses more frames than the tier permits", () => {
    const verdict = checkBudget({
      settings: { ...settings, tier: 1 },
      spend: noSpend,
      kind: "view",
      estimatedUsd: 0.5,
      frames: 70,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe("tier_locked");
  });

  it("never blocks a 3D work order, which spends nothing", () => {
    const verdict = checkBudget({
      settings,
      spend: { month_to_date_usd: 999, today_usd: 999, by_kind: { view: 999 } },
      kind: "model3d",
      estimatedUsd: 0,
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe("the ladder", () => {
  it("caps frames at every level except the last", () => {
    expect(tierFor(0).max_frames).toBe(2);
    expect(tierFor(1).max_frames).toBe(20);
    expect(tierFor(2).max_frames).toBe(70);
    expect(tierFor(3).max_frames).toBeNull();
  });

  it("matches the pilot cohort at tier 2", () => {
    // Tier 2 exists to run exactly the pilot: 70 frames, ~$23.5 of the $40 cap.
    expect(tierFor(2).max_frames).toBe(70);
    expect(tierFor(2).monthly_ceiling_usd_views).toBeGreaterThan(23.5);
  });

  it("never lets a ceiling shrink as the level rises", () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].monthly_ceiling_usd_views).toBeGreaterThanOrEqual(
        TIERS[i - 1].monthly_ceiling_usd_views
      );
    }
  });

  it("starts with video effectively closed", () => {
    // 550 videos is $440 — six months of infra. Video is opt-in per tier, and
    // tier 1 (the first real batch) has no video budget at all.
    expect(tierFor(1).monthly_ceiling_usd_video).toBe(0);
  });
});
