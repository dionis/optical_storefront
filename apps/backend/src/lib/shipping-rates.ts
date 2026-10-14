/**
 * Cotización de envío de la tienda: FedEx y DHL, SOLO Estados Unidos.
 *
 * Política comercial (14-oct-2026):
 *   · Pedidos de $100 o más ⇒ envío GRATIS con cualquiera de los dos.
 *   · Por debajo, cada transportista cotiza su tarifa y EL CLIENTE elige.
 *   · De momento no se admite ninguna dirección fuera de USA (us_only).
 *
 * Las tarifas salen de esta TABLA de servidor (paquete pequeño ~1 lb, 48
 * estados contiguos, tarifas de lista publicadas de FedEx Home Delivery y DHL
 * eCommerce SmartMail). El cliente JAMÁS manda importes. Cuando existan
 * credenciales de las APIs oficiales (FEDEX_API_KEY / DHL_API_KEY en el env),
 * `quoteCarriers` es el único punto a cambiar para cotizar en vivo — la firma
 * ya es asíncrona-amistosa y los dos routes consumen solo su resultado.
 */

export interface CarrierQuote {
  carrier: "fedex" | "dhl";
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

// Promo de envío gratis RETIRADA (pedido del dueño, 14-oct-2026): sin la env
// no hay umbral (Infinity = nunca gratis). Poner FREE_SHIPPING_THRESHOLD en
// Coolify la reactiva sin tocar código.
export const FREE_SHIPPING_THRESHOLD = process.env.FREE_SHIPPING_THRESHOLD
  ? num(process.env.FREE_SHIPPING_THRESHOLD, Infinity)
  : Infinity;

const CARRIERS: Array<Omit<CarrierQuote, "amount" | "free"> & { rate: number }> = [
  {
    carrier: "fedex",
    label: "FedEx Home Delivery",
    // Pedido del dueño (14-oct-2026): $28 de envío con 4 días de demora.
    rate: num(process.env.SHIPPING_FEDEX_RATE, 28),
    eta_min_days: num(process.env.SHIPPING_FEDEX_ETA_DAYS, 4),
    eta_max_days: num(process.env.SHIPPING_FEDEX_ETA_DAYS, 4),
  },
  {
    carrier: "dhl",
    label: "DHL eCommerce",
    rate: num(process.env.SHIPPING_DHL_RATE, 7.95),
    eta_min_days: 4,
    eta_max_days: 7,
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
