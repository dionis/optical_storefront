import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";

// Premium loading indicator: a pair of glasses that floats in the air and
// SPINS a full 360° in real 3D. The 3D is genuine — the frame is extruded into
// depth by stacking several copies along the Z axis inside a `preserve-3d`
// scene, so as it turns you see a solid rotating object (not a flat wobble).
// Pure CSS: it appears instantly and never pulls three.js onto the loading
// path. Colours cycle through the Cuban flag (blue → white → red).
//
// Reusable across every "please wait" moment: catalog load, prescription OCR,
// 3D render, checkout. Pass `messages` (array of i18n keys) to tailor the copy;
// text is language-sensitive via the i18n dictionary.

const DEFAULT_MSGS = [
  "loader.catalog",   // Cargando el catálogo
  "loader.frames",    // Preparando tus monturas
  "loader.prices",    // Calculando precios
  "loader.almost",    // Casi listo
];

// Extrusion layers: each is one copy of the frame pushed to a different depth.
// Together they read as a solid, thick 3D frame when it turns. A wider spread
// (±15px, 11 layers) keeps the frame substantial even at the edge-on moment.
// Odd count keeps a clean centre layer.
const DEPTHS = [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15];

function Frame({ z, i, n }) {
  // Deeper layers render slightly darker to fake directional shading, and the
  // very front/back a touch brighter — this is what sells the volume.
  const mid = (n - 1) / 2;
  const bright = 1 - Math.abs(i - mid) * 0.06;
  return (
    <svg
      className="gll-layer"
      viewBox="0 0 240 108"
      style={{ transform: `translate(-50%,-50%) translateZ(${z}px)`, filter: `brightness(${bright})` }}
      aria-hidden="true"
    >
      {/* lens rims as filled rings (outer rounded rect minus inner) + bridge +
          temples. fillRule evenodd carves the lens opening out of each rim. */}
      <path
        className="gll-paint"
        fillRule="evenodd"
        d="M24 30h78a17 17 0 0 1 17 17v20a17 17 0 0 1-17 17H24A17 17 0 0 1 7 67V47A17 17 0 0 1 24 30Z
           M34 42h58a9 9 0 0 1 9 9v12a9 9 0 0 1-9 9H34a9 9 0 0 1-9-9V51a9 9 0 0 1 9-9Z"
      />
      <path
        className="gll-paint"
        fillRule="evenodd"
        d="M138 30h78a17 17 0 0 1 17 17v20a17 17 0 0 1-17 17h-78a17 17 0 0 1-17-17V47a17 17 0 0 1 17-17Z
           M148 42h58a9 9 0 0 1 9 9v12a9 9 0 0 1-9 9h-58a9 9 0 0 1-9-9V51a9 9 0 0 1 9-9Z"
      />
      {/* bridge */}
      <path className="gll-paint" d="M100 50q19 -12 38 0v7q-19 -10 -38 0Z" />
      {/* temples */}
      <path className="gll-paint" d="M7 50q-14 -8 -22 3l3 6q9 -9 20 -3Z" />
      <path className="gll-paint" d="M233 50q14 -8 22 3l-3 6q-9 -9 -20 -3Z" />
    </svg>
  );
}

export default function GlassesLoader({ messages = DEFAULT_MSGS, compact = false }) {
  const { t } = useLang();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!messages || messages.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % messages.length), 1800);
    return () => clearInterval(id);
  }, [messages]);

  const msgKey = messages && messages.length ? messages[i % messages.length] : null;

  return (
    <div className={`gll ${compact ? "gll-compact" : ""}`} role="status" aria-live="polite">
      <div className="gll-scene">
        <div className="gll-shadow" />
        <div className="gll-float">
          <div className="gll-spin">
            {DEPTHS.map((z, idx) => (
              <Frame key={z} z={z} i={idx} n={DEPTHS.length} />
            ))}
          </div>
        </div>
      </div>
      {msgKey && (
        <div className="gll-msg">
          {t(msgKey)}
          <span className="gll-dots" />
        </div>
      )}
      <div className="gll-pips" aria-hidden="true">
        <span className="gll-pip b" />
        <span className="gll-pip w" />
        <span className="gll-pip r" />
      </div>
    </div>
  );
}
