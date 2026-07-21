/**
 * Maps common frame color names (from supplier data) to approximate CSS hex values.
 * Used to render color dot swatches on frame cards.
 */
export const COLOR_MAP: Record<string, string> = {
  // Blacks & grays
  black: "#1a1a1a",
  matte_black: "#2d2d2d",
  gunmetal: "#3d454a",
  "dark gray": "#4a4a4a",
  "dark grey": "#4a4a4a",
  charcoal: "#3c3c3c",
  // Browns & tortoise
  brown: "#7b4c2d",
  tortoise: "#8b5c2a",
  tortoiseshell: "#8b5c2a",
  havana: "#8b4c1a",
  amber: "#c47a1a",
  // Golds & silvers
  gold: "#c5a028",
  silver: "#a0a0a0",
  "rose gold": "#c09080",
  "antique gold": "#b8963e",
  chrome: "#c0c0c0",
  // Blues
  blue: "#2563eb",
  navy: "#1e3a5f",
  "dark blue": "#1e3a5f",
  "light blue": "#60a5fa",
  // Reds & pinks
  red: "#dc2626",
  burgundy: "#7f1d1d",
  wine: "#7f1d1d",
  pink: "#f9a8d4",
  "rose": "#fb7185",
  magenta: "#db2777",
  // Greens
  green: "#16a34a",
  olive: "#78740e",
  teal: "#0d9488",
  // Purples
  purple: "#7c3aed",
  violet: "#8b5cf6",
  lavender: "#c4b5fd",
  // Whites & clears
  white: "#f5f5f5",
  crystal: "#e8f4f8",
  clear: "#e8f4f8",
  transparent: "#e8f4f8",
  // Specialty
  demi: "#8b5c2a",
  "matte brown": "#6b3c1d",
  "matte blue": "#1d4ed8",
};

/**
 * Returns a CSS color for a color name, with a sensible fallback.
 */
export function getColorHex(colorName: string): string {
  const normalized = colorName.toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (COLOR_MAP[normalized]) return COLOR_MAP[normalized];
  // Partial match
  for (const [key, hex] of Object.entries(COLOR_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) return hex;
  }
  return "#9ca3af"; // gray-400 fallback
}
