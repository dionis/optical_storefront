import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { loadLive } from "./data/catalogStore.js";
import ScrollToTop from "./components/ScrollToTop.jsx";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./pages/Home.jsx";
import Catalog from "./pages/Catalog.jsx";
import ProductDetail from "./pages/ProductDetail.jsx";
import CaseDetail from "./pages/CaseDetail.jsx";
import LensProcess from "./pages/LensProcess.jsx";
import { CartProvider } from "./components/CartContext.jsx";
import { LanguageProvider } from "./i18n/LanguageContext.jsx";

export default function App() {
  useEffect(() => { loadLive(); }, []);
  return (
    <LanguageProvider>
      <CartProvider>
        <ScrollToTop />
        <Header />
        <main className="site-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/catalogo" element={<Catalog />} />
            <Route path="/marca/:slug" element={<Catalog />} />
            <Route path="/producto/:slug" element={<ProductDetail />} />
            <Route path="/estuche/:slug" element={<CaseDetail />} />
            <Route path="/estuches" element={<Catalog />} />
            <Route path="/recetas/:slug" element={<LensProcess />} />
          </Routes>
        </main>
        <Footer />
      </CartProvider>
    </LanguageProvider>
  );
}
