"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useFramesSearch } from "@/hooks/use-frames-search";
import { EMPTY_FILTERS } from "@/lib/filter-params";
import { resolveLocalizedFrameText } from "@eyewear/shared";
import type { Locale } from "@/i18n/routing";

interface FrameSelectorProps {
  selectedHandle: string | null;
  onSelect: (handle: string, imageUrl: string | null) => void;
}

export function FrameSelector({ selectedHandle, onSelect }: FrameSelectorProps) {
  const t = useTranslations("tryOn");
  const locale = useLocale() as Locale;
  const { hits, isLoading } = useFramesSearch(EMPTY_FILTERS);

  const cdnUrl = process.env.NEXT_PUBLIC_CDN_URL ?? "";

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 mb-3">
        {t("chooseFrame")}
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-20 w-24 shrink-0 rounded-xl bg-gray-100 animate-pulse snap-start"
            />
          ))}
        {hits.map((frame) => {
          const rawUrl = frame.thumbnail ?? null;
          const imageUrl =
            rawUrl && rawUrl.startsWith("http")
              ? rawUrl
              : rawUrl
              ? `${cdnUrl}/${rawUrl}`
              : null;
          const isSelected = frame.handle === selectedHandle;
          const { title } = resolveLocalizedFrameText(frame, locale);
          return (
            <button
              key={frame.handle}
              type="button"
              onClick={() => onSelect(frame.handle, imageUrl)}
              aria-pressed={isSelected}
              aria-label={title}
              title={title}
              className={`relative h-20 w-24 shrink-0 rounded-xl border-2 overflow-hidden bg-gray-50 snap-start transition-all hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                isSelected ? "border-accent ring-2 ring-accent/30" : "border-transparent"
              }`}
            >
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt={title}
                  fill
                  sizes="96px"
                  className="object-contain p-1"
                />
              ) : (
                <span className="flex h-full items-center justify-center text-2xl">
                  👓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
