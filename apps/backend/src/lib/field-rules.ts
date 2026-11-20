/**
 * Contact fields, as the server accepts them. Pure. The panel and the checkout
 * apply the same rules first (capri-storefront/src/data/fieldRules.js) to explain
 * them as you type; here they are what cannot be skipped.
 */

export const FIELD_LIMITS = { name: 80, email: 254, phone: 20, street: 160, city: 80, state: 40 };

const EMAIL = /^[^\s@.]+(\.[^\s@.]+)*@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
const PHONE = /^\+?[\d\s().-]+$/;
const NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
const ZIP = /^\d{5}(-\d{4})?$/;

export const isValidEmail = (v: string): boolean => v.length <= FIELD_LIMITS.email && EMAIL.test(v);

/** Digits and the usual separators, with the 7 to 15 digits a phone number has. */
export function isValidPhone(v: string): boolean {
  if (v.length > FIELD_LIMITS.phone || !PHONE.test(v)) return false;
  const digits = v.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

export const isValidName = (v: string): boolean => v.length <= FIELD_LIMITS.name && NAME.test(v);
export const isValidUsZip = (v: string): boolean => ZIP.test(v);
