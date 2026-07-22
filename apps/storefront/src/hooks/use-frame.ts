"use client";

import { useState, useEffect } from "react";

export interface MedusaVariant {
  id: string;
  title: string;
  prices: Array<{ currency_code: string; amount: number }>;
  metadata: Record<string, unknown>;
}

export interface MedusaProductImage {
  id: string;
  url: string;
}

export interface MedusaProduct {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  thumbnail: string | null;
  images: MedusaProductImage[];
  variants: MedusaVariant[];
  metadata: Record<string, unknown>;
}

interface UseFrameReturn {
  frame: MedusaProduct | null;
  isLoading: boolean;
  error: string | null;
}

export function useFrame(handle: string): UseFrameReturn {
  const [frame, setFrame] = useState<MedusaProduct | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;

    const backendUrl =
      process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";
    const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "";

    const url = `${backendUrl}/store/products?handle=${encodeURIComponent(handle)}&fields=*variants,*variants.prices,*images`;

    fetch(url, {
      headers: {
        "x-publishable-api-key": publishableKey,
      },
    })
      .then((r) => r.json())
      .then((data: { products?: MedusaProduct[] }) => {
        const product = data.products?.[0];
        if (product) {
          setFrame(product);
        } else {
          setError("not_found");
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "fetch_error");
      })
      .finally(() => setIsLoading(false));
  }, [handle]);

  return { frame, isLoading, error };
}
