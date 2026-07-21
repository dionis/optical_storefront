"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { MeilisearchFrameDocument } from "@eyewear/shared";
import { ColorSwatch } from "./color-swatch";
import { formatPrice } from "@/lib/utils";

interface FrameCardProps {
  frame: MeilisearchFrameDocument;
}

export function FrameCard({ frame }: FrameCardProps) {
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const selectedColor = frame.colors[selectedColorIndex] ?? frame.colors[0];

  const thumbnailUrl = frame.thumbnail
    ? frame.thumbnail.startsWith("http")
      ? frame.thumbnail
      : `${process.env.NEXT_PUBLIC_CDN_URL ?? ""}/${frame.thumbnail}`
    : null;

  return (
    <Link
      href={`/glasses/${frame.handle}`}
      className="group flex flex-col bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all duration-200"
    >
      {/* Image area */}
      <div className="relative aspect-[4/3] bg-gray-50 overflow-hidden">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={`${frame.title}${selectedColor ? ` — ${selectedColor}` : ""}`}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-16 w-16"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={0.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        )}
        {/* Collection badge */}
        {frame.collection && (
          <span className="absolute top-2 left-2 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide backdrop-blur-sm">
            {frame.collection.replace(/-/g, " ")}
          </span>
        )}
      </div>

      {/* Info area */}
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2 group-hover:text-accent transition-colors">
            {frame.title}
          </h3>
          <span className="shrink-0 text-sm font-semibold text-gray-900 whitespace-nowrap">
            {frame.price_from > 0
              ? `Desde ${formatPrice(frame.price_from)}`
              : "Precio a consultar"}
          </span>
        </div>

        {/* Size info */}
        {frame.eye_size > 0 && (
          <p className="text-xs text-gray-400">
            {frame.eye_size}–{frame.bridge_size}–{frame.temple_length}
          </p>
        )}

        {/* Color swatches */}
        {frame.colors.length > 0 && (
          <ColorSwatch
            colors={frame.colors}
            selectedIndex={selectedColorIndex}
            onSelect={setSelectedColorIndex}
          />
        )}
      </div>
    </Link>
  );
}
