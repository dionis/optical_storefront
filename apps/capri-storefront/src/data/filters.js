// Filter taxonomy replicated from caprioptics.com (image 2).
// `field` is the product attribute each group filters on (null = display only).
// Option values are canonical Spanish (they match the product data); the UI
// translates them for display via tv().
export const FILTER_GROUPS = [
  { key: "shape", title: { es: "Forma", en: "Shape" }, field: "shape",
    options: ["Aviador", "Ojo de gato", "Geométrico", "Óvalo modificado", "Ronda modificada", "Navegador", "Oval", "Redondo", "Cuadrado", "Rectángulo", "Combo", "Marco completo"] },
  { key: "material", title: { es: "Material", en: "Material" }, field: "material",
    options: ["Acetato", "Metal", "Plástica", "Inyección", "Memoria", "Acero inoxidable", "Titanio", "TR-90", "Ultem"] },
  { key: "gender", title: { es: "Categoría de género", en: "Gender" }, field: "gender",
    options: ["Señoras", "Hombres", "Unisexo"] },
  { key: "age", title: { es: "Clase de edad", en: "Age group" }, field: "age",
    options: ["Adulto", "Niños"] },
  { key: "eye_size", title: { es: "Tamaño del ojo", en: "Eye size" }, field: "eye_size",
    options: ["34-43 mm", "44-47 mm", "48-50 mm", "51-53 mm", "54-56 mm", "57-59 mm", "Más de 60 mm"] },
  { key: "bridge_size", title: { es: "Tamaño del puente", en: "Bridge size" }, field: "bridge_size",
    options: ["13-15 mm", "16-17 mm", "18-19 mm", "20-22 mm", "23-24 mm"] },
  { key: "temple_length", title: { es: "Largo de la sien", en: "Temple length" }, field: "temple_length",
    options: ["115-120 mm", "125-130 mm", "135-140 mm", "145-150 mm", "155+ mm"] },
  { key: "style", title: { es: "Estilo", en: "Style" }, field: null,
    options: ["Juego de 3 piezas sin aro", "Combo", "Marco completo", "Sin montura semi al aire", "Gafas de sol"] },
  { key: "features", title: { es: "Características", en: "Features" }, field: null,
    options: ["Bisagra de resorte", "Puente Unifit"] },
];

export function productMatches(product, selected) {
  for (const group of FILTER_GROUPS) {
    const chosen = selected[group.key];
    if (!chosen || chosen.length === 0) continue;
    if (!group.field) continue;
    const val = product.attributes[group.field];
    if (Array.isArray(val)) {
      if (!chosen.some((c) => val.includes(c))) return false;
    } else {
      if (!chosen.includes(val)) return false;
    }
  }
  return true;
}
