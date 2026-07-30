import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { trackAddToCart, trackFav, recordOrder } from "../admin/analytics.js";

const CartContext = createContext(null);

function load(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; } catch { return def; }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => load("oer_cart", []));
  const [favorites, setFavorites] = useState(() => load("oer_fav", []));

  // Ref siempre al día con los items, para que checkout() pueda leer el carrito
  // de forma síncrona y DEVOLVER la orden creada (React no garantiza que el
  // updater de setState corra sincrónicamente).
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => { try { localStorage.setItem("oer_cart", JSON.stringify(items)); } catch {} }, [items]);
  useEffect(() => { try { localStorage.setItem("oer_fav", JSON.stringify(favorites)); } catch {} }, [favorites]);

  const addItem = useCallback((item) => {
    setItems((prev) => [...prev, { ...item, id: `${item.sku}-${Date.now()}-${Math.round(performance.now())}` }]);
    try { trackAddToCart(); } catch {}
  }, []);
  const removeItem = useCallback((id) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const clearCart = useCallback(() => setItems([]), []);

  // Registra una orden real desde el carrito actual (al pagar), vacía el carrito
  // y DEVUELVE la orden creada (para mostrar el comprobante y notificar). Si el
  // carrito está vacío devuelve null.
  const checkout = useCallback((shippingCost = 0, shipMethod, extra = {}) => {
    const prev = itemsRef.current;
    if (!prev.length) return null;
    let rec = null;
    try {
      const goods = prev.reduce((s, i) => s + (i.total || 0), 0);
      rec = recordOrder({
        // Conservamos el desglose completo (color, diseño/material/foto/AR y
        // `specs` legibles) para que la orden muestre lo MISMO al cliente y al admin.
        items: prev.map((i) => ({
          sku: i.sku, name: i.name, brand: i.brand || "—",
          kind: i.isCase ? "case" : "frame",
          color: i.color || null,
          design: i.design || null, material: i.material || null,
          photo: i.photo || null, ar: i.ar || null,
          specs: Array.isArray(i.specs) ? i.specs : [],
          total: i.total || 0,
        })),
        total: goods + (Number(shippingCost) || 0),
        shipping: { cost: Number(shippingCost) || 0, method: shipMethod || "pickup" },
        customer: extra.customer || null,
        delivery: extra.delivery || null,
      });
    } catch {}
    setItems([]);
    return rec;
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
