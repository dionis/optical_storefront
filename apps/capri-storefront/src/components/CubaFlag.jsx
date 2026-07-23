// Cuban flag emblem (allegory for the store's audience — Cubans on the island),
// drawn as an SVG so it scales crisply and can wave gently via CSS. Kept tasteful:
// used at low opacity as a decorative motif, never over readable text.
export default function CubaFlag({ className = "" }) {
  return (
    <svg className={`cuba-flag ${className}`} viewBox="0 0 120 60" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {/* 5 stripes: blue / white / blue / white / blue */}
      <rect width="120" height="60" fill="#fff" />
      <rect y="0" width="120" height="12" fill="#0E5AD0" />
      <rect y="24" width="120" height="12" fill="#0E5AD0" />
      <rect y="48" width="120" height="12" fill="#0E5AD0" />
      {/* red triangle at the hoist */}
      <polygon points="0,0 0,60 52,30" fill="#FD0E3F" />
      {/* white five-point star */}
      <g transform="translate(17,30)">
        <path d="M0 -8 L2.35 -2.47 L8.31 -2.47 L3.63 1.06 L5.29 6.47 L0 3.2 L-5.29 6.47 L-3.63 1.06 L-8.31 -2.47 L-2.35 -2.47 Z" fill="#fff" />
      </g>
    </svg>
  );
}
