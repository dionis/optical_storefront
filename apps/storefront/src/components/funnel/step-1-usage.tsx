"use client";

import { UsageType } from "@eyewear/shared";
import { useFunnelStore } from "@/store/funnel-store";

interface UsageOption {
  type: UsageType;
  label: string;
  description: string;
  icon: string;
}

const OPTIONS: UsageOption[] = [
  {
    type: "single_vision_distance",
    label: "Visión lejana",
    description: "Para ver de lejos: conducir, pantallas, deporte.",
    icon: "🚗",
  },
  {
    type: "single_vision_reading",
    label: "Visión cercana",
    description: "Para leer, bordar o trabajo de detalle.",
    icon: "📖",
  },
  {
    type: "progressive",
    label: "Progresivos",
    description: "Sin línea visible. Visión lejos y cerca en una sola lente.",
    icon: "✨",
  },
  {
    type: "non_prescription",
    label: "Sin graduación",
    description: "Solo antireflejante o fotocromático. Sin receta.",
    icon: "😎",
  },
];

interface Step1UsageProps {
  onNext: () => void;
}

export function Step1Usage({ onNext }: Step1UsageProps) {
  const usageType = useFunnelStore((s) => s.usageType);
  const setUsageType = useFunnelStore((s) => s.setUsageType);

  const handleSelect = (type: UsageType) => {
    setUsageType(type);
    // Slight delay so user sees the selection before advancing
    setTimeout(onNext, 200);
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">
        ¿Para qué usarás tus lentes?
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Selecciona el tipo de uso para configurar la mejor opción.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {OPTIONS.map((opt) => (
          <button
            key={opt.type}
            type="button"
            onClick={() => handleSelect(opt.type)}
            aria-pressed={usageType === opt.type}
            className={`flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all hover:border-accent hover:bg-accent/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              usageType === opt.type
                ? "border-accent bg-accent/5"
                : "border-gray-200"
            }`}
          >
            <span className="text-3xl leading-none">{opt.icon}</span>
            <div>
              <p className="font-semibold text-gray-900">{opt.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
            </div>
            {usageType === opt.type && (
              <span className="ml-auto text-accent">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
