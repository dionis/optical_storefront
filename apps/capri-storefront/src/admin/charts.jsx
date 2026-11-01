import { useEffect, useState, useRef, useId } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";

// ---------------------------------------------------------------------------
// Capri admin dashboard — dependency-free, responsive, accessible SVG charts.
// Enhanced with mount entrance animations, hover motion and rich Spanish
// tooltips. All keyframes live in admin.css (prefixed `cx-` / `cx…`) and are
// disabled under `prefers-reduced-motion: reduce`.
// Brand palette. Neutrals follow the panel's --adm-* tokens (admin.css) so the
// charts switch with light/dark mode; the hex is the fallback outside the panel.
// Non-invasive: the accent carries the main series, the second series is a
// muted blue (--adm-chart-2), gridlines are hairlines and axis text is 11 px
// muted. Semantic green/red appear only in deltas (tooltips, KPI pills).
const BRAND = {
  primary: "var(--adm-chart-1, var(--adm-accent, #4f5bd5))",
  accent: "var(--adm-chart-2, #7d8bbf)",
  ink: "var(--adm-ink, #16181d)",
  muted: "var(--adm-chart-axis, var(--adm-muted, #5c6470))",
  line: "var(--adm-chart-grid, var(--adm-line, #e6e8ec))",
  soft: "var(--adm-surface-2, #f5f6f8)",
  surface: "var(--adm-surface, #fff)",
  ok: "var(--adm-green-dark, #10754d)",
  warn: "var(--adm-gold-dark, #8a5a0c)",
};

// Categorical palette for donut / funnel / multi-series when no explicit color
// is given: the store accent first, then muted blues/greys and one warm sand
// (tokens --adm-chart-* in admin.css, light and dark).
const PALETTE = [
  "var(--adm-chart-1, var(--adm-accent, #4f5bd5))",
  "var(--adm-chart-2, #7d8bbf)",
  "var(--adm-chart-4, #c3b48a)",
  "var(--adm-chart-5, #6f9bb3)",
  "var(--adm-chart-3, #a3acc4)",
  "var(--adm-chart-6, #b8bfcf)",
  "var(--adm-purple, #6d4fc2)",
  "var(--adm-gold, #c9a24a)",
];

const FONT = 'var(--adm-font, "Manrope", system-ui, sans-serif)';
const DISPLAY = 'var(--adm-display, "Fraunces", Georgia, serif)';
const AXIS_FS = 11;           // axis / label text, never below 11 px
const LINE_W = 1.5;           // series stroke
const BAR_FRAC = 0.6;         // bar width as a fraction of its slot
const HAIR = { strokeWidth: 1, vectorEffect: "non-scaling-stroke" }; // gridlines stay 1 px whatever the scale
const AREA_OP = "var(--adm-chart-area, 0.16)";

/**
 * Real width of the chart box (ResizeObserver), so the SVG draws 1:1 and the
 * text keeps its pixel size at 120–160 px tall cards instead of being scaled
 * down with a fixed 720-wide viewBox. Falls back to 720 before the first measure.
 */
function useBoxWidth(fallback = 720) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => { const cw = Math.round(e.contentRect.width); if (cw > 0) setW(cw); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---- helpers --------------------------------------------------------------
function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "0";
  const neg = n < 0;
  const abs = Math.abs(n);
  const rounded =
    abs % 1 === 0 ? String(abs) : String(Math.round(abs * 100) / 100);
  const [int, dec] = rounded.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + grouped + (dec ? "." + dec : "");
}

// "nice" upper bound for an axis given a raw max.
function niceMax(max) {
  if (!max || max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = Math.pow(10, exp);
  const frac = max / base;
  let nice;
  if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 2.5) nice = 2.5;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

// choose a step so at most `maxTicks` labels are shown
function labelStep(count, maxTicks = 7) {
  if (count <= maxTicks) return 1;
  return Math.ceil(count / maxTicks);
}
// Every `step`-th label plus the last one — unless the last sits on top of the
// previous shown label, which is then skipped.
function showLabel(i, n, step) {
  if (i === n - 1) return true;
  return i % step === 0 && (n - 1 - i) * 2 >= step;
}

function Empty({ height, msg }) {
  const { t } = useLang();
  msg = msg ?? t("adm.chart.noData");
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: BRAND.muted,
        fontFamily: FONT,
        fontSize: 13,
        background: BRAND.soft,
        border: `1px solid ${BRAND.line}`,
        borderRadius: 12,
        boxSizing: "border-box",
      }}
    >
      {msg}
    </div>
  );
}

// Floating rich tooltip. Positioned by viewBox coords (x,y) inside a
// position:relative wrapper whose rendered box matches the <svg>.
function Tip({ x, y, W, H, caption, value, valueColor, lines = [] }) {
  const leftPct = Math.max(5, Math.min(95, (x / W) * 100));
  const topPct = Math.max(0, (y / H) * 100);
  return (
    <div className="cx-tip" style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
      {caption != null ? <div className="cx-tip-cap">{caption}</div> : null}
      {value != null ? (
        <div className="cx-tip-val" style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </div>
      ) : null}
      {lines.map((l, i) => (
        <div
          key={i}
          className="cx-tip-line"
          style={l.color ? { color: l.color } : undefined}
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}

// signed percentage vs a reference (e.g. average) as a colored tooltip line
// `labelText` is passed in already translated — this is a plain helper, not a
// component, so it cannot reach the dictionary itself.
function deltaLine(value, ref, labelText) {
  if (!ref || ref <= 0) return null;
  const pct = ((value - ref) / ref) * 100;
  const sign = pct > 0 ? "+" : "";
  return {
    text: `${sign}${pct.toFixed(0)}% ${labelText}`,
    color: pct >= 0 ? "#7ee2a0" : "#ff9db0",
  };
}

// ---------------------------------------------------------------------------
// 1. KpiCard
const SIGN = (n) => (n > 0 ? "+" : n < 0 ? "−" : "");
const LOCALE = (lang) => (lang === "en" ? "en-US" : "es-US");

/**
 * Variación de un KPI contra el período anterior — el MISMO contrato en todas
 * las tarjetas del panel (ExecutiveHub.jsx la usa en su tira, KpiCard la
 * acepta en `delta`). Devuelve null mientras no haya período anterior
 * (cargando / sin dato); si no, { value, pct, good, zero, text }:
 *   value  cur − prev, en la unidad del KPI
 *   pct    variación en %, o null si prev es 0 (no hay con qué comparar)
 *   good   si la variación es buena: subir, salvo `invert` (un costo que baja es bueno)
 *   zero   sin cambio (se pinta en gris con «=»)
 *   text   `+$123.00 (+12%)` (money) · `+3` / `−2` (count) · `+1.5 pt` (pct) · `=`
 * `fmt` da formato al importe absoluto (p. ej. (v) => money(v, "usd", lang)).
 */
export function kpiDelta(cur, prev, { kind = "count", invert = false, lang = "es", fmt } = {}) {
  const a = Number(cur);
  const b = Number(prev);
  if (prev == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const value = a - b;
  const eps = kind === "count" ? 0.5 : 0.005;
  const zero = Math.abs(value) < eps;
  const pct = b !== 0 && kind !== "pct" ? Math.round((value / Math.abs(b)) * 1000) / 10 : null;
  const good = zero ? null : invert ? value < 0 : value > 0;
  const abs = Math.abs(value);
  let text;
  if (zero) text = "=";
  else if (kind === "money") text = `${SIGN(value)}${fmt ? fmt(abs) : abs.toFixed(2)}${pct == null ? "" : ` (${SIGN(pct)}${Math.abs(pct).toLocaleString(LOCALE(lang), { maximumFractionDigits: Math.abs(pct) < 10 ? 1 : 0 })}%)`}`;
  else if (kind === "pct") text = `${SIGN(value)}${abs.toLocaleString(LOCALE(lang), { maximumFractionDigits: 1 })} pt`;
  else text = `${SIGN(value)}${Math.round(abs).toLocaleString(LOCALE(lang))}`;
  return { value, pct, good, zero, text };
}

export function KpiCard({ label, value, delta, deltaGood, icon, sub, onClick, hint }) {
  // `delta` puede ser el objeto de kpiDelta() o, como antes, un texto con `deltaGood`.
  const obj = delta && typeof delta === "object" ? delta : null;
  const deltaText = obj ? obj.text : delta;
  const flat = obj ? obj.zero : false;
  const good = obj ? !!obj.good : !!deltaGood;
  // La flecha dice hacia dónde fue la cifra; el color, si eso es bueno (un costo que baja: ▼ en verde).
  const up = obj ? obj.value > 0 : good;
  const clickable = typeof onClick === "function";
  return (
    <div
      className={`cx-kpi ${clickable ? "clickable" : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={hint || undefined}
      onClick={onClick}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      style={{
        cursor: clickable ? "pointer" : undefined,
        fontFamily: FONT,
        background: BRAND.surface,
        border: `1px solid ${BRAND.line}`,
        borderRadius: "var(--adm-radius, 14px)",
        padding: "10px 14px",
        boxShadow: "var(--adm-shadow-card, 0 1px 2px rgba(16,24,40,0.04))",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          className="cx-kpi-label"
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: BRAND.muted,
          }}
        >
          {label}
        </span>
        {icon ? (
          <span aria-hidden="true" className="cx-kpi-icon" style={{ fontSize: 18, lineHeight: 1 }}>
            {icon}
          </span>
        ) : null}
      </div>
      <div
        className="cx-kpi-value"
        style={{
          // Dentro de .board-kpis el tamaño sigue al ancho de la tarjeta; fuera, se queda en 26.
          fontFamily: DISPLAY,
          fontOpticalSizing: "auto",
          fontSize: "clamp(20px, 11.5cqi, 26px)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          color: "var(--adm-accent-ink, " + BRAND.ink + ")",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {deltaText !== undefined && deltaText !== null && deltaText !== "" ? (
          <span
            className={`cx-kpi-delta ${flat ? "flat" : good ? "good" : "bad"}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 11.5,
              fontWeight: 700,
              padding: "1px 7px",
              borderRadius: 999,
              fontVariantNumeric: "tabular-nums",
              color: flat ? BRAND.muted : good ? "var(--adm-green-dark, #10754d)" : "var(--adm-red-dark, #b02a37)",
              background: flat ? BRAND.soft : good ? "var(--adm-green-soft, #ebf8f2)" : "var(--adm-red-soft, #fdf1f2)",
            }}
          >
            {!flat && <span aria-hidden="true">{up ? "▲" : "▼"}</span>}
            {deltaText}
          </span>
        ) : null}
        {sub ? (
          <span style={{ fontSize: 11.5, color: BRAND.muted }}>{sub}</span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrendChart: one or several series of the same unit over the same buckets, on
// one axis. Bars while they fit (one or two series), lines otherwise. It draws
// at the real width of its box, so the text stays readable on a phone, and it
// takes negative values (a period with a loss).
function barPath(x, y0, y1, w, r) {
  const up = y1 <= y0;
  const h = Math.abs(y1 - y0);
  const c = Math.min(r, h, w / 2);
  const s = up ? 1 : -1;
  return `M${x},${y0} V${y1 + s * c} Q${x},${y1} ${x + c},${y1} H${x + w - c} Q${x + w},${y1} ${x + w},${y1 + s * c} V${y0} Z`;
}

export function TrendChart({ labels, series, height = 260, format = fmt, axisFormat, tipExtra, forceLines = false }) {
  const { t } = useLang();
  const wrap = useRef(null);
  const [W, setW] = useState(720);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    if (!wrap.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 0) setW(Math.round(e.contentRect.width)); });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  // El contenedor existe aunque no haya datos: así se mide antes de dibujar.
  const n = labels?.length || 0;
  const all = (series || []).flatMap((s) => s.values);
  const empty = n === 0 || !series?.length || all.every((v) => !v);

  const H = height;
  const compact = W < 480;
  const padL = compact ? 44 : 58;
  const padR = 10;
  const padT = 12;
  const padB = 26;
  const plotW = Math.max(10, W - padL - padR);
  const plotH = H - padT - padB;
  const hi = niceMax(Math.max(0, ...all));
  const lowest = Math.min(0, ...all);
  const lo = lowest < 0 ? -niceMax(-lowest) : 0;
  const yAt = (v) => padT + plotH - (plotH * (v - lo)) / (hi - lo || 1);
  const band = plotW / Math.max(1, n);
  const xAt = (i) => padL + band * (i + 0.5);
  const bars = !forceLines && series?.length <= 2 && band >= 7;
  const step = labelStep(n, Math.max(3, Math.floor(plotW / (compact ? 62 : 76))));
  const ticks = lo < 0 ? [lo, 0, hi / 2, hi] : [0, hi / 4, hi / 2, (hi * 3) / 4, hi];
  const axis = axisFormat || format;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) * (W / rect.width) - padL) / band);
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div ref={wrap} style={{ position: "relative", width: "100%", fontFamily: FONT }}>
      {empty ? <Empty height={H} /> : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={t("adm.chart.ariaTrend", { n, series: series.map((s) => s.label).join(", ") })} style={{ display: "block" }}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={padL} x2={W - padR} y1={yAt(v)} y2={yAt(v)} stroke={v === 0 ? "var(--adm-faint, #c9cdd4)" : BRAND.line} {...HAIR} />
                <text x={padL - 8} y={yAt(v) + 4} textAnchor="end" fontSize="11" fill={BRAND.muted}>{axis(v)}</text>
              </g>
            ))}
            {hover !== null && <rect x={padL + band * hover} y={padT} width={band} height={plotH} fill={BRAND.soft} />}
            {labels.map((l, i) => (i % step === 0 ? (
              <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={BRAND.muted}>{l}</text>
            ) : null))}
            {bars && labels.map((_, i) => {
              const groupW = Math.min(band * BAR_FRAC, series.length * 30);
              const w = (groupW - 2 * (series.length - 1)) / series.length;
              return series.map((s, k) => {
                const v = Number(s.values[i]) || 0;
                if (!v) return null;
                const x = xAt(i) - groupW / 2 + k * (w + 2);
                return <path key={s.key + i} d={barPath(x, yAt(0), yAt(v), w, 4)} fill={s.color} />;
              });
            })}
            {!bars && series.map((s) => (
              <path key={s.key} d={s.values.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(Number(v) || 0).toFixed(1)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={LINE_W} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {!bars && (hover !== null ? [hover] : n === 1 ? [0] : []).flatMap((i) => series.map((s) => (
              <circle key={s.key + i} cx={xAt(i)} cy={yAt(Number(s.values[i]) || 0)} r="4.5" fill={s.color} stroke={BRAND.surface} strokeWidth="2" />
            )))}
            <rect x={padL} y={padT} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
          {hover !== null && (
            <Tip x={xAt(hover)} y={yAt(Math.max(0, ...series.map((s) => Number(s.values[hover]) || 0)))} W={W} H={H} caption={labels[hover]}
              lines={[...series.map((s) => ({ text: `${s.label}: ${format(Number(s.values[hover]) || 0)}` })), ...(tipExtra ? tipExtra(hover) : []).map((text) => ({ text }))]} />
          )}
          {series.length > 1 && (
            <div className="ins-legend">
              {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. LineChart — one series over time; draws at the real width of its box.
export function LineChart({
  data,
  height = 220,
  color = BRAND.primary,
  valuePrefix = "",
  area = true,
}) {
  const { t } = useLang();
  const gid = useId().replace(/[:]/g, "");
  const [hover, setHover] = useState(null); // {x, y, i}
  const [wrapRef, W] = useBoxWidth();

  if (!Array.isArray(data) || data.length === 0)
    return <div ref={wrapRef}><Empty height={height} /></div>;

  const H = height;
  const values = data.map((d) => Number(d.value) || 0);
  const rawMax = Math.max(...values, 0);
  const max = niceMax(rawMax);
  const n = data.length;
  const total = values.reduce((s, v) => s + v, 0);
  const avg = n > 0 ? total / n : 0;
  const compact = H < 170;
  const padL = Math.min(72, 12 + (valuePrefix + fmt(max)).length * 6.6);
  const padR = 10;
  const padT = 8;
  const padB = 22;
  const plotW = Math.max(10, W - padL - padR);
  const plotH = H - padT - padB;

  const xAt = (i) => (n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1));
  const yAt = (v) => padT + plotH - (plotH * v) / max;

  const pts = data.map((d, i) => ({ x: xAt(i), y: yAt(Number(d.value) || 0), d, i }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `M${pts[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} ` + pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + ` L${pts[n - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const gridN = compact ? 2 : 4;
  const grid = Array.from({ length: gridN + 1 }, (_, i) => { const v = (max * i) / gridN; return { v, y: yAt(v) }; });
  const step = labelStep(n, Math.max(3, Math.floor(plotW / 56)));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) { const dx = Math.abs(xAt(i) - relX); if (dx < bestD) { bestD = dx; best = i; } }
    setHover({ i: best, x: pts[best].x, y: pts[best].y });
  };

  const hp = hover ? pts[hover.i] : null;
  const hv = hp ? Number(hp.d.value) || 0 : 0;
  const hpct = hp && total > 0 ? (hv / total) * 100 : 0;
  const DRAW = "3000";

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", fontFamily: FONT }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
        aria-label={t("adm.chart.ariaSparkline", { n })}
        style={{ display: "block", overflow: "visible" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`lg-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={AREA_OP} />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke={BRAND.line} {...HAIR} />
            <text x={padL - 6} y={g.y + 4} textAnchor="end" fontSize={AXIS_FS} fill={BRAND.muted}>{valuePrefix}{fmt(g.v)}</text>
          </g>
        ))}
        {data.map((d, i) => (showLabel(i, n, step) ? (
          <text key={i} x={xAt(i)} y={H - 6} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={AXIS_FS} fill={BRAND.muted}>{d.label}</text>
        ) : null))}
        {area ? <path d={areaPath} fill={`url(#lg-${gid})`} style={{ animation: "cxFadeIn 1.1s ease .25s both" }} /> : null}
        <path d={linePath} fill="none" stroke={color} strokeWidth={LINE_W} strokeLinejoin="round" strokeLinecap="round"
          style={{ strokeDasharray: DRAW, "--cx-len": `${DRAW}px`, animation: "cxDraw 1.4s cubic-bezier(.3,.8,.25,1) both" }} />
        {hp ? <line x1={hp.x} y1={padT} x2={hp.x} y2={padT + plotH} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" /> : null}
        {pts.map((p) => (
          <circle key={p.i} cx={p.x} cy={p.y} r={hover && hover.i === p.i ? 4 : n > 40 ? 0 : 2} fill={BRAND.surface} stroke={color}
            strokeWidth={hover && hover.i === p.i ? 2 : 1.5} style={{ transition: "r .15s ease, stroke-width .15s ease" }} />
        ))}
      </svg>
      {hp ? (
        <Tip x={hp.x} y={hp.y} W={W} H={H} caption={hp.d.label} value={`${valuePrefix}${fmt(hv)}`}
          lines={[{ text: t("adm.chart.pctOfTotal", { pct: hpct.toFixed(1) }), color: "rgba(255,255,255,0.72)" }, deltaLine(hv, avg, t("adm.chart.vsAvg"))].filter(Boolean)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. BarChart — bars at 60 % of their slot, soft fill, hairline grid.
export function BarChart({
  data,
  height = 220,
  color = BRAND.primary,
  horizontal = false,
  valuePrefix = "",
}) {
  const { t } = useLang();
  const [hover, setHover] = useState(null);
  const [wrapRef, W] = useBoxWidth();

  if (!Array.isArray(data) || data.length === 0)
    return <div ref={wrapRef}><Empty height={height} /></div>;

  const values = data.map((d) => Number(d.value) || 0);
  const rawMax = Math.max(...values, 0);
  const max = niceMax(rawMax) || 1;
  const n = data.length;
  const total = values.reduce((s, v) => s + v, 0);
  const avg = n > 0 ? total / n : 0;
  const H = height;
  const ariaLabel = t("adm.chart.ariaBar", { n, max: `${valuePrefix}${fmt(rawMax)}` });
  const tipLines = (v) => [
    { text: t("adm.chart.pctOfTotal", { pct: total > 0 ? ((v / total) * 100).toFixed(1) : "0" }), color: "rgba(255,255,255,0.72)" },
    deltaLine(v, avg, t("adm.chart.vsAvg")),
  ].filter(Boolean);

  if (horizontal) {
    const padL = Math.min(140, 16 + Math.max(...data.map((d) => String(d.label).slice(0, 16).length)) * 6.4);
    const padR = 56, padT = 6, padB = 6;
    const plotW = Math.max(10, W - padL - padR);
    const rowH = (H - padT - padB) / n;
    const barH = Math.min(18, rowH * BAR_FRAC);
    const hv = hover != null ? values[hover] : 0;
    const hy = hover != null ? padT + rowH * hover + rowH / 2 : 0;
    const hx = hover != null ? padL + Math.max(0, (plotW * hv) / max) : 0;
    return (
      <div ref={wrapRef} style={{ position: "relative", width: "100%", fontFamily: FONT }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ display: "block" }}>
          {data.map((d, i) => {
            const v = Number(d.value) || 0;
            const y = padT + rowH * i + (rowH - barH) / 2;
            const w = Math.max(0, (plotW * v) / max);
            const hovered = hover === i;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={0} y={padT + rowH * i} width={W} height={rowH} fill="transparent" />
                <text x={padL - 8} y={y + barH / 2 + 4} textAnchor="end" fontSize={AXIS_FS} fill={hovered ? BRAND.ink : BRAND.muted} fontWeight={hovered ? "700" : "500"}>
                  {String(d.label).length > 16 ? String(d.label).slice(0, 15) + "…" : d.label}
                </text>
                <rect x={padL} y={y} width={plotW} height={barH} rx={barH / 2} fill={BRAND.soft} />
                <rect x={padL} y={y} width={w} height={barH} rx={barH / 2} fill={color} opacity={hovered ? 1 : 0.8}
                  style={{ transformBox: "fill-box", transformOrigin: "left", transition: "opacity .15s ease", animation: `cxGrowRight .7s cubic-bezier(.2,.85,.25,1) ${i * 40}ms both` }} />
                <text x={padL + w + 6} y={y + barH / 2 + 4} fontSize={AXIS_FS} fontWeight="600" fill={hovered ? BRAND.ink : BRAND.muted}>{valuePrefix}{fmt(v)}</text>
              </g>
            );
          })}
        </svg>
        {hover != null ? <Tip x={hx} y={hy} W={W} H={H} caption={data[hover].label} value={`${valuePrefix}${fmt(hv)}`} lines={tipLines(hv)} /> : null}
      </div>
    );
  }

  // vertical
  const compact = H < 170;
  const padL = Math.min(72, 12 + (valuePrefix + fmt(max)).length * 6.6);
  const padR = 8, padT = 8;
  const padB = 22;
  const plotW = Math.max(10, W - padL - padR);
  const plotH = H - padT - padB;
  const slot = plotW / n;
  const barW = Math.min(40, slot * BAR_FRAC);
  const yAt = (v) => padT + plotH - (plotH * v) / max;
  const gridN = compact ? 2 : 4;
  const grid = Array.from({ length: gridN + 1 }, (_, i) => { const v = (max * i) / gridN; return { v, y: yAt(v) }; });
  const step = labelStep(n, Math.max(3, Math.floor(plotW / 48)));
  const hv = hover != null ? values[hover] : 0;
  const hcx = hover != null ? padL + slot * hover + slot / 2 : 0;
  const hy = hover != null ? yAt(hv) : 0;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", fontFamily: FONT }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ display: "block" }}>
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke={BRAND.line} {...HAIR} />
            <text x={padL - 6} y={g.y + 4} textAnchor="end" fontSize={AXIS_FS} fill={BRAND.muted}>{valuePrefix}{fmt(g.v)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const v = Number(d.value) || 0;
          const cx = padL + slot * i + slot / 2;
          const by = yAt(v);
          const bh = Math.max(0, padT + plotH - by);
          const hovered = hover === i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH} fill={hovered ? BRAND.soft : "transparent"} />
              <rect x={cx - barW / 2} y={by} width={barW} height={bh} rx={Math.min(4, barW / 2)} fill={color} opacity={hovered ? 1 : 0.8}
                style={{ transformBox: "fill-box", transformOrigin: "bottom", transition: "opacity .15s ease", animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 30}ms both` }} />
              {showLabel(i, n, step) ? (
                <text x={cx} y={H - 6} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={AXIS_FS} fill={hovered ? BRAND.ink : BRAND.muted} fontWeight={hovered ? "700" : "400"}>{d.label}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover != null ? <Tip x={hcx} y={hy} W={W} H={H} caption={data[hover].label} value={`${valuePrefix}${fmt(hv)}`} lines={tipLines(hv)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. DonutChart
export function DonutChart({ data, height = 220, size = 180, iconByLabel, onSelect }) {
  const { t } = useLang();
  const [hi, setHi] = useState(-1);

  if (!Array.isArray(data) || data.length === 0)
    return <Empty height={height} />;
  // The ring never exceeds the card height; the legend sits beside it and
  // scrolls when there are more rows than the height allows.
  size = Math.max(84, Math.min(size, height));

  const items = data.map((d, i) => ({
    label: d.label,
    value: Math.max(0, Number(d.value) || 0),
    color: d.color || PALETTE[i % PALETTE.length],
  }));
  const total = items.reduce((s, d) => s + d.value, 0);

  const S = size;
  const stroke = Math.max(12, S * 0.15);
  const r = (S - stroke) / 2;
  const cx = S / 2;
  const cy = S / 2;
  const circ = 2 * Math.PI * r;

  let acc = 0;
  const segs = items.map((d) => {
    const frac = total > 0 ? d.value / total : 0;
    const seg = {
      ...d,
      frac,
      dash: frac * circ,
      offset: acc * circ,
    };
    acc += frac;
    return seg;
  });

  const ariaLabel = t("adm.chart.ariaDonut", { total: fmt(total), n: items.length });
  const active = hi >= 0 ? segs[hi] : null;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        fontFamily: FONT,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
      }}
    >
      <svg
        viewBox={`0 0 ${S} ${S}`}
        width={S}
        height={S}
        role="img"
        aria-label={ariaLabel}
        style={{ flex: "0 0 auto", maxWidth: "100%" }}
      >
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={BRAND.line}
            strokeWidth={stroke}
          />
          {total > 0 &&
            segs.map((s, i) => {
              const hovered = hi === i;
              const dim = hi >= 0 && !hovered;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={hovered ? stroke * 1.14 : stroke}
                  strokeDasharray={`${s.dash} ${circ - s.dash}`}
                  strokeDashoffset={-s.offset}
                  strokeLinecap="butt"
                  onMouseEnter={() => setHi(i)}
                  onMouseLeave={() => setHi(-1)}
                  onClick={onSelect ? () => onSelect(s.label, i) : undefined}
                  style={{
                    opacity: dim ? 0.4 : 1,
                    cursor: "pointer",
                    transition: "stroke-width .18s ease, opacity .18s ease",
                    "--cx-from": `${-s.offset + s.dash}px`,
                    "--cx-to": `${-s.offset}px`,
                    animation: `cxSweep .8s cubic-bezier(.3,.8,.25,1) ${i * 110}ms both`,
                  }}
                />
              );
            })}
        </g>
        {active ? (
          <>
            <text
              x={cx}
              y={cy - S * 0.11}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill={BRAND.muted}
              style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
            >
              {String(active.label).length > 10
                ? String(active.label).slice(0, 9) + "…"
                : active.label}
            </text>
            <text
              x={cx}
              y={cy + S * 0.02}
              textAnchor="middle"
              fontSize={Math.max(14, S * 0.15)}
              fontWeight="700"
              fill={BRAND.ink}
            >
              {fmt(active.value)}
            </text>
            <text
              x={cx}
              y={cy + S * 0.15}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill={BRAND.muted}
            >
              {(active.frac * 100).toFixed(1)}%
            </text>
          </>
        ) : (
          <>
            <text
              x={cx}
              y={cy - 2}
              textAnchor="middle"
              fontSize={Math.max(14, S * 0.16)}
              fontWeight="700"
              fill={BRAND.ink}
            >
              {fmt(total)}
            </text>
            <text
              x={cx}
              y={cy + S * 0.12}
              textAnchor="middle"
              fontSize="11"
              fill={BRAND.muted}
            >
              Total
            </text>
          </>
        )}
      </svg>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          flex: "1 1 160px",
          minWidth: 140,
          maxHeight: height,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {segs.map((s, i) => (
          <li
            key={i}
            onMouseEnter={() => setHi(i)}
            onClick={onSelect ? () => onSelect(segs[i] ? segs[i].label : undefined, i) : undefined}
            onMouseLeave={() => setHi(-1)}
            className="cx-legend-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              lineHeight: 1.25,
              padding: "2px 6px",
              borderRadius: 8,
              cursor: "pointer",
              background: hi === i ? "var(--adm-accent-soft, rgba(14,90,208,0.06))" : "transparent",
              opacity: hi >= 0 && hi !== i ? 0.55 : 1,
              transition: "background .15s ease, opacity .15s ease",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: s.color,
                flex: "0 0 auto",
                transform: hi === i ? "scale(1.25)" : "none",
                transition: "transform .15s ease",
              }}
            />
            {iconByLabel && iconByLabel[s.label] && (
              <img src={iconByLabel[s.label]} alt="" loading="lazy"
                   onError={(e) => { e.currentTarget.style.display = "none"; }}
                   style={{ width: 34, height: 16, objectFit: "contain", flex: "0 0 auto" }} />
            )}
            <span style={{ color: BRAND.ink, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s.label}
            </span>
            <span style={{ color: BRAND.ink, fontWeight: 600 }}>
              {fmt(s.value)}
            </span>
            <span style={{ color: BRAND.muted, width: 42, textAlign: "right" }}>
              {(s.frac * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Sparkline
export function Sparkline({ data, color = BRAND.primary, width = 120, height = 34 }) {
  // Above the empty-data guard: hooks cannot sit behind an early return.
  const { t } = useLang();
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={t("adm.chart.noData")}
        style={{ display: "inline-block", verticalAlign: "middle" }}
      />
    );
  }

  const values = data.map((d) =>
    typeof d === "number" ? d : Number(d.value) || 0
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = values.length;
  const pad = 3;
  const xAt = (i) =>
    n === 1 ? width / 2 : pad + ((width - pad * 2) * i) / (n - 1);
  const yAt = (v) =>
    height - pad - ((height - pad * 2) * (v - min)) / span;

  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
    .join(" ");
  const lastX = xAt(n - 1);
  const lastY = yAt(values[n - 1]);
  const DRAW = "600";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={t("adm.chart.ariaSparkline", { n })}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{
          strokeDasharray: DRAW,
          "--cx-len": `${DRAW}px`,
          animation: "cxDraw 1s ease both",
        }}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="2"
        fill={color}
        style={{ animation: "cxFadeIn .4s ease .9s both" }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 6. Funnel
export function Funnel({ steps, height, rowHeight }) {
  const { t } = useLang();
  const [hi, setHi] = useState(-1);

  if (!Array.isArray(steps) || steps.length === 0)
    return <Empty height={height || 160} />;
  // Rows share the given height (gap included); 26 px bars by default.
  const gap = 6;
  const rowH = rowHeight || (height ? Math.max(18, Math.min(30, Math.floor((height - gap * (steps.length - 1)) / steps.length))) : 26);

  const rows = steps.map((s) => ({
    label: s.label,
    value: Math.max(0, Number(s.value) || 0),
  }));
  const first = rows[0].value || 0;
  const maxV = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        fontFamily: FONT,
        display: "flex",
        flexDirection: "column",
        gap,
      }}
      role="img"
      aria-label={t("adm.chart.ariaFunnel", { n: rows.length })}
    >
      {rows.map((r, i) => {
        const wpct = (r.value / maxV) * 100;
        const conv = first > 0 ? (r.value / first) * 100 : 0;
        const prev = i > 0 ? rows[i - 1].value : r.value;
        const stepDrop = prev > 0 ? (1 - r.value / prev) * 100 : 0;
        const c = PALETTE[i % PALETTE.length];
        const hovered = hi === i;
        return (
          <div
            key={i}
            className="cx-funnel-row"
            onMouseEnter={() => setHi(i)}
            onMouseLeave={() => setHi(-1)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              animation: `cxRise .5s cubic-bezier(.2,.8,.2,1) ${i * 70}ms both`,
            }}
          >
            <div
              style={{
                width: 104,
                flex: "0 0 auto",
                fontSize: 12,
                color: BRAND.ink,
                fontWeight: 600,
                textAlign: "right",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.label}
            </div>
            <div
              style={{
                flex: 1,
                background: BRAND.soft,
                borderRadius: 6,
                height: rowH,
                position: "relative",
                overflow: "hidden",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  width: `${wpct}%`,
                  height: "100%",
                  background: c,
                  opacity: 0.9,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 8,
                  boxSizing: "border-box",
                  transformOrigin: "left",
                  filter: hovered ? "brightness(1.07)" : "none",
                  transition: "filter .15s ease",
                  animation: `cxGrowRight .8s cubic-bezier(.2,.85,.25,1) ${i * 70}ms both`,
                }}
              >
                {wpct >= 14 ? (
                  <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, textShadow: "0 1px 1px rgba(0,0,0,.25)" }}>
                    {fmt(r.value)}
                  </span>
                ) : null}
              </div>
              {wpct < 14 ? (
                <span style={{ position: "absolute", left: `calc(${wpct}% + 6px)`, top: "50%", transform: "translateY(-50%)", fontSize: 11, fontWeight: 700, color: BRAND.ink, pointerEvents: "none" }}>
                  {fmt(r.value)}
                </span>
              ) : null}
              {hovered && i > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--adm-red-dark, #b02a37)",
                    background: "var(--adm-surface, rgba(255,255,255,0.9))",
                    padding: "1px 6px",
                    borderRadius: 999,
                    pointerEvents: "none",
                  }}
                >
                  {t("adm.chart.funnelDrop", { pct: stepDrop.toFixed(0) })}
                </span>
              ) : null}
            </div>
            <div
              style={{
                width: 44,
                flex: "0 0 auto",
                fontSize: 12,
                fontWeight: 600,
                color: i === 0 ? BRAND.muted : "var(--adm-accent-ink, " + BRAND.ink + ")",
                textAlign: "right",
              }}
            >
              {conv.toFixed(0)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combo: daily ACCESSES (line/area) vs PURCHASES (bars) on the same chart.
// data = [{ label, access, orders }]. Draws at the real width of its box so the
// text keeps 11 px at 120–160 px tall cards.
export function AccessVsBuyChart({ data, height = 250 }) {
  const { t } = useLang();
  const gid = useId();
  const [hi, setHi] = useState(-1);
  const [wrapRef, W] = useBoxWidth();
  const H = height, PR = 8, PT = 8, PB = 22;
  if (!data || !data.length) return <div ref={wrapRef} className="chart-empty" style={{ height }}>{t("adm.chart.noData")}</div>;
  const max = Math.max(1, ...data.map((d) => Math.max(d.access, d.orders)));
  const nice = Math.ceil(max / 4) * 4;
  const PL = Math.min(60, 12 + fmt(nice).length * 6.6);
  const iw = Math.max(10, W - PL - PR), ih = H - PT - PB;
  const n = data.length;
  const slot = iw / n;
  const x = (i) => PL + slot * (i + 0.5);
  const y = (v) => PT + ih - (v / nice) * ih;
  const bw = Math.max(2, Math.min(18, slot * BAR_FRAC));
  const linePts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.access).toFixed(1)}`).join(" ");
  const areaPts = `${x(0).toFixed(1)},${PT + ih} ${linePts} ${x(n - 1).toFixed(1)},${PT + ih}`;
  const step = labelStep(n, Math.max(3, Math.floor(iw / 56)));
  const compact = H < 170;
  const gridN = compact ? 2 : 4;
  const hd = hi >= 0 ? data[hi] : null;
  const convText = hd ? convLabel(hd.access, hd.orders, t) : "";
  return (
    <div className="chart-wrap" role="img" aria-label={t("adm.chart.ariaAccessVsBuy")}>
      <div className="chart-legend">
        <span><i style={{ background: BRAND.primary }} />{t("adm.chart.access")}</span>
        <span><i style={{ background: BRAND.accent }} />{t("adm.chart.buys")}</span>
      </div>
      <div ref={wrapRef} style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHi(-1)}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={BRAND.primary} stopOpacity={AREA_OP} /><stop offset="1" stopColor={BRAND.primary} stopOpacity="0" />
            </linearGradient>
          </defs>
          {Array.from({ length: gridN + 1 }, (_, g) => { const yy = PT + (g / gridN) * ih; const val = Math.round(nice - (g / gridN) * nice);
            return <g key={g}><line x1={PL} x2={W - PR} y1={yy} y2={yy} stroke={BRAND.line} {...HAIR} /><text x={PL - 6} y={yy + 4} textAnchor="end" fontSize={AXIS_FS} fill={BRAND.muted}>{val}</text></g>; })}
          <polygon points={areaPts} fill={`url(#${gid})`} style={{ animation: "cxFadeIn 1.1s ease .3s both" }} />
          {data.map((d, i) => {
            const hovered = hi === i;
            return (
              <g key={i} onMouseEnter={() => setHi(i)}>
                <rect x={PL + slot * i} y={PT} width={slot} height={ih} fill={hovered ? BRAND.soft : "transparent"} />
                <rect x={x(i) - bw / 2} y={y(d.orders)} width={bw} height={Math.max(0, PT + ih - y(d.orders))} rx={Math.min(3, bw / 2)}
                  fill={BRAND.accent} opacity={hi < 0 || hovered ? 0.85 : 0.5}
                  style={{ transformBox: "fill-box", transformOrigin: "bottom", transition: "opacity .15s ease", animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 30}ms both` }} />
                {showLabel(i, n, step) && <text x={x(i)} y={H - 6} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={AXIS_FS} fill={hovered ? BRAND.ink : BRAND.muted} fontWeight={hovered ? "700" : "400"}>{d.label}</text>}
              </g>
            );
          })}
          <polyline points={linePts} fill="none" stroke={BRAND.primary} strokeWidth={LINE_W} strokeLinejoin="round" strokeLinecap="round"
            style={{ strokeDasharray: "3000", "--cx-len": "3000px", animation: "cxDraw 1.4s cubic-bezier(.3,.8,.25,1) both", pointerEvents: "none" }} />
          {hi >= 0 && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={PT + ih} stroke={BRAND.primary} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />}
          {hi >= 0 && <circle cx={x(hi)} cy={y(data[hi].access)} r="4" fill={BRAND.primary} stroke={BRAND.surface} strokeWidth="1.5" />}
        </svg>
        {hd && (
          <Tip x={x(hi)} y={Math.min(y(hd.access), y(hd.orders))} W={W} H={H} caption={hd.label} value={null}
            lines={[
              { text: t("adm.chart.accessN", { n: fmt(hd.access) }), color: "#b9c4ff" },
              { text: t("adm.chart.buysN", { n: fmt(hd.orders) }), color: "#e2e6f5" },
              { text: convText, color: "rgba(255,255,255,0.8)" },
            ]} />
        )}
      </div>
    </div>
  );
}

/**
 * Conversion = purchases ÷ accesses. Accesses are counted in the browser
 * (localStorage) while purchases come from the store, so a day can have
 * purchases and no accesses — or more purchases than accesses. Those cases are
 * not a conversion rate: they render as "—" and the hint says why.
 */
export function convRate(access, orders) {
  const a = Number(access) || 0, o = Number(orders) || 0;
  if (a <= 0 || o > a) return null;
  return Math.round((o / a) * 1000) / 10;
}
const convLabel = (access, orders, t) => { const c = convRate(access, orders); return c == null ? t("adm.fit.convNa") : t("adm.chart.conv", { pct: c }); };

// Grouped bars per weekday: accesses vs purchases. data = [{label, access, orders, conv}]
export function WeekdayChart({ data, height = 230 }) {
  const { t } = useLang();
  const [hi, setHi] = useState(-1);
  const [wrapRef, W] = useBoxWidth();
  const H = height, PR = 8, PT = 8, PB = 34;
  if (!data || !data.length) return <div ref={wrapRef} className="chart-empty" style={{ height }}>{t("adm.chart.noData")}</div>;
  const max = Math.max(1, ...data.map((d) => Math.max(d.access, d.orders)));
  const nice = Math.ceil(max / 4) * 4;
  const PL = Math.min(60, 12 + fmt(nice).length * 6.6);
  const iw = Math.max(10, W - PL - PR), ih = H - PT - PB;
  const gw = iw / data.length, bw = Math.min(18, (gw * BAR_FRAC) / 2);
  const y = (v) => PT + ih - (v / nice) * ih;
  const compact = H < 170;
  const gridN = compact ? 2 : 4;
  // best day = most purchases (ties → highest conversion)
  let bestIdx = 0;
  data.forEach((d, i) => {
    const b = data[bestIdx];
    if (d.orders > b.orders || (d.orders === b.orders && (convRate(d.access, d.orders) || 0) > (convRate(b.access, b.orders) || 0))) bestIdx = i;
  });
  const hd = hi >= 0 ? data[hi] : null;
  const convOf = (d) => { const c = convRate(d.access, d.orders); return c == null ? "—" : `${c}%`; };
  return (
    <div className="chart-wrap" role="img" aria-label={t("adm.chart.ariaWeekday")}>
      <div className="chart-legend">
        <span><i style={{ background: BRAND.primary }} />{t("adm.chart.access")}</span>
        <span><i style={{ background: BRAND.accent }} />{t("adm.chart.buys")}</span>
      </div>
      <div ref={wrapRef} style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHi(-1)}>
          {Array.from({ length: gridN + 1 }, (_, g) => { const yy = PT + (g / gridN) * ih; const val = Math.round(nice - (g / gridN) * nice);
            return <g key={g}><line x1={PL} x2={W - PR} y1={yy} y2={yy} stroke={BRAND.line} {...HAIR} /><text x={PL - 6} y={yy + 4} textAnchor="end" fontSize={AXIS_FS} fill={BRAND.muted}>{val}</text></g>; })}
          {data.map((d, i) => {
            const cx = PL + gw * i + gw / 2;
            const hovered = hi === i;
            const isBest = i === bestIdx && d.orders > 0;
            return (
              <g key={i} onMouseEnter={() => setHi(i)}>
                <rect x={PL + gw * i} y={PT} width={gw} height={ih} fill={hovered ? BRAND.soft : "transparent"} />
                <rect x={cx - bw - 1} y={y(d.access)} width={bw} height={PT + ih - y(d.access)} rx={Math.min(3, bw / 2)}
                  fill={BRAND.primary} opacity={hi < 0 || hovered ? 0.85 : 0.5}
                  style={{ transformBox: "fill-box", transformOrigin: "bottom", transition: "opacity .15s ease", animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 45}ms both` }} />
                <rect x={cx + 1} y={y(d.orders)} width={bw} height={PT + ih - y(d.orders)} rx={Math.min(3, bw / 2)}
                  fill={BRAND.accent} opacity={hi < 0 || hovered ? 0.85 : 0.5}
                  style={{ transformBox: "fill-box", transformOrigin: "bottom", transition: "opacity .15s ease", animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 45 + 60}ms both` }} />
                {isBest && <text x={cx} y={Math.min(y(d.access), y(d.orders)) - 4} textAnchor="middle" fontSize="11" fill="var(--adm-gold-dark, #8a5a0c)">★</text>}
                <text x={cx} y={H - 20} textAnchor="middle" fontSize={AXIS_FS} fill={hovered || isBest ? BRAND.ink : BRAND.muted} fontWeight={hovered || isBest ? "700" : "600"}>{d.label}</text>
                <text x={cx} y={H - 6} textAnchor="middle" fontSize={AXIS_FS} fill={BRAND.muted}>{convOf(d)}</text>
              </g>
            );
          })}
        </svg>
        {hd && (
          <Tip x={PL + gw * hi + gw / 2} y={Math.min(y(hd.access), y(hd.orders))} W={W} H={H}
            caption={`${hd.label}${hi === bestIdx && hd.orders > 0 ? `  ${t("adm.chart.bestDay")}` : ""}`} value={null}
            lines={[
              { text: t("adm.chart.accessN", { n: fmt(hd.access) }), color: "#b9c4ff" },
              { text: t("adm.chart.buysN", { n: fmt(hd.orders) }), color: "#e2e6f5" },
              { text: convLabel(hd.access, hd.orders, t), color: "rgba(255,255,255,0.8)" },
            ]} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompareBarChart: per bucket (a day), two bars side by side — sales in the
// accent and cost in the muted second series — with the margin % printed above
// each pair so the gap between what came in and what was kept is read at a
// glance. One money axis for both (same unit), tooltip with sales / cost /
// profit / margin. Draws at the real width of its box (useBoxWidth); never
// overflows: the % labels thin out when the slots get narrow and come back on
// hover.
//
//   <CompareBarChart data={[{ label: "10-03", sales: 820, cost: 510 }]} height={220}
//     format={(v) => money(v, "usd", lang)} labels={{ sales, cost, profit, margin }} />
//
// `margin` is derived (sales − cost) unless the row brings its own `profit`.
// `onSelect(row, i)` makes a pair clickable. Colors default to --adm-chart-1/2.
export function CompareBarChart({ data, height = 220, format = (v) => `$${fmt(v)}`, axisFormat, labels = {}, colors = {}, onSelect, showPct = true }) {
  const { t } = useLang();
  const [hi, setHi] = useState(-1);
  const [wrapRef, W] = useBoxWidth();
  const L = { sales: labels.sales || t("adm.chart.sales"), cost: labels.cost || t("adm.chart.cost"), profit: labels.profit || t("adm.chart.profit"), margin: labels.margin || t("adm.chart.margin") };
  const cSales = colors.sales || BRAND.primary;
  const cCost = colors.cost || BRAND.accent;
  const rows = (data || []).map((d) => {
    const sales = Math.max(0, Number(d.sales) || 0);
    const cost = Math.max(0, Number(d.cost) || 0);
    const profit = d.profit != null ? Number(d.profit) || 0 : sales - cost;
    const pct = sales > 0 ? (profit / sales) * 100 : null;
    return { ...d, sales, cost, profit, pct };
  });
  const n = rows.length;
  const empty = n === 0 || rows.every((r) => !r.sales && !r.cost);
  const H = height, PR = 8, PT = showPct ? 20 : 8, PB = 22;
  const max = niceMax(Math.max(0, ...rows.map((r) => Math.max(r.sales, r.cost))));
  const axis = axisFormat || ((v) => format(v));
  const PL = Math.min(72, 12 + String(axis(max)).length * 6.6);
  const iw = Math.max(10, W - PL - PR), ih = H - PT - PB;
  const slot = iw / Math.max(1, n);
  const gap = 2;
  const bw = Math.max(2, Math.min(22, (slot * 0.72 - gap) / 2));
  const cx = (i) => PL + slot * i + slot / 2;
  const y = (v) => PT + ih - (v / max) * ih;
  const compact = H < 170;
  const gridN = compact ? 2 : 4;
  const step = labelStep(n, Math.max(3, Math.floor(iw / 48)));
  const showAxis = (i) => (i === n - 1 ? true : i % step === 0 && n - 1 - i >= step);
  // % labels: one per pair while they fit ("38%" ≈ 22 px); otherwise every k-th, and always the hovered one.
  const pctStep = slot >= 26 ? 1 : Math.ceil(26 / slot);
  const pctText = (p) => (p == null ? "—" : `${Math.round(p)}%`);
  const hd = hi >= 0 ? rows[hi] : null;
  const aria = t("adm.chart.ariaCompare", { n, sales: L.sales, cost: L.cost });
  const pick = (i) => { if (onSelect) onSelect(rows[i], i); };
  return (
    <div className="chart-wrap cx-compare" role="img" aria-label={aria}>
      <div className="chart-legend">
        <span><i style={{ background: cSales }} />{L.sales}</span>
        <span><i style={{ background: cCost }} />{L.cost}</span>
        {showPct && <span className="cx-compare-pctkey"><b>38%</b> {L.margin}</span>}
      </div>
      <div ref={wrapRef} style={{ position: "relative", width: "100%", fontFamily: FONT }}>
        {empty ? <Empty height={H} /> : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", overflow: "hidden" }} onMouseLeave={() => setHi(-1)}>
            {Array.from({ length: gridN + 1 }, (_, g) => { const val = (max * g) / gridN; const yy = y(val);
              return <g key={g}><line x1={PL} x2={W - PR} y1={yy} y2={yy} stroke={BRAND.line} {...HAIR} /><text x={PL - 6} y={yy + 4} textAnchor="end" fontSize={AXIS_FS} fill={BRAND.muted}>{axis(val)}</text></g>; })}
            {rows.map((r, i) => {
              const hovered = hi === i;
              const x0 = cx(i) - bw - gap / 2;
              const x1 = cx(i) + gap / 2;
              const top = Math.min(y(r.sales), y(r.cost));
              const showP = showPct && (hovered || i % pctStep === 0);
              const neg = r.pct != null && r.pct < 0;
              return (
                <g key={i} onMouseEnter={() => setHi(i)} onClick={onSelect ? () => pick(i) : undefined} style={onSelect ? { cursor: "pointer" } : undefined}>
                  <rect x={PL + slot * i} y={PT} width={slot} height={ih} fill={hovered ? BRAND.soft : "transparent"} />
                  {r.sales > 0 && <path d={barPath(x0, y(0), y(r.sales), bw, 3)} fill={cSales} opacity={hi < 0 || hovered ? 0.92 : 0.5}
                    style={{ transition: "opacity .15s ease", animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 25}ms both`, transformBox: "fill-box", transformOrigin: "bottom" }} />}
                  {r.cost > 0 && <path d={barPath(x1, y(0), y(r.cost), bw, 3)} fill={cCost} opacity={hi < 0 || hovered ? 0.92 : 0.5}
                    style={{ transition: "opacity .15s ease", animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 25 + 50}ms both`, transformBox: "fill-box", transformOrigin: "bottom" }} />}
                  {showP && (r.sales > 0 || r.cost > 0) && (
                    <text x={cx(i)} y={Math.max(9, top - 4)} textAnchor="middle" fontSize="10" fontWeight={hovered ? "800" : "700"} fill={neg ? "var(--adm-red-dark, #b02a37)" : hovered ? BRAND.ink : BRAND.muted} style={{ fontVariantNumeric: "tabular-nums" }}>{pctText(r.pct)}</text>
                  )}
                  {showAxis(i) && <text x={cx(i)} y={H - 6} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={AXIS_FS} fill={hovered ? BRAND.ink : BRAND.muted} fontWeight={hovered ? "700" : "400"}>{r.label}</text>}
                </g>
              );
            })}
          </svg>
        )}
        {hd && (
          <Tip x={cx(hi)} y={Math.min(y(hd.sales), y(hd.cost))} W={W} H={H} caption={hd.label} value={null}
            lines={[
              { text: `${L.sales}: ${format(hd.sales)}`, color: "#e2e6f5" },
              { text: `${L.cost}: ${format(hd.cost)}`, color: "#b9c4ff" },
              { text: `${L.profit}: ${format(hd.profit)}`, color: hd.profit >= 0 ? "#7ee2a0" : "#ff9db0" },
              { text: `${L.margin}: ${pctText(hd.pct)}`, color: "rgba(255,255,255,0.8)" },
            ]} />
        )}
      </div>
    </div>
  );
}
