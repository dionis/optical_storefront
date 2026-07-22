"use client";

import { useTranslations } from "next-intl";

interface MeasurementsDiagramProps {
  eyeSize: number;
  bridgeSize: number;
  templeLength: number;
  a?: number | null;
  b?: number | null;
}

/** Visual diagram showing eye-bridge-temple measurements for a frame. */
export function MeasurementsDiagram({
  eyeSize,
  bridgeSize,
  templeLength,
  a,
  b,
}: MeasurementsDiagramProps) {
  const t = useTranslations("pdp");

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
        {t("measurementsTitle")}
      </h3>
      {/* SVG frame diagram */}
      <svg
        viewBox="0 0 280 80"
        className="w-full max-w-xs mx-auto"
        aria-label={t("measurementsAria", { eyeSize, bridgeSize, templeLength })}
      >
        {/* Left lens */}
        <rect x="10" y="20" width="90" height="50" rx="8" fill="none" stroke="#94a3b8" strokeWidth="2" />
        {/* Bridge */}
        <line x1="100" y1="40" x2="130" y2="40" stroke="#94a3b8" strokeWidth="2" />
        {/* Right lens */}
        <rect x="130" y="20" width="90" height="50" rx="8" fill="none" stroke="#94a3b8" strokeWidth="2" />
        {/* Left temple */}
        <line x1="10" y1="32" x2="-30" y2="36" stroke="#94a3b8" strokeWidth="2" />
        {/* Right temple */}
        <line x1="220" y1="32" x2="260" y2="36" stroke="#94a3b8" strokeWidth="2" />

        {/* Eye size label (top, left lens) */}
        <text x="55" y="14" textAnchor="middle" fontSize="9" fill="#64748b">{eyeSize}</text>
        <line x1="10" y1="16" x2="100" y2="16" stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="2" />

        {/* Bridge label */}
        <text x="115" y="14" textAnchor="middle" fontSize="9" fill="#64748b">{bridgeSize}</text>

        {/* B measurement (vertical, if present) */}
        {b && (
          <>
            <text x="3" y="48" textAnchor="middle" fontSize="8" fill="#64748b">{b}</text>
          </>
        )}
      </svg>

      {/* Measurement pills */}
      <div className="flex flex-wrap justify-center gap-2 mt-3">
        <Pill label={t("measureEye")} value={`${eyeSize} mm`} />
        <Pill label={t("measureBridge")} value={`${bridgeSize} mm`} />
        <Pill label={t("measureTemple")} value={`${templeLength} mm`} />
        {a && <Pill label="A" value={`${a} mm`} />}
        {b && <Pill label="B" value={`${b} mm`} />}
      </div>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2.5 py-1 text-xs">
      <span className="font-medium text-gray-500">{label}</span>
      <span className="text-gray-900">{value}</span>
    </span>
  );
}
