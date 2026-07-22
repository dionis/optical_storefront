"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { LensIndex, CoatingType } from "@eyewear/shared";
import { useFunnelStore } from "@/store/funnel-store";
import { formatPrice } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";

interface LensOptionItem {
  id: string;
  usage_type: string;
  index: LensIndex;
  label: string;
  description: string;
  price_modifier_cents: number;
}

interface CoatingOptionItem {
  id: string;
  type: CoatingType;
  label: string;
  description: string;
  price_modifier_cents: number;
  compatible_usage_types: string[];
}

interface Step3LensProps {
  onNext: () => void;
  onBack: () => void;
}

export function Step3Lens({ onNext, onBack }: Step3LensProps) {
  const t = useTranslations("funnel");
  const locale = useLocale() as Locale;
  const usageType = useFunnelStore((s) => s.usageType);
  const lensIndex = useFunnelStore((s) => s.lensIndex);
  const coatings = useFunnelStore((s) => s.coatings);
  const framePriceCents = useFunnelStore((s) => s.framePriceCents);
  const setLensIndex = useFunnelStore((s) => s.setLensIndex);
  const setCoatings = useFunnelStore((s) => s.setCoatings);

  // The recommended index may have been set in step 2 from validation
  const validationRecommendedIndex = useFunnelStore((s) => s.lensIndex);

  const [lensOptions, setLensOptions] = useState<LensOptionItem[]>([]);
  const [coatingOptions, setCoatingOptions] = useState<CoatingOptionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const backendUrl =
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";

  useEffect(() => {
    const usageParam = usageType ?? "single_vision_distance";
    Promise.all([
      fetch(`${backendUrl}/store/lens-config/options?usage_type=${usageParam}`).then(
        (r) => r.json() as Promise<{ options: LensOptionItem[] }>
      ),
      fetch(
        `${backendUrl}/store/lens-config/coatings?usage_type=${usageParam}`
      ).then((r) => r.json() as Promise<{ options: CoatingOptionItem[] }>),
    ])
      .then(([lensData, coatingData]) => {
        setLensOptions(lensData.options ?? []);
        setCoatingOptions(coatingData.options ?? []);
      })
      .catch(() => {
        // Silently degrade; user can still proceed
      })
      .finally(() => setLoading(false));
  }, [usageType, backendUrl]);

  const toggleCoating = (type: CoatingType) => {
    const next = coatings.includes(type)
      ? coatings.filter((c) => c !== type)
      : [...coatings, type];
    setCoatings(next);
  };

  const selectedLens = lensOptions.find((o) => o.index === lensIndex);
  const coatingTotal = coatings.reduce((sum, type) => {
    const coating = coatingOptions.find((c) => c.type === type);
    return sum + (coating?.price_modifier_cents ?? 0);
  }, 0);
  const lensModifier = selectedLens?.price_modifier_cents ?? 0;
  const subtotalCents = (framePriceCents ?? 0) + lensModifier + coatingTotal;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
        {t("step3.loading")}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t("step3.title")}</h2>
      <p className="text-sm text-gray-500 mb-5">{t("step3.subtitle")}</p>

      {/* Lens index cards */}
      {lensOptions.length > 0 && (
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            {t("step3.indexHeading")}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {lensOptions.map((opt) => {
              const isSelected = lensIndex === opt.index;
              const isRecommended =
                validationRecommendedIndex === opt.index && opt.index !== 1.57;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLensIndex(opt.index)}
                  aria-pressed={isSelected}
                  className={`relative rounded-xl border-2 p-3 text-left transition-all hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    isSelected
                      ? "border-accent bg-accent/5"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  {isRecommended && (
                    <span className="absolute -top-2 left-3 rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      {t("step3.recommended")}
                    </span>
                  )}
                  <p className="font-bold text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                    {opt.description}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-accent">
                    {opt.price_modifier_cents === 0
                      ? t("step3.included")
                      : `+${formatPrice(opt.price_modifier_cents, locale)}`}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Coating checkboxes */}
      {coatingOptions.length > 0 && (
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            {t("step3.treatmentsHeading")}
          </h3>
          <div className="space-y-2">
            {coatingOptions.map((opt) => {
              const isChecked = coatings.includes(opt.type);
              return (
                <label
                  key={opt.id}
                  className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
                    isChecked
                      ? "border-accent bg-accent/5"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleCoating(opt.type)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-accent accent-accent focus:ring-accent"
                    aria-label={opt.label}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {opt.label}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {opt.description}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-accent">
                    {opt.price_modifier_cents === 0
                      ? t("step3.included")
                      : `+${formatPrice(opt.price_modifier_cents, locale)}`}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {/* Subtotal */}
      <div className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-sm mb-4">
        <span className="text-gray-600">{t("step3.subtotal")}</span>
        <span className="font-bold text-gray-900">{formatPrice(subtotalCents, locale)}</span>
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {t("back")}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!lensIndex}
          className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t("continue")}
        </button>
      </div>
    </div>
  );
}
