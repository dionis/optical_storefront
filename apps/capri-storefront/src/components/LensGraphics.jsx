/*
 * LensGraphics.jsx
 * -----------------------------------------------------------------------------
 * Original, self-contained SVG artwork for the lens funnel: a consistent line
 * icon set plus educational diagrams. Everything is inline SVG (no external
 * images), monochrome-by-default and responsive.
 *
 * Two families are exported:
 *
 *   1. ICONS  — one component per icon in the approved icon set. All share the
 *      same line style (24x24 grid, stroke 1.7, round caps/joins, fill none).
 *      Props: { size, color, active, strokeWidth, title, ...svgProps }.
 *        - Default tint is `currentColor` so an icon inherits its surrounding
 *          text color.
 *        - `active` paints it with the Cuban-flag red accent (--cuba-red),
 *          matching the selected/active state used across the storefront.
 *        - `color` overrides both.
 *
 *   2. DIAGRAMS — educational figures rendered as inline SVG with a viewBox and
 *      width:100% so they scale to any container. They reproduce the approved
 *      designs (thickness discs, progressive vision zones, polarized frame) and
 *      add four new figures in the same visual language (blue light, photochromic,
 *      night driving, vision fields).
 *
 * Palette: Cuban flag — azul --cuba-blue (#002A8F) as the base/line ink, rojo
 * --cuba-red (#CF142B) as the active/selected accent, white as the surface.
 * These CSS vars are defined in styles/index.css. Icons consume them through the
 * SVG `color` (so both stroke and fill dots follow the accent); diagrams use the
 * matching hex constants below for gradient stops and multi-color artwork.
 */

// Hex mirrors of the CSS custom properties, for use inside SVG gradients and
// multi-fill artwork where CSS var() is not valid in presentation attributes.
const BLUE = "#002A8F"; // --cuba-blue
const RED = "#CF142B"; // --cuba-red
const INK = "#3a3f4a";
const MUT = "#6b7280";
const LINE = "#d8dee9";
const NEUT = "#eef1f6";

// Resolve an in-artwork label through the app's t() when a translator is passed
// in, falling back to the Spanish literal baked into the diagram. This keeps the
// SVGs self-contained (they still render standalone) while letting the lens
// funnel show them in the active language. All keys live in translations.js
// under `edu.*` with es/en parity enforced there.
function txt(t, key, fallback) {
  if (typeof t !== "function") return fallback;
  const v = t(key);
  return v && v !== key ? v : fallback;
}

/* ===========================================================================
 * ICONS
 * ======================================================================== */

// Shared wrapper: fixes the 24x24 line-icon style and resolves the tint.
// We drive the tint through CSS `color` (via style) so `currentColor` on both
// the strokes and the small filled dots resolves to the same accent.
function IconBase({
  size = 24,
  color,
  active = false,
  strokeWidth = 1.7,
  title,
  className = "",
  style,
  children,
  ...rest
}) {
  const tint = color || (active ? "var(--cuba-red)" : "currentColor");
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`lens-ico${active ? " is-active" : ""}${className ? " " + className : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      style={{ color: tint, ...style }}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

// Small filled accents (dots) inherit the tint via currentColor.
const fillProps = { fill: "currentColor", stroke: "none" };

// ---- Funnel steps ----
export function IconReceta(p) {
  return (
    <IconBase {...p}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h4" />
      <circle cx="17.5" cy="16.5" r="2.4" />
    </IconBase>
  );
}
export function IconMaterial(p) {
  return (
    <IconBase {...p}>
      <ellipse cx="9" cy="12" rx="3.2" ry="8" />
      <path d="M9 4c3 0 6 3.6 6 8s-3 8-6 8" />
      <path d="M12 4c3 0 5.5 3.6 5.5 8s-2.5 8-5.5 8" opacity=".55" />
    </IconBase>
  );
}
export function IconTratamiento(p) {
  return (
    <IconBase {...p}>
      <path d="M12 3l1.9 4.3L18.5 8l-3.3 3.1.8 4.6L12 13.9 7.9 15.7l.8-4.6L5.4 8l4.7-.7z" />
    </IconBase>
  );
}
export function IconGrados(p) {
  return (
    <IconBase {...p}>
      <path d="M4 15a8 8 0 0 1 16 0" />
      <path d="M12 15l4-4" />
      <circle cx="12" cy="15" r="1.3" {...fillProps} />
    </IconBase>
  );
}

// ---- Lens types ----
export function IconSencilla(p) {
  return (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" opacity=".35" />
    </IconBase>
  );
}
export function IconBifocal(p) {
  return (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M6 15h12" />
      <path d="M9.5 17.5a3 3 0 0 0 5 0" opacity=".6" />
    </IconBase>
  );
}
export function IconProgresivo(p) {
  return (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 6.5c0 3 6 3 6 6.5s-3 4-3 6" opacity=".7" />
      <circle cx="12" cy="7.5" r="1" {...fillProps} />
      <circle cx="12" cy="16.5" r="1" {...fillProps} />
    </IconBase>
  );
}
export function IconSol(p) {
  return (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8" />
    </IconBase>
  );
}

// ---- Treatments / materials ----
export function IconAr(p) {
  return (
    <IconBase {...p}>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M4 4l16 16" />
    </IconBase>
  );
}
export function IconAzul(p) {
  return (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="12" rx="1.6" />
      <path d="M9 20h6M12 16v4" />
      <path d="M8 10h8" opacity=".5" />
    </IconBase>
  );
}
export function IconPolarizado(p) {
  return (
    <IconBase {...p}>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <path d="M9 8.5l6 7M12 7.5l4.5 6" opacity=".55" />
    </IconBase>
  );
}
export function IconFotocromatico(p) {
  return (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 0 0 16z" {...fillProps} />
    </IconBase>
  );
}
export function IconUv(p) {
  return (
    <IconBase {...p}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 10v2.5a1.5 1.5 0 0 0 3 0V10M14 10v4" opacity=".8" />
    </IconBase>
  );
}
export function IconIndice(p) {
  return (
    <IconBase {...p}>
      <path d="M5 6c4-2 10-2 14 0M6 18c3.5 1.6 8.5 1.6 12 0" opacity=".5" />
      <path d="M5 6c2 2 2 10 0 12M19 6c-2 2-2 10 0 12" />
    </IconBase>
  );
}
export function IconConduccion(p) {
  return (
    <IconBase {...p}>
      <path d="M4 14l1.5-4.5A2 2 0 0 1 7.4 8h9.2a2 2 0 0 1 1.9 1.5L20 14v4h-2v-2H6v2H4z" />
      <circle cx="7.5" cy="15.5" r="1" {...fillProps} />
      <circle cx="16.5" cy="15.5" r="1" {...fillProps} />
    </IconBase>
  );
}

// ---- Actions ----
export function IconCarrito(p) {
  return (
    <IconBase {...p}>
      <path d="M3 4h2l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h8.1a1.5 1.5 0 0 0 1.5-1.2L20 8H6" />
      <circle cx="9.5" cy="20" r="1.3" {...fillProps} />
      <circle cx="17.5" cy="20" r="1.3" {...fillProps} />
    </IconBase>
  );
}
export function IconComprar(p) {
  return (
    <IconBase {...p}>
      <path d="M6 7h12l-1 13H7z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
      <path d="M9.5 13l2 2 3.5-3.5" opacity=".85" />
    </IconBase>
  );
}
export function IconFavorito(p) {
  return (
    <IconBase {...p}>
      <path d="M12 20s-7-4.3-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.8C19 15.7 12 20 12 20z" />
    </IconBase>
  );
}
export function IconMontura(p) {
  return (
    <IconBase {...p}>
      <circle cx="6.5" cy="13" r="3.5" />
      <circle cx="17.5" cy="13" r="3.5" />
      <path d="M10 12.5c1-1 3-1 4 0M3 11l1.5-1M21 11l-1.5-1" />
    </IconBase>
  );
}

// Registry: name -> icon component, for data-driven rendering.
export const ICONS = {
  receta: IconReceta,
  material: IconMaterial,
  tratamiento: IconTratamiento,
  grados: IconGrados,
  sencilla: IconSencilla,
  bifocal: IconBifocal,
  progresivo: IconProgresivo,
  sol: IconSol,
  ar: IconAr,
  azul: IconAzul,
  polarizado: IconPolarizado,
  fotocromatico: IconFotocromatico,
  uv: IconUv,
  indice: IconIndice,
  conduccion: IconConduccion,
  carrito: IconCarrito,
  comprar: IconComprar,
  favorito: IconFavorito,
  montura: IconMontura,
};

// Convenience: <LensIcon name="progresivo" active /> renders by key.
export function LensIcon({ name, ...rest }) {
  const Cmp = ICONS[name];
  return Cmp ? <Cmp {...rest} /> : null;
}

/* ===========================================================================
 * DIAGRAMS
 * ======================================================================== */

// Shared responsive SVG wrapper for diagrams.
function DiagSvg({ viewBox, title, className = "", children, ...rest }) {
  return (
    <svg
      viewBox={viewBox}
      className={`lens-diag${className ? " " + className : ""}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role={title ? "img" : "presentation"}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

const labelStyle = { fill: MUT, fontSize: 11, fontFamily: "sans-serif", textAnchor: "middle" };
const labelHi = { fill: RED, fontSize: 11, fontFamily: "sans-serif", textAnchor: "middle" };

// ---------------------------------------------------------------------------
// DiagThickness — 3D glass discs, edge (canto) thinning from CR-39 to super
// high index. Faithful reproduction of thick.html (same geometry algorithm).
// ---------------------------------------------------------------------------
export function DiagThickness({ t, ...props }) {
  const rx = 22;
  const ry = 54;
  const cy = 78;
  // [label, edge thickness, front-face x]
  const data = [
    [txt(t, "edu.thickness.cr39", "CR-39"), 34, 70],
    [txt(t, "edu.thickness.poly", "Policarbonato"), 25, 175],
    [txt(t, "edu.thickness.high", "Alto índice"), 15, 275],
    [txt(t, "edu.thickness.super", "Súper alto índice"), 7, 365],
  ];
  const top = cy - ry;
  const bot = cy + ry;
  return (
    <DiagSvg viewBox="0 0 480 190" {...props}>
      <defs>
        <linearGradient id="lg-face" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#f2f8ff" />
          <stop offset=".55" stopColor="#d4e6f6" />
          <stop offset="1" stopColor="#b7d0e8" />
        </linearGradient>
        <linearGradient id="lg-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7f9db9" />
          <stop offset=".45" stopColor="#cfe1f2" />
          <stop offset="1" stopColor="#9fbcd7" />
        </linearGradient>
      </defs>
      {data.map(([label, T, x]) => {
        const bx = x - T; // back-face x
        const edge = `M ${bx} ${top} A ${rx} ${ry} 0 0 0 ${bx} ${bot} L ${x} ${bot} A ${rx} ${ry} 0 0 1 ${x} ${top} Z`;
        return (
          <g key={label}>
            {/* back face (far side of the glass) */}
            <ellipse cx={bx} cy={cy} rx={rx} ry={ry} fill="#a9c4de" />
            {/* visible glass thickness (the canto) on the left */}
            <path d={edge} fill="url(#lg-edge)" />
            {/* top sliver smoothing the coin */}
            <path d={`M ${bx} ${top} L ${x} ${top}`} stroke="#cfe1f2" strokeWidth="1" />
            {/* front face */}
            <ellipse cx={x} cy={cy} rx={rx} ry={ry} fill="url(#lg-face)" stroke="#eaf3ff" strokeWidth="1.4" />
            {/* front highlight */}
            <path
              d={`M ${x - 9} ${cy - 30} q -8 30 4 58`}
              stroke="#ffffff"
              strokeWidth="2.4"
              fill="none"
              opacity=".5"
              strokeLinecap="round"
            />
            <text x={bx + T / 2} y="172" style={labelStyle}>
              {label}
            </text>
          </g>
        );
      })}
      <text x="240" y="188" style={labelHi}>
        {txt(t, "edu.thickness.hint", "más índice → borde más fino y ligero")}
      </text>
    </DiagSvg>
  );
}

// ---------------------------------------------------------------------------
// DiagProgressive — progressive vision zones: traditional (narrow corridor,
// wide/close blur) vs high-end (wide corridor, small/apart blur).
// Reproduces the clip-path layout of diagrams.html, retuned to the Cuban
// palette for a light surface.
// ---------------------------------------------------------------------------
export function DiagProgressive({ t, ...props }) {
  return (
    <DiagSvg viewBox="0 0 340 170" {...props}>
      <defs>
        <clipPath id="pg-lT">
          <rect x="14" y="12" width="130" height="140" rx="26" />
        </clipPath>
        <clipPath id="pg-lH">
          <rect x="196" y="12" width="130" height="140" rx="26" />
        </clipPath>
      </defs>

      {/* TRADITIONAL: blur big & close -> narrow corridor */}
      <g clipPath="url(#pg-lT)">
        <rect x="14" y="12" width="130" height="140" fill={NEUT} />
        <circle cx="14" cy="82" r="58" fill="#b7c0cf" />
        <circle cx="144" cy="82" r="58" fill="#b7c0cf" />
      </g>
      <rect x="14" y="12" width="130" height="140" rx="26" fill="none" stroke={BLUE} strokeWidth="1.6" />
      <line x1="79" y1="20" x2="79" y2="144" stroke={BLUE} strokeDasharray="4 4" opacity=".8" />
      <path d="M64 82 A15 62 0 0 0 94 82" fill="none" stroke={BLUE} strokeWidth="1.4" />
      <text x="79" y="164" style={labelStyle}>
        {txt(t, "edu.progressive.traditional", "Tradicional · pasillo estrecho")}
      </text>

      {/* HIGH-END: blur small & apart -> wide corridor */}
      <g clipPath="url(#pg-lH)">
        <rect x="196" y="12" width="130" height="140" fill={NEUT} />
        <circle cx="196" cy="88" r="34" fill="#b7c0cf" />
        <circle cx="326" cy="88" r="34" fill="#b7c0cf" />
      </g>
      <rect x="196" y="12" width="130" height="140" rx="26" fill="none" stroke={RED} strokeWidth="1.6" />
      <path d="M234 20 v124 M288 20 v124" stroke={RED} strokeDasharray="4 4" opacity=".85" />
      <text x="261" y="164" style={labelHi}>
        {txt(t, "edu.progressive.premium", "Alta gama · pasillo ancho")}
      </text>
    </DiagSvg>
  );
}

// ---------------------------------------------------------------------------
// DiagPolarized — one frame, two lenses: non-polarized (glare, washed) vs
// polarized (glare cut, clear/vivid). Reproduces the sol figure of
// diagrams.html with the Cuban-blue frame.
// ---------------------------------------------------------------------------
export function DiagPolarized({ t, ...props }) {
  return (
    <DiagSvg viewBox="0 0 340 150" {...props}>
      <defs>
        <clipPath id="pz-Lp">
          <ellipse cx="96" cy="74" rx="52" ry="40" />
        </clipPath>
        <clipPath id="pz-Rp">
          <ellipse cx="244" cy="74" rx="52" ry="40" />
        </clipPath>
        <linearGradient id="pz-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7db6e8" />
          <stop offset="1" stopColor="#cfe6f7" />
        </linearGradient>
      </defs>

      {/* left lens: washed + glare */}
      <g clipPath="url(#pz-Lp)">
        <rect x="44" y="34" width="104" height="80" fill="url(#pz-sky)" opacity=".55" />
        <path d="M44 96 L78 66 L100 84 L124 58 L148 90 V114 H44 Z" fill="#9fb0c0" opacity=".5" />
        <rect x="44" y="34" width="104" height="80" fill="#fff" opacity=".33" />
        <g stroke="#fde68a" strokeWidth="3" opacity=".9">
          <path d="M56 52 l20 16M96 44 l16 26M120 50 l18 20" />
        </g>
      </g>
      {/* right lens: clear / vivid */}
      <g clipPath="url(#pz-Rp)">
        <rect x="192" y="34" width="104" height="80" fill="url(#pz-sky)" />
        <path d="M192 96 L226 60 L250 82 L272 52 L296 92 V114 H192 Z" fill="#3f6f4b" />
        <path d="M226 60 l10 14 M272 52 l12 18" stroke="#dff3e6" strokeWidth="2" opacity=".7" />
      </g>
      {/* frame */}
      <g fill="none" stroke={BLUE} strokeWidth="3.4">
        <ellipse cx="96" cy="74" rx="52" ry="40" />
        <ellipse cx="244" cy="74" rx="52" ry="40" />
        <path d="M148 66 q22 -8 44 0" />
        <path d="M44 62 l-16 -6M296 62 l16 -6" />
      </g>
      <text x="96" y="132" style={labelStyle}>
        {txt(t, "edu.polarized.off", "Sin polarizar")}
      </text>
      <text x="244" y="132" style={labelHi}>
        {txt(t, "edu.polarized.on", "Polarizado")}
      </text>
    </DiagSvg>
  );
}

// ---------------------------------------------------------------------------
// DiagBlueLight — screens (monitor / tablet / phone) emit blue light; the lens
// filters it -> less eye strain, better sleep (moon). Same line-diagram style.
// ---------------------------------------------------------------------------
export function DiagBlueLight({ t, ...props }) {
  return (
    <DiagSvg viewBox="0 0 340 160" {...props}>
      {/* devices */}
      <g fill={NEUT} stroke={INK} strokeWidth="1.6" strokeLinejoin="round">
        {/* monitor */}
        <rect x="18" y="30" width="66" height="44" rx="4" />
        <path d="M44 74v10M36 84h30" fill="none" />
        {/* tablet */}
        <rect x="24" y="92" width="34" height="46" rx="4" />
        {/* phone */}
        <rect x="66" y="104" width="20" height="34" rx="4" />
      </g>
      {/* screens glowing blue */}
      <g fill={BLUE} opacity=".18">
        <rect x="23" y="35" width="56" height="34" rx="2" />
        <rect x="28" y="97" width="26" height="36" rx="2" />
        <rect x="69" y="108" width="14" height="24" rx="2" />
      </g>

      {/* emitted blue rays travelling right toward the lens */}
      <g fill="none" stroke={BLUE} strokeWidth="2" strokeLinecap="round" opacity=".8">
        <path d="M96 52 q14 -6 28 0 q14 6 28 0" />
        <path d="M96 74 q14 -6 28 0 q14 6 28 0" />
        <path d="M96 96 q14 -6 28 0 q14 6 28 0" />
      </g>

      {/* filtering lens (blue-light coat) */}
      <g>
        <ellipse cx="176" cy="80" rx="18" ry="46" fill={BLUE} opacity=".1" stroke={BLUE} strokeWidth="2" />
        <path d="M176 40 q-8 40 0 80" fill="none" stroke="#fff" strokeWidth="3" opacity=".6" strokeLinecap="round" />
      </g>
      {/* rays blocked: short red ticks past the lens */}
      <g stroke={RED} strokeWidth="2.4" strokeLinecap="round">
        <path d="M192 66 l10 -6M192 80 l12 0M192 94 l10 6" />
      </g>

      {/* benefit: relaxed eye + moon */}
      <g fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M236 62 q18 -16 36 0 q-18 16 -36 0z" />
        <circle cx="254" cy="62" r="5" fill={BLUE} stroke="none" />
      </g>
      {/* crescent moon = better sleep */}
      <path
        d="M300 96 a18 18 0 1 1 -14 -29 a14 14 0 0 0 14 29z"
        fill={BLUE}
        opacity=".85"
      />
      <g fill={MUT} fontFamily="sans-serif" fontSize="12" fontWeight="700">
        <text x="286" y="60">z</text>
        <text x="294" y="52">z</text>
      </g>

      <text x="55" y="152" style={labelStyle}>
        {txt(t, "edu.bluelight.screens", "Pantallas · luz azul")}
      </text>
      <text x="270" y="132" style={labelHi}>
        {txt(t, "edu.bluelight.benefit", "Menos fatiga · mejor sueño")}
      </text>
    </DiagSvg>
  );
}

// ---------------------------------------------------------------------------
// DiagPhotochromic — lens darkens as sunlight grows: indoors -> sun -> strong
// sun. Three lens states with rising sun intensity.
// ---------------------------------------------------------------------------
export function DiagPhotochromic({ t, ...props }) {
  // [cx, label, tint opacity, sun rays count/strength]
  const stages = [
    { cx: 62, label: txt(t, "edu.photochromic.indoor", "Interior"), tint: 0.04, sun: 0 },
    { cx: 170, label: txt(t, "edu.photochromic.sun", "Sol"), tint: 0.32, sun: 1 },
    { cx: 278, label: txt(t, "edu.photochromic.strong", "Sol fuerte"), tint: 0.62, sun: 2 },
  ];
  return (
    <DiagSvg viewBox="0 0 340 160" {...props}>
      {stages.map(({ cx, label, tint, sun }, i) => (
        <g key={label}>
          {/* sun above, intensity grows */}
          {sun > 0 && (
            <g stroke={RED} strokeWidth={sun === 2 ? 2.6 : 1.8} strokeLinecap="round">
              <circle cx={cx} cy="26" r={sun === 2 ? 9 : 7} fill={RED} stroke="none" opacity=".9" />
              <path
                d={`M${cx} 10v6M${cx} 36v6M${cx - 16} 26h6M${cx + 10} 26h6M${cx - 12} 14l4 4M${cx + 8} 34l4 4M${cx - 12} 38l4 -4M${cx + 8} 18l4 -4`}
                opacity={sun === 2 ? 1 : 0.7}
              />
            </g>
          )}
          {sun === 0 && (
            <g fill="none" stroke={MUT} strokeWidth="1.6" strokeLinecap="round">
              {/* little indoor lamp glyph */}
              <path d="M62 14v6" />
              <path d="M55 30a7 7 0 0 1 14 0z" fill={NEUT} />
            </g>
          )}
          {/* lens: base outline + darkening tint fill */}
          <ellipse cx={cx} cy="86" rx="30" ry="42" fill={BLUE} fillOpacity={tint} stroke={BLUE} strokeWidth="2" />
          <path d={`M${cx - 10} 56 q-8 30 4 58`} fill="none" stroke="#fff" strokeWidth="2.4" opacity=".5" strokeLinecap="round" />
          <text x={cx} y="146" style={i === 2 ? labelHi : labelStyle}>
            {label}
          </text>
          {/* progression arrow */}
          {i < stages.length - 1 && (
            <path
              d={`M${cx + 34} 86 h30`}
              fill="none"
              stroke={MUT}
              strokeWidth="1.6"
              markerEnd="url(#pc-arrow)"
            />
          )}
        </g>
      ))}
      <defs>
        <marker id="pc-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0 1 L6 4 L0 7 Z" fill={MUT} />
        </marker>
      </defs>
    </DiagSvg>
  );
}

// ---------------------------------------------------------------------------
// DiagNightDrive — oncoming headlights: with glare halos vs sharp/clear.
// Night scene (dark surface), warm headlights, red benefit label.
// ---------------------------------------------------------------------------
export function DiagNightDrive({ t, ...props }) {
  return (
    <DiagSvg viewBox="0 0 340 150" {...props}>
      {/* two night panels */}
      <rect x="10" y="14" width="150" height="96" rx="10" fill="#0b1830" />
      <rect x="180" y="14" width="150" height="96" rx="10" fill="#0b1830" />

      {/* road hints */}
      <g stroke="#26324a" strokeWidth="2" strokeLinecap="round">
        <path d="M40 108 L70 70M130 108 L100 70" />
        <path d="M210 108 L240 70M300 108 L270 70" />
      </g>

      {/* LEFT: headlights with big glare halos */}
      <g>
        <circle cx="70" cy="60" r="18" fill="#ffe9a8" opacity=".18" />
        <circle cx="70" cy="60" r="12" fill="#ffe9a8" opacity=".28" />
        <circle cx="70" cy="60" r="6" fill="#fff4cf" />
        <circle cx="100" cy="60" r="18" fill="#ffe9a8" opacity=".18" />
        <circle cx="100" cy="60" r="12" fill="#ffe9a8" opacity=".28" />
        <circle cx="100" cy="60" r="6" fill="#fff4cf" />
        {/* starburst glare */}
        <g stroke="#ffe9a8" strokeWidth="1.4" opacity=".7" strokeLinecap="round">
          <path d="M70 40v-8M70 80v8M50 60h-8M90 60h8M100 40v-8M100 80v8M80 60h-8M120 60h8" />
        </g>
      </g>

      {/* RIGHT: crisp headlights, no halo */}
      <g>
        <circle cx="240" cy="60" r="6" fill="#fff4cf" stroke="#ffe9a8" strokeWidth="1.4" />
        <circle cx="270" cy="60" r="6" fill="#fff4cf" stroke="#ffe9a8" strokeWidth="1.4" />
      </g>

      <text x="85" y="128" style={labelStyle}>
        {txt(t, "edu.nightdrive.off", "Sin filtro · halos")}
      </text>
      <text x="255" y="128" style={labelHi}>
        {txt(t, "edu.nightdrive.on", "Con filtro · nítido")}
      </text>
    </DiagSvg>
  );
}

// ---------------------------------------------------------------------------
// DiagVisionFields — the three working distances a progressive covers:
// lejos (far) / intermedia (screen) / cerca (reading), mapped down a lens.
// ---------------------------------------------------------------------------
export function DiagVisionFields({ t, ...props }) {
  return (
    <DiagSvg viewBox="0 0 340 170" {...props}>
      {/* lens body */}
      <rect x="30" y="14" width="150" height="142" rx="34" fill={NEUT} stroke={BLUE} strokeWidth="2" />
      {/* zone dividers */}
      <path d="M30 62 h150 M30 108 h150" stroke={LINE} strokeWidth="1.4" strokeDasharray="4 4" />
      {/* focus corridor down the middle */}
      <path d="M105 20 v130" stroke={RED} strokeWidth="1.6" strokeDasharray="4 4" opacity=".8" />

      {/* FAR zone — mountains */}
      <g fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M60 50 l14 -18 l10 12 l8 -8 l16 22" />
      </g>
      <circle cx="70" cy="30" r="4" fill={RED} stroke="none" />

      {/* INTERMEDIATE zone — monitor */}
      <g fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round">
        <rect x="88" y="74" width="36" height="22" rx="2" />
        <path d="M106 96 v6 M96 102 h20" strokeLinecap="round" />
      </g>

      {/* NEAR zone — open book */}
      <g fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M84 138 q18 -8 22 -2 q4 -6 22 2 M106 136 v-8" />
        <path d="M90 132 h10 M112 132 h10" opacity=".6" />
      </g>

      {/* side labels with leader lines */}
      <g stroke={LINE} strokeWidth="1.2">
        <path d="M180 40 h26 M180 86 h26 M180 132 h26" />
      </g>
      <g fontFamily="sans-serif" fontSize="13" fontWeight="600">
        <text x="212" y="36" fill={INK}>
          {txt(t, "edu.visionfields.far", "Lejos")}
        </text>
        <text x="212" y="45" fill={MUT} fontSize="10" fontWeight="400">
          {txt(t, "edu.visionfields.farSub", "conducir, calle")}
        </text>
        <text x="212" y="82" fill={INK}>
          {txt(t, "edu.visionfields.mid", "Intermedia")}
        </text>
        <text x="212" y="91" fill={MUT} fontSize="10" fontWeight="400">
          {txt(t, "edu.visionfields.midSub", "computadora")}
        </text>
        <text x="212" y="128" fill={INK}>
          {txt(t, "edu.visionfields.near", "Cerca")}
        </text>
        <text x="212" y="137" fill={MUT} fontSize="10" fontWeight="400">
          {txt(t, "edu.visionfields.nearSub", "leer, móvil")}
        </text>
      </g>
    </DiagSvg>
  );
}

// Registry for data-driven diagram rendering.
export const DIAGRAMS = {
  thickness: DiagThickness,
  progressive: DiagProgressive,
  polarized: DiagPolarized,
  blueLight: DiagBlueLight,
  photochromic: DiagPhotochromic,
  nightDrive: DiagNightDrive,
  visionFields: DiagVisionFields,
};
