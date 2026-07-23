"use client";

import { useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { FrameSelector } from "@/components/try-on/frame-selector";

// Render try-on canvas only on client (uses webcam + WASM)
const TryonCanvas = dynamic(
  () =>
    import("@/components/try-on/tryon-canvas").then((m) => ({
      default: m.TryonCanvas,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center rounded-2xl bg-gray-100 p-16 text-sm text-gray-400">
        Iniciando cámara…
      </div>
    ),
  }
);

function TryOnInner() {
  const searchParams = useSearchParams();
  const handleParam = searchParams.get("frame");

  const [selectedHandle, setSelectedHandle] = useState<string | null>(
    handleParam ?? null
  );
  const [frameImageUrl, setFrameImageUrl] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);

  // If a frame handle was passed via URL, resolve its image
  useEffect(() => {
    if (!handleParam) return;
    const backendUrl =
      process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";
    const publishableKey =
      process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "";
    fetch(
      `${backendUrl}/store/products?handle=${encodeURIComponent(handleParam)}&fields=thumbnail,images`,
      { headers: { "x-publishable-api-key": publishableKey } }
    )
      .then((r) => r.json())
      .then((data: { products?: Array<{ thumbnail?: string }> }) => {
        const thumb = data.products?.[0]?.thumbnail ?? null;
        if (thumb) setFrameImageUrl(thumb);
      })
      .catch(() => {});
  }, [handleParam]);

  const handleSelectFrame = (handle: string, imageUrl: string | null) => {
    setSelectedHandle(handle);
    setFrameImageUrl(imageUrl);
    setCaptured(null);
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Prueba virtual
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Pruébate monturas en tiempo real con tu cámara. La detección facial
        ocurre completamente en tu dispositivo — ninguna imagen se envía a
        servidores.
      </p>

      {/* Privacy badge */}
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
          <path
            fillRule="evenodd"
            d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
        Todo el procesamiento es local — tu cámara no se sube a ningún servidor
      </div>

      {/* Live camera + overlay */}
      <div className="mb-6">
        <TryonCanvas
          frameImageUrl={frameImageUrl}
          onCapture={setCaptured}
        />
      </div>

      {/* Frame picker */}
      <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-4">
        <FrameSelector
          selectedHandle={selectedHandle}
          onSelect={handleSelectFrame}
        />
      </div>

      {/* CTA: go to lens selection for the selected frame */}
      {selectedHandle && (
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-700">
            ¿Te gustó esta montura? Configura tus lentes.
          </p>
          <Link
            href={`/glasses/${selectedHandle}/select-lenses`}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 transition-colors"
          >
            Seleccionar lentes
          </Link>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center text-xs text-gray-500">
        {[
          { icon: "💡", text: "Buena iluminación frontal" },
          { icon: "👁️", text: "Mira directo a la cámara" },
          { icon: "📏", text: "Mantén el rostro centrado" },
        ].map(({ icon, text }) => (
          <div
            key={text}
            className="rounded-xl border border-gray-100 bg-gray-50 p-3"
          >
            <span className="block text-2xl mb-1">{icon}</span>
            {text}
          </div>
        ))}
      </div>

      {/* Unused captured state — just to avoid lint warning when not using onCapture */}
      {captured && null}
    </main>
  );
}

export default function TryOnPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
        </main>
      }
    >
      <TryOnInner />
    </Suspense>
  );
}

