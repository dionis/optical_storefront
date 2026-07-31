import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { trackAddToCart, trackFav } from "../admin/analytics.js";
import * as mcart from "../data/medusaCart.js";

// Cart state IS the Medusa cart (server-side truth). localStorage keeps only the
// cart_id (handled inside medusaCart.js under "oer_medusa_cart") and the favorites.
// items/count/total are DERIVED from the server cart — the client never recomputes
// a total. There is no silent fallback to a local cart: a failed add throws so the
// caller can surface it (that silent fallback is what produced the "empty cart at
// checkout" bug). The analytics order is recorded after Medusa confirms the order
// (in MedusaCheckout), not when a local cart is cleared.
const CartContext = createContext(null);

function loadFav() {
  try { const v = JSON.parse(localStorage.getItem("oer_fav")); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState(null);          // Medusa cart object (or null)
  const [favorites, setFavorites] = useState(loadFav);
  const [busy, setBusy] = useState(false);

  useEffect(() => { try { localStorage.setItem("oer_fav", JSON.stringify(favorites)); } catch {} }, [favorites]);

  // Hydrate the existing server cart on mount (if any).
  const refresh = useCallback(async () => {
    try { const c = await mcart.getCart(); setCart(c); return c; }
    catch { setCart(null); return null; }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Add a plain variant (frame at base price, or a case). Throws if no variantId —
  // the caller must disable the buy button and show a notice instead of falling
  // back to a local cart.
  const addVariant = useCallback(async (variantId, quantity = 1) => {
    if (!variantId) throw new Error("no-variant");
    setBusy(true);
    try { const c = await mcart.addVariant(variantId, quantity); setCart(c); try { trackAddToCart(); } catch {} return c; }
    finally { setBusy(false); }
  }, []);

  // Add a frame configured with lenses — priced entirely server-side. `selection`
  // carries the lens codes; `prescriptionId` is the PHI reference (never the values).
  const addConfiguredFrame = useCallback(async (variantId, selection, prescriptionId = null) => {
    if (!variantId) throw new Error("no-variant");
    setBusy(true);
    try { const c = await mcart.addConfiguredFrame(variantId, selection, prescriptionId); setCart(c); try { trackAddToCart(); } catch {} return c; }
    finally { setBusy(false); }
  }, []);

  const removeItem = useCallback(async (lineItemId) => {
    setBusy(true);
    try { const c = await mcart.removeItem(lineItemId); setCart(c); return c; }
    finally { setBusy(false); }
  }, []);

  // Local reset of the cart reference (used after a completed order or by "clear").
  const clearCart = useCallback(async () => { mcart.clearCartId(); setCart(null); }, []);

  const toggleFav = useCallback((p) => {
    setFavorites((prev) => (prev.find((x) => x.slug === p.slug)
      ? prev.filter((x) => x.slug !== p.slug)
      : [...prev, { slug: p.slug, name: p.name, price: p.price, image: p.image, brand: p.brand, variantId: p.variantId || null }]));
    try { trackFav(); } catch {}
  }, []);
  const isFav = useCallback((slug) => favorites.some((x) => x.slug === slug), [favorites]);

  // Derived from the SERVER cart — never recomputed on the client.
  const items = cart?.items || [];
  const count = items.reduce((s, i) => s + (i.quantity || 1), 0);
  const total = cart?.total ?? 0;

  return (
    <CartContext.Provider value={{
      cart, items, count, total, busy,
      refresh, addVariant, addConfiguredFrame, removeItem, clearCart,
      favorites, toggleFav, isFav, favCount: favorites.length,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
