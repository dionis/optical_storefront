import Link from "next/link";
import { ShoppingCart, Glasses, Eye } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-gray-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight text-gray-900 hover:text-accent transition-colors">
            <Glasses className="h-6 w-6 text-accent" aria-hidden="true" />
            <span>Óptica</span>
          </Link>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <Link href="/glasses" className="hover:text-gray-900 transition-colors">
              Monturas
            </Link>
            <Link href="/glasses?sort=price_asc" className="hover:text-gray-900 transition-colors">
              Ofertas
            </Link>
            <Link href="/try-on" className="hover:text-gray-900 transition-colors flex items-center gap-1">
              <Eye className="h-4 w-4" />
              Prueba virtual
            </Link>
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            <Link
              href="/cart"
              aria-label="Carrito de compras"
              className="relative rounded-full p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              <ShoppingCart className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
