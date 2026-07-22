import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface RatingStarsProps {
  rating: number;
  reviewCount?: number;
  size?: "sm" | "md";
  className?: string;
}

export function RatingStars({ rating, reviewCount, size = "sm", className }: RatingStarsProps) {
  const starSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const rounded = Math.round(rating);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div className="flex items-center">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={cn(
              starSize,
              i < rounded ? "fill-amber-400 text-amber-400" : "fill-gray-200 text-gray-200"
            )}
          />
        ))}
      </div>
      <span className="text-xs text-gray-500">
        {rating.toFixed(1)}
        {reviewCount !== undefined && ` (${reviewCount})`}
      </span>
    </div>
  );
}
