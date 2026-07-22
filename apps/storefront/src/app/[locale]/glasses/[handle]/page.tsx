import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FrameDetail } from "@/components/pdp/frame-detail";
import type { MedusaProduct } from "@/hooks/use-frame";
import { resolveLocalizedProductMetadataText, type Locale } from "@eyewear/shared";
import { Link } from "@/i18n/navigation";

interface Params {
  params: Promise<{ handle: string; locale: string }>;
}

async function fetchProduct(handle: string): Promise<MedusaProduct | null> {
  const backendUrl =
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";
  const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "";

  try {
    const res = await fetch(
      `${backendUrl}/store/products?handle=${encodeURIComponent(handle)}&fields=*variants,*variants.prices,*images`,
      {
        headers: { "x-publishable-api-key": publishableKey },
        next: { revalidate: 60 },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { products?: MedusaProduct[] };
    return data.products?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle, locale } = await params;
  const t = await getTranslations({ locale, namespace: "pdp" });
  const product = await fetchProduct(handle);
  if (!product) return { title: t("notFoundMetaTitle") };

  const { title, description } = resolveLocalizedProductMetadataText(
    product.metadata,
    product.title,
    product.description ?? "",
    locale as Locale
  );

  return {
    title,
    description: description || t("metaDescription", { title }),
    openGraph: {
      images: product.thumbnail ? [product.thumbnail] : [],
    },
  };
}

export default async function ProductPage({ params }: Params) {
  const { handle, locale } = await params;
  const product = await fetchProduct(handle);
  const t = await getTranslations({ locale, namespace: "pdp" });

  if (!product) {
    // When backend is not running / product not yet ingested, show graceful state
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-5xl mb-6">👓</p>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          {t("notFoundTitle")}
        </h1>
        <p className="text-gray-500 mb-6">{t("notFoundBody")}</p>
        <Link
          href="/glasses"
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 transition-colors"
        >
          {t("viewAll")}
        </Link>
      </div>
    );
  }

  return <FrameDetail product={product} />;
}
