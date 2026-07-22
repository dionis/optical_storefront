"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ProductGalleryProps {
  images: Array<{ url: string; alt: string }>;
}

export function ProductGallery({ images }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = images[activeIndex];
  const t = useTranslations("gallery");

  const cdnUrl = process.env.NEXT_PUBLIC_CDN_URL ?? "";
  const resolveUrl = (url: string) =>
    url.startsWith("http") ? url : `${cdnUrl}/${url}`;

  if (!images.length) {
    return (
      <div className="aspect-[4/3] rounded-2xl bg-gray-100 flex items-center justify-center text-gray-300">
        <span className="text-6xl">👓</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Main image */}
      <div className="relative aspect-[4/3] rounded-2xl bg-gray-50 overflow-hidden group">
        <Image
          src={resolveUrl(activeImage.url)}
          alt={activeImage.alt}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-contain p-6"
          priority
        />
        {images.length > 1 && (
          <>
            <button
              type="button"
              aria-label={t("prevImage")}
              onClick={() =>
                setActiveIndex((i) => (i - 1 + images.length) % images.length)
              }
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1.5 shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4 text-gray-700" />
            </button>
            <button
              type="button"
              aria-label={t("nextImage")}
              onClick={() =>
                setActiveIndex((i) => (i + 1) % images.length)
              }
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1.5 shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white"
            >
              <ChevronRight className="h-4 w-4 text-gray-700" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIndex(i)}
              aria-label={t("imageN", { n: i + 1 })}
              aria-pressed={i === activeIndex}
              className={`relative h-16 w-20 shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                i === activeIndex
                  ? "border-accent"
                  : "border-transparent hover:border-gray-200"
              }`}
            >
              <Image
                src={resolveUrl(img.url)}
                alt={img.alt}
                fill
                sizes="80px"
                className="object-contain p-1"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
