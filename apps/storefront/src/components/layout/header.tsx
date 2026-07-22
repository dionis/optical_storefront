"use client";

import { useEffect, useState } from "react";
import { ShoppingCart, Glasses, Eye, Search, Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { PromoBar } from "./promo-bar";
import { LanguageSwitcher } from "./language-switcher";
import { useWishlistStore } from "@/store/wishlist-store";

export function Header() {
  const t = useTranslations("header");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const wishlistCount = useWishlistStore((s) => s.handles.length);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/glasses${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-gray-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <PromoBar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Logo */}
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 font-bold text-xl tracking-tight text-gray-900 hover:text-accent transition-colors"
          >
            <Glasses className="h-6 w-6 text-accent" aria-hidden="true" />
            <span>{tCommon("siteName")}</span>
          </Link>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600 shrink-0">
            <Link href="/glasses" className="hover:text-gray-900 transition-colors">
              {t("navFrames")}
            </Link>
            <Link href="/glasses?sort=price_asc" className="hover:text-gray-900 transition-colors">
              {t("navDeals")}
            </Link>
            <Link
              href="/try-on"
              className="hover:text-gray-900 transition-colors flex items-center gap-1"
            >
              <Eye className="h-4 w-4" />
              {t("navTryOn")}
            </Link>
          </nav>

          {/* Search */}
          <form
            onSubmit={handleSearchSubmit}
            className="hidden lg:flex flex-1 max-w-xs items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5"
          >
            <Search className="h-4 w-4 text-gray-400 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchAria")}
              className="w-full bg-transparent text-sm placeholder:text-gray-400 focus:outline-none"
            />
          </form>

          {/* Right actions */}
          <div className="flex items-center gap-1 shrink-0">
            <LanguageSwitcher />
            <button
              type="button"
              aria-label={t("wishlistAria")}
              className="relative rounded-full p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              <Heart className="h-5 w-5" />
              {mounted && wishlistCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                  {wishlistCount}
                </span>
              )}
            </button>
            <Link
              href="/cart"
              aria-label={t("cartAria")}
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
