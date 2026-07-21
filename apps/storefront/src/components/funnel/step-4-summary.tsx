"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFunnelStore } from "@/store/funnel-store";
import { useCart } from "@/hooks/use-cart";
import { formatPrice } from "@/lib/utils";
import type { CartLensMetadata } from "@eyewear/shared";

interface LineItem {
  label: string;
  amount: number | null;
  hint?: string;
}

interface Step4SummaryProps {
  onBack: () => void;
  frameTitle: string;
}

export function Step4Summary({ onBack, frameTitle }: Step4SummaryProps) {
  const store = useFunnelStore();
  const { addItem, isLoading: cartLoading } = useCart();
  const router = useRouter();

  const [computedPrice, setComputedPrice] = useState<{
    frame_cents: number;
    lens_modifier_cents: number;
    coating_modifier_cents: number;
    total_cents: number;
  } | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const backendUrl =
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";

  useEffect(() => {
    const lensConfig = store.getLensConfig();
    if (!lensConfig || !store.framePriceCents) {
      setPriceLoading(false);
      return;
    }

    fetch(`${backendUrl}/store/lens-config/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frame_price_cents: store.framePriceCents,
        config: lensConfig,
      }),
    })
      .then((r) => r.json())
      .then((data: { price: typeof computedPrice }) => {
        setComputedPrice(data.price);
      })
      .catch(() => setError("No se pudo calcular el precio. Inténtalo de nuevo."))
      .finally(() => setPriceLoading(false));
  }, []); // run once on mount; store is stable ref

  const handleAddToCart = async () => {
    if (!store.variantId || !computedPrice) return;

    // Verify prescription before adding
    if (
      store.usageType !== "non_prescription" &&
      store.prescription &&
      !store.prescription.verified_by_user
    ) {
      // "Provide later" flow — still allowed
    }

    const lensConfig = store.getLensConfig();
    if (!lensConfig) return;

    const metadata: CartLensMetadata = {
      lens_config: lensConfig,
      prescription: store.prescription ?? null,
      frame_price_cents: store.framePriceCents ?? 0,
      total_price_cents: computedPrice.total_cents,
    };

    try {
      await addItem(store.variantId, metadata as unknown as Record<string, unknown>);
      store.reset();
      router.push("/cart");
    } catch {
      setError("Error al agregar al carrito. Inténtalo de nuevo.");
    }
  };

  const lines: LineItem[] = [
    { label: "Montura", amount: store.framePriceCents ?? null, hint: frameTitle },
    {
      label: "Lentes",
      amount: computedPrice?.lens_modifier_cents ?? null,
      hint: store.lensIndex ? `Índice ${store.lensIndex}` : undefined,
    },
    {
      label: "Tratamientos",
      amount: computedPrice?.coating_modifier_cents ?? null,
      hint:
        store.coatings.length > 0
          ? store.coatings.join(", ")
          : "Ninguno",
    },
  ];

  const usageLabels: Record<string, string> = {
    single_vision_distance: "Visión lejana",
    single_vision_reading: "Visión cercana",
    progressive: "Progresivos",
    non_prescription: "Sin graduación",
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Resumen</h2>
      <p className="text-sm text-gray-500 mb-5">
        Revisa tu selección antes de agregar al carrito.
      </p>

      {/* Usage badge */}
      {store.usageType && (
        <div className="mb-4 inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
          {usageLabels[store.usageType] ?? store.usageType}
        </div>
      )}

      {/* Price breakdown */}
      <div className="rounded-xl border border-gray-100 divide-y divide-gray-100 mb-5">
        {lines.map((line) => (
          <div
            key={line.label}
            className="flex items-center justify-between px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-gray-900">{line.label}</p>
              {line.hint && (
                <p className="text-xs text-gray-400">{line.hint}</p>
              )}
            </div>
            <span className="text-sm font-semibold text-gray-900">
              {priceLoading ? (
                <span className="block h-4 w-14 animate-pulse rounded bg-gray-100" />
              ) : line.amount !== null ? (
                line.amount === 0 ? (
                  "Incluido"
                ) : (
                  formatPrice(line.amount)
                )
              ) : (
                "—"
              )}
            </span>
          </div>
        ))}

        {/* Total */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-b-xl">
          <span className="text-sm font-bold text-gray-900">Total</span>
          <span className="text-lg font-bold text-accent">
            {priceLoading ? (
              <span className="block h-5 w-20 animate-pulse rounded bg-gray-100" />
            ) : computedPrice ? (
              formatPrice(computedPrice.total_cents)
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      {/* Prescription notice */}
      {store.prescription && !store.prescription.verified_by_user && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>Receta pendiente:</strong> Tu pedido se fabricará cuando recibamos tu receta.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Atrás
        </button>
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={priceLoading || cartLoading || !computedPrice}
          className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {cartLoading ? "Agregando…" : "Añadir al carrito"}
        </button>
      </div>
    </div>
  );
}
