"use client";

import { useState, useEffect, useCallback } from "react";
import { medusaClient } from "@/lib/medusa-client";

const CART_ID_KEY = "eyewear_cart_id";

interface CartLineItem {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  thumbnail: string | null;
  variant_id: string;
  metadata: Record<string, unknown>;
}

interface Cart {
  id: string;
  items: CartLineItem[];
  total: number;
  subtotal: number;
  currency_code: string;
}

interface UseCartReturn {
  cart: Cart | null;
  isLoading: boolean;
  addItem: (variantId: string, metadata?: Record<string, unknown>) => Promise<void>;
  removeItem: (lineItemId: string) => Promise<void>;
  itemCount: number;
}

export function useCart(): UseCartReturn {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const getOrCreateCart = useCallback(async (): Promise<Cart> => {
    const existingId =
      typeof window !== "undefined"
        ? localStorage.getItem(CART_ID_KEY)
        : null;

    if (existingId) {
      try {
        const { cart: existing } = await (medusaClient.store as unknown as {
          cart: { retrieve: (id: string) => Promise<{ cart: Cart }> };
        }).cart.retrieve(existingId);
        return existing;
      } catch {
        // Cart may have expired — create a new one
        localStorage.removeItem(CART_ID_KEY);
      }
    }

    const { cart: created } = await (medusaClient.store as unknown as {
      cart: { create: (data: Record<string, unknown>) => Promise<{ cart: Cart }> };
    }).cart.create({});
    localStorage.setItem(CART_ID_KEY, created.id);
    return created;
  }, []);

  useEffect(() => {
    const load = async () => {
      const existingId =
        typeof window !== "undefined"
          ? localStorage.getItem(CART_ID_KEY)
          : null;
      if (!existingId) return;
      try {
        const { cart: c } = await (medusaClient.store as unknown as {
          cart: { retrieve: (id: string) => Promise<{ cart: Cart }> };
        }).cart.retrieve(existingId);
        setCart(c);
      } catch {
        localStorage.removeItem(CART_ID_KEY);
      }
    };
    load();
  }, []);

  const addItem = useCallback(
    async (variantId: string, metadata: Record<string, unknown> = {}) => {
      setIsLoading(true);
      try {
        const currentCart = await getOrCreateCart();
        const { cart: updated } = await (medusaClient.store as unknown as {
          cart: {
            lineItems: {
              create: (
                cartId: string,
                data: Record<string, unknown>
              ) => Promise<{ cart: Cart }>;
            };
          };
        }).cart.lineItems.create(currentCart.id, {
          variant_id: variantId,
          quantity: 1,
          metadata,
        });
        setCart(updated);
      } finally {
        setIsLoading(false);
      }
    },
    [getOrCreateCart]
  );

  const removeItem = useCallback(
    async (lineItemId: string) => {
      if (!cart) return;
      setIsLoading(true);
      try {
        const { cart: updated } = await (medusaClient.store as unknown as {
          cart: {
            lineItems: {
              delete: (
                cartId: string,
                lineItemId: string
              ) => Promise<{ cart: Cart }>;
            };
          };
        }).cart.lineItems.delete(cart.id, lineItemId);
        setCart(updated);
      } finally {
        setIsLoading(false);
      }
    },
    [cart]
  );

  const itemCount =
    cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return { cart, isLoading, addItem, removeItem, itemCount };
}
