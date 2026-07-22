import { useTranslations } from "next-intl";

export function PromoBar() {
  const t = useTranslations("promoBar");

  return (
    <div className="hidden sm:flex items-center justify-center gap-6 bg-gray-50 border-b border-gray-100 px-4 py-2 text-xs text-gray-600">
      <span>{t("shipping")}</span>
      <span className="h-3 w-px bg-gray-200" aria-hidden="true" />
      <span>{t("deal")}</span>
    </div>
  );
}
