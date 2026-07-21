"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import type { ListingFilters } from "@/lib/filter-params";
import {
  filtersToSearchParams,
  countActiveFilters,
  EMPTY_FILTERS,
} from "@/lib/filter-params";
import { FilterSidebar } from "@/components/search/filter-sidebar";
import { FramesGrid } from "@/components/search/frames-grid";
import { useFramesSearch } from "@/hooks/use-frames-search";

interface GlassesClientPageProps {
  initialFilters: ListingFilters;
}

export function GlassesClientPage({ initialFilters }: GlassesClientPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState<ListingFilters>(initialFilters);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Fetch facets for sidebar (using current filters minus the changed one for true facet counts)
  const { facets } = useFramesSearch(filters);

  const activeFilterCount = countActiveFilters(filters);

  const updateFilters = useCallback(
    (next: ListingFilters) => {
      setFilters(next);
      const params = filtersToSearchParams(next);
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [router, pathname]
  );

  const clearFilters = useCallback(() => {
    updateFilters({ ...EMPTY_FILTERS, sort: filters.sort });
  }, [filters.sort, updateFilters]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Monturas</h1>
          {filters.query && (
            <p className="mt-1 text-sm text-gray-500">
              Resultados para:{" "}
              <span className="font-medium text-gray-800">
                &ldquo;{filters.query}&rdquo;
              </span>
            </p>
          )}
        </div>

        {/* Mobile filter button */}
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="lg:hidden flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
          {activeFilterCount > 0 && (
            <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Search bar */}
      <div className="mb-6">
        <input
          type="search"
          value={filters.query}
          onChange={(e) => updateFilters({ ...filters, query: e.target.value })}
          placeholder="Buscar monturas…"
          aria-label="Buscar monturas"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
        />
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Filtros activos:</span>
          {filters.genders.map((g) => (
            <Chip
              key={`gender-${g}`}
              label={g}
              onRemove={() =>
                updateFilters({
                  ...filters,
                  genders: filters.genders.filter((v) => v !== g),
                })
              }
            />
          ))}
          {filters.shapes.map((s) => (
            <Chip
              key={`shape-${s}`}
              label={s}
              onRemove={() =>
                updateFilters({
                  ...filters,
                  shapes: filters.shapes.filter((v) => v !== s),
                })
              }
            />
          ))}
          {filters.materials.map((m) => (
            <Chip
              key={`material-${m}`}
              label={m}
              onRemove={() =>
                updateFilters({
                  ...filters,
                  materials: filters.materials.filter((v) => v !== m),
                })
              }
            />
          ))}
          {filters.sizes.map((sz) => (
            <Chip
              key={`size-${sz}`}
              label={sz}
              onRemove={() =>
                updateFilters({
                  ...filters,
                  sizes: filters.sizes.filter((v) => v !== sz),
                })
              }
            />
          ))}
          {filters.collections.map((c) => (
            <Chip
              key={`col-${c}`}
              label={c.replace(/-/g, " ")}
              onRemove={() =>
                updateFilters({
                  ...filters,
                  collections: filters.collections.filter((v) => v !== c),
                })
              }
            />
          ))}
          {filters.colors.map((c) => (
            <Chip
              key={`color-${c}`}
              label={c}
              onRemove={() =>
                updateFilters({
                  ...filters,
                  colors: filters.colors.filter((v) => v !== c),
                })
              }
            />
          ))}
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2"
          >
            Limpiar todo
          </button>
        </div>
      )}

      {/* Main layout */}
      <div className="flex gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-56 shrink-0">
          <FilterSidebar
            filters={filters}
            facets={facets}
            onChange={updateFilters}
          />
        </aside>

        {/* Results */}
        <div className="min-w-0 flex-1">
          <FramesGrid
            filters={filters}
            onSortChange={(sort) => updateFilters({ ...filters, sort })}
          />
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-80 max-w-full bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 p-4">
              <h2 className="font-semibold text-gray-900">Filtros</h2>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
                aria-label="Cerrar filtros"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              <FilterSidebar
                filters={filters}
                facets={facets}
                onChange={(next) => {
                  updateFilters(next);
                }}
              />
            </div>
            <div className="border-t border-gray-100 p-4">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 transition-colors"
              >
                Ver resultados
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Eliminar filtro ${label}`}
        className="ml-0.5 rounded-full hover:bg-gray-200 transition-colors p-0.5"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
