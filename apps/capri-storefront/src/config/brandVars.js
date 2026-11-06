// The CSS variables a brand paints, in ONE place for the build (scripts/tenant/load.mjs,
// manifest colours baked into index.html) and the browser (src/config/brandRuntime.js,
// colours the owner saved in the panel). Plain ESM with no imports: Node loads it too.

/** `{ "--blue": "#…", … }` for a primary / dark primary / accent triple. */
export function brandVars({ primary, primaryDark, accent }) {
  return {
    "--blue": primary,
    "--primary-blue": primary,
    "--rl-navy": primary,
    "--blue-dark": primaryDark,
    "--primary-blue-dark": primaryDark,
    "--red": accent,
    "--red-dark": accent,
    "--offer": accent,
  };
}

/** `hex` mixed with black (`amount` of black, 0–1) — same as the backend's shade(). */
export function shade(hex, amount) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${ch.map((c) => Math.round(c * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio; the panel previews it, the server (lib/tenant-brand.ts) enforces 4.5. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const MIN_CONTRAST = 4.5;
export const HEX_RE = /^#[0-9a-f]{6}$/i;
