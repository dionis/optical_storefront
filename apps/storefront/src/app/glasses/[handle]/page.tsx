import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FrameDetail } from "@/components/pdp/frame-detail";
import type { MedusaProduct } from "@/hooks/use-frame";

interface Params {
  params: Promise<{ handle: string }>;
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
  const { handle } = await params;
  const product = await fetchProduct(handle);
  if (!product) return { title: "Montura no encontrada" };
  return {
    title: product.title,
    description:
      product.description ??
      `Compra ${product.title} online. Elige lentes graduados a tu medida.`,
    openGraph: {
      images: product.thumbnail ? [product.thumbnail] : [],
    },
  };
}

export default async function ProductPage({ params }: Params) {
  const { handle } = await params;
  const product = await fetchProduct(handle);

  if (!product) {
    // When backend is not running / product not yet ingested, show graceful state
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-5xl mb-6">👓</p>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          Montura no disponible
        </h1>
        <p className="text-gray-500 mb-6">
          Esta montura aún no está disponible o no se encontró.
          El catálogo se carga automáticamente cada día.
        </p>
        <a
          href="/glasses"
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 transition-colors"
        >
          Ver todas las monturas
        </a>
      </div>
    );
  }

  return <FrameDetail product={product} />;
}
