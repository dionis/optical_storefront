import { useEffect, lazy, Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { loadLive, startAutoRevalidate } from "./data/catalogStore.js";
import { trackAccess } from "./admin/analytics.js";
import { initSfx } from "./lib/sfx.js";
import { checkBuildVersion } from "./lib/buildVersion.js";
import ScrollToTop from "./components/ScrollToTop.jsx";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
// Rutas primarias (primera pintura): se cargan de inmediato.
import Home from "./pages/Home.jsx";
import Catalog from "./pages/Catalog.jsx";
import ProductDetail from "./pages/ProductDetail.jsx";
// Rutas secundarias: se cargan BAJO DEMANDA (code-splitting) para no pesar en el
// bundle inicial del catálogo. El admin (charts + dashboard) es el mayor ahorro.
const CaseDetail = lazy(() => import("./pages/CaseDetail.jsx"));
const LensProcess = lazy(() => import("./pages/LensProcess.jsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
const AccountPage = lazy(() => import("./pages/AccountPage.jsx"));
const MyOrders = lazy(() => import("./pages/MyOrders.jsx"));
const MedusaCheckout = lazy(() => import("./pages/MedusaCheckout.jsx"));
import { CartProvider } from "./components/CartContext.jsx";
import { FeedbackProvider } from "./components/Feedback.jsx";
import { LanguageProvider } from "./i18n/LanguageContext.jsx";
import { ReviewSummaryProvider } from "./components/ReviewSummaryContext.jsx";

// Fallback mientras carga una ruta bajo demanda: reserva alto para evitar saltos
// de layout (CLS) y es invisible; los chunks vienen del mismo origen y cargan rápido.
const RouteFallback = () => (
  <div style={{ minHeight: "50vh" }} aria-busy="true" aria-live="polite" />
);

export default function App() {
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith("/admin");
  useEffect(() => { loadLive(); trackAccess(); initSfx(); }, []);
  // El catálogo se revalida solo al volver a la pestaña o al recuperar la red.
  useEffect(() => startAutoRevalidate(), []);
  // …y en cada cambio de ruta se compara la versión del bundle: si hay un deploy
  // nuevo, esta pestaña se recarga sola en un punto seguro (nunca en /checkout).
  useEffect(() => { checkBuildVersion(pathname); }, [pathname]);

  if (isAdmin) {
    return (
      <LanguageProvider>
        <FeedbackProvider>
          <CartProvider>
            <ScrollToTop />
            <Suspense fallback={<RouteFallback />}>
              <Routes><Route path="/admin" element={<AdminPage />} /></Routes>
            </Suspense>
          </CartProvider>
        </FeedbackProvider>
      </LanguageProvider>
    );
  }

  return (
    <LanguageProvider>
      <FeedbackProvider>
        <CartProvider>
          <ReviewSummaryProvider>
          <ScrollToTop />
          <Header />
          <main className="site-main">
            <Suspense fallback={<RouteFallback />}>
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
            </Suspense>
          </main>
          <Footer />
          </ReviewSummaryProvider>
        </CartProvider>
      </FeedbackProvider>
    </LanguageProvider>
  );
}
