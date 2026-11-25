// Icons of the web material chooser (MaterialChooser.jsx): the owner's own icon
// set (medal, eye, glasses, check ring, laptop, car, book, layers, shield,
// feather) drawn on its 36 × 34 grid, plain or inside a glossy round badge in
// one of the set's three tones. The photos of the chooser (lenses, thickness
// discs, glasses) are files under public/ui/lens/, not drawings.
import { useId } from "react";

const uid = (raw) => raw.replace(/[^a-zA-Z0-9]/g, "");

// The set's gradients, top-left to bottom (x2 = .23, y2 = 1).
const TONES = {
  gold: ["#fff9d0", "#ffe789", "#e8a329", "#ad6911"],
  ice: ["#ffffff", "#eff9ff", "#b6dbf6", "#75add8"],
  navy: ["#5289be", "#235483", "#0d2d55", "#061a33"],
  blue: ["#a2e4ff", "#51a8ee", "#1666ae", "#082e60"],
};
const Gradient = ({ id, tone }) => (
  <linearGradient id={id} x1="0" y1="0" x2="0.23" y2="1">
    {TONES[tone].map((c, i) => <stop key={i} offset={i / 3} stopColor={c} />)}
  </linearGradient>
);

// Stroke symbols on the 36 × 34 grid (stroke 2.05, round joins). `span`,
// `thickness` and `check` complete the set in the same hand.
const SYMBOLS = {
  ojo: <><path d="M4 16q14-16 28 0Q18 32 4 16Z" /><circle cx="18" cy="16" r="5" /><circle cx="18" cy="16" r="1.5" fill="currentColor" stroke="none" /></>,
  espejuelos: <path d="M3 11h30M5 12c0 8 1 11 6 11s6-4 6-8c0-3-2-3-5-3Zm26 0c0 8-1 11-6 11s-6-4-6-8c0-3 2-3 5-3Z" />,
  verificado: <path d="M28 15a11 11 0 1 1-7-9m-9 10 4 4L29 7" />,
  computadora: <><rect x="7" y="6" width="22" height="16" rx="1.5" /><path d="m7 22-4 5h30l-4-5" /></>,
  conduccion: <path d="m7 12 3-6h16l3 6M5 23v3h4v-3m18 0v3h4v-3M5 16q0-4 5-4h16q5 0 5 4v7H5Zm4 2h4m10 0h4" />,
  lectura: <path d="M18 8Q11 3 5 6v19q6-3 13 2 7-5 13-2V6q-6-3-13 2zm0 0v19" />,
  capas: <path d="m4 11 14-7 14 7-14 7Zm0 6 14 7 14-7M4 23l14 7 14-7" />,
  escudo: <path d="M18 4Q24 8 30 8v8q0 8-12 13Q6 24 6 16V8q6 0 12-4zm-5 12 4 4 7-8" />,
  pluma: <path d="M5 29 27 8m-17 16C5 11 21 3 31 4c1 10-9 24-21 20zm8-7 1-8m-5 12 8-1" />,
  span: <path d="M4 17h28M10 11l-6 6 6 6M26 11l6 6-6 6" />,
  thickness: <path d="M5 17h26M18 4v8m-4-4 4 4 4-4M18 30v-8m-4 4 4-4 4 4" />,
  check: <path d="m9 17.5 6.5 6.5L27 11" strokeWidth="3.2" />,
};
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.05, strokeLinecap: "round", strokeLinejoin: "round" };

/** One symbol of the set, in the text colour. */
export function Glyph({ name, size = 24, className }) {
  return (
    <svg className={className} width={size} height={Math.round((size * 34) / 36)} viewBox="0 0 36 34" aria-hidden="true" focusable="false">
      <g {...stroke}>{SYMBOLS[name]}</g>
    </svg>
  );
}

/** The quality seal: gold medal on its blue ribbon (it carries its own colours). */
export function Medal({ size = 36, className }) {
  const id = uid(useId());
  return (
    <svg className={className} width={size} height={Math.round((size * 34) / 36)} viewBox="0 0 36 34" aria-hidden="true" focusable="false">
      <defs><Gradient id={`${id}g`} tone="gold" /><Gradient id={`${id}b`} tone="blue" /></defs>
      <g {...stroke} stroke="#0a2341">
        <path fill={`url(#${id}b)`} stroke="none" d="m10 20-4 10 7-2 3 3 3-11 3 11 3-3 7 2-5-11z" />
        <circle cx="18" cy="13" r="11" fill={`url(#${id}g)`} stroke="#bb7d20" strokeWidth=".7" />
        <circle cx="18" cy="13" r="8.5" stroke="#fff4b4" strokeWidth=".8" />
        <path d="m13.5 13 3 3 6-6" />
      </g>
    </svg>
  );
}

/**
 * A symbol inside the set's glossy round badge. `tone`: gold | ice | navy
 * (white symbol on navy, navy symbol on the other two).
 */
export function Badge({ name, tone = "gold", size = 30, className }) {
  const id = uid(useId());
  return (
    <svg className={className} width={size} height={Math.round((size * 66) / 70)} viewBox="0 0 70 66" aria-hidden="true" focusable="false">
      <defs>
        <Gradient id={`${id}t`} tone={tone} />
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0.23" y2="1">
          <stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="35" cy="33" rx="35" ry="33" fill={`url(#${id}t)`} />
      <ellipse cx="29" cy="19" rx="19" ry="10" fill={`url(#${id}s)`} opacity=".65" />
      <g transform="translate(10 9) scale(1.389 1.412)" {...stroke} color={tone === "navy" ? "#fff" : "#0a2341"}>{SYMBOLS[name]}</g>
    </svg>
  );
}

/** The glass lens of the popup header. */
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
