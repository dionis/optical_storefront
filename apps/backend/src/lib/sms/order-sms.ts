/**
 * Short SMS bodies for the order.placed notifications (customer + store owner).
 *
 * SMS is plain text and length-sensitive, so these are intentionally terse: the
 * order number, the total, and one line of context. They mirror the email copy
 * but never reuse its HTML. Locale comes from the same resolver the emails use.
 */

import type { EmailLocale } from "../email/copy";
import type { OrderEmailData } from "../email/order-confirmation";

const STORE_NAME = "Óptica El Rancho";

/** Currency format with a bare-amount fallback for unknown codes. */
function money(amount: number | null | undefined, currency: string | null | undefined, locale: EmailLocale): string {
  const code = (currency ?? "usd").toUpperCase();
  const value = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

/** Confirmation the customer receives after paying. */
export function renderCustomerOrderSms(order: OrderEmailData, locale: EmailLocale): string {
  const id = `#${order.display_id ?? order.id}`;
  const total = money(order.total, order.currency_code, locale);
  if (locale === "en") {
    return `${STORE_NAME}: we received your order ${id} for ${total}. We'll text you when it's ready. Thank you!`;
  }
  return `${STORE_NAME}: recibimos tu pedido ${id} por ${total}. Te avisamos cuando esté listo. ¡Gracias!`;
}

/** Heads-up the store owner receives for each new order. */
export function renderAdminOrderSms(order: OrderEmailData, locale: EmailLocale): string {
  const id = `#${order.display_id ?? order.id}`;
  const total = money(order.total, order.currency_code, locale);
  const who = order.email ? ` — ${order.email}` : "";
  if (locale === "en") {
    return `${STORE_NAME}: new order ${id} for ${total}${who}.`;
  }
  return `${STORE_NAME}: nuevo pedido ${id} por ${total}${who}.`;
}
