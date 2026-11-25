// Drawings and icons of the web material chooser (MaterialChooser.jsx). Everything
// is inline SVG so it stays sharp at any size and every label is live text in the
// active language (the labels arrive as props; nothing here is copy).
import { useId } from "react";

const uid = (raw) => raw.replace(/[^a-zA-Z0-9]/g, "");

// ── Line icons (24 × 24, currentColor) ───────────────────────────────────────
const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
const Svg = ({ children, className, size = 24 }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{children}</svg>
);

export const IcLayers = (p) => (
  <Svg {...p}><path {...line} d="M12 3.5 21 8l-9 4.5L3 8l9-4.5Z" /><path {...line} d="m3.6 12.3 8.4 4.2 8.4-4.2" /><path {...line} d="m3.6 16.3 8.4 4.2 8.4-4.2" /></Svg>
);
export const IcShield = (p) => (
  <Svg {...p}><path {...line} d="M12 3 4.5 5.8v5.4c0 4.6 3 8 7.5 9.8 4.5-1.8 7.5-5.2 7.5-9.8V5.8L12 3Z" /><path {...line} d="m8.8 12 2.3 2.3 4.2-4.4" /></Svg>
);
export const IcFeather = (p) => (
  <Svg {...p}><path {...line} d="M19.5 4.5c-5.5-.5-10.5 2.5-12 8-.5 1.9-.7 3.8-.7 5.5 1.7.1 3.6-.1 5.5-.7 5.5-1.6 8.3-6.8 7.2-12.8Z" /><path {...line} d="M4 20 15 9" /></Svg>
);
export const IcEye = (p) => (
  <Svg {...p}><path {...line} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle {...line} cx="12" cy="12" r="3" /></Svg>
);
export const IcSpan = (p) => (
  <Svg {...p}><path {...line} d="M3 12h18" /><path {...line} d="m7 8-4 4 4 4" /><path {...line} d="m17 8 4 4-4 4" /></Svg>
);
export const IcGlasses = (p) => (
  <Svg {...p}><rect {...line} x="2.5" y="9" width="7.5" height="6" rx="2.2" /><rect {...line} x="14" y="9" width="7.5" height="6" rx="2.2" /><path {...line} d="M10 11.5c.7-.9 3.3-.9 4 0" /></Svg>
);
export const IcLaptop = (p) => (
  <Svg {...p}><rect {...line} x="4.5" y="5" width="15" height="10" rx="1.5" /><path {...line} d="M2.5 18.5h19" /></Svg>
);
export const IcCar = (p) => (
  <Svg {...p}><path {...line} d="M4 16v-3.2l1.7-4.3A2 2 0 0 1 7.6 7.2h8.8a2 2 0 0 1 1.9 1.3L20 12.8V16" /><path {...line} d="M3 16h18v1.5a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1V16M7.5 16v1.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1" /><path {...line} d="M4.5 12.5h15" /><circle cx="7.3" cy="14.3" r=".9" fill="currentColor" /><circle cx="16.7" cy="14.3" r=".9" fill="currentColor" /></Svg>
);
export const IcBook = (p) => (
  <Svg {...p}><path {...line} d="M12 6.5C10 5 7 4.8 3.5 5.5v12.5c3.5-.7 6.5-.5 8.5 1 2-1.5 5-1.7 8.5-1V5.5C17 4.8 14 5 12 6.5Z" /><path {...line} d="M12 6.5V19" /></Svg>
);
export const IcSun = (p) => (
  <Svg {...p}><circle {...line} cx="12" cy="12" r="3.6" /><path {...line} d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" /></Svg>
);
export const IcCheckRing = (p) => (
  <Svg {...p}><circle {...line} cx="12" cy="12" r="8.5" /><path {...line} d="m8.3 12.2 2.5 2.5 4.9-5.1" /></Svg>
);
export const IcThin = (p) => (
  <Svg {...p}><path {...line} d="M4 12h16" /><path {...line} d="M12 3.5v5M9.8 6.3 12 8.5l2.2-2.2" /><path {...line} d="M12 20.5v-5M9.8 17.7 12 15.5l2.2 2.2" /></Svg>
);
export const IcTag = (p) => (
  <Svg {...p}><path {...line} d="M3.5 12.3V5a1.5 1.5 0 0 1 1.5-1.5h7.3L20.5 11.7a1.5 1.5 0 0 1 0 2.1l-6.7 6.7a1.5 1.5 0 0 1-2.1 0L3.5 12.3Z" /><circle cx="8" cy="8" r="1.3" fill="currentColor" /></Svg>
);
export const IcSparkles = (p) => (
  <Svg {...p}><path {...line} d="M10 4.5 11.6 9l4.4 1.5-4.4 1.6L10 16.5 8.4 12.1 4 10.5 8.4 9 10 4.5Z" /><path {...line} d="M18 14.5 18.8 16.7 21 17.5l-2.2.8L18 20.5l-.8-2.2L15 17.5l2.2-.8.8-2.2Z" /></Svg>
);

/** Solid gold check used in the bullet lists and the selected row. */
export function GoldCheck({ className, size = 20 }) {
  const id = uid(useId());
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe7a6" /><stop offset=".5" stopColor="#e9b93f" /><stop offset="1" stopColor="#c98f1d" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill={`url(#${id}g)`} stroke="#b97f14" strokeWidth=".8" />
      <path d="m7.3 12.3 3.1 3.1 6.3-6.6" fill="none" stroke="#0b2f66" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The gold award seal with blue ribbons that opens the recommendation. */
export function AwardSeal({ className }) {
  const id = uid(useId());
  return (
    <svg className={className} viewBox="0 0 48 56" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0b8" /><stop offset=".45" stopColor="#f0c24a" /><stop offset="1" stopColor="#c58a17" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f73d6" /><stop offset="1" stopColor="#0d3f93" />
        </linearGradient>
        <radialGradient id={`${id}s`} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#fff7d6" /><stop offset="1" stopColor="#eab73a" />
        </radialGradient>
      </defs>
      <path d="M14 30 8.5 53l8-4 4.5 6.5L25 34Z" fill={`url(#${id}b)`} />
      <path d="M34 30l5.5 23-8-4-4.5 6.5L23 34Z" fill={`url(#${id}b)`} />
      <path
        d="M24 2.5l4.1 3.2 5.2-.6 2 4.8 4.8 2-.6 5.2 3.2 4.1-3.2 4.1.6 5.2-4.8 2-2 4.8-5.2-.6L24 39.9l-4.1-3.2-5.2.6-2-4.8-4.8-2 .6-5.2-3.2-4.1 3.2-4.1-.6-5.2 4.8-2 2-4.8 5.2.6L24 2.5Z"
        fill={`url(#${id}g)`} stroke="#b47f16" strokeWidth=".9" strokeLinejoin="round"
      />
      <circle cx="24" cy="21.2" r="11.2" fill={`url(#${id}s)`} stroke="#fff6d2" strokeWidth="1.2" />
      <path d="m18.3 21.5 4 4 7.6-8" fill="none" stroke="#0b2f66" strokeWidth="2.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The glass lens icon of the popup header and the hero. */
export function LensGlyph({ className }) {
  const id = uid(useId());
  return (
    <svg className={className} viewBox="0 0 40 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#9ec5ff" />
        </linearGradient>
      </defs>
      <g transform="rotate(-18 20 16)">
        <ellipse cx="20" cy="18.5" rx="16" ry="9.5" fill="#5d97e6" opacity=".9" />
        <ellipse cx="20" cy="15.5" rx="16" ry="9.5" fill={`url(#${id}a)`} stroke="#fff" strokeWidth="1" />
        <path d="M8.5 13.5c2.5-4 7-5.8 12-5.8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// ── Lens drawings ────────────────────────────────────────────────────────────

/**
 * A lens blank lying flat, seen from slightly above: the edge is what the
 * customer compares. `thickness` is 1 for standard resin (see relativeThickness).
 */
export function LensDisc({ thickness = 1, className }) {
  const id = uid(useId());
  const span = Math.max(0, Math.min(1, (thickness - 0.42) / 0.58));
  const edge = 2.6 + 11 * Math.pow(span, 1.6);
  const cy = 13;
  const rx = 52;
  const ry = 8.6;
  return (
    <svg className={className} viewBox="0 0 120 46" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}e`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2f6fd0" /><stop offset=".22" stopColor="#8fc0ff" /><stop offset=".5" stopColor="#3f82df" />
          <stop offset=".8" stopColor="#1e5cc0" /><stop offset="1" stopColor="#5a9bf0" />
        </linearGradient>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f9ff" /><stop offset=".5" stopColor="#cfe3ff" /><stop offset="1" stopColor="#9fc6fb" />
        </linearGradient>
        <filter id={`${id}s`} x="-20%" y="-60%" width="140%" height="260%"><feGaussianBlur stdDeviation="2.6" /></filter>
      </defs>
      <ellipse cx="60" cy={cy + edge + 6} rx="46" ry="4.5" fill="#0b2f66" opacity=".22" filter={`url(#${id}s)`} />
      <path
        d={`M${60 - rx} ${cy} v${edge} a${rx} ${ry} 0 0 0 ${rx * 2} 0 v${-edge} Z`}
        fill={`url(#${id}e)`}
      />
      <path d={`M${60 - rx} ${cy + edge} a${rx} ${ry} 0 0 0 ${rx * 2} 0`} fill="none" stroke="#ffffff" strokeOpacity=".55" strokeWidth=".8" />
      <ellipse cx="60" cy={cy} rx={rx} ry={ry} fill={`url(#${id}t)`} stroke="#ffffff" strokeWidth="1.1" />
      <path d={`M${60 - rx + 9} ${cy - 1.5} a${rx - 9} ${ry - 2.4} 0 0 1 ${rx - 4} -4.7`} fill="none" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" opacity=".95" />
      <ellipse cx="78" cy={cy + 2.2} rx="20" ry="2.6" fill="#ffffff" opacity=".35" />
    </svg>
  );
}

/** The big glass lens of the single-vision block. */
export function LensHeroArt({ thickness = 1, className }) {
  const id = uid(useId());
  const span = Math.max(0, Math.min(1, (thickness - 0.42) / 0.58));
  const edge = 5 + 15 * Math.pow(span, 2);
  return (
    <svg className={className} viewBox="0 0 320 230" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id={`${id}f`} cx=".34" cy=".3" r=".95">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".92" />
          <stop offset=".35" stopColor="#dcecff" stopOpacity=".62" />
          <stop offset=".75" stopColor="#a9cdfb" stopOpacity=".42" />
          <stop offset="1" stopColor="#e6f1ff" stopOpacity=".8" />
        </radialGradient>
        <linearGradient id={`${id}e`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#cfe4ff" /><stop offset=".18" stopColor="#ffffff" /><stop offset=".45" stopColor="#8dbcf7" />
          <stop offset=".75" stopColor="#4d8fe6" /><stop offset="1" stopColor="#d7e9ff" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" /><stop offset=".5" stopColor="#ffffff" stopOpacity=".5" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}s`} x="-30%" y="-80%" width="160%" height="300%"><feGaussianBlur stdDeviation="9" /></filter>
        <filter id={`${id}g`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.2" /></filter>
        <clipPath id={`${id}c`}><ellipse cx="160" cy="108" rx="122" ry="66" /></clipPath>
      </defs>
      <ellipse cx="166" cy="196" rx="118" ry="13" fill="#ffffff" opacity=".42" filter={`url(#${id}s)`} />
      <ellipse cx="170" cy="190" rx="96" ry="9" fill="#06265a" opacity=".3" filter={`url(#${id}s)`} />
      <g transform="rotate(-13 160 110)">
        <path
          d={`M38 108 v${edge} a122 66 0 0 0 244 0 v${-edge} Z`}
          fill={`url(#${id}e)`} opacity=".96"
        />
        <path d={`M38 ${108 + edge} a122 66 0 0 0 244 0`} fill="none" stroke="#ffffff" strokeWidth="1.4" opacity=".8" />
        <ellipse cx="160" cy="108" rx="122" ry="66" fill={`url(#${id}f)`} stroke="#ffffff" strokeWidth="2" />
        <ellipse cx="160" cy="110" rx="108" ry="56" fill="none" stroke="#ffffff" strokeOpacity=".4" strokeWidth="1.1" />
        <g clipPath={`url(#${id}c)`}>
          <path d="M70 20 L128 20 L84 200 L26 200 Z" fill={`url(#${id}b)`} opacity=".75" />
          <path d="M150 20 L168 20 L124 200 L106 200 Z" fill={`url(#${id}b)`} opacity=".5" />
        </g>
        <path d="M52 96 A118 62 0 0 1 150 46" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" filter={`url(#${id}g)`} />
        <path d="M262 132 A118 62 0 0 1 196 166" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" opacity=".8" filter={`url(#${id}g)`} />
      </g>
      <path d="M70 176l2.2 6.3 6.3 2.2-6.3 2.2L70 193.2l-2.2-6.3-6.3-2.2 6.3-2.2Z" fill="#ffffff" opacity=".95" />
      <path d="M258 52l1.4 3.9 3.9 1.4-3.9 1.4-1.4 3.9-1.4-3.9-3.9-1.4 3.9-1.4Z" fill="#ffffff" opacity=".8" />
    </svg>
  );
}

// ── Glasses on a table: bifocal and progressive ──────────────────────────────

// Lens openings and rim silhouettes of the left eye; the right eye is the mirror
// image about x = 220 (see `mirror`). 440 × 248 box, glasses standing on a table.
const OPEN_L = "M58 88 Q58 70 78 70 L178 70 Q197 70 196 88 L191 142 Q188 176 154 176 L100 176 Q65 176 62 142 Z";
const RIM_L = "M48 86 Q48 59 78 59 L180 60 Q207 60 205 88 L199 145 Q196 185 154 185 L100 185 Q56 185 53 145 Z";
const mirror = "translate(440 0) scale(-1 1)";

function SceneText({ x, y, children, size = 11, light = false, sub = false }) {
  return (
    <text
      x={x} y={y} textAnchor="middle" fontSize={size} fontWeight={sub ? 600 : 800}
      fill={light ? "#ffffff" : "#0a2a5c"}
      stroke={light ? "rgba(6,28,66,.6)" : "rgba(255,255,255,.9)"} strokeWidth={light ? 2.6 : 2.8}
      paintOrder="stroke" strokeLinejoin="round"
    >
      {children}
    </text>
  );
}

/**
 * Black frame standing on a table with what the lens does drawn on it.
 * `kind`: "bifocal" (reading segment) or "progressive" (three zones).
 * `labels`: live strings — bifocal { far, farSub, near, nearSub, seg };
 * progressive { far, farSub, mid, midSub, near, nearSub }.
 */
export function GlassesScene({ kind = "bifocal", labels = {}, flatTop = true, className }) {
  const id = uid(useId());
  const prog = kind === "progressive";
  const u = (name) => `url(#${id}${name})`;
  // One eye: glass, what the lens does, reflections. Drawn once, mirrored for the other.
  const eye = (
    <g>
      <path d={OPEN_L} fill={u("ln")} />
      {prog ? (
        <g clipPath={u("cl")}>
          <rect x="50" y="60" width="160" height="124" fill={u("pz")} />
          <path d="M72 74 C104 104 108 132 90 174" fill="none" stroke="#ffffff" strokeWidth="1.3" strokeDasharray="4 3.5" opacity=".92" />
          <path d="M184 74 C152 104 148 132 166 174" fill="none" stroke="#ffffff" strokeWidth="1.3" strokeDasharray="4 3.5" opacity=".92" />
        </g>
      ) : flatTop ? (
        <path d="M87 128 H167 V138 C167 156 150 168 127 168 C104 168 87 156 87 138 Z" fill="#ffffff" fillOpacity=".42" stroke="#ffffff" strokeWidth="1.7" />
      ) : (
        <circle cx="127" cy="146" r="22" fill="#ffffff" fillOpacity=".42" stroke="#ffffff" strokeWidth="1.7" />
      )}
      <g clipPath={u("cl")} opacity={prog ? ".2" : ".55"}>
        <path d="M52 168 L104 62 L128 62 L76 168 Z" fill="#ffffff" />
        <path d="M150 62 L160 62 L108 168 L98 168 Z" fill="#ffffff" opacity=".6" />
      </g>
    </g>
  );
  // One rim: the black acetate with its light on the brow.
  const rim = (
    <g>
      <path d={`${RIM_L} ${OPEN_L}`} fillRule="evenodd" fill={u("fr")} />
      <path d="M57 70 Q62 62 78 62 L182 63" fill="none" stroke="#ffffff" strokeOpacity=".42" strokeWidth="1.6" strokeLinecap="round" />
      <path d={OPEN_L} fill="none" stroke="#000000" strokeOpacity=".55" strokeWidth="1.2" />
      <path d="M55 146 Q58 182 100 183 L154 183" fill="none" stroke="#ffffff" strokeOpacity=".16" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="54.5" cy="80" r="1.9" fill={u("gd")} /><circle cx="54.5" cy="87" r="1.9" fill={u("gd")} />
    </g>
  );
  const frame = (
    <g>
      {rim}
      <g transform={mirror}>{rim}</g>
      <path d="M202 84 C210 69 230 69 238 84 L237 98 C229 86 211 86 203 98 Z" fill={u("fr")} />
      <path d="M208 78 C214 72 226 72 232 78" fill="none" stroke="#ffffff" strokeOpacity=".35" strokeWidth="1.3" strokeLinecap="round" />
    </g>
  );
  return (
    <svg className={className} viewBox="0 0 440 248" role="img" aria-label={prog ? `${labels.far} · ${labels.mid} · ${labels.near}` : `${labels.far} · ${labels.near}`} preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={prog ? "#9db6d8" : "#cfc6bb"} /><stop offset=".5" stopColor={prog ? "#dbe7f5" : "#f1e9dd"} /><stop offset="1" stopColor={prog ? "#aec4e2" : "#cdbfae"} />
        </linearGradient>
        <linearGradient id={`${id}tb`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={prog ? "#aebfd6" : "#b9bcc2"} /><stop offset=".25" stopColor={prog ? "#8ea3c0" : "#9ea3ac"} /><stop offset="1" stopColor={prog ? "#56698a" : "#5b616d"} />
        </linearGradient>
        <linearGradient id={`${id}ln`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".72" /><stop offset=".5" stopColor="#eaf2fb" stopOpacity=".5" /><stop offset="1" stopColor="#d3e2f4" stopOpacity=".66" />
        </linearGradient>
        <linearGradient id={`${id}pz`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a66c9" stopOpacity=".9" /><stop offset=".28" stopColor="#3b8bd9" stopOpacity=".84" />
          <stop offset=".5" stopColor="#3aa9a2" stopOpacity=".82" /><stop offset=".7" stopColor="#93bf68" stopOpacity=".82" />
          <stop offset="1" stopColor="#eba53a" stopOpacity=".92" />
        </linearGradient>
        <linearGradient id={`${id}fr`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4e57" /><stop offset=".12" stopColor="#1a1c21" /><stop offset=".55" stopColor="#08090b" /><stop offset="1" stopColor="#23262c" />
        </linearGradient>
        <linearGradient id={`${id}gd`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe7a6" /><stop offset="1" stopColor="#c98f1d" />
        </linearGradient>
        <linearGradient id={`${id}fd`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".55" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}vg`} cx=".5" cy=".45" r=".75">
          <stop offset=".55" stopColor="#0b1a33" stopOpacity="0" /><stop offset="1" stopColor="#0b1a33" stopOpacity=".34" />
        </radialGradient>
        <filter id={`${id}b1`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12" /></filter>
        <filter id={`${id}b2`} x="-20%" y="-150%" width="140%" height="400%"><feGaussianBlur stdDeviation="5" /></filter>
        <filter id={`${id}b3`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
        <filter id={`${id}b4`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.6" /></filter>
        <clipPath id={`${id}cl`}><path d={OPEN_L} /></clipPath>
        <clipPath id={`${id}ct`}><rect x="0" y="187" width="440" height="61" /></clipPath>
        <mask id={`${id}mk`}><rect x="0" y="187" width="440" height="61" fill={u("fd")} /></mask>
      </defs>

      {/* Room out of focus */}
      <rect width="440" height="248" fill={u("bg")} />
      <g filter={u("b1")}>
        <circle cx="58" cy="44" r="36" fill="#ffffff" opacity=".75" />
        <circle cx="356" cy="30" r="46" fill={prog ? "#f4f9ff" : "#fff1d6"} opacity=".9" />
        <circle cx="210" cy="14" r="28" fill="#ffffff" opacity=".6" />
        <circle cx="428" cy="112" r="34" fill={prog ? "#8fb0e0" : "#e2bf92"} opacity=".7" />
        <circle cx="8" cy="120" r="34" fill={prog ? "#9bb8e2" : "#c9ac8a"} opacity=".65" />
        <circle cx="150" cy="60" r="22" fill={prog ? "#c9dcf5" : "#f6e3c4"} opacity=".5" />
      </g>
      {/* Table */}
      <path d="M0 150 H440 V248 H0 Z" fill={u("tb")} />
      <rect x="0" y="150" width="440" height="14" fill="#ffffff" opacity=".2" filter={u("b2")} />
      {/* Reflection of the frame on the table, fading out */}
      <g mask={u("mk")} opacity=".32">
        <g transform="translate(0 374) scale(1 -1)" filter={u("b4")}>{frame}</g>
      </g>
      <ellipse cx="220" cy="189" rx="178" ry="6" fill="#05080e" opacity=".5" filter={u("b2")} />

      {/* Temples going back, out of focus */}
      <g filter={u("b3")}>
        <path d="M52 62 L36 61 Q20 62 15 78 L3 150 L13 152 L24 98 Q28 84 52 84 Z" fill="#101216" />
        <path d="M52 62 L36 61 Q20 62 15 78 L3 150 L13 152 L24 98 Q28 84 52 84 Z" fill="#101216" transform={mirror} />
      </g>

      {/* Lenses, then the frame over them */}
      {eye}
      <g transform={mirror}>{eye}</g>
      {frame}
      <rect width="440" height="248" fill={u("vg")} />

      {/* Labels (live text, never mirrored) */}
      {prog ? (
        [127, 313].map((x) => (
          <g key={x}>
            <SceneText x={x} y={93} light size={12.5}>{labels.far}</SceneText>
            <SceneText x={x} y={105} light sub size={9.5}>{labels.farSub}</SceneText>
            <SceneText x={x} y={124} light size={12.5}>{labels.mid}</SceneText>
            <SceneText x={x} y={136} light sub size={9.5}>{labels.midSub}</SceneText>
            <SceneText x={x} y={155} light size={12.5}>{labels.near}</SceneText>
            <SceneText x={x} y={167} light sub size={9.5}>{labels.nearSub}</SceneText>
          </g>
        ))
      ) : (
        <>
          {[127, 313].map((x) => (
            <g key={x}>
              <SceneText x={x} y={90} size={12}>{labels.far}</SceneText>
              <SceneText x={x} y={102} sub size={9.5}>{labels.farSub}</SceneText>
              <SceneText x={x} y={146} size={10.5}>{labels.near}</SceneText>
              <SceneText x={x} y={158} sub size={9.5}>{labels.nearSub}</SceneText>
            </g>
          ))}
          <path d="M127 106 V118" stroke="#0a2a5c" strokeWidth="1.2" /><circle cx="127" cy="119.5" r="1.9" fill="#0a2a5c" />
          {flatTop && labels.seg ? (
            <g>
              <path d="M274 117 H352" stroke="#a8730f" strokeWidth="1.6" />
              <path d="m279 113-5 4 5 4M347 113l5 4-5 4" fill="none" stroke="#a8730f" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="291" y="108" width="44" height="18" rx="9" fill={u("gd")} stroke="#a8730f" strokeWidth=".8" />
              <text x="313" y="121" textAnchor="middle" fontSize="10.5" fontWeight="800" fill="#0a2a5c">{labels.seg}</text>
            </g>
          ) : (
            <><path d="M313 106 V118" stroke="#0a2a5c" strokeWidth="1.2" /><circle cx="313" cy="119.5" r="1.9" fill="#0a2a5c" /></>
          )}
        </>
      )}
    </svg>
  );
}
