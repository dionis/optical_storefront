import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { trackAddToCart, trackFav, recordOrder } from "../admin/analytics.js";

const CartContext = createContext(null);

function load(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; } catch { return def; }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => load("oer_cart", []));
  const [favorites, setFavorites] = useState(() => load("oer_fav", []));

  useEffect(() => { try { localStorage.setItem("oer_cart", JSON.stringify(items)); } catch {} }, [items]);
  useEffect(() => { try { localStorage.setItem("oer_fav", JSON.stringify(favorites)); } catch {} }, [favorites]);

  const addItem = useCallback((item) => {
    setItems((prev) => [...prev, { ...item, id: `${item.sku}-${Date.now()}-${Math.round(performance.now())}` }]);
    try { trackAddToCart(); } catch {}
  }, []);
  const removeItem = useCallback((id) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const clearCart = useCallback(() => setItems([]), []);

  // Records a real order from the current cart (called at checkout) and empties it.
  const checkout = useCallback((shippingCost = 0, shipMethod, extra = {}) => {
    setItems((prev) => {
      if (prev.length) {
        try {
          const goods = prev.reduce((s, i) => s + (i.total || 0), 0);
          recordOrder({
            items: prev.map((i) => ({ sku: i.sku, name: i.name, brand: i.brand || "—", kind: i.isCase ? "case" : "frame", total: i.total || 0 })),
            total: goods + (Number(shippingCost) || 0),
            shipping: { cost: Number(shippingCost) || 0, method: shipMethod || "pickup" },
            customer: extra.customer || null,
            delivery: extra.delivery || null,
          });
        } catch {}
      }
      return [];
    });
  }, []);

  const toggleFav = useCallback((p) => {
    setFavorites((prev) => (prev.find((x) => x.slug === p.slug)
      ? prev.filter((x) => x.slug !== p.slug)
      : [...prev, { slug: p.slug, name: p.name, price: p.price, image: p.image, brand: p.brand }]));
    try { trackFav(); } catch {}
  }, []);
  const isFav = useCallback((slug) => favorites.some((x) => x.slug === slug), [favorites]);

  const count = items.length;
  const total = items.reduce((s, i) => s + (i.total || 0), 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, clearCart, checkout, count, total, favorites, toggleFav, isFav, favCount: favorites.length }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
