import { useState, useRef, useId } from "react";

// ---------------------------------------------------------------------------
// Capri admin dashboard — dependency-free, responsive, accessible SVG charts.
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

function Empty({ height, msg = "sin datos" }) {
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

// ---------------------------------------------------------------------------
// 1. KpiCard
export function KpiCard({ label, value, delta, deltaGood, icon, sub }) {
  const good = !!deltaGood;
  return (
    <div
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
          <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
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
  const tipLeftPct = hp ? (hp.x / W) * 100 : 0;
  const tipTopPct = hp ? (hp.y / H) * 100 : 0;

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

        {area ? <path d={areaPath} fill={`url(#lg-${gid})`} /> : null}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* dots */}
        {pts.map((p) => (
          <circle
            key={p.i}
            cx={p.x}
            cy={p.y}
            r={hover && hover.i === p.i ? 4.5 : 2.5}
            fill="#fff"
            stroke={color}
            strokeWidth="2"
          />
        ))}

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
      </svg>

      {hp ? (
        <div
          style={{
            position: "absolute",
            left: `${tipLeftPct}%`,
            top: `${tipTopPct}%`,
            transform: "translate(-50%, calc(-100% - 10px))",
            background: BRAND.ink,
            color: "#fff",
            padding: "6px 9px",
            borderRadius: 8,
            fontSize: 11,
            lineHeight: 1.35,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 4px 12px rgba(16,24,40,0.18)",
            zIndex: 2,
          }}
        >
          <div style={{ color: "rgba(255,255,255,0.7)" }}>{hp.d.label}</div>
          <div style={{ fontWeight: 700 }}>
            {valuePrefix}
            {fmt(Number(hp.d.value) || 0)}
          </div>
        </div>
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
  const [hover, setHover] = useState(null);

  if (!Array.isArray(data) || data.length === 0)
    return <Empty height={height} />;

  const values = data.map((d) => Number(d.value) || 0);
  const rawMax = Math.max(...values, 0);
  const max = niceMax(rawMax) || 1;
  const n = data.length;
  const W = 720;
  const H = height;

  const ariaLabel = `Gráfico de barras, ${n} categorías, máximo ${valuePrefix}${fmt(
    rawMax
  )}`;

  if (horizontal) {
    const padL = 120;
    const padR = 60;
    const padT = 8;
    const padB = 8;
    const plotW = W - padL - padR;
    const rowH = (H - padT - padB) / n;
    const barH = Math.min(26, rowH * 0.62);

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
                  fill={BRAND.ink}
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
                />
                <rect
                  x={padL}
                  y={y}
                  width={w}
                  height={barH}
                  rx={barH / 2}
                  fill={color}
                  opacity={hovered ? 1 : 0.9}
                />
                <text
                  x={padL + w + 8}
                  y={y + barH / 2 + 4}
                  fontSize="11"
                  fontWeight="600"
                  fill={BRAND.muted}
                >
                  {valuePrefix}
                  {fmt(v)}
                </text>
              </g>
            );
          })}
        </svg>
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
              <rect
                x={bx}
                y={by}
                width={barW}
                height={Math.max(0, bh)}
                rx={6}
                fill={color}
                opacity={hovered ? 1 : 0.9}
              />
              {hovered ? (
                <text
                  x={cx}
                  y={by - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  fill={BRAND.ink}
                >
                  {valuePrefix}
                  {fmt(v)}
                </text>
              ) : null}
              {i % step === 0 || i === n - 1 ? (
                <text
                  x={cx}
                  y={H - (rotate ? 6 : 12)}
                  textAnchor={rotate ? "end" : "middle"}
                  fontSize="10"
                  fill={BRAND.muted}
                  transform={rotate ? `rotate(-35 ${cx} ${H - 6})` : undefined}
                >
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. DonutChart
export function DonutChart({ data, height = 220, size = 180 }) {
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

  const ariaLabel = `Gráfico de dona, total ${fmt(total)}, ${items.length} categorías`;

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
            segs.map((s, i) => (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${s.dash} ${circ - s.dash}`}
                strokeDashoffset={-s.offset}
                strokeLinecap="butt"
              />
            ))}
        </g>
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
          gap: 8,
        }}
      >
        {segs.map((s, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
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
              }}
            />
            <span style={{ color: BRAND.ink, flex: 1, minWidth: 0 }}>
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
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label="sin datos"
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
      />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 6. Funnel
export function Funnel({ steps }) {
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
      aria-label={`Embudo de conversión, ${rows.length} pasos`}
    >
      {rows.map((r, i) => {
        const wpct = (r.value / maxV) * 100;
        const conv = first > 0 ? (r.value / first) * 100 : 0;
        const c = PALETTE[i % PALETTE.length];
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                  transition: "width 0.3s ease",
                }}
              >
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>
                  {fmt(r.value)}
                </span>
              </div>
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
