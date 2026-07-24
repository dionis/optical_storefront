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
  { id: "1.56",  maxAbs: 3,  label: { es: "Índice 1.56",    en: "Index 1.56" },         desc: { es: "Más delgado que CR-39.",     en: "Thinner than CR-39." } },
  { id: "1.61",  maxAbs: 4,  label: { es: "Índice 1.61",    en: "Index 1.61" },         desc: { es: "Delgado.",                   en: "Thin." } },
  { id: "1.67",  maxAbs: 6,  label: { es: "Índice 1.67",    en: "Index 1.67" },         desc: { es: "Muy delgado.",               en: "Very thin." } },
  { id: "1.74",  maxAbs: 99, label: { es: "Índice 1.74",    en: "Index 1.74" },         desc: { es: "Ultra delgado. Alta graduación.", en: "Ultra-thin. High Rx." } },
];

// Matriz base: BASE[designId][materialId] = precio del lente (USD).
export const BASE = {
  "sv":        { cr39: 60,  poly: 90,  "1.56": 100, "1.61": 100, "1.67": 120, "1.74": 150 },
  "bifocal":   { cr39: 130, poly: 140, "1.56": 140, "1.61": 140, "1.67": 160, "1.74": 160 },
  "prog-mid":  { cr39: 180, poly: 180, "1.56": 180, "1.61": 180, "1.67": 200, "1.74": 230 },
  "prog-high": { cr39: 240, poly: 240, "1.56": 240, "1.61": 240, "1.67": 280, "1.74": 300 },
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

// Antirreflejos (adicional). Grupo por categoría: sv vs bifprog.
export const AR = {
  sv: [
    { id: "ar-green-basic",  label: { es: "AR Green Básico", en: "AR Green Basic" }, price: 60 },
    { id: "ar-green-plus",   label: { es: "AR Green Plus",   en: "AR Green Plus" },  price: 90 },
    { id: "ar-blue-protect", label: { es: "AR Blue Protect", en: "AR Blue Protect" },price: 90 },
  ],
  bifprog: [
    { id: "adequate",    label: { es: "Adequate",    en: "Adequate" },    price: 50 },
    { id: "crystal",     label: { es: "Crystal",     en: "Crystal" },     price: 80 },
    { id: "flawless",    label: { es: "Flawless",    en: "Flawless" },    price: 120 },
    { id: "blue-uv-445", label: { es: "Blue UV 445", en: "Blue UV 445" }, price: 120 },
  ],
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
