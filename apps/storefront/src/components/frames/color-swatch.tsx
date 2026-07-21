"use client";

import { useState } from "react";
import { getColorHex } from "@/lib/color-map";

interface ColorSwatchProps {
  colors: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  maxVisible?: number;
}

export function ColorSwatch({
  colors,
  selectedIndex,
  onSelect,
  maxVisible = 5,
}: ColorSwatchProps) {
  const visible = colors.slice(0, maxVisible);
  const overflow = colors.length - maxVisible;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {visible.map((color, i) => (
        <button
          key={color}
          type="button"
          title={color}
          aria-label={`Color ${color}${i === selectedIndex ? " (seleccionado)" : ""}`}
          aria-pressed={i === selectedIndex}
          onClick={(e) => {
            e.preventDefault();
            onSelect(i);
          }}
          className={`h-4 w-4 rounded-full border-2 transition-transform hover:scale-110 ${
            i === selectedIndex
              ? "border-accent scale-110"
              : "border-transparent hover:border-gray-300"
          }`}
          style={{ backgroundColor: getColorHex(color) }}
        />
      ))}
      {overflow > 0 && (
        <span className="text-xs text-gray-400 ml-0.5">+{overflow}</span>
      )}
    </div>
  );
}
