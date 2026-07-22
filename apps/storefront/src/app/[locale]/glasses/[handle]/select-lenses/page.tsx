import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LensFunnel } from "@/components/funnel/lens-funnel";
import type { MedusaProduct } from "@/hooks/use-frame";
import { resolveLocalizedProductMetadataText, type Locale } from "@eyewear/shared";
import { Link } from "@/i18n/navigation";
import { ChevronLeft } from "lucide-react";

interface Params {
  params: Promise<{ handle: string; locale: string }>;
}

async function fetchProduct(handle: string): Promise<MedusaProduct | null> {
  const backendUrl =
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";
  const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "";
  try {
    const res = await fetch(
      `${backendUrl}/store/products?handle=${encodeURIComponent(handle)}&fields=title,description,metadata`,
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

async function resolveFrameTitle(handle: string, locale: string): Promise<string> {
  const product = await fetchProduct(handle);
  if (!product) return handle;
  return resolveLocalizedProductMetadataText(
    product.metadata,
    product.title,
    product.description ?? "",
    locale as Locale
  ).title;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle, locale } = await params;
  const title = await resolveFrameTitle(handle, locale);
  const t = await getTranslations({ locale, namespace: "pdp" });
  return {
    title: t("selectLensesMetaTitle", { title }),
    robots: { index: false },
  };
}

export default async function SelectLensesPage({ params }: Params) {
  const { handle, locale } = await params;
  const frameTitle = await resolveFrameTitle(handle, locale);
  const t = await getTranslations({ locale, namespace: "pdp" });

  return (
    <div>
      {/* Back link */}
      <div className="max-w-xl mx-auto px-4 pt-6">
        <Link
          href={`/glasses/${handle}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("backTo", { title: frameTitle })}
        </Link>
      </div>

      <LensFunnel frameHandle={handle} frameTitle={frameTitle} />
    </div>
  );
}
