import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeroBannerProps {
  eyebrow?: string;
  titlePlain: string;
  titleAccent: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  size?: "lg" | "sm";
  className?: string;
}

/** Reusable hero band — full hero on the homepage, a shorter strip atop the catalog listing. */
export function HeroBanner({
  eyebrow,
  titlePlain,
  titleAccent,
  subtitle,
  ctaLabel,
  ctaHref = "/glasses",
  size = "lg",
  className,
}: HeroBannerProps) {
  const isLarge = size === "lg";

  return (
    <section
      className={cn(
        "relative overflow-hidden bg-gradient-to-br from-gray-50 to-white",
        isLarge ? "rounded-none" : "rounded-2xl border border-gray-100",
        className
      )}
    >
      <div
        className={cn(
          "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8",
          isLarge ? "py-20 md:py-28" : "py-10 md:py-14"
        )}
      >
        <div className="max-w-2xl">
          {eyebrow && (
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-accent">
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              "font-bold tracking-tight text-gray-900 leading-[1.1]",
              isLarge ? "text-5xl md:text-6xl mb-6" : "text-3xl md:text-4xl mb-3"
            )}
          >
            {titlePlain} <span className="text-accent">{titleAccent}</span>
          </h1>
          {subtitle && (
            <p
              className={cn(
                "text-gray-500 leading-relaxed",
                isLarge ? "text-xl mb-8" : "text-base mb-5"
              )}
            >
              {subtitle}
            </p>
          )}
          {ctaLabel && (
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
