/**
 * The color of each store, so an email shows at a glance which store a sale
 * belongs to. A new store gets one no other store has; the owner can then pick
 * any color, even a repeated one. Pure — no I/O.
 */

/**
 * Starting colors, far from each other and from the emails' navy and gold. Keep
 * in step with the panel (adminStores.js). CreateEstablishmentColor4 only seeded
 * the first ten; the last four are the owner's picks for the panel theme (clinic
 * green, copper, fuchsia, the storefront's brand blue) — which store gets which
 * is data (Stores → Edit), never code.
 */
export const STORE_COLORS = ["#2563EB", "#DC2626", "#16A34A", "#7C3AED", "#EA580C", "#DB2777", "#0891B2", "#854D0E", "#65A30D", "#475569", "#1B7F4C", "#B5651D", "#C2185B", "#0E5AD0"];

const HEX = /^#[0-9a-f]{6}$/i;

/** Canonical `#RRGGBB`, or null when it is not one. */
export function normalizeColor(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return HEX.test(s) ? s.toUpperCase() : null;
}

function hueToHex(hue: number): string {
  const s = 0.65;
  const l = 0.42;
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

/**
 * A color no store has: the palette first, then hues spaced by the golden angle.
 * Counts every store ever created, so a deactivated store's color is not reused.
 */
export function nextStoreColor(used: Array<string | null | undefined>): string {
  const taken = new Set(used.map(normalizeColor).filter(Boolean));
  const free = STORE_COLORS.find((c) => !taken.has(c));
  if (free) return free;
  for (let i = 0; i < 3600; i++) {
    const c = hueToHex((i * 137.508) % 360);
    if (!taken.has(c)) return c;
  }
  return STORE_COLORS[0];
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** White or dark text, whichever reads better on the color (WCAG luminance). */
export function inkOn(color: string): string {
  const [r, g, b] = channels(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? "#111827" : "#FFFFFF";
}

const CIRCLES: Array<[string, string]> = [
  ["🔴", "#DC2626"],
  ["🟠", "#EA580C"],
  ["🟡", "#EAB308"],
  ["🟢", "#16A34A"],
  ["🔵", "#2563EB"],
  ["🟣", "#7C3AED"],
  ["🟤", "#854D0E"],
  ["⚫", "#1F2937"],
  ["⚪", "#E5E7EB"],
];

/** The closest colored circle: a subject line cannot carry a real color. */
export function colorCircle(color: string): string {
  const c = normalizeColor(color);
  if (!c) return "⚪";
  const [r, g, b] = channels(c);
  let best = CIRCLES[0];
  let bestDistance = Infinity;
  for (const candidate of CIRCLES) {
    const [x, y, z] = channels(candidate[1]);
    const distance = (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best[0];
}

export interface StoreLabel {
  code: string;
  name?: string | null;
  color?: string | null;
}

/** `🔵 Op2`, the start of a subject: what the inbox list shows before opening the mail. */
export function storeSubjectTag(store: StoreLabel): string {
  return `${colorCircle(store.color ?? "")} ${store.code}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Full-width band at the top of an email, in the store's color. `bgcolor` is for Outlook. */
export function storeBanner(store: StoreLabel): string {
  const bg = normalizeColor(store.color) ?? STORE_COLORS[0];
  const text = [store.code, store.name].filter(Boolean).join(" · ");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px"><tr><td bgcolor="${bg}" style="background:${bg};color:${inkOn(bg)};padding:12px 16px;border-radius:8px;font-size:16px;font-weight:800;letter-spacing:.02em">${esc(text)}</td></tr></table>`;
}

/** A small square in the store's color, before a store's name in a list. */
export function storeDot(color: string | null | undefined): string {
  const c = normalizeColor(color);
  return c ? `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${c};margin-right:7px;vertical-align:baseline"></span>` : "";
}
