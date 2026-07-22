"use client";

import { useTranslations } from "next-intl";

interface WizardProgressProps {
  currentStep: 1 | 2 | 3 | 4;
  totalSteps?: number;
}

const STEP_KEYS = ["usage", "prescription", "lens", "summary"] as const;

export function WizardProgress({
  currentStep,
  totalSteps = 4,
}: WizardProgressProps) {
  const t = useTranslations("funnel");

  return (
    <div className="w-full" aria-label={t("stepAria", { current: currentStep, total: totalSteps })}>
      {/* Step labels */}
      <ol className="flex items-center justify-between mb-3">
        {STEP_KEYS.map((key, i) => {
          const step = (i + 1) as 1 | 2 | 3 | 4;
          const isActive = step === currentStep;
          const isDone = step < currentStep;
          return (
            <li
              key={key}
              className={`flex flex-col items-center gap-1 ${
                isActive
                  ? "text-accent"
                  : isDone
                  ? "text-green-600"
                  : "text-gray-400"
              }`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold border-2 transition-all ${
                  isActive
                    ? "border-accent bg-accent text-white"
                    : isDone
                    ? "border-green-500 bg-green-500 text-white"
                    : "border-gray-200 bg-white"
                }`}
              >
                {isDone ? (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M2 7l4 4 6-7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  step
                )}
              </span>
              <span className="text-[11px] font-medium hidden sm:block">
                {t(`steps.${key}`)}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}
