"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWishlistStore } from "@/store/wishlist-store";
import { cn } from "@/lib/utils";

interface WishlistButtonProps {
  handle: string;
  variant?: "card" | "pdp";
  className?: string;
}

export function WishlistButton({ handle, variant = "card", className }: WishlistButtonProps) {
  const t = useTranslations("wishlist");
  const toggle = useWishlistStore((s) => s.toggle);
  const has = useWishlistStore((s) => s.has(handle));

  // Zustand's persist middleware rehydrates from localStorage after mount —
  // gate on mount so SSR markup (always "not wishlisted") never mismatches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isWishlisted = mounted && has;

  const baseCls =
    variant === "card"
      ? "absolute top-2 right-2 z-10 rounded-full bg-white/90 p-1.5 shadow-sm backdrop-blur-sm hover:bg-white transition-colors"
      : "inline-flex items-center justify-center rounded-full border border-gray-200 p-2.5 hover:bg-gray-50 transition-colors";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(handle);
      }}
      aria-label={isWishlisted ? t("remove") : t("add")}
      aria-pressed={isWishlisted}
      className={cn(baseCls, className)}
    >
      <Heart
        className={cn(
          variant === "card" ? "h-4 w-4" : "h-5 w-5",
          isWishlisted ? "fill-red-500 text-red-500" : "text-gray-500"
        )}
      />
    </button>
  );
}
