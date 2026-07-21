"use client";

import { useState, useCallback, useRef } from "react";
import type { Prescription, PrescriptionEye, PrescriptionValidationResult } from "@eyewear/shared";
import { useFunnelStore } from "@/store/funnel-store";
import { RxUpload } from "./rx-upload";
import {
  SPH_VALUES,
  CYL_VALUES,
  AXIS_VALUES,
  ADD_VALUES,
  PD_SINGLE,
  PD_HALF,
  fmtDiop,
} from "@/lib/rx-ranges";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function blankEye(): PrescriptionEye {
  return { sph: 0, cyl: 0, axis: null, add: null, prism: null, base: null };
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function EyeRow({
  label,
  eye,
  onChange,
  showAdd,
}: {
  label: string;
  eye: PrescriptionEye;
  onChange: (updated: PrescriptionEye) => void;
  showAdd: boolean;
}) {
  return (
    <tr>
      <td className="py-2 pr-3 font-semibold text-sm w-10 align-middle">{label}</td>
      <td className="py-2 pr-2">
        <select
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent"
          value={eye.sph}
          onChange={(e) => onChange({ ...eye, sph: Number(e.target.value) })}
          aria-label={`SPH ${label}`}
        >
          {SPH_VALUES.map((v) => (
            <option key={v} value={v}>
              {fmtDiop(v)}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-2">
        <select
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent"
          value={eye.cyl}
          onChange={(e) => onChange({ ...eye, cyl: Number(e.target.value), axis: eye.axis ?? 90 })}
          aria-label={`CYL ${label}`}
        >
          {CYL_VALUES.map((v) => (
            <option key={v} value={v}>
              {fmtDiop(v)}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-2">
        <select
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40"
          value={eye.axis ?? ""}
          onChange={(e) => onChange({ ...eye, axis: Number(e.target.value) })}
          disabled={eye.cyl === 0}
          aria-label={`AXIS ${label}`}
        >
          <option value="">—</option>
          {AXIS_VALUES.map((v) => (
            <option key={v} value={v}>
              {v}°
            </option>
          ))}
        </select>
      </td>
      {showAdd && (
        <td className="py-2">
          <select
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent"
            value={eye.add ?? ""}
            onChange={(e) => onChange({ ...eye, add: Number(e.target.value) })}
            aria-label={`ADD ${label}`}
          >
            <option value="">—</option>
            {ADD_VALUES.map((v) => (
              <option key={v} value={v}>
                +{v.toFixed(2)}
              </option>
            ))}
          </select>
        </td>
      )}
    </tr>
  );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

const TABS = ["manual", "upload", "later"] as const;
type Tab = (typeof TABS)[number];

interface Step2PrescriptionProps {
  onNext: () => void;
  onBack: () => void;
}

export function Step2Prescription({ onNext, onBack }: Step2PrescriptionProps) {
  const usageType = useFunnelStore((s) => s.usageType);
  const prescription = useFunnelStore((s) => s.prescription);
  const setPrescription = useFunnelStore((s) => s.setPrescription);

  const [tab, setTab] = useState<Tab>("manual");
  const [od, setOd] = useState<PrescriptionEye>(
    prescription?.od ?? blankEye()
  );
  const [os, setOs] = useState<PrescriptionEye>(
    prescription?.os ?? blankEye()
  );
  const [pdMode, setPdMode] = useState<"single" | "dual">("single");
  const [pdSingle, setPdSingle] = useState<number>(63);
  const [pdOd, setPdOd] = useState<number>(31.5);
  const [pdOs, setPdOs] = useState<number>(31.5);

  const [validation, setValidation] = useState<PrescriptionValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isProgressive = usageType === "progressive";
  const isNonPrescription = usageType === "non_prescription";

  const buildRx = useCallback((): Omit<Prescription, "verified_by_user"> => {
    return {
      od,
      os,
      pd: pdMode === "single" ? pdSingle : undefined,
      pd_od: pdMode === "dual" ? pdOd : undefined,
      pd_os: pdMode === "dual" ? pdOs : undefined,
      source: "manual",
      file_url: null,
    };
  }, [od, os, pdMode, pdSingle, pdOd, pdOs]);

  const triggerValidation = useCallback(
    (rx: Omit<Prescription, "verified_by_user">) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setValidating(true);
        try {
          const backendUrl =
            process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";
          const res = await fetch(`${backendUrl}/store/prescriptions/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prescription: rx,
              context: { frame_type: "full-rim" },
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { result: PrescriptionValidationResult };
            setValidation(data.result);
          }
        } catch {
          // Silently ignore when backend offline
        } finally {
          setValidating(false);
        }
      }, 600);
    },
    []
  );

  const handleOdChange = (updated: PrescriptionEye) => {
    setOd(updated);
    triggerValidation({ ...buildRx(), od: updated });
  };

  const handleOsChange = (updated: PrescriptionEye) => {
    setOs(updated);
    triggerValidation({ ...buildRx(), os: updated });
  };

  const handleContinue = () => {
    const rx: Prescription = {
      ...buildRx(),
      verified_by_user: tab === "later" ? false : true,
    };
    setPrescription(rx);
    if (validation?.recommended_index) {
      useFunnelStore.getState().setLensIndex(validation.recommended_index);
    }
    onNext();
  };

  if (isNonPrescription) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Receta médica</h2>
        <p className="text-sm text-gray-500 mb-6">
          Como elegiste sin graduación, no necesitas receta. Puedes continuar.
        </p>
        <div className="flex gap-3 justify-between pt-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Atrás
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 transition-colors"
          >
            Continuar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Tu receta</h2>
      <p className="text-sm text-gray-500 mb-4">
        Ingresa los valores de tu receta óptica más reciente.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 mb-6">
        {(
          [
            { key: "manual", label: "Ingresar manualmente" },
            { key: "upload", label: "Subir foto" },
            { key: "later", label: "Más tarde" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
              tab === key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "manual" && (
        <div className="space-y-5">
          {/* Prescription table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] text-sm">
              <thead>
                <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="pb-2 text-left w-10"></th>
                  <th className="pb-2 text-center">SPH</th>
                  <th className="pb-2 text-center">CYL</th>
                  <th className="pb-2 text-center">EJE</th>
                  {isProgressive && <th className="pb-2 text-center">ADD</th>}
                </tr>
              </thead>
              <tbody>
                <EyeRow
                  label="OD"
                  eye={od}
                  onChange={handleOdChange}
                  showAdd={isProgressive}
                />
                <EyeRow
                  label="OS"
                  eye={os}
                  onChange={handleOsChange}
                  showAdd={isProgressive}
                />
              </tbody>
            </table>
          </div>

          {/* PD */}
          <div>
            <div className="flex items-center gap-4 mb-2">
              <span className="text-sm font-medium text-gray-700">
                Distancia pupilar (DP)
              </span>
              <div className="flex gap-1 rounded-md bg-gray-100 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPdMode("single")}
                  className={`rounded px-2.5 py-1 font-medium transition-all ${
                    pdMode === "single"
                      ? "bg-white shadow text-gray-900"
                      : "text-gray-500"
                  }`}
                >
                  Simple
                </button>
                <button
                  type="button"
                  onClick={() => setPdMode("dual")}
                  className={`rounded px-2.5 py-1 font-medium transition-all ${
                    pdMode === "dual"
                      ? "bg-white shadow text-gray-900"
                      : "text-gray-500"
                  }`}
                >
                  Dual
                </button>
              </div>
            </div>
            {pdMode === "single" ? (
              <div className="flex items-center gap-2">
                <select
                  className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  value={pdSingle}
                  onChange={(e) => setPdSingle(Number(e.target.value))}
                  aria-label="PD simple"
                >
                  {PD_SINGLE.map((v) => (
                    <option key={v} value={v}>
                      {v} mm
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm text-gray-600">
                  OD
                  <select
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    value={pdOd}
                    onChange={(e) => setPdOd(Number(e.target.value))}
                    aria-label="PD OD"
                  >
                    {PD_HALF.map((v) => (
                      <option key={v} value={v}>
                        {v} mm
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-sm text-gray-600">
                  OS
                  <select
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    value={pdOs}
                    onChange={(e) => setPdOs(Number(e.target.value))}
                    aria-label="PD OS"
                  >
                    {PD_HALF.map((v) => (
                      <option key={v} value={v}>
                        {v} mm
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Validation feedback */}
          {validating && (
            <p className="text-xs text-gray-400 animate-pulse">
              Validando receta…
            </p>
          )}
          {validation && !validating && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                validation.fulfillable
                  ? "border-green-200 bg-green-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              {validation.fulfillable ? (
                <p className="text-green-700 font-medium mb-1">
                  ✓ Receta válida
                </p>
              ) : (
                <p className="text-red-700 font-medium mb-1">
                  ✗ Receta fuera de rango
                </p>
              )}
              {validation.warnings.map((w, i) => (
                <p key={i} className="text-gray-600 text-xs">
                  • {w}
                </p>
              ))}
              {validation.recommended_index && (
                <p className="mt-1 text-xs font-semibold text-accent">
                  Índice recomendado: {validation.recommended_index}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "upload" && (
        <RxUpload
          isProgressive={isProgressive}
          onSwitchToManual={() => setTab("manual")}
          onConfirm={(rx) => {
            // Pre-populate manual fields from OCR result
            setOd(rx.od);
            setOs(rx.os);
            if (rx.pd !== null && rx.pd !== undefined) {
              setPdMode("single");
              setPdSingle(rx.pd);
            } else if (rx.pd_od !== null && rx.pd_od !== undefined) {
              setPdMode("dual");
              setPdOd(rx.pd_od ?? 31.5);
              setPdOs(rx.pd_os ?? 31.5);
            }
            setPrescription(rx);
            if (rx.source === "ocr") {
              // validated by review step in RxUpload, proceed
              onNext();
            }
          }}
        />
      )}

      {tab === "later" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm">
          <p className="font-medium text-amber-800 mb-1">
            Proporcionar receta más tarde
          </p>
          <p className="text-amber-700">
            Podrás enviar tu receta por WhatsApp o correo después de completar
            tu pedido. Tu pedido se fabricará al recibirla.
          </p>
        </div>
      )}

      {/* Actions — hidden when upload tab manages its own navigation */}
      {tab !== "upload" && (
        <div className="flex gap-3 justify-between pt-6">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Atrás
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={
              tab === "manual" &&
              validation !== null &&
              !validation.fulfillable
            }
            className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Continuar
          </button>
        </div>
      )}
      {tab === "upload" && (
        <div className="pt-6">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Atrás
          </button>
        </div>
      )}
    </div>
  );
}
