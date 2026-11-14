/**
 * Envío de la tienda online: UN precio fijo, SOLO Estados Unidos.
 *
 * Política comercial (dueño, 13-nov-2026): la entrega hasta el cliente se
 * VENDE a $30, siempre, a cualquier dirección de EE. UU. No hay tarifa por
 * peso ni por zona, ni segunda mensajería más barata: es un precio de venta,
 * no el reembolso de lo que cobre el transportista (eso es un costo «por
 * venta» de la tienda online, en «Reglas y comisiones»).
 *
 *   · Fuera de EE. UU. no se vende (422 `us_only`).
 *   · El importe lo fija el SERVIDOR; el cliente jamás manda importes.
 *   · `SHIPPING_FLAT_RATE` cambia el precio sin tocar código. Las variables
 *     antiguas (`SHIPPING_FEDEX_RATE`, `SHIPPING_DHL_RATE`) ya NO se leen: un
 *     28 olvidado en Coolify no puede pisar los $30.
 *   · `FREE_SHIPPING_THRESHOLD` sigue existiendo para una promo puntual; sin
 *     ella nunca es gratis.
 */

export interface CarrierQuote {
  carrier: "fedex";
  label: string;
  amount: number;        // USD decimales; 0 cuando free === true
  free: boolean;
  eta_min_days: number;
  eta_max_days: number;
}

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// Envío gratis: solo si el dueño pone FREE_SHIPPING_THRESHOLD en Coolify (una
// promo). Sin la variable no hay umbral (Infinity = nunca gratis).
export const FREE_SHIPPING_THRESHOLD = process.env.FREE_SHIPPING_THRESHOLD
  ? num(process.env.FREE_SHIPPING_THRESHOLD, Infinity)
  : Infinity;

/** Lo que se le cobra al cliente por la entrega, en dólares. */
export const FLAT_SHIPPING_RATE = num(process.env.SHIPPING_FLAT_RATE, 30);

const CARRIERS: Array<Omit<CarrierQuote, "amount" | "free"> & { rate: number }> = [
  {
    carrier: "fedex",
    label: "FedEx Home Delivery",
    rate: FLAT_SHIPPING_RATE,
    eta_min_days: num(process.env.SHIPPING_FEDEX_ETA_DAYS, 4),
    eta_max_days: num(process.env.SHIPPING_FEDEX_ETA_DAYS, 4),
  },
];

/** true si la dirección puede enviarse: hoy, solo USA (o sin país aún). */
export function isShippableCountry(countryCode: unknown): boolean {
  const cc = String(countryCode ?? "").trim().toLowerCase();
  return cc === "" || cc === "us";
}

export function quoteCarriers(itemTotal: number): CarrierQuote[] {
  const free = Number(itemTotal) >= FREE_SHIPPING_THRESHOLD;
  return CARRIERS.map((c) => ({
    carrier: c.carrier,
    label: c.label,
    amount: free ? 0 : c.rate,
    free,
    eta_min_days: c.eta_min_days,
    eta_max_days: c.eta_max_days,
  }));
}

export function quoteCarrier(itemTotal: number, carrier: string): CarrierQuote | null {
  return quoteCarriers(itemTotal).find((q) => q.carrier === String(carrier).toLowerCase()) ?? null;
}
