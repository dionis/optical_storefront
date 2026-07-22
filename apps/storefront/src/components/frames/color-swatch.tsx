"use client";

import { getColorHex } from "@/lib/color-map";
import { cn } from "@/lib/utils";

interface ColorSwatchProps {
  colors: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  maxVisible?: number;
  size?: "sm" | "lg";
  showLabel?: boolean;
}

export function ColorSwatch({
  colors,
  selectedIndex,
  onSelect,
  maxVisible = 5,
  size = "sm",
  showLabel = false,
}: ColorSwatchProps) {
  const visible = colors.slice(0, maxVisible);
  const overflow = colors.length - maxVisible;
  const dotCls = size === "lg" ? "h-7 w-7" : "h-4 w-4";

  return (
    <div className="flex flex-col gap-2">
      {showLabel && colors[selectedIndex] && (
        <p className="text-sm font-medium text-gray-700">
          {colors[selectedIndex]}
        </p>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {visible.map((color, i) => (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={color}
            aria-pressed={i === selectedIndex}
            onClick={(e) => {
              e.preventDefault();
              onSelect(i);
            }}
            className={cn(
              dotCls,
              "rounded-full border-2 transition-transform hover:scale-110",
              i === selectedIndex
                ? "border-accent scale-110"
                : "border-transparent hover:border-gray-300"
            )}
            style={{ backgroundColor: getColorHex(color) }}
          />
        ))}
        {overflow > 0 && (
          <span className="text-xs text-gray-400 ml-0.5">+{overflow}</span>
        )}
      </div>
    </div>
  );
}
