"use client";

import { WizardProgress } from "./wizard-progress";
import { Step1Usage } from "./step-1-usage";
import { Step2Prescription } from "./step-2-prescription";
import { Step3Lens } from "./step-3-lens";
import { Step4Summary } from "./step-4-summary";
import { useFunnelStore } from "@/store/funnel-store";

interface LensFunnelProps {
  frameHandle: string;
  frameTitle: string;
}

export function LensFunnel({ frameHandle: _frameHandle, frameTitle }: LensFunnelProps) {
  const step = useFunnelStore((s) => s.step);
  const setStep = useFunnelStore((s) => s.setStep);

  const goNext = () => setStep((step < 4 ? step + 1 : 4) as 1 | 2 | 3 | 4);
  const goBack = () => setStep((step > 1 ? step - 1 : 1) as 1 | 2 | 3 | 4);

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      {/* Progress */}
      <div className="mb-8">
        <WizardProgress currentStep={step} />
      </div>

      {/* Step content */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {step === 1 && <Step1Usage onNext={goNext} />}
        {step === 2 && <Step2Prescription onNext={goNext} onBack={goBack} />}
        {step === 3 && <Step3Lens onNext={goNext} onBack={goBack} />}
        {step === 4 && (
          <Step4Summary onBack={goBack} frameTitle={frameTitle} />
        )}
      </div>
    </div>
  );
}
