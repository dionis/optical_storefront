// ─────────────────────────────────────────────────────────────
// Lista de precios profesional 2026 — Óptica El Rancho.
// Precio base del LENTE = matriz (diseño × material). Se suma al precio
// de la MONTURA (producto). Fotocromáticos/Transitions y antirreflejos
// son adicionales. Editable desde el board (overrides en priceStore).
// Etiquetas bilingües {es,en}. Precios en USD.
// ─────────────────────────────────────────────────────────────

// Diseños (filas). cat = categoría usada para fotocromáticos/AR.
export const DESIGNS = [
  { id: "sv",        cat: "sv",      rx: true,  add: false, label: { es: "Visión Sencilla",        en: "Single Vision" } },
  { id: "bifocal",   cat: "bifocal", rx: true,  add: true,  label: { es: "Bifocal FT-28",          en: "Bifocal FT-28" } },
  { id: "prog-mid",  cat: "prog",    rx: true,  add: true,  label: { es: "Progresivo Gama Media",  en: "Progressive · Mid" } },
  { id: "prog-high", cat: "prog",    rx: true,  add: true,  label: { es: "Progresivo Gama Alta",   en: "Progressive · Premium" } },
];

export const FRAME_ONLY = { id: "frame-only", rx: false, label: { es: "Solo montura", en: "Frame only" } };

// Materiales (columnas). maxAbs = graduación máx. recomendada.
export const MATERIALS = [
  { id: "cr39",  maxAbs: 2,  label: { es: "CR-39 (Resina)", en: "CR-39 (Resin)" },     desc: { es: "Estándar, económico.",       en: "Standard, budget." } },
  { id: "poly",  maxAbs: 3,  label: { es: "Policarbonato",  en: "Polycarbonate" },      desc: { es: "Resistente a impactos. Niños/deporte.", en: "Impact-resistant. Kids/sport." } },
  { id: "1.67",  maxAbs: 6,  label: { es: "Índice 1.67",    en: "Index 1.67" },         desc: { es: "Muy delgado.",               en: "Very thin." } },
  { id: "1.74",  maxAbs: 99, label: { es: "Índice 1.74",    en: "Index 1.74" },         desc: { es: "Ultra delgado. Alta graduación.", en: "Ultra-thin. High Rx." } },
];

// Matriz base: BASE[designId][materialId] = precio del lente (USD).
export const BASE = {
  "sv":        { cr39: 24,  poly: 30,  "1.67": 52,  "1.74": 95 },
  "bifocal":   { cr39: 47,  poly: 55,  "1.67": 160, "1.74": 180 },
  "prog-mid":  { cr39: 75,  poly: 75,  "1.67": 131, "1.74": 145 },
  "prog-high": { cr39: 101, poly: 101, "1.67": 135, "1.74": 135 },
};

// Fotocromáticos y Transitions (adicional al lente). price por categoría
// sv / bifocal / prog. null = no disponible para esa categoría.
export const PHOTO = [
  { id: "photo-grey",   colors: ["grey"],                 label: { es: "Fotocromático Grey",            en: "Photochromic Grey" },            price: { sv: 85,   bifocal: 110, prog: 90 } },
  { id: "photo-brown",  colors: ["brown"],                label: { es: "Fotocromático Brown",           en: "Photochromic Brown" },           price: { sv: null, bifocal: 110, prog: 90 } },
  { id: "trans-s-grey", colors: ["grey"],                 label: { es: "Transitions Gen S Grey",        en: "Transitions Gen S Grey" },       price: { sv: 105,  bifocal: 105, prog: 105 } },
  { id: "trans-s-brown",colors: ["brown"],                label: { es: "Transitions Gen S Brown",       en: "Transitions Gen S Brown" },      price: { sv: 105,  bifocal: 105, prog: 105 } },
  { id: "trans-s-green",colors: ["green"],                label: { es: "Transitions Gen S Graphite Green", en: "Transitions Gen S Graphite Green" }, price: { sv: 105, bifocal: 105, prog: 105 } },
  { id: "trans-x-grey", colors: ["grey"],                 label: { es: "Transitions Xtractive Grey",    en: "Transitions Xtractive Grey" },   price: { sv: 130,  bifocal: 130, prog: 130 } },
  { id: "trans-x-brown",colors: ["brown"],                label: { es: "Transitions Xtractive Brown (RAM)", en: "Transitions Xtractive Brown (RAM)" }, price: { sv: 130, bifocal: 130, prog: 130 } },
];

// Antirreflejos: 2 opciones (AR Green / AR Blue), iguales para todos los diseños.
// El precio real depende del material y sale de TREAT (matriz por diseño×material).
export const AR_OPTIONS = [
  { id: "ar-green", label: { es: "AR Green", en: "AR Green" }, price: 20 },
  { id: "ar-blue",  label: { es: "AR Blue",  en: "AR Blue" },  price: 35 },
];
export const AR = { sv: AR_OPTIONS, bifprog: AR_OPTIONS };

// Precio de tratamiento por (diseño × material) en USD — coincide con la lista
// RUBILENT (AR Green / AR Blue / Fotocromático). Respaldo de vista; el backend
// (lens_treatment_price) es la fuente de verdad para el cobro.
export const TREAT = {
  "sv": {
    "cr39": { "ar-green": 20, "ar-blue": 35, "photo": 42 },
    "poly": { "ar-green": 20, "ar-blue": 35, "photo": 46 },
    "1.67": { "ar-green": 35, "ar-blue": 42, "photo": 76 },
    "1.74": { "ar-green": 35, "ar-blue": 45, "photo": 80 },
  },
  "bifocal": {
    "cr39": { "ar-green": 36, "ar-blue": 72, "photo": 85 },
    "poly": { "ar-green": 36, "ar-blue": 72, "photo": 85 },
    "1.67": { "ar-green": 36, "ar-blue": 72, "photo": 85 },
    "1.74": { "ar-green": 36, "ar-blue": 72, "photo": 85 },
  },
  "prog-mid": {
    "cr39": { "ar-green": 36, "ar-blue": 72, "photo": 44 },
    "poly": { "ar-green": 36, "ar-blue": 72, "photo": 55 },
    "1.67": { "ar-green": 36, "ar-blue": 72, "photo": 68 },
    "1.74": { "ar-green": 36, "ar-blue": 72, "photo": 68 },
  },
  "prog-high": {
    "cr39": { "ar-green": 36, "ar-blue": 72, "photo": 45 },
    "poly": { "ar-green": 36, "ar-blue": 72, "photo": 45 },
    "1.67": { "ar-green": 36, "ar-blue": 72, "photo": 73 },
    "1.74": { "ar-green": 36, "ar-blue": 72, "photo": 73 },
  },
};

// Colores disponibles (para mostrar swatches).
export const PHOTO_COLORS = {
  grey:  { es: "Gris",  en: "Grey",  hex: "#5b6068" },
  brown: { es: "Marrón",en: "Brown", hex: "#6b4a2b" },
  green: { es: "Verde grafito", en: "Graphite green", hex: "#3f5b4a" },
};

// Helpers
export const designById = (id) => DESIGNS.find((d) => d.id === id) || null;
export const materialById = (id) => MATERIALS.find((m) => m.id === id) || null;
// categoría de AR para un diseño: sv -> "sv", bifocal/prog -> "bifprog"
export const arGroupFor = (design) => (design && design.cat === "sv" ? "sv" : "bifprog");
export const arListFor = (design) => AR[arGroupFor(design)] || [];
export const L = (obj, lang) => (obj ? (obj[lang] || obj.es || "") : "");
