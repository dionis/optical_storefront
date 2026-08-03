import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { loadLive } from "./data/catalogStore.js";
import { trackAccess } from "./admin/analytics.js";
import { initSfx } from "./lib/sfx.js";
import ScrollToTop from "./components/ScrollToTop.jsx";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./pages/Home.jsx";
import Catalog from "./pages/Catalog.jsx";
import ProductDetail from "./pages/ProductDetail.jsx";
import CaseDetail from "./pages/CaseDetail.jsx";
import LensProcess from "./pages/LensProcess.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import AccountPage from "./pages/AccountPage.jsx";
import MyOrders from "./pages/MyOrders.jsx";
import MedusaCheckout from "./pages/MedusaCheckout.jsx";
import { CartProvider } from "./components/CartContext.jsx";
import { FeedbackProvider } from "./components/Feedback.jsx";
import { LanguageProvider } from "./i18n/LanguageContext.jsx";

export default function App() {
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith("/admin");
  useEffect(() => { loadLive(); trackAccess(); initSfx(); }, []);

  if (isAdmin) {
    return (
      <LanguageProvider>
        <FeedbackProvider>
          <CartProvider>
            <ScrollToTop />
            <Routes><Route path="/admin" element={<AdminPage />} /></Routes>
          </CartProvider>
        </FeedbackProvider>
      </LanguageProvider>
    );
  }

  return (
    <LanguageProvider>
      <FeedbackProvider>
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
              <Route path="/checkout" element={<MedusaCheckout />} />
              <Route path="/cuenta" element={<AccountPage />} />
              <Route path="/my-orders" element={<MyOrders />} />
            </Routes>
          </main>
          <Footer />
        </CartProvider>
      </FeedbackProvider>
    </LanguageProvider>
  );
}
