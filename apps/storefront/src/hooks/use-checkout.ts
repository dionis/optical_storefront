"use client";

import { useState, useCallback } from "react";

const CART_ID_KEY = "eyewear_cart_id";

export interface ShippingAddress {
  first_name: string;
  last_name: string;
  address_1: string;
  address_2?: string;
  city: string;
  province: string;
  postal_code: string;
  country_code: string;
  phone?: string;
}

export interface ContactInfo {
  email: string;
}

export type CheckoutStep = "address" | "payment" | "processing" | "complete";

export interface UseCheckoutReturn {
  step: CheckoutStep;
  contact: ContactInfo;
  address: ShippingAddress;
  selectedProvider: string;
  paymentSessionData: Record<string, unknown> | null;
  isLoading: boolean;
  error: string | null;
  setContact: (c: ContactInfo) => void;
  setAddress: (a: ShippingAddress) => void;
  setSelectedProvider: (id: string) => void;
  submitAddress: () => Promise<boolean>;
  initPaymentSession: (providerId: string) => Promise<Record<string, unknown> | null>;
  completeOrder: () => Promise<string | null>;
}

const EMPTY_ADDRESS: ShippingAddress = {
  first_name: "",
  last_name: "",
  address_1: "",
  city: "",
  province: "",
  postal_code: "",
  country_code: "MX",
  phone: "",
};

export function useCheckout(): UseCheckoutReturn {
  const [step, setStep] = useState<CheckoutStep>("address");
  const [contact, setContact] = useState<ContactInfo>({ email: "" });
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_ADDRESS);
  const [selectedProvider, setSelectedProvider] = useState("pp_stripe_stripe");
  const [paymentSessionData, setPaymentSessionData] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backendUrl =
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000";
  const publishableKey =
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "";

  const cartId = (): string | null =>
    typeof window !== "undefined" ? localStorage.getItem(CART_ID_KEY) : null;

  const headers = {
    "Content-Type": "application/json",
    "x-publishable-api-key": publishableKey,
  };

  /** Update cart with contact email and shipping address */
  const submitAddress = useCallback(async (): Promise<boolean> => {
    const id = cartId();
    if (!id) {
      setError("Carrito no encontrado. Por favor recarga la página.");
      return false;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/store/carts/${id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: contact.email,
          shipping_address: address,
          billing_address: address,
        }),
      });
      if (!res.ok) {
        setError("Error al guardar la dirección. Inténtalo de nuevo.");
        return false;
      }
      setStep("payment");
      return true;
    } catch {
      setError("Error de conexión. Verifica tu internet e inténtalo de nuevo.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [contact, address, backendUrl]);

  /**
   * Initialize payment session with the selected provider.
   * Returns the provider session data (e.g. Stripe client_secret).
   */
  const initPaymentSession = useCallback(
    async (providerId: string): Promise<Record<string, unknown> | null> => {
      const id = cartId();
      if (!id) return null;
      setIsLoading(true);
      setError(null);
      try {
        // 1. Create payment collection for the cart
        const collRes = await fetch(`${backendUrl}/store/payment-collections`, {
          method: "POST",
          headers,
          body: JSON.stringify({ cart_id: id }),
        });
        if (!collRes.ok) {
          setError("Error al iniciar el pago.");
          return null;
        }
        const collData = (await collRes.json()) as {
          payment_collection?: { id: string };
        };
        const collectionId = collData.payment_collection?.id;
        if (!collectionId) {
          setError("Error al crear la sesión de pago.");
          return null;
        }

        // 2. Initialize payment session for the chosen provider
        const sessRes = await fetch(
          `${backendUrl}/store/payment-collections/${collectionId}/payment-sessions`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ provider_id: providerId }),
          }
        );
        if (!sessRes.ok) {
          setError("Error al iniciar la sesión de pago.");
          return null;
        }
        const sessData = (await sessRes.json()) as {
          payment_collection?: {
            payment_sessions?: Array<{ data: Record<string, unknown>; provider_id: string }>;
          };
        };
        const session = sessData.payment_collection?.payment_sessions?.find(
          (s) => s.provider_id === providerId
        );
        const data = session?.data ?? null;
        if (data) {
          setPaymentSessionData(data);
          setSelectedProvider(providerId);
        }
        return data;
      } catch {
        setError("Error al configurar el método de pago.");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [backendUrl]
  );

  /** Complete the cart — creates the order */
  const completeOrder = useCallback(async (): Promise<string | null> => {
    const id = cartId();
    if (!id) return null;
    setIsLoading(true);
    setStep("processing");
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/store/carts/${id}/complete`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        setError("Error al procesar el pedido. Inténtalo de nuevo.");
        setStep("payment");
        return null;
      }
      const data = (await res.json()) as {
        type?: string;
        order?: { id: string };
      };
      if (data.type === "order" && data.order?.id) {
        localStorage.removeItem(CART_ID_KEY);
        setStep("complete");
        return data.order.id;
      }
      setError("El pago fue procesado pero no se pudo crear el pedido.");
      setStep("payment");
      return null;
    } catch {
      setError("Error de conexión al completar el pedido.");
      setStep("payment");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [backendUrl]);

  return {
    step,
    contact,
    address,
    selectedProvider,
    paymentSessionData,
    isLoading,
    error,
    setContact,
    setAddress,
    setSelectedProvider,
    submitAddress,
    initPaymentSession,
    completeOrder,
  };
}
