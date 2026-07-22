"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Eye, ChevronRight } from "lucide-react";
import type { MedusaProduct } from "@/hooks/use-frame";
import { resolveLocalizedProductMetadataText } from "@eyewear/shared";
import type { Locale } from "@/i18n/routing";
import { ProductGallery } from "./product-gallery";
import { MeasurementsDiagram } from "./measurements-diagram";
import { ColorSwatch } from "@/components/frames/color-swatch";
import { RatingStars } from "@/components/shared/rating-stars";
import { WishlistButton } from "@/components/shared/wishlist-button";
import { formatPrice } from "@/lib/utils";
import { useFunnelStore } from "@/store/funnel-store";

interface FrameDetailProps {
  product: MedusaProduct;
}

export function FrameDetail({ product }: FrameDetailProps) {
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const setFrame = useFunnelStore((s) => s.setFrame);
  const locale = useLocale() as Locale;
  const t = useTranslations("pdp");

  const meta = product.metadata ?? {};
  const variants = product.variants ?? [];
  const selectedVariant = variants[selectedVariantIndex];

  const colors = variants.map((v) => v.title);

  const { title, description } = resolveLocalizedProductMetadataText(
    meta,
    product.title,
    product.description ?? "",
    locale
  );

  // Build image list: prefer variant images, then product images
  const variantImages: Array<{ url: string; alt: string }> =
    (
      (selectedVariant?.metadata?.images as Array<{ url: string }> | undefined) ??
      []
    ).map((img) => ({ url: img.url, alt: `${title} — ${selectedVariant?.title}` }));

  const productImages: Array<{ url: string; alt: string }> =
    product.images?.map((img) => ({
      url: img.url,
      alt: title,
    })) ?? [];

  const displayImages =
    variantImages.length > 0 ? variantImages : productImages;

  // Price from selected variant
  const variantPrice =
    selectedVariant?.prices?.find((p) => p.currency_code === "usd")?.amount ??
    null;

  const eyeSize = meta["eye_size"] as number | undefined;
  const bridgeSize = meta["bridge_size"] as number | undefined;
  const templeLength = meta["temple_length"] as number | undefined;
  const hasMeasurements = eyeSize && bridgeSize && templeLength;

  const rating = typeof meta["rating"] === "number" ? meta["rating"] : 0;
  const reviewCount = typeof meta["review_count"] === "number" ? meta["review_count"] : 0;
  const bestSeller = meta["best_seller"] === true;
  const originalPriceCents =
    typeof meta["original_price_cents"] === "number" ? meta["original_price_cents"] : null;

  const handleSelectLenses = () => {
    if (selectedVariant) {
      setFrame(product.id, selectedVariant.id, variantPrice ?? 0);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-gray-500">
        <Link href="/glasses" className="hover:text-gray-800 transition-colors">
          {t("breadcrumbFrames")}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-gray-900 font-medium truncate">{title}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
        {/* Gallery */}
        <div>
          <ProductGallery images={displayImages} />
        </div>

        {/* Info */}
        <div className="flex flex-col gap-6">
          {/* Title + collection */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              {Boolean(meta["collection_slug"]) && (
                <p className="text-xs font-medium uppercase tracking-widest text-accent">
                  {String(meta["collection_slug"]).replace(/-/g, " ")}
                </p>
              )}
              {bestSeller && (
                <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {t("bestSeller")}
                </span>
              )}
            </div>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
              <WishlistButton handle={product.handle} variant="pdp" />
            </div>
            {rating > 0 && (
              <RatingStars rating={rating} reviewCount={reviewCount} size="md" className="mt-2" />
            )}
            {variantPrice !== null && (
              <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-gray-900">
                {formatPrice(variantPrice, locale)}
                {originalPriceCents && originalPriceCents > variantPrice && (
                  <span className="text-base font-normal text-gray-400 line-through">
                    {formatPrice(originalPriceCents, locale)}
                  </span>
                )}
                <span className="text-sm font-normal text-gray-400">
                  {t("lensesFrom")}
                </span>
              </p>
            )}
          </div>

          {/* Color selector */}
          {colors.length > 0 && (
            <ColorSwatch
              colors={colors}
              selectedIndex={selectedVariantIndex}
              onSelect={setSelectedVariantIndex}
              maxVisible={10}
              size="lg"
              showLabel
            />
          )}

          {/* Measurements */}
          {hasMeasurements && (
            <MeasurementsDiagram
              eyeSize={eyeSize!}
              bridgeSize={bridgeSize!}
              templeLength={templeLength!}
              a={(meta["a"] as number | null) ?? null}
              b={(meta["b"] as number | null) ?? null}
            />
          )}

          {/* Features */}
          {Array.isArray(meta["features"]) && (meta["features"] as string[]).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(meta["features"] as string[]).map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-gray-200 px-2.5 py-0.5 text-xs text-gray-600"
                >
                  {f.replace(/-/g, " ")}
                </span>
              ))}
            </div>
          )}

          {/* CTAs */}
          <div className="flex flex-col gap-3 pt-2">
            <Link
              href={`/glasses/${product.handle}/select-lenses`}
              onClick={handleSelectLenses}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-accent-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t("selectLenses")}
              <ChevronRight className="h-5 w-5" />
            </Link>
            <Link
              href={`/try-on?frame=${product.handle}`}
              className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-6 py-3.5 text-base font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Eye className="h-5 w-5" />
              {t("tryOnVirtual")}
            </Link>
          </div>

          {/* Description */}
          {description && (
            <p className="text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-4">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
