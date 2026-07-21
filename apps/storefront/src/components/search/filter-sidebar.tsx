"use client";

import type { FacetDistribution } from "meilisearch";
import type { ListingFilters, SizeBucket } from "@/lib/filter-params";
import { SIZE_BUCKET_LABELS } from "@/lib/filter-params";
import { getColorHex } from "@/lib/color-map";
import { X } from "lucide-react";

const SHAPE_LABELS: Record<string, string> = {
  round: "Redonda",
  oval: "Oval",
  rectangle: "Rectangular",
  square: "Cuadrada",
  cat_eye: "Ojo de gato",
  aviator: "Aviador",
  browline: "Browline",
  geometric: "Geométrica",
  rimless: "Sin aro",
  semi_rimless: "Semi sin aro",
  other: "Otro",
};

const MATERIAL_LABELS: Record<string, string> = {
  acetate: "Acetato",
  metal: "Metal",
  titanium: "Titanio",
  stainless_steel: "Acero inoxidable",
  tr90: "TR90",
  mixed: "Mixto",
  wood: "Madera",
  other: "Otro",
};

const GENDER_LABELS: Record<string, string> = {
  men: "Hombre",
  women: "Mujer",
  unisex: "Unisex",
};

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
}

function FilterSection({ title, children }: FilterSectionProps) {
  return (
    <div className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
      <h3 className="mb-3 text-sm font-semibold text-gray-800">{title}</h3>
      {children}
    </div>
  );
}

interface CheckboxItemProps {
  label: string;
  checked: boolean;
  count?: number;
  onChange: () => void;
}

function CheckboxItem({ label, checked, count, onChange }: CheckboxItemProps) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer group py-0.5">
      <span className="flex items-center gap-2">
        <span
          role="checkbox"
          aria-checked={checked}
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onChange()}
          onClick={onChange}
          className={`h-4 w-4 shrink-0 rounded border transition-colors ${
            checked
              ? "bg-accent border-accent"
              : "bg-white border-gray-300 group-hover:border-accent"
          } flex items-center justify-center`}
        >
          {checked && (
            <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="currentColor">
              <path d="M8.5 2L4 7.5 1.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          )}
        </span>
        <span className={`text-sm ${checked ? "text-gray-900 font-medium" : "text-gray-600"} group-hover:text-gray-900 transition-colors leading-tight`}>
          {label}
        </span>
      </span>
      {count !== undefined && (
        <span className="text-xs text-gray-400 tabular-nums">{count}</span>
      )}
    </label>
  );
}

interface FilterSidebarProps {
  filters: ListingFilters;
  facets: FacetDistribution;
  onChange: (next: ListingFilters) => void;
}

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export function FilterSidebar({ filters, facets, onChange }: FilterSidebarProps) {
  const shapeFacets = (facets["shape"] ?? {}) as Record<string, number>;
  const materialFacets = (facets["material"] ?? {}) as Record<string, number>;
  const genderFacets = (facets["gender"] ?? {}) as Record<string, number>;
  const collectionFacets = (facets["collection"] ?? {}) as Record<string, number>;
  const featureFacets = (facets["features"] ?? {}) as Record<string, number>;
  const colorFacets = (facets["colors"] ?? {}) as Record<string, number>;

  const hasShapes = Object.keys(shapeFacets).length > 0;
  const hasMaterials = Object.keys(materialFacets).length > 0;
  const hasGenders = Object.keys(genderFacets).length > 0;
  const hasCollections = Object.keys(collectionFacets).length > 0;
  const hasFeatures = Object.keys(featureFacets).length > 0;
  const hasColors = Object.keys(colorFacets).length > 0;

  return (
    <aside className="flex flex-col gap-4">
      {/* Gender */}
      {hasGenders && (
        <FilterSection title="Género">
          <div className="flex flex-col gap-1.5">
            {Object.entries(genderFacets)
              .sort((a, b) => b[1] - a[1])
              .map(([g, count]) => (
                <CheckboxItem
                  key={g}
                  label={GENDER_LABELS[g] ?? g}
                  checked={filters.genders.includes(g)}
                  count={count}
                  onChange={() =>
                    onChange({ ...filters, genders: toggle(filters.genders, g) })
                  }
                />
              ))}
          </div>
        </FilterSection>
      )}

      {/* Shape */}
      {hasShapes && (
        <FilterSection title="Forma">
          <div className="flex flex-col gap-1.5">
            {Object.entries(shapeFacets)
              .sort((a, b) => b[1] - a[1])
              .map(([shape, count]) => (
                <CheckboxItem
                  key={shape}
                  label={SHAPE_LABELS[shape] ?? shape}
                  checked={filters.shapes.includes(shape)}
                  count={count}
                  onChange={() =>
                    onChange({ ...filters, shapes: toggle(filters.shapes, shape) })
                  }
                />
              ))}
          </div>
        </FilterSection>
      )}

      {/* Material */}
      {hasMaterials && (
        <FilterSection title="Material">
          <div className="flex flex-col gap-1.5">
            {Object.entries(materialFacets)
              .sort((a, b) => b[1] - a[1])
              .map(([mat, count]) => (
                <CheckboxItem
                  key={mat}
                  label={MATERIAL_LABELS[mat] ?? mat}
                  checked={filters.materials.includes(mat)}
                  count={count}
                  onChange={() =>
                    onChange({ ...filters, materials: toggle(filters.materials, mat) })
                  }
                />
              ))}
          </div>
        </FilterSection>
      )}

      {/* Size */}
      <FilterSection title="Tamaño (ojo)">
        <div className="flex flex-col gap-1.5">
          {(["narrow", "medium", "wide"] as SizeBucket[]).map((bucket) => (
            <CheckboxItem
              key={bucket}
              label={SIZE_BUCKET_LABELS[bucket]}
              checked={filters.sizes.includes(bucket)}
              onChange={() =>
                onChange({ ...filters, sizes: toggle(filters.sizes, bucket) })
              }
            />
          ))}
        </div>
      </FilterSection>

      {/* Color */}
      {hasColors && (
        <FilterSection title="Color">
          <div className="flex flex-wrap gap-2">
            {Object.entries(colorFacets)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([color]) => {
                const active = filters.colors.includes(color);
                return (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={`${color}${active ? " (activo)" : ""}`}
                    aria-pressed={active}
                    onClick={() =>
                      onChange({ ...filters, colors: toggle(filters.colors, color) })
                    }
                    className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                      active ? "border-accent scale-110" : "border-gray-200"
                    }`}
                    style={{ backgroundColor: getColorHex(color) }}
                  />
                );
              })}
          </div>
        </FilterSection>
      )}

      {/* Collection */}
      {hasCollections && (
        <FilterSection title="Colección">
          <div className="flex flex-col gap-1.5">
            {Object.entries(collectionFacets)
              .sort((a, b) => b[1] - a[1])
              .map(([col, count]) => (
                <CheckboxItem
                  key={col}
                  label={col.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  checked={filters.collections.includes(col)}
                  count={count}
                  onChange={() =>
                    onChange({
                      ...filters,
                      collections: toggle(filters.collections, col),
                    })
                  }
                />
              ))}
          </div>
        </FilterSection>
      )}

      {/* Features */}
      {hasFeatures && (
        <FilterSection title="Características">
          <div className="flex flex-col gap-1.5">
            {Object.entries(featureFacets)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([feature, count]) => (
                <CheckboxItem
                  key={feature}
                  label={feature.replace(/-/g, " ")}
                  checked={filters.features.includes(feature)}
                  count={count}
                  onChange={() =>
                    onChange({
                      ...filters,
                      features: toggle(filters.features, feature),
                    })
                  }
                />
              ))}
          </div>
        </FilterSection>
      )}

      {/* Show empty state when no facets yet */}
      {!hasShapes && !hasMaterials && !hasGenders && !hasCollections && !hasColors && (
        <p className="text-sm text-gray-400 py-2">
          Los filtros aparecerán una vez que haya productos indexados.
        </p>
      )}
    </aside>
  );
}
