// La promoción por artículo y tienda (docs/PRICE-MATRIX.md, «Cómo se aplica el
// descuento»): el servidor guarda en cada línea
//   promo: { frame_pct, lens_pct, photo_pct, ar_pct, before_cents }
// y su `list` es YA el precio rebajado. Los recibos y el resumen de la venta
// enseñan debajo de la línea «Precio antes $X · Promoción −Y %». Puro: lo usan
// SaleDocuments.jsx (HTML impreso, idioma del recibo) y PosSaleSummary.jsx.

const PARTS = ["frame_pct", "lens_pct", "photo_pct", "ar_pct"];

/**
 * { before, pct } en dólares y por ciento, o null cuando la línea no tiene
 * promoción (o el precio de antes no es mayor que el de ahora). Una sola parte
 * rebajada (o todas con el mismo %) enseña ese %; si las partes llevan % distintos
 * se enseña el efectivo de la línea, con un decimal.
 */
export function promoOf(line) {
  const p = line?.promo ?? line?.metadata?.promo ?? null;
  if (!p || typeof p !== "object") return null;
  // Two shapes reach here: the quote / sale line (`before_cents`, cents) and the
  // printed document's `DocLine.promo` (`before` in dollars + the line's
  // effective `pct`, lib/pos-documents.ts). Reading only `before_cents` left
  // every printed receipt without its «Precio antes … Promoción» line.
  const before = p.before_cents != null ? Number(p.before_cents) / 100 : Number(p.before);
  const now = Number(line.list);
  if (!(before > 0)) return null;
  const docPct = Number(p.pct);
  if (p.before_cents == null && docPct > 0) return { before, pct: Math.round(docPct * 100) / 100 };
  const pcts = [...new Set(PARTS.map((k) => Number(p[k]) || 0).filter((v) => v > 0))];
  let pct;
  if (pcts.length === 1) pct = pcts[0];
  else if (Number.isFinite(now) && now < before) pct = Math.round(((before - now) / before) * 1000) / 10;
  else return null;
  if (!(pct > 0)) return null;
  return { before, pct: Math.round(pct * 100) / 100 };
}

/**
 * The promotion of a POS search result or of the frame chosen from it
 * (`GET /admin/pos/products`: `price` is already reduced, `price_before` the
 * price without it, `discount_pct` null without a promotion). { before, pct }
 * or null. Pure.
 */
export function listPromoOf(item) {
  const pct = Number(item?.discount_pct);
  const before = Number(item?.price_before);
  const now = Number(item?.price);
  if (!(pct > 0) || !(before > 0) || !Number.isFinite(now) || !(now < before)) return null;
  return { before, pct: Math.round(pct * 100) / 100 };
}
