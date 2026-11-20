/**
 * The brand the owner edits from the panel (docs/MULTI-TENANT-TECNICO.md §7.5).
 *
 * Stored in `tenant_profile.brand` (the previous one in `brand_previous`, for
 * "back to the previous brand"). The manifest/env colours are only the starting
 * point: once the owner saves a brand, the storefront (GET /store/tenant) and the
 * emails (src/lib/email/order-confirmation.ts → recolorEmail) use it without a
 * redeploy. Everything in this file is pure.
 *
 * Rules (the server's, the panel only previews them):
 *   - colours are #rrggbb;
 *   - white text on `primary` and `accent` must reach WCAG AA (4.5:1): both are
 *     used as button/badge backgrounds with white text, and `accent` also as
 *     text on white, which is the same ratio;
 *   - logos are https URLs (what the upload route returns) or a /path of the
 *     storefront;
 *   - an uploaded logo is PNG, WebP, JPEG or SVG, at most 300 KB, and an SVG
 *     with anything active in it (scripts, event handlers, external links,
 *     embedded documents) is refused, not cleaned.
 */

export interface TenantBrandProfile {
  primary: string;
  accent: string;
  logo_url: string | null;
  logo_mark_url: string | null;
  updated_at: string;
}

/** What the storefront paints with: the profile brand plus the derived dark shade. */
export interface PublicBrand extends TenantBrandProfile {
  primary_dark: string;
}

export const MIN_CONTRAST = 4.5;
export const MAX_LOGO_BYTES = 300 * 1024;
export const LOGO_KINDS = ["logo", "logo_mark"] as const;
export type LogoKind = (typeof LOGO_KINDS)[number];

const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `hex` mixed with black (`amount` of black, 0–1). */
export function shade(hex: string, amount: number): string {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${ch.map((c) => Math.round(c * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

/** `hex` mixed with white (`amount` of white, 0–1). */
export function tint(hex: string, amount: number): string {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${ch.map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}

const isLogoUrl = (v: string): boolean => {
  if (/^\/[^/\\]/.test(v)) return !/[<>"'\s]/.test(v);
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

export type BrandCleanResult =
  | { ok: true; brand: Omit<TenantBrandProfile, "updated_at"> }
  | { ok: false; reason: "invalid_color" | "low_contrast" | "invalid_url" | "invalid_type"; field: string; ratio?: number };

export function cleanBrandInput(body: unknown): BrandCleanResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const colors: Record<"primary" | "accent", string> = { primary: "", accent: "" };
  for (const key of ["primary", "accent"] as const) {
    const v = b[key];
    if (typeof v !== "string" || !HEX.test(v.trim())) return { ok: false, reason: "invalid_color", field: key };
    colors[key] = v.trim().toLowerCase();
    const ratio = contrastRatio(colors[key], "#ffffff");
    if (ratio < MIN_CONTRAST) return { ok: false, reason: "low_contrast", field: key, ratio: Math.round(ratio * 100) / 100 };
  }
  const urls: Record<"logo_url" | "logo_mark_url", string | null> = { logo_url: null, logo_mark_url: null };
  for (const key of ["logo_url", "logo_mark_url"] as const) {
    const v = b[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") return { ok: false, reason: "invalid_type", field: key };
    const s = v.trim();
    if (s.length > 500 || !isLogoUrl(s)) return { ok: false, reason: "invalid_url", field: key };
    urls[key] = s;
  }
  return { ok: true, brand: { ...colors, ...urls } };
}

/** The stored json, or null when it is missing or malformed (then the defaults apply). */
export function readBrand(v: unknown): TenantBrandProfile | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.primary !== "string" || !HEX.test(r.primary) || typeof r.accent !== "string" || !HEX.test(r.accent)) return null;
  const url = (x: unknown) => (typeof x === "string" && isLogoUrl(x) ? x : null);
  return {
    primary: r.primary.toLowerCase(),
    accent: r.accent.toLowerCase(),
    logo_url: url(r.logo_url),
    logo_mark_url: url(r.logo_mark_url),
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

export function publicBrand(brand: TenantBrandProfile | null): PublicBrand | null {
  return brand ? { ...brand, primary_dark: shade(brand.primary, 0.35) } : null;
}

// ── uploads ──────────────────────────────────────────────────────────────────
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

const UNSAFE_SVG =
  /<script|<foreignobject|<iframe|<embed|<object|<use\b[^>]*href\s*=\s*["'](?!#)|\bon[a-z]+\s*=|javascript:|data:text\/html|<!entity|(?:xlink:)?href\s*=\s*["'](?!#|data:image\/)/i;

export type LogoCheck =
  | { ok: true; mime: string; ext: string; bytes: Buffer }
  | { ok: false; reason: "invalid_type" | "unsupported_type" | "too_large" | "bad_image" | "unsafe_svg" };

/** Validates a `data:<mime>;base64,…` upload. */
export function checkLogoUpload(dataUrl: unknown): LogoCheck {
  if (typeof dataUrl !== "string") return { ok: false, reason: "invalid_type" };
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) return { ok: false, reason: "invalid_type" };
  const mime = m[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) return { ok: false, reason: "unsupported_type" };
  const bytes = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  if (!bytes.length) return { ok: false, reason: "bad_image" };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, reason: "too_large" };

  const head = bytes.subarray(0, 12);
  const magic: Record<string, boolean> = {
    "image/png": head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/jpeg": head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
    "image/webp": head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP",
  };
  if (mime === "image/svg+xml") {
    const text = bytes.toString("utf8");
    if (!/<svg[\s>]/i.test(text)) return { ok: false, reason: "bad_image" };
    if (UNSAFE_SVG.test(text)) return { ok: false, reason: "unsafe_svg" };
  } else if (!magic[mime]) {
    return { ok: false, reason: "bad_image" };
  }
  return { ok: true, mime, ext, bytes };
}

// ── emails ───────────────────────────────────────────────────────────────────
export interface EmailPalette {
  primary: string;
  accent: string;
  primarySoft: string;
  accentSoft: string;
}

/**
 * Repaints a rendered email: every colour of the deployment's palette (`from`)
 * becomes the owner's (`to`). The templates interpolate the palette constants,
 * so their exact strings are what appears in the HTML.
 */
export function recolorHtml(html: string, from: EmailPalette, to: EmailPalette): string {
  let out = html;
  for (const key of ["primary", "accent", "primarySoft", "accentSoft"] as const) {
    if (from[key].toLowerCase() === to[key].toLowerCase()) continue;
    out = out.split(from[key]).join(to[key]);
    if (from[key] !== from[key].toUpperCase()) out = out.split(from[key].toUpperCase()).join(to[key]);
  }
  return out;
}
