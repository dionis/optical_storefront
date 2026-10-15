import { useState, useRef, useId } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";

// ---------------------------------------------------------------------------
// Capri admin dashboard — dependency-free, responsive, accessible SVG charts.
// Enhanced with mount entrance animations, hover motion and rich Spanish
// tooltips. All keyframes live in admin.css (prefixed `cx-` / `cx…`) and are
// disabled under `prefers-reduced-motion: reduce`.
// Brand palette
const BRAND = {
  primary: "#0E5AD0",
  accent: "#FD0E3F",
  ink: "#16181d",
  muted: "#5c6470",
  line: "#e6e8ec",
  soft: "#f5f6f8",
  ok: "#2e7d46",
  warn: "#b26a00",
};

// Categorical palette for donut / multi-series when no explicit color given.
const PALETTE = [
  "#0E5AD0",
  "#FD0E3F",
  "#2e7d46",
  "#b26a00",
  "#7b4aa0",
  "#4bb8c4",
  "#c9a44a",
  "#5c6470",
];

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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
export function KpiCard({ label, value, delta, deltaGood, icon, sub }) {
  const good = !!deltaGood;
  return (
    <div
      className="cx-kpi"
      style={{
        fontFamily: FONT,
        background: "#fff",
        border: `1px solid ${BRAND.line}`,
        borderRadius: 14,
        padding: "16px 18px",
        boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
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
          style={{
            fontSize: 11,
            fontWeight: 600,
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
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: BRAND.ink,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {delta !== undefined && delta !== null && delta !== "" ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 12,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 999,
              color: good ? BRAND.ok : BRAND.accent,
              background: good ? "rgba(46,125,70,0.10)" : "rgba(253,14,63,0.10)",
            }}
          >
            <span aria-hidden="true">{good ? "▲" : "▼"}</span>
            {delta}
          </span>
        ) : null}
        {sub ? (
          <span style={{ fontSize: 12, color: BRAND.muted }}>{sub}</span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. LineChart
export function LineChart({
  data,
  height = 220,
  color = "#0E5AD0",
  valuePrefix = "",
  area = true,
}) {
  const { t } = useLang();
  const gid = useId().replace(/[:]/g, "");
  const [hover, setHover] = useState(null); // {x, y, i}
  const wrapRef = useRef(null);

  if (!Array.isArray(data) || data.length === 0)
    return <Empty height={height} />;

  const W = 720;
  const H = height;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const values = data.map((d) => Number(d.value) || 0);
  const rawMax = Math.max(...values, 0);
  const max = niceMax(rawMax);
  const n = data.length;
  const total = values.reduce((s, v) => s + v, 0);
  const avg = n > 0 ? total / n : 0;

  const xAt = (i) => (n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1));
  const yAt = (v) => padT + plotH - (plotH * v) / max;

  const pts = data.map((d, i) => ({
    x: xAt(i),
    y: yAt(Number(d.value) || 0),
    d,
    i,
  }));

  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    `M${pts[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} ` +
    pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${pts[n - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const gridN = 4;
  const grid = Array.from({ length: gridN + 1 }, (_, i) => {
    const v = (max * i) / gridN;
    return { v, y: yAt(v) };
  });

  const step = labelStep(n, 7);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    // nearest point index
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = Math.abs(xAt(i) - relX);
      if (dx < bestD) {
        bestD = dx;
        best = i;
      }
    }
    setHover({ i: best, x: pts[best].x, y: pts[best].y });
  };

  const ariaLabel = `Gráfico de línea, ${n} puntos, máximo ${valuePrefix}${fmt(
    rawMax
  )}`;

  const hp = hover ? pts[hover.i] : null;
  const hv = hp ? Number(hp.d.value) || 0 : 0;
  const hpct = hp && total > 0 ? (hv / total) * 100 : 0;
  const DRAW = "3000";

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", fontFamily: FONT }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block", overflow: "visible" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`lg-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* gridlines + y labels */}
        {grid.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={g.y}
              x2={W - padR}
              y2={g.y}
              stroke={BRAND.line}
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={g.y + 4}
              textAnchor="end"
              fontSize="10"
              fill={BRAND.muted}
            >
              {valuePrefix}
              {fmt(g.v)}
            </text>
          </g>
        ))}

        {/* x labels (thinned) */}
        {data.map((d, i) =>
          i % step === 0 || i === n - 1 ? (
            <text
              key={i}
              x={xAt(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill={BRAND.muted}
            >
              {d.label}
            </text>
          ) : null
        )}

        {area ? (
          <path
            d={areaPath}
            fill={`url(#lg-${gid})`}
            style={{ animation: "cxFadeIn 1.1s ease .25s both" }}
          />
        ) : null}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{
            strokeDasharray: DRAW,
            "--cx-len": `${DRAW}px`,
            animation: "cxDraw 1.4s cubic-bezier(.3,.8,.25,1) both",
          }}
        />

        {/* hover guide */}
        {hp ? (
          <line
            x1={hp.x}
            y1={padT}
            x2={hp.x}
            y2={padT + plotH}
            stroke={color}
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.6"
          />
        ) : null}

        {/* dots */}
        {pts.map((p) => (
          <circle
            key={p.i}
            cx={p.x}
            cy={p.y}
            r={hover && hover.i === p.i ? 5 : 2.5}
            fill="#fff"
            stroke={color}
            strokeWidth={hover && hover.i === p.i ? 2.5 : 2}
            style={{
              transition: "r .15s ease, stroke-width .15s ease",
              animation: `cxFadeIn .5s ease ${0.6 + p.i * 0.02}s both`,
            }}
          />
        ))}
      </svg>

      {hp ? (
        <Tip
          x={hp.x}
          y={hp.y}
          W={W}
          H={H}
          caption={hp.d.label}
          value={`${valuePrefix}${fmt(hv)}`}
          lines={[
            { text: t("adm.chart.pctOfTotal", { pct: hpct.toFixed(1) }), color: "rgba(255,255,255,0.72)" },
            deltaLine(hv, avg, t("adm.chart.vsAvg")),
          ].filter(Boolean)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. BarChart
export function BarChart({
  data,
  height = 220,
  color = "#0E5AD0",
  horizontal = false,
  valuePrefix = "",
}) {
  const { t } = useLang();
  const [hover, setHover] = useState(null);

  if (!Array.isArray(data) || data.length === 0)
    return <Empty height={height} />;

  const values = data.map((d) => Number(d.value) || 0);
  const rawMax = Math.max(...values, 0);
  const max = niceMax(rawMax) || 1;
  const n = data.length;
  const total = values.reduce((s, v) => s + v, 0);
  const avg = n > 0 ? total / n : 0;
  const W = 720;
  const H = height;

  const ariaLabel = t("adm.chart.ariaBar", { n, max: `${valuePrefix}${fmt(rawMax)}` });

  const tipLines = (v) =>
    [
      {
        text: t("adm.chart.pctOfTotal", { pct: total > 0 ? ((v / total) * 100).toFixed(1) : "0" }),
        color: "rgba(255,255,255,0.72)",
      },
      deltaLine(v, avg, t("adm.chart.vsAvg")),
    ].filter(Boolean);

  if (horizontal) {
    const padL = 120;
    const padR = 60;
    const padT = 8;
    const padB = 8;
    const plotW = W - padL - padR;
    const rowH = (H - padT - padB) / n;
    const barH = Math.min(26, rowH * 0.62);
    const hv = hover != null ? values[hover] : 0;
    const hy =
      hover != null
        ? padT + rowH * hover + (rowH - barH) / 2 + barH / 2
        : 0;
    const hx =
      hover != null ? padL + Math.max(0, (plotW * hv) / max) : 0;

    return (
      <div style={{ position: "relative", width: "100%", fontFamily: FONT }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={ariaLabel}
          style={{ display: "block" }}
        >
          {data.map((d, i) => {
            const v = Number(d.value) || 0;
            const y = padT + rowH * i + (rowH - barH) / 2;
            const w = Math.max(0, (plotW * v) / max);
            const hovered = hover === i;
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <text
                  x={padL - 10}
                  y={y + barH / 2 + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill={hovered ? BRAND.ink : BRAND.muted}
                  fontWeight={hovered ? "700" : "400"}
                  style={{ transition: "fill .15s ease" }}
                >
                  {String(d.label).length > 16
                    ? String(d.label).slice(0, 15) + "…"
                    : d.label}
                </text>
                <rect
                  x={padL}
                  y={y}
                  width={plotW}
                  height={barH}
                  rx={barH / 2}
                  fill={BRAND.soft}
                  style={{ animation: "none" }}
                />
                <g
                  style={{
                    transform: hovered ? "translateX(3px)" : "none",
                    transition: "transform .18s cubic-bezier(.2,.8,.2,1)",
                  }}
                >
                  <rect
                    x={padL}
                    y={y}
                    width={w}
                    height={barH}
                    rx={barH / 2}
                    fill={color}
                    opacity={hovered ? 1 : 0.9}
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "left",
                      transition: "opacity .15s ease, filter .18s ease",
                      filter: hovered
                        ? `brightness(1.06) drop-shadow(0 2px 6px ${color}55)`
                        : "none",
                      animation: `cxGrowRight .7s cubic-bezier(.2,.85,.25,1) ${i * 40}ms both`,
                    }}
                  />
                </g>
                <text
                  x={padL + w + 8}
                  y={y + barH / 2 + 4}
                  fontSize="11"
                  fontWeight="600"
                  fill={hovered ? BRAND.ink : BRAND.muted}
                  style={{ transition: "fill .15s ease" }}
                >
                  {valuePrefix}
                  {fmt(v)}
                </text>
              </g>
            );
          })}
        </svg>
        {hover != null ? (
          <Tip
            x={hx}
            y={hy}
            W={W}
            H={H}
            caption={data[hover].label}
            value={`${valuePrefix}${fmt(hv)}`}
            lines={tipLines(hv)}
          />
        ) : null}
      </div>
    );
  }

  // vertical
  const padL = 44;
  const padR = 14;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slot = plotW / n;
  const barW = Math.min(48, slot * 0.6);
  const yAt = (v) => padT + plotH - (plotH * v) / max;

  const gridN = 4;
  const grid = Array.from({ length: gridN + 1 }, (_, i) => {
    const v = (max * i) / gridN;
    return { v, y: yAt(v) };
  });

  const step = labelStep(n, 8);
  const rotate = n > 8;

  const hv = hover != null ? values[hover] : 0;
  const hcx = hover != null ? padL + slot * hover + slot / 2 : 0;
  const hy = hover != null ? yAt(hv) : 0;

  return (
    <div style={{ position: "relative", width: "100%", fontFamily: FONT }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block" }}
      >
        {grid.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={g.y}
              x2={W - padR}
              y2={g.y}
              stroke={BRAND.line}
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={g.y + 4}
              textAnchor="end"
              fontSize="10"
              fill={BRAND.muted}
            >
              {valuePrefix}
              {fmt(g.v)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const v = Number(d.value) || 0;
          const cx = padL + slot * i + slot / 2;
          const bx = cx - barW / 2;
          const by = yAt(v);
          const bh = padT + plotH - by;
          const hovered = hover === i;
          return (
            <g
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* transparent hit slot so the whole column is hoverable */}
              <rect
                x={padL + slot * i}
                y={padT}
                width={slot}
                height={plotH}
                fill="transparent"
              />
              <g
                style={{
                  transform: hovered ? "translateY(-4px)" : "none",
                  transition: "transform .18s cubic-bezier(.2,.8,.2,1)",
                }}
              >
                <rect
                  x={bx}
                  y={by}
                  width={barW}
                  height={Math.max(0, bh)}
                  rx={6}
                  fill={color}
                  opacity={hovered ? 1 : 0.9}
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "bottom",
                    transition: "opacity .15s ease, filter .18s ease",
                    filter: hovered
                      ? `brightness(1.06) drop-shadow(0 4px 8px ${color}55)`
                      : "none",
                    animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 40}ms both`,
                  }}
                />
              </g>
              {i % step === 0 || i === n - 1 ? (
                <text
                  x={cx}
                  y={H - (rotate ? 6 : 12)}
                  textAnchor={rotate ? "end" : "middle"}
                  fontSize="10"
                  fill={hovered ? BRAND.ink : BRAND.muted}
                  fontWeight={hovered ? "700" : "400"}
                  transform={rotate ? `rotate(-35 ${cx} ${H - 6})` : undefined}
                  style={{ transition: "fill .15s ease" }}
                >
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover != null ? (
        <Tip
          x={hcx}
          y={hy}
          W={W}
          H={H}
          caption={data[hover].label}
          value={`${valuePrefix}${fmt(hv)}`}
          lines={tipLines(hv)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. DonutChart
export function DonutChart({ data, height = 220, size = 180, iconByLabel }) {
  const { t } = useLang();
  const [hi, setHi] = useState(-1);

  if (!Array.isArray(data) || data.length === 0)
    return <Empty height={height} />;

  const items = data.map((d, i) => ({
    label: d.label,
    value: Math.max(0, Number(d.value) || 0),
    color: d.color || PALETTE[i % PALETTE.length],
  }));
  const total = items.reduce((s, d) => s + d.value, 0);

  const S = size;
  const stroke = Math.max(14, S * 0.16);
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
        gap: 20,
      }}
    >
      <svg
        viewBox={`0 0 ${S} ${S}`}
        width={S}
        height={Math.min(height, S)}
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
              fontSize="9.5"
              fontWeight="600"
              fill={active.color}
              style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
            >
              {String(active.label).length > 12
                ? String(active.label).slice(0, 11) + "…"
                : active.label}
            </text>
            <text
              x={cx}
              y={cy + S * 0.02}
              textAnchor="middle"
              fontSize={S * 0.15}
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
              fontSize={S * 0.16}
              fontWeight="700"
              fill={BRAND.ink}
            >
              {fmt(total)}
            </text>
            <text
              x={cx}
              y={cy + S * 0.12}
              textAnchor="middle"
              fontSize="10"
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
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {segs.map((s, i) => (
          <li
            key={i}
            onMouseEnter={() => setHi(i)}
            onMouseLeave={() => setHi(-1)}
            className="cx-legend-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              padding: "4px 6px",
              borderRadius: 8,
              cursor: "pointer",
              background: hi === i ? "rgba(14,90,208,0.06)" : "transparent",
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
export function Sparkline({ data, color = "#0E5AD0", width = 120, height = 34 }) {
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
      aria-label={`Tendencia, ${n} puntos`}
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
export function Funnel({ steps }) {
  const { t } = useLang();
  const [hi, setHi] = useState(-1);

  if (!Array.isArray(steps) || steps.length === 0)
    return <Empty height={160} />;

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
        gap: 10,
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
                width: 120,
                flex: "0 0 auto",
                fontSize: 12,
                color: BRAND.ink,
                fontWeight: 600,
                textAlign: "right",
              }}
            >
              {r.label}
            </div>
            <div
              style={{
                flex: 1,
                background: BRAND.soft,
                borderRadius: 8,
                height: 30,
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
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 10,
                  boxSizing: "border-box",
                  transformOrigin: "left",
                  filter: hovered ? "brightness(1.07)" : "none",
                  transition: "filter .15s ease",
                  animation: `cxGrowRight .8s cubic-bezier(.2,.85,.25,1) ${i * 70}ms both`,
                }}
              >
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>
                  {fmt(r.value)}
                </span>
              </div>
              {hovered && i > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: BRAND.accent,
                    background: "rgba(255,255,255,0.9)",
                    padding: "1px 6px",
                    borderRadius: 999,
                    pointerEvents: "none",
                  }}
                >
                  −{stepDrop.toFixed(0)}% vs paso previo
                </span>
              ) : null}
            </div>
            <div
              style={{
                width: 54,
                flex: "0 0 auto",
                fontSize: 12,
                fontWeight: 600,
                color: i === 0 ? BRAND.muted : BRAND.primary,
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
// data = [{ label, access, orders }]
export function AccessVsBuyChart({ data, height = 250 }) {
  const { t } = useLang();
  const gid = useId();
  const [hi, setHi] = useState(-1);
  const W = 720, H = height, PL = 44, PR = 14, PT = 18, PB = 30;
  const iw = W - PL - PR, ih = H - PT - PB;
  if (!data || !data.length) return <div className="chart-empty" style={{ height }}>{t("adm.chart.noData")}</div>;
  const max = Math.max(1, ...data.map((d) => Math.max(d.access, d.orders)));
  const nice = Math.ceil(max / 4) * 4;
  const x = (i) => PL + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => PT + ih - (v / nice) * ih;
  const bw = Math.max(2, Math.min(16, iw / data.length * 0.5));
  const linePts = data.map((d, i) => `${x(i)},${y(d.access)}`).join(" ");
  const areaPts = `${PL},${PT + ih} ${linePts} ${PL + iw},${PT + ih}`;
  const step = Math.ceil(data.length / 7);
  const hd = hi >= 0 ? data[hi] : null;
  const conv = hd && hd.access ? (hd.orders / hd.access) * 100 : 0;
  return (
    <div className="chart-wrap" role="img" aria-label={t("adm.chart.ariaAccessVsBuy")}>
      <div className="chart-legend">
        <span><i style={{ background: "#0E5AD0" }} />{t("adm.chart.access")}</span>
        <span><i style={{ background: "#FD0E3F" }} />{t("adm.chart.buys")}</span>
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet"
             style={{ display: "block" }}
             onMouseLeave={() => setHi(-1)}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#0E5AD0" stopOpacity="0.22" /><stop offset="1" stopColor="#0E5AD0" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={gid + "b"} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#FF3B62" /><stop offset="1" stopColor="#FD0E3F" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((g) => { const yy = PT + (g / 4) * ih; const val = Math.round(nice - (g / 4) * nice);
            return <g key={g}><line x1={PL} x2={W - PR} y1={yy} y2={yy} stroke="#eef1f6" /><text x={PL - 8} y={yy + 4} textAnchor="end" fontSize="11" fill="#98a1b0">{val}</text></g>; })}
          <polygon points={areaPts} fill={`url(#${gid})`} style={{ animation: "cxFadeIn 1.1s ease .3s both" }} />
          <polyline points={linePts} fill="none" stroke="#0E5AD0" strokeWidth="2.5" strokeLinejoin="round"
                    style={{ strokeDasharray: "3000", "--cx-len": "3000px", animation: "cxDraw 1.4s cubic-bezier(.3,.8,.25,1) both" }} />
          {data.map((d, i) => {
            const hovered = hi === i;
            return (
              <g key={i} onMouseEnter={() => setHi(i)}>
                <g style={{ transform: hovered ? "translateY(-3px)" : "none", transition: "transform .18s cubic-bezier(.2,.8,.2,1)" }}>
                  <rect x={x(i) - bw / 2} y={y(d.orders)} width={bw} height={Math.max(0, PT + ih - y(d.orders))} rx="3"
                        fill={`url(#${gid + "b"})`} opacity={hi < 0 || hovered ? 1 : 0.55}
                        style={{ transformBox: "fill-box", transformOrigin: "bottom", transition: "opacity .15s ease",
                                 animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 30}ms both` }} />
                </g>
                {i % step === 0 && <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="10.5" fill={hovered ? "#16181d" : "#98a1b0"} fontWeight={hovered ? "700" : "400"}>{d.label}</text>}
                <rect x={x(i) - iw / data.length / 2} y={PT} width={iw / data.length} height={ih} fill="transparent" />
              </g>
            );
          })}
          {hi >= 0 && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={PT + ih} stroke="#0E5AD0" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />}
          {hi >= 0 && <circle cx={x(hi)} cy={y(data[hi].access)} r="5" fill="#0E5AD0" stroke="#fff" strokeWidth="2" />}
        </svg>
        {hd && (
          <Tip
            x={x(hi)}
            y={Math.min(y(hd.access), y(hd.orders))}
            W={W}
            H={H}
            caption={hd.label}
            value={null}
            lines={[
              { text: t("adm.chart.accessN", { n: fmt(hd.access) }), color: "#8fc0ff" },
              { text: t("adm.chart.buysN", { n: fmt(hd.orders) }), color: "#ff9db0" },
              { text: t("adm.chart.conv", { pct: conv.toFixed(1) }), color: "#7ee2a0" },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// Grouped bars per weekday: accesses vs purchases. data = [{label, access, orders, conv}]
export function WeekdayChart({ data, height = 230 }) {
  const { t } = useLang();
  const [hi, setHi] = useState(-1);
  const gid = useId();
  const W = 720, H = height, PL = 40, PR = 12, PT = 16, PB = 42;
  const iw = W - PL - PR, ih = H - PT - PB;
  if (!data || !data.length) return <div className="chart-empty" style={{ height }}>{t("adm.chart.noData")}</div>;
  const max = Math.max(1, ...data.map((d) => Math.max(d.access, d.orders)));
  const nice = Math.ceil(max / 4) * 4;
  const gw = iw / data.length, bw = Math.min(22, gw / 3);
  const y = (v) => PT + ih - (v / nice) * ih;
  // best day = most purchases (ties → highest conversion)
  let bestIdx = 0;
  data.forEach((d, i) => {
    const b = data[bestIdx];
    if (d.orders > b.orders || (d.orders === b.orders && (d.conv || 0) > (b.conv || 0))) bestIdx = i;
  });
  const hd = hi >= 0 ? data[hi] : null;
  return (
    <div className="chart-wrap" role="img" aria-label={t("adm.chart.ariaWeekday")}>
      <div className="chart-legend">
        <span><i style={{ background: "#0E5AD0" }} />{t("adm.chart.access")}</span>
        <span><i style={{ background: "#FD0E3F" }} />{t("adm.chart.buys")}</span>
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }} onMouseLeave={() => setHi(-1)}>
          <defs>
            <linearGradient id={gid + "a"} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#3d84ea" /><stop offset="1" stopColor="#0E5AD0" /></linearGradient>
            <linearGradient id={gid + "o"} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#FF3B62" /><stop offset="1" stopColor="#FD0E3F" /></linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((g) => { const yy = PT + (g / 4) * ih;
            return <line key={g} x1={PL} x2={W - PR} y1={yy} y2={yy} stroke="#eef1f6" />; })}
          {data.map((d, i) => {
            const cx = PL + gw * i + gw / 2;
            const hovered = hi === i;
            const isBest = i === bestIdx;
            return (
              <g key={i} onMouseEnter={() => setHi(i)}>
                <rect x={PL + gw * i} y={PT} width={gw} height={ih} fill={hovered ? "rgba(14,90,208,0.05)" : "transparent"} />
                <g style={{ transform: hovered ? "translateY(-5px)" : "none", transition: "transform .18s cubic-bezier(.2,.8,.2,1)" }}>
                  <rect x={cx - bw - 2} y={y(d.access)} width={bw} height={PT + ih - y(d.access)} rx="4"
                        fill={`url(#${gid + "a"})`} opacity={hi < 0 || hovered ? 1 : 0.6}
                        style={{ transformBox: "fill-box", transformOrigin: "bottom", transition: "opacity .15s ease",
                                 animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 45}ms both` }} />
                  <rect x={cx + 2} y={y(d.orders)} width={bw} height={PT + ih - y(d.orders)} rx="4"
                        fill={`url(#${gid + "o"})`} opacity={hi < 0 || hovered ? 1 : 0.6}
                        style={{ transformBox: "fill-box", transformOrigin: "bottom", transition: "opacity .15s ease",
                                 animation: `cxGrowUp .7s cubic-bezier(.2,.85,.25,1) ${i * 45 + 60}ms both` }} />
                </g>
                {isBest && <text x={cx} y={Math.min(y(d.access), y(d.orders)) - 6} textAnchor="middle" fontSize="12" fill="#c9a44a">★</text>}
                <text x={cx} y={H - 24} textAnchor="middle" fontSize="12" fill={hovered || isBest ? "#16181d" : "#5c6470"} fontWeight={hovered || isBest ? "700" : "600"}>{d.label}</text>
                <text x={cx} y={H - 9} textAnchor="middle" fontSize="10.5" fill="#98a1b0">{d.conv}%</text>
              </g>
            );
          })}
        </svg>
        {hd && (
          <Tip
            x={PL + gw * hi + gw / 2}
            y={Math.min(y(hd.access), y(hd.orders))}
            W={W}
            H={H}
            caption={`${hd.label}${hi === bestIdx ? `  ${t("adm.chart.bestDay")}` : ""}`}
            value={null}
            lines={[
              { text: t("adm.chart.accessN", { n: fmt(hd.access) }), color: "#8fc0ff" },
              { text: t("adm.chart.buysN", { n: fmt(hd.orders) }), color: "#ff9db0" },
              { text: t("adm.chart.conv", { pct: hd.conv }), color: "#7ee2a0" },
            ]}
          />
        )}
      </div>
    </div>
  );
}
