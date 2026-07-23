import { createContext, useContext, useState, useCallback, useEffect } from "react";

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
  }, []);
  const removeItem = useCallback((id) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const clearCart = useCallback(() => setItems([]), []);

  const toggleFav = useCallback((p) => {
    setFavorites((prev) => (prev.find((x) => x.slug === p.slug)
      ? prev.filter((x) => x.slug !== p.slug)
      : [...prev, { slug: p.slug, name: p.name, price: p.price, image: p.image, brand: p.brand }]));
  }, []);
  const isFav = useCallback((slug) => favorites.some((x) => x.slug === slug), [favorites]);

  const count = items.length;
  const total = items.reduce((s, i) => s + (i.total || 0), 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, clearCart, count, total, favorites, toggleFav, isFav, favCount: favorites.length }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
