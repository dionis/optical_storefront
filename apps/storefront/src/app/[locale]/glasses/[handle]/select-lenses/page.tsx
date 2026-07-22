import type { Metadata } from "next";
import { LensFunnel } from "@/components/funnel/lens-funnel";
import type { MedusaProduct } from "@/hooks/use-frame";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

interface Params {
  params: Promise<{ handle: string }>;
}

async function fetchProductTitle(handle: string): Promise<string> {
  const backendUrl =
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";
  const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "";
  try {
    const res = await fetch(
      `${backendUrl}/store/products?handle=${encodeURIComponent(handle)}&fields=title`,
      {
        headers: { "x-publishable-api-key": publishableKey },
        next: { revalidate: 60 },
      }
    );
    if (!res.ok) return handle;
    const data = (await res.json()) as { products?: MedusaProduct[] };
    return data.products?.[0]?.title ?? handle;
  } catch {
    return handle;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const title = await fetchProductTitle(handle);
  return {
    title: `Seleccionar lentes — ${title}`,
    robots: { index: false },
  };
}

export default async function SelectLensesPage({ params }: Params) {
  const { handle } = await params;
  const frameTitle = await fetchProductTitle(handle);

  return (
    <div>
      {/* Back link */}
      <div className="max-w-xl mx-auto px-4 pt-6">
        <Link
          href={`/glasses/${handle}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Volver a {frameTitle}
        </Link>
      </div>

      <LensFunnel frameHandle={handle} frameTitle={frameTitle} />
    </div>
  );
}
