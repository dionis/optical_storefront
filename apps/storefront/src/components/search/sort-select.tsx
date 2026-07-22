"use client";

import { useTranslations } from "next-intl";
import { SORT_OPTIONS, type SortOption } from "@/lib/filter-params";

interface SortSelectProps {
  value: SortOption;
  onChange: (sort: SortOption) => void;
}

export function SortSelect({ value, onChange }: SortSelectProps) {
  const t = useTranslations("listing");

  return (
    <label className="flex items-center gap-2 text-sm text-gray-600">
      <span className="hidden sm:inline">{t("sortLabel")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent/30 cursor-pointer"
        aria-label={t("sortAria")}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {t(`sort.${opt}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
