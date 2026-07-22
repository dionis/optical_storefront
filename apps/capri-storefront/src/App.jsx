import { Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./pages/Home.jsx";
import Catalog from "./pages/Catalog.jsx";
import ProductDetail from "./pages/ProductDetail.jsx";
import LensProcess from "./pages/LensProcess.jsx";
import { CartProvider } from "./components/CartContext.jsx";

export default function App() {
  return (
    <CartProvider>
      <Header />
      <main className="site-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalogo" element={<Catalog />} />
          <Route path="/marca/:slug" element={<Catalog />} />
          <Route path="/producto/:slug" element={<ProductDetail />} />
          <Route path="/recetas/:slug" element={<LensProcess />} />
        </Routes>
      </main>
      <Footer />
    </CartProvider>
  );
}
