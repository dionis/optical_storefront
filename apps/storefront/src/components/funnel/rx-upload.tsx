"use client";

import { useRef, useState } from "react";
import type { Prescription, PrescriptionEye, PrescriptionValidationResult } from "@eyewear/shared";
import {
  SPH_VALUES,
  CYL_VALUES,
  AXIS_VALUES,
  ADD_VALUES,
  PD_SINGLE,
  PD_HALF,
  fmtDiop,
} from "@/lib/rx-ranges";

// ── Types ──────────────────────────────────────────────────────────────────

type OcrStatus = "idle" | "uploading" | "reviewing" | "error";

interface OcrResponse {
  prescription?: Prescription;
  validation?: PrescriptionValidationResult;
  error?: string;
  fallback?: boolean;
  message?: string;
}

interface RxUploadProps {
  onConfirm: (prescription: Prescription) => void;
  onSwitchToManual: () => void;
  isProgressive: boolean;
}

// ── Eye row ────────────────────────────────────────────────────────────────

function EyeRow({
  label,
  eye,
  onChange,
  showAdd,
}: {
  label: string;
  eye: PrescriptionEye;
  onChange: (e: PrescriptionEye) => void;
  showAdd: boolean;
}) {
  return (
    <tr>
      <td className="py-2 pr-3 font-semibold text-sm w-10 align-middle">{label}</td>
      <td className="py-2 pr-2">
        <select
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent"
          value={eye.sph ?? 0}
          onChange={(e) => onChange({ ...eye, sph: Number(e.target.value) })}
          aria-label={`SPH ${label}`}
        >
          {SPH_VALUES.map((v) => (
            <option key={v} value={v}>{fmtDiop(v)}</option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-2">
        <select
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent"
          value={eye.cyl ?? 0}
          onChange={(e) =>
            onChange({ ...eye, cyl: Number(e.target.value), axis: eye.axis ?? 90 })
          }
          aria-label={`CYL ${label}`}
        >
          {CYL_VALUES.map((v) => (
            <option key={v} value={v}>{fmtDiop(v)}</option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-2">
        <select
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40"
          value={eye.axis ?? ""}
          onChange={(e) => onChange({ ...eye, axis: Number(e.target.value) })}
          disabled={(eye.cyl ?? 0) === 0}
          aria-label={`AXIS ${label}`}
        >
          <option value="">—</option>
          {AXIS_VALUES.map((v) => (
            <option key={v} value={v}>{v}°</option>
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
              <option key={v} value={v}>+{v.toFixed(2)}</option>
            ))}
          </select>
        </td>
      )}
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function RxUpload({ onConfirm, onSwitchToManual, isProgressive }: RxUploadProps) {
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Editable extracted fields
  const [od, setOd] = useState<PrescriptionEye>({ sph: 0, cyl: 0, axis: null, add: null, prism: null, base: null });
  const [os, setOs] = useState<PrescriptionEye>({ sph: 0, cyl: 0, axis: null, add: null, prism: null, base: null });
  const [pdMode, setPdMode] = useState<"single" | "dual">("single");
  const [pdSingle, setPdSingle] = useState<number>(63);
  const [pdOd, setPdOd] = useState<number>(31.5);
  const [pdOs, setPdOs] = useState<number>(31.5);
  const [ocrFileUrl, setOcrFileUrl] = useState<string | null>(null);
  const [validation, setValidation] = useState<PrescriptionValidationResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const backendUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setPreviewUrl(URL.createObjectURL(file));
    setStatus("uploading");
    setErrorMsg(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${backendUrl}/store/prescriptions/ocr`, {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as OcrResponse;

      if (!res.ok || data.error) {
        if (data.fallback) {
          setErrorMsg(data.error ?? "Error al procesar la imagen.");
          setStatus("error");
        } else {
          setErrorMsg(data.error ?? "No se pudo leer la receta.");
          setStatus("error");
        }
        return;
      }

      if (data.prescription) {
        const rx = data.prescription;
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
        setOcrFileUrl(rx.file_url ?? null);
        setValidation(data.validation ?? null);
        setStatus("reviewing");
      } else {
        setErrorMsg("No se encontraron datos de receta en la imagen.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Error de conexión. Por favor ingresa tu receta manualmente.");
      setStatus("error");
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleConfirm = () => {
    const prescription: Prescription = {
      od,
      os,
      pd: pdMode === "single" ? pdSingle : undefined,
      pd_od: pdMode === "dual" ? pdOd : undefined,
      pd_os: pdMode === "dual" ? pdOs : undefined,
      source: "ocr",
      verified_by_user: true,
      file_url: ocrFileUrl,
    };
    onConfirm(prescription);
  };

  // ── Idle state: dropzone ───────────────────────────────────────────────

  if (status === "idle" || status === "error") {
    return (
      <div className="space-y-4">
        <div
          role="button"
          tabIndex={0}
          aria-label="Subir imagen de receta"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-10 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="text-4xl select-none">📷</span>
          <div>
            <p className="text-sm font-semibold text-gray-800">
              Arrastra tu receta aquí o haz clic para seleccionar
            </p>
            <p className="text-xs text-gray-400 mt-1">
              JPEG · PNG · WEBP — máx. 10 MB
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={handleInputChange}
            aria-hidden="true"
          />
        </div>

        {status === "error" && errorMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
            <button
              type="button"
              onClick={onSwitchToManual}
              className="ml-2 underline font-medium hover:text-red-900"
            >
              Ingresar manualmente
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Uploading state: spinner ───────────────────────────────────────────

  if (status === "uploading") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        {previewUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUrl}
            alt={fileName ?? "Receta"}
            className="h-28 w-auto rounded-lg border border-gray-200 object-contain shadow-sm"
          />
        )}
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <svg
            className="h-5 w-5 animate-spin text-accent"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          Analizando tu receta con IA…
        </div>
        <p className="text-xs text-gray-400">
          Esto puede tardar unos segundos
        </p>
      </div>
    );
  }

  // ── Reviewing state: editable form ────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header with thumbnail */}
      <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
        {previewUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUrl}
            alt={fileName ?? "Receta"}
            className="h-12 w-auto rounded object-contain border border-green-200"
          />
        )}
        <div>
          <p className="text-sm font-semibold text-green-800">
            ✓ Receta detectada
          </p>
          <p className="text-xs text-green-600">
            Revisa y corrige los valores si es necesario
          </p>
        </div>
      </div>

      {/* Validation warnings */}
      {validation && !validation.fulfillable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold mb-1">Valores fuera de rango normal:</p>
          {validation.warnings.map((w, i) => (
            <p key={i}>• {w}</p>
          ))}
        </div>
      )}

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
            <EyeRow label="OD" eye={od} onChange={setOd} showAdd={isProgressive} />
            <EyeRow label="OS" eye={os} onChange={setOs} showAdd={isProgressive} />
          </tbody>
        </table>
      </div>

      {/* PD */}
      <div>
        <div className="flex items-center gap-4 mb-2">
          <span className="text-sm font-medium text-gray-700">Distancia pupilar (DP)</span>
          <div className="flex gap-1 rounded-md bg-gray-100 p-0.5 text-xs">
            {(["single", "dual"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPdMode(mode)}
                className={`rounded px-2.5 py-1 font-medium transition-all ${
                  pdMode === mode
                    ? "bg-white shadow text-gray-900"
                    : "text-gray-500"
                }`}
              >
                {mode === "single" ? "Simple" : "Dual"}
              </button>
            ))}
          </div>
        </div>
        {pdMode === "single" ? (
          <select
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            value={pdSingle}
            onChange={(e) => setPdSingle(Number(e.target.value))}
            aria-label="PD simple"
          >
            {PD_SINGLE.map((v) => (
              <option key={v} value={v}>{v} mm</option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-3">
            {(["OD", "OS"] as const).map((eye) => (
              <label key={eye} className="flex items-center gap-1.5 text-sm text-gray-600">
                {eye}
                <select
                  className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  value={eye === "OD" ? pdOd : pdOs}
                  onChange={(e) =>
                    eye === "OD"
                      ? setPdOd(Number(e.target.value))
                      : setPdOs(Number(e.target.value))
                  }
                  aria-label={`PD ${eye}`}
                >
                  {PD_HALF.map((v) => (
                    <option key={v} value={v}>{v} mm</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Consent notice */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        <strong>Importante:</strong> Al confirmar, declaras que los valores son
        correctos. El fabricante elaborará tus lentes con estos datos.
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setPreviewUrl(null);
            setFileName(null);
          }}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cambiar imagen
        </button>
        <button
          type="button"
          onClick={onSwitchToManual}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Editar manualmente
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="ml-auto rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-700 transition-colors"
        >
          Confirmar receta
        </button>
      </div>
    </div>
  );
}
