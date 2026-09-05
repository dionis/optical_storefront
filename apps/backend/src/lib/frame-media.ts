/**
 * Rules for generated frame media: identity, the status machine, and freshness.
 *
 * Kept out of the module service (which is CRUD only), the same split ocr-config
 * uses. Everything here is pure and unit-testable — the spending decisions in
 * `frame-media-settings.ts` and the atomic claim in `frame-media-claim.ts` are
 * the parts that need a container and a database.
 */
import { createHash } from "node:crypto";

export const VIEW_SLOTS = ["front", "left", "right", "back"] as const;
export type ViewSlot = (typeof VIEW_SLOTS)[number];

export type MediaKind = "view" | "video" | "model3d";

export type MediaStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "stale"
  | "awaiting_external"
  | "blocked_budget"
  | "skipped";

/**
 * Bumped by hand whenever VIEW_PROMPTS or IDENTITY_GUARD changes in
 * gemini_media.py. It is part of the fingerprint, so raising it marks every
 * existing asset stale — a catalogue-wide, $223 sweep. That must always be a
 * deliberate edit, never a side effect of touching a prompt string.
 */
export const PROMPT_VERSION = 1;

/** How long a claimed asset stays leased. See the model's comment: 15 min < 20. */
export const LEASE_MINUTES = 20;

/** Attempts before an asset stops being reclaimed and waits for a manual retry. */
export const MAX_ATTEMPTS = 3;

/**
 * Provider failures that must NOT be retried, mirroring the contract
 * `gemini_media.py` states: a 403 or 404 is a bad key or a bad model, and
 * retrying it only buries the real reason behind three identical failures.
 */
export const NON_RETRYABLE_REASONS = new Set([
  "auth_failed",
  "model_not_found",
  "no_source_image",
  "r2_unconfigured",
]);

/** Statuses a run is allowed to pick up. */
export const CLAIMABLE: MediaStatus[] = ["pending", "failed"];

/** Statuses that mean "there is a usable file behind this row". */
export const HAS_OUTPUT: MediaStatus[] = ["done", "stale"];

export function isRetryable(reason: string | null | undefined): boolean {
  return !reason || !NON_RETRYABLE_REASONS.has(reason);
}

/**
 * Slots a given kind uses. Video and 3D are one asset each; only views fan out,
 * which is the whole reason the table is keyed per slot.
 */
export function slotsFor(kind: MediaKind): (ViewSlot | null)[] {
  return kind === "view" ? [...VIEW_SLOTS] : [null];
}

/**
 * R2 object key for a generated asset.
 *
 * Follows the convention `apps/scraper/scraper/images.py` already uses for
 * supplier photos (`products/{handle}/{handle}_{idx}.webp`) and try-on assets
 * (`tryon/{handle}_{color}.png`), including its colour slug — lowercase, spaces
 * to underscores. Requirement 1 is "store them the way images are stored today",
 * and this is the half of it that lives in TypeScript.
 */
export function outputKey(input: {
  kind: MediaKind;
  handle: string;
  colorway: string | null;
  slot: ViewSlot | null;
  ext?: string;
}): string {
  const colour = colorSlug(input.colorway);
  switch (input.kind) {
    case "view":
      return `products/${input.handle}/views/${input.handle}_${colour}_${input.slot}.${input.ext ?? "webp"}`;
    case "video":
      return `products/${input.handle}/video/${input.handle}_${colour}.${input.ext ?? "mp4"}`;
    case "model3d":
      return `models/${input.handle}/${input.handle}_${colour}.${input.ext ?? "glb"}`;
  }
}

/** Same rule as images.py: `color.lower().replace(' ', '_')`. */
export function colorSlug(colorway: string | null | undefined): string {
  return String(colorway ?? "default")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/**
 * Ties a result to the exact input that was paid for.
 *
 * Includes the model id and the prompt version, not just the photo: regenerating
 * because the prompt changed is a different question from regenerating because
 * the supplier swapped the picture, and both must invalidate.
 */
export function fingerprint(input: {
  sourceBytesSha256: string;
  modelId: string;
  promptVersion?: number;
}): string {
  return createHash("sha256")
    .update(
      [
        input.sourceBytesSha256,
        input.modelId,
        `pv${input.promptVersion ?? PROMPT_VERSION}`,
      ].join("|")
    )
    .digest("hex");
}

/** sha256 of raw bytes, for the source half of the fingerprint. */
export function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Whether an asset needs (re)generating.
 *
 * A `done` row whose fingerprint still matches is never regenerated — that is
 * the "never pay twice" rule, and it is a comparison rather than a heuristic.
 * A `done` row whose fingerprint has changed becomes `stale`: the old file keeps
 * being served, because an out-of-date view beats a hole in the gallery, and
 * regenerating is a deliberate click with the cost on screen.
 */
export function nextStatusForFingerprint(
  current: MediaStatus,
  storedFingerprint: string | null,
  incomingFingerprint: string
): MediaStatus | null {
  if (current === "done") {
    if (!storedFingerprint || storedFingerprint === incomingFingerprint) return null;
    return "stale";
  }
  if (current === "running" || current === "awaiting_external") return null;
  return "pending";
}

/**
 * Which transitions the state machine permits. Anything not listed is refused,
 * so a bug in a caller cannot walk an asset from `done` back to `pending` and
 * quietly re-bill it.
 */
const ALLOWED: Record<MediaStatus, MediaStatus[]> = {
  pending: ["running", "blocked_budget", "skipped"],
  running: ["done", "failed", "pending", "awaiting_external"],
  failed: ["running", "pending", "skipped"],
  done: ["stale"],
  stale: ["running", "pending"],
  blocked_budget: ["pending", "skipped"],
  awaiting_external: ["done", "failed", "pending"],
  skipped: ["pending"],
};

export function canTransition(from: MediaStatus, to: MediaStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** Whether a lease has expired, so the asset can be reclaimed by another run. */
export function leaseExpired(leaseUntil: Date | string | null, now = new Date()): boolean {
  if (!leaseUntil) return true;
  return new Date(leaseUntil).getTime() < now.getTime();
}

export function leaseUntil(now = new Date()): Date {
  return new Date(now.getTime() + LEASE_MINUTES * 60_000);
}

/**
 * The Medusa product handle, as apps/scraper/scraper/parser.py:193 builds it:
 * `f"{_slug(name)}-{collection_slug}"`.
 *
 * NOTE THE TWO SLUGS. The storefront's bundled seed uses a different rule
 * (products.js: `sku.toLowerCase().replace(/[^a-z0-9]+/g, "")`, which DELETES the
 * separator instead of replacing it), so "DC 50" is `dc-50-di-caprio` here and
 * `dc50` there. Enqueue talks to Medusa, so this is the one it must use.
 */
export function medusaHandle(name: string, brandSlug: string): string {
  const slug = String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}-${brandSlug}`;
}
