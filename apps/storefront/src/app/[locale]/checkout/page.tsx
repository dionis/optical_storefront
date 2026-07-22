"use client";

import { useEffect, useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  loadStripe,
  type Stripe,
  type StripeCardElement,
} from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useCart } from "@/hooks/use-cart";
import { useCheckout } from "@/hooks/use-checkout";
import { formatPrice } from "@/lib/utils";
import type { CartLensMetadata } from "@eyewear/shared";
import type { Locale } from "@/i18n/routing";

// ── Stripe initialisation ─────────────────────────────────────────────────

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
);

// ── Reusable field component ──────────────────────────────────────────────

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-gray-600">
        {label}
      </label>
      {children}
    </div>
  );
}

const INPUT_CLS =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-gray-300";

// ── Step 1: Address form ──────────────────────────────────────────────────

function AddressStep({
  checkout,
}: {
  checkout: ReturnType<typeof useCheckout>;
}) {
  const t = useTranslations("checkout");
  const { contact, address, setContact, setAddress, submitAddress, isLoading, error } = checkout;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitAddress();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900">{t("contactData")}</h2>

      <Field label={t("email")} id="email">
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={contact.email}
          onChange={(e) => setContact({ email: e.target.value })}
          className={INPUT_CLS}
          placeholder="name@example.com"
        />
      </Field>

      <h2 className="text-lg font-bold text-gray-900 pt-2">{t("shippingAddress")}</h2>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("firstName")} id="first_name">
          <input
            id="first_name"
            required
            autoComplete="given-name"
            value={address.first_name}
            onChange={(e) => setAddress({ ...address, first_name: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>
        <Field label={t("lastName")} id="last_name">
          <input
            id="last_name"
            required
            autoComplete="family-name"
            value={address.last_name}
            onChange={(e) => setAddress({ ...address, last_name: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>
      </div>

      <Field label={t("addressLine1")} id="address_1">
        <input
          id="address_1"
          required
          autoComplete="address-line1"
          value={address.address_1}
          onChange={(e) => setAddress({ ...address, address_1: e.target.value })}
          className={INPUT_CLS}
        />
      </Field>

      <Field label={t("addressLine2")} id="address_2">
        <input
          id="address_2"
          autoComplete="address-line2"
          value={address.address_2 ?? ""}
          onChange={(e) => setAddress({ ...address, address_2: e.target.value })}
          className={INPUT_CLS}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("city")} id="city">
          <input
            id="city"
            required
            autoComplete="address-level2"
            value={address.city}
            onChange={(e) => setAddress({ ...address, city: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>
        <Field label={t("province")} id="province">
          <input
            id="province"
            required
            autoComplete="address-level1"
            value={address.province}
            onChange={(e) => setAddress({ ...address, province: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("postalCode")} id="postal_code">
          <input
            id="postal_code"
            required
            autoComplete="postal-code"
            value={address.postal_code}
            onChange={(e) => setAddress({ ...address, postal_code: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>
        <Field label={t("phone")} id="phone">
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            value={address.phone ?? ""}
            onChange={(e) => setAddress({ ...address, phone: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50 transition-colors"
      >
        {isLoading ? t("saving") : t("continueToPayment")}
      </button>
    </form>
  );
}

// ── Step 2: Payment (Stripe card form) ────────────────────────────────────

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "14px",
      color: "#111827",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      "::placeholder": { color: "#d1d5db" },
    },
    invalid: { color: "#ef4444" },
  },
};

function PaymentStep({
  checkout,
  cartTotal,
  onOrderComplete,
}: {
  checkout: ReturnType<typeof useCheckout>;
  cartTotal: number;
  onOrderComplete: (orderId: string) => void;
}) {
  const t = useTranslations("checkout");
  const locale = useLocale() as Locale;
  const stripe = useStripe();
  const elements = useElements();
  const { selectedProvider, setSelectedProvider, initPaymentSession, completeOrder, isLoading, error } = checkout;

  const PROVIDERS = [
    { id: "pp_stripe_stripe", label: t("providerStripe"), icon: "💳" },
    { id: "pp_paypal_paypal", label: t("providerPaypal"), icon: "🅿️" },
    { id: "pp_square_square", label: t("providerSquare"), icon: "⬛" },
  ];

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const displayError =
    initError ?? (error ? (t.has(`errors.${error}`) ? t(`errors.${error}`) : error) : null);

  // Initialize Stripe payment session on mount
  useEffect(() => {
    if (selectedProvider !== "pp_stripe_stripe") return;
    initPaymentSession("pp_stripe_stripe").then((data) => {
      if (data?.client_secret) {
        setClientSecret(data.client_secret as string);
      } else if (data) {
        setInitError(t("errorStripeInit"));
      }
    });
  }, [selectedProvider]);

  const handleStripeSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!stripe || !elements || !clientSecret) return;

      const card = elements.getElement(CardElement) as StripeCardElement | null;
      if (!card) return;

      const { error: stripeError } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: { card } }
      );

      if (stripeError) {
        setInitError(stripeError.message ?? t("errorPaymentGeneric"));
        return;
      }

      const orderId = await completeOrder();
      if (orderId) onOrderComplete(orderId);
    },
    [stripe, elements, clientSecret, completeOrder, onOrderComplete]
  );

  const handlePayPalSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const data = await initPaymentSession("pp_paypal_paypal");
      const approveUrl = data?.approve_url as string | undefined;
      if (approveUrl) {
        window.location.href = approveUrl;
      } else {
        setInitError(t("errorPaypalInit"));
      }
    },
    [initPaymentSession]
  );

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900">{t("paymentMethod")}</h2>

      {/* Provider selector */}
      <div className="flex flex-col gap-2">
        {PROVIDERS.map((p) => (
          <label
            key={p.id}
            className={`flex items-center gap-3 rounded-xl border-2 p-3.5 cursor-pointer transition-all ${
              selectedProvider === p.id
                ? "border-accent bg-accent/5"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <input
              type="radio"
              name="payment_provider"
              value={p.id}
              checked={selectedProvider === p.id}
              onChange={() => {
                setSelectedProvider(p.id);
                setClientSecret(null);
                setInitError(null);
              }}
              className="accent-accent"
            />
            <span className="text-lg">{p.icon}</span>
            <span className="text-sm font-medium text-gray-800">{p.label}</span>
          </label>
        ))}
      </div>

      {/* Stripe card form */}
      {selectedProvider === "pp_stripe_stripe" && (
        <form onSubmit={handleStripeSubmit} className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3.5">
            <CardElement options={CARD_ELEMENT_OPTIONS} />
          </div>

          {displayError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {displayError}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading || !stripe || !clientSecret}
            className="w-full rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50 transition-colors"
          >
            {isLoading ? t("processing") : t("pay", { amount: formatPrice(cartTotal, locale) })}
          </button>
        </form>
      )}

      {/* PayPal */}
      {selectedProvider === "pp_paypal_paypal" && (
        <form onSubmit={handlePayPalSubmit} className="space-y-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
            {t("paypalNotice")}
          </div>
          {displayError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {displayError}
            </p>
          )}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-xl bg-[#0070ba] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#005ea2] disabled:opacity-50 transition-colors"
          >
            {isLoading ? t("paypalRedirecting") : t("paypalContinue")}
          </button>
        </form>
      )}

      {/* Square */}
      {selectedProvider === "pp_square_square" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            {t("squareNotice")}
          </div>
          <button
            type="button"
            disabled
            className="w-full rounded-xl bg-gray-800 px-6 py-3.5 text-sm font-semibold text-white opacity-40 cursor-not-allowed"
          >
            {t("comingSoon")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Order summary sidebar ─────────────────────────────────────────────────

function OrderSummary({
  items,
  total,
}: {
  items: ReturnType<typeof useCart>["cart"] extends null | undefined
    ? []
    : NonNullable<ReturnType<typeof useCart>["cart"]>["items"];
  total: number;
}) {
  const t = useTranslations("checkout");
  const locale = useLocale() as Locale;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <h2 className="text-base font-bold text-gray-900 mb-4">{t("yourOrder")}</h2>
      <div className="space-y-3 mb-4">
        {items.map((item) => {
          const lensTotal =
            (item.metadata as Partial<CartLensMetadata>)?.total_price_cents ??
            item.subtotal;
          return (
            <div key={item.id} className="flex justify-between text-sm">
              <span className="text-gray-700 truncate pr-2" title={item.title}>
                {item.title}
              </span>
              <span className="font-semibold text-gray-900 shrink-0">
                {formatPrice(lensTotal, locale)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between border-t border-gray-100 pt-3 text-sm font-bold">
        <span className="text-gray-900">{t("total")}</span>
        <span className="text-accent">{formatPrice(total, locale)}</span>
      </div>
      <p className="mt-3 text-xs text-gray-400 text-center">{t("secureNotice")}</p>
    </div>
  );
}

// ── Processing overlay ────────────────────────────────────────────────────

function ProcessingOverlay() {
  const t = useTranslations("checkout");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
      <div className="text-center">
        <svg className="mx-auto h-10 w-10 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <p className="mt-4 text-sm font-medium text-gray-600">{t("processingOrder")}</p>
      </div>
    </div>
  );
}

// ── Root checkout component ───────────────────────────────────────────────

function CheckoutInner() {
  const t = useTranslations("checkout");
  const router = useRouter();
  const { cart } = useCart();
  const checkout = useCheckout();

  const items = cart?.items ?? [];
  const total = cart?.total ?? 0;

  const handleOrderComplete = (orderId: string) => {
    router.push(`/order/confirmed/${orderId}`);
  };

  if (checkout.step === "processing") {
    return <ProcessingOverlay />;
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">{t("title")}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <div className="lg:col-span-2">
          {checkout.step === "address" && (
            <AddressStep checkout={checkout} />
          )}
          {checkout.step === "payment" && (
            <PaymentStep
              checkout={checkout}
              cartTotal={total}
              onOrderComplete={handleOrderComplete}
            />
          )}
        </div>

        {/* Summary */}
        <div className="lg:col-span-1">
          <OrderSummary items={items} total={total} />
        </div>
      </div>
    </main>
  );
}

// ── Page export (wrapped in Stripe Elements) ──────────────────────────────

export default function CheckoutPage() {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutInner />
    </Elements>
  );
}
