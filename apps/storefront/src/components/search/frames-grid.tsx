"use client";

import { FrameCard } from "@/components/frames/frame-card";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useFramesSearch } from "@/hooks/use-frames-search";
import type { ListingFilters } from "@/lib/filter-params";
import { SortSelect } from "./sort-select";
import { Loader2 } from "lucide-react";

interface FramesGridProps {
  filters: ListingFilters;
  onSortChange: (sort: ListingFilters["sort"]) => void;
}

export function FramesGrid({ filters, onSortChange }: FramesGridProps) {
  const { hits, totalHits, isLoading, isLoadingMore, hasMore, error, loadMore } =
    useFramesSearch(filters);

  const sentinelRef = useIntersectionObserver(loadMore);

  if (error) {
    return (
      <div className="py-16 text-center text-gray-500">
        <p className="mb-2 font-medium">Error al cargar resultados</p>
        <p className="text-sm text-gray-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          {isLoading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Buscando…
            </span>
          ) : (
            <>
              <span className="font-semibold text-gray-900">{totalHits}</span>{" "}
              {totalHits === 1 ? "montura" : "monturas"}
            </>
          )}
        </p>
        <SortSelect value={filters.sort} onChange={onSortChange} />
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl bg-gray-100 aspect-[4/3] animate-pulse"
            />
          ))}
        </div>
      ) : hits.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-500 mb-2">No se encontraron monturas.</p>
          <p className="text-sm text-gray-400">
            Intenta ajustar los filtros o el término de búsqueda.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {hits.map((frame) => (
              <FrameCard key={frame.id} frame={frame} />
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          {hasMore && (
            <div ref={sentinelRef} className="py-4 flex justify-center">
              {isLoadingMore && (
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              )}
            </div>
          )}

          {!hasMore && hits.length > 0 && (
            <p className="py-4 text-center text-sm text-gray-400">
              Has visto todas las monturas disponibles.
            </p>
          )}
        </>
      )}
    </div>
  );
}
