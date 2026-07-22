"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Trash2, ShoppingBag, ChevronRight } from "lucide-react";
import { useCart } from "@/hooks/use-cart";
import { formatPrice } from "@/lib/utils";
import type { CartLensMetadata } from "@eyewear/shared";
import type { Locale } from "@/i18n/routing";

function LensMetaSummary({ metadata }: { metadata: Record<string, unknown> }) {
  const t = useTranslations("funnel.usageTypes");
  const lens = metadata as Partial<CartLensMetadata>;
  const config = lens.lens_config;
  if (!config) return null;

  const parts: string[] = [];
  if (config.usage_type)
    parts.push(t.has(`${config.usage_type}.label`) ? t(`${config.usage_type}.label`) : config.usage_type);
  if (config.index) parts.push(`${config.index}`);
  if (config.coatings?.length) parts.push(config.coatings.join(", "));

  return (
    <p className="text-xs text-gray-400 mt-0.5">{parts.join(" · ")}</p>
  );
}

export default function CartPage() {
  const t = useTranslations("cart");
  const locale = useLocale() as Locale;
  const { cart, isLoading, removeItem, itemCount } = useCart();

  const items = cart?.items ?? [];

  if (!cart && !isLoading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-20 text-center">
        <ShoppingBag className="mx-auto h-14 w-14 text-gray-200 mb-5" />
        <h1 className="text-2xl font-bold text-gray-900 mb-3">{t("emptyTitle")}</h1>
        <p className="text-gray-500 mb-6">{t("emptyBody")}</p>
        <Link
          href="/glasses"
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-700 transition-colors"
        >
          {t("emptyCta")}
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">{t("title")}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Items list */}
        <div className="lg:col-span-2 space-y-4">
          {isLoading && items.length === 0 ? (
            /* Skeleton */
            Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-28 rounded-2xl bg-gray-100 animate-pulse"
              />
            ))
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 p-8 text-center">
              <ShoppingBag className="mx-auto h-10 w-10 text-gray-200 mb-3" />
              <p className="text-gray-500 text-sm">{t("noItems")}</p>
            </div>
          ) : (
            items.map((item) => {
              const lensTotal =
                (item.metadata as Partial<CartLensMetadata>)?.total_price_cents ??
                item.subtotal;
              return (
                <div
                  key={item.id}
                  className="flex gap-4 rounded-2xl border border-gray-100 bg-white p-4"
                >
                  {/* Thumbnail */}
                  <div className="relative h-20 w-24 shrink-0 rounded-xl bg-gray-50 overflow-hidden">
                    {item.thumbnail ? (
                      <Image
                        src={item.thumbnail}
                        alt={item.title}
                        fill
                        sizes="96px"
                        className="object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-3xl">
                        👓
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {item.title}
                    </p>
                    <LensMetaSummary metadata={item.metadata} />
                    <p className="mt-2 text-sm font-semibold text-accent">
                      {formatPrice(lensTotal, locale)}
                    </p>
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    aria-label={t("removeAria", { title: item.title })}
                    onClick={() => removeItem(item.id)}
                    disabled={isLoading}
                    className="self-start rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Order summary */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 sticky top-4">
            <h2 className="text-lg font-bold text-gray-900 mb-4">{t("summaryTitle")}</h2>

            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-gray-500">{t("itemsCount", { count: itemCount })}</span>
                <span className="font-medium text-gray-900">
                  {cart ? formatPrice(cart.subtotal, locale) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t("shipping")}</span>
                <span className="text-gray-400 text-xs">{t("shippingCalculated")}</span>
              </div>
            </div>

            <div className="flex justify-between border-t border-gray-100 pt-3 mb-5">
              <span className="font-bold text-gray-900">{t("total")}</span>
              <span className="text-lg font-bold text-accent">
                {cart ? formatPrice(cart.total, locale) : "—"}
              </span>
            </div>

            <Link
              href="/checkout"
              className={`flex items-center justify-center gap-2 w-full rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-white hover:bg-accent-700 transition-colors ${
                itemCount === 0 ? "pointer-events-none opacity-50" : ""
              }`}
              aria-disabled={itemCount === 0}
            >
              {t("checkout")}
              <ChevronRight className="h-4 w-4" />
            </Link>

            <Link
              href="/glasses"
              className="mt-3 block text-center text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              {t("continueShopping")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
