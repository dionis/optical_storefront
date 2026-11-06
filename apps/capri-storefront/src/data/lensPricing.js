// ─────────────────────────────────────────────────────────────
// Lista de precios profesional 2026 — RUBI LENS.
// Precio base del LENTE = matriz (diseño × material). Se suma al precio
// de la MONTURA (producto). Fotocromáticos/Transitions y antirreflejos
// son adicionales. Editable desde el board (overrides en priceStore).
// Etiquetas bilingües {es,en}. Precios en USD.
// ─────────────────────────────────────────────────────────────

// Diseños (filas). cat = categoría usada para fotocromáticos/AR.
export const DESIGNS = [
  { id: "sv",        cat: "sv",      rx: true,  add: false, label: { es: "Visión Sencilla",        en: "Single Vision" } },
  // Donde la lista decía "Bifocal FT-28" la tienda vende "Tallado" (tallado en
  // laboratorio) y "De stock" (lente terminado de inventario). Misma categoría
  // (fotocromáticos y AR se cobran igual); el precio lo fija el dueño por tienda.
  { id: "tallado",   cat: "bifocal", rx: true,  add: true,  label: { es: "Tallado",                en: "Surfaced" } },
  { id: "stock",     cat: "bifocal", rx: true,  add: true,  label: { es: "De stock",               en: "Stock" } },
  { id: "prog-mid",  cat: "prog",    rx: true,  add: true,  label: { es: "Progresivo Gama Media",  en: "Progressive · Mid" } },
  { id: "prog-high", cat: "prog",    rx: true,  add: true,  label: { es: "Progresivo Gama Alta",   en: "Progressive · Premium" } },
  // Progresivos digitales con nombre (mapa de potencias 2026). `tier` y `use` son
  // lo que el dueño usa para recomendarlos en el mostrador.
  { id: "purity-basic",  cat: "prog", rx: true, add: true, tier: "Básico",            use: { es: "Nuevos usuarios / uso diario",                 en: "New wearers / everyday use" },        label: { es: "Purity Basic",         en: "Purity Basic" } },
  { id: "purity-plus",   cat: "prog", rx: true, add: true, tier: "Intermedio",        use: { es: "Uso diario, más campo visual",                 en: "Everyday use, wider field" },         label: { es: "Purity Plus",          en: "Purity Plus" } },
  { id: "dvg-distinct",  cat: "prog", rx: true, add: true, tier: "Avanzado",          use: { es: "Uso general equilibrado",                      en: "Balanced general use" },              label: { es: "DVG Distinct",         en: "DVG Distinct" } },
  { id: "dvg-drive",     cat: "prog", rx: true, add: true, tier: "Avanzado",          use: { es: "Conducción frecuente",                         en: "Frequent driving" },                  label: { es: "DVG Drive",            en: "DVG Drive" } },
  { id: "purity-office", cat: "prog", rx: true, add: true, tier: "Premium",           use: { es: "Oficina y computadora",                        en: "Office and computer" },               label: { es: "Purity Office",        en: "Purity Office" } },
  { id: "dvg-cubicle",   cat: "prog", rx: true, add: true, tier: "Premium",           use: { es: "Oficina y computadora (campo cercano amplio)", en: "Office and computer (wide near field)" }, label: { es: "DVG Cubicle",      en: "DVG Cubicle" } },
  { id: "dvg-aqueous",   cat: "prog", rx: true, add: true, tier: "Premium superior",  use: { es: "Profesionales y ejecutivos",                   en: "Professionals and executives" },      label: { es: "DVG Aqueous",          en: "DVG Aqueous" } },
  { id: "dvg-maverick",  cat: "prog", rx: true, add: true, tier: "Premium superior",  use: { es: "Alto desempeño y viajeros",                    en: "High performance and travellers" },   label: { es: "DVG Maverick (Pilot)", en: "DVG Maverick (Pilot)" } },
  { id: "dvg-camber",    cat: "prog", rx: true, add: true, tier: "Elite",             use: { es: "Máxima tecnología",                            en: "Top technology" },                    label: { es: "DVG Camber",           en: "DVG Camber" } },
];

export const FRAME_ONLY = { id: "frame-only", rx: false, label: { es: "Solo montura", en: "Frame only" } };

// Materiales (columnas). maxAbs = graduación máx. recomendada.
export const MATERIALS = [
  { id: "cr39",  maxAbs: 2,  label: { es: "CR-39 (Resina)", en: "CR-39 (Resin)" },     desc: { es: "Estándar, económico.",       en: "Standard, budget." } },
  { id: "poly",  maxAbs: 3,  label: { es: "Policarbonato",  en: "Polycarbonate" },      desc: { es: "Resistente a impactos. Niños/deporte.", en: "Impact-resistant. Kids/sport." } },
  { id: "1.56",  maxAbs: 4,  label: { es: "Índice 1.56",    en: "Index 1.56" },         desc: { es: "Más delgado que la resina.", en: "Thinner than resin." } },
  { id: "1.61",  maxAbs: 5,  label: { es: "Índice 1.61",    en: "Index 1.61" },         desc: { es: "Delgado y ligero.",          en: "Thin and light." } },
  { id: "1.67",  maxAbs: 6,  label: { es: "Índice 1.67",    en: "Index 1.67" },         desc: { es: "Muy delgado.",               en: "Very thin." } },
  { id: "1.74",  maxAbs: 99, label: { es: "Índice 1.74",    en: "Index 1.74" },         desc: { es: "Ultra delgado. Alta graduación.", en: "Ultra-thin. High Rx." } },
];

// Matriz base: BASE[designId][materialId] = precio del lente (USD).
export const BASE = {
  "sv":        { cr39: 60,  poly: 90,  "1.56": 100, "1.61": 100, "1.67": 120, "1.74": 150 },
  "tallado":   { cr39: 130, poly: 140, "1.56": 140, "1.61": 140, "1.67": 160, "1.74": 160 },
  "stock":     { cr39: 130, poly: 140, "1.56": 140, "1.61": 140, "1.67": 160, "1.74": 160 },
  "prog-mid":  { cr39: 180, poly: 180, "1.56": 180, "1.61": 180, "1.67": 200, "1.74": 230 },
  "prog-high": { cr39: 240, poly: 240, "1.56": 240, "1.61": 240, "1.67": 280, "1.74": 300 },
  "purity-basic":  { cr39: 160, poly: 160, "1.56": 160, "1.61": 160, "1.67": 180, "1.74": 210 },
  "purity-plus":   { cr39: 180, poly: 180, "1.56": 180, "1.61": 180, "1.67": 200, "1.74": 230 },
  "dvg-distinct":  { cr39: 240, poly: 240, "1.56": 240, "1.61": 240, "1.67": 280, "1.74": 330 },
  "dvg-drive":     { cr39: 250, poly: 250, "1.56": 250, "1.61": 250, "1.67": 290, "1.74": 340 },
  "purity-office": { cr39: 200, poly: 200, "1.56": 200, "1.61": 200, "1.67": 240, "1.74": 290 },
  "dvg-cubicle":   { cr39: 210, poly: 210, "1.56": 210, "1.61": 210, "1.67": 250, "1.74": 300 },
  "dvg-aqueous":   { cr39: 260, poly: 260, "1.56": 260, "1.61": 260, "1.67": 300, "1.74": 350 },
  "dvg-maverick":  { cr39: 280, poly: 280, "1.56": 280, "1.61": 280, "1.67": 320, "1.74": 370 },
  "dvg-camber":    { cr39: 300, poly: 300, "1.56": 300, "1.61": 300, "1.67": 340, "1.74": 390 },
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

// Antirreflejos (lista 2026): un juego para visión sencilla y otro para
// bifocales y progresivos. Precio fijo por opción, ya no por material.
export const AR_SV = [
  { id: "ar-green-basic",  label: { es: "AR Green Básico", en: "AR Green Basic" },  price: 60 },
  { id: "ar-green-plus",   label: { es: "AR Green Plus",   en: "AR Green Plus" },   price: 90 },
  { id: "ar-blue-protect", label: { es: "AR Blue Protect", en: "AR Blue Protect" }, price: 90 },
];
export const AR_BIFPROG = [
  { id: "adequate",    label: { es: "Adequate",    en: "Adequate" },    price: 50 },
  { id: "crystal",     label: { es: "Crystal",     en: "Crystal" },     price: 80 },
  { id: "flawless",    label: { es: "Flawless",    en: "Flawless" },    price: 120 },
  { id: "blue-uv-445", label: { es: "Blue UV 445", en: "Blue UV 445" }, price: 120 },
];
/** Todas las opciones, para traducir un código guardado en una venta antigua o nueva. */
export const AR_OPTIONS = [...AR_SV, ...AR_BIFPROG];
export const AR = { sv: AR_SV, bifprog: AR_BIFPROG };

// La lista 2026 no cobra el tratamiento por (diseño × material): el antirreflejo
// tiene precio propio (AR) y el fotocromático por categoría (PHOTO). La migración
// UpgradeLensList2026Seed7 retira las celdas de `lens_treatment_price`, así que
// esta tabla queda vacía; se mantiene exportada porque lensCatalog.js la usa como
// respaldo cuando un backend viejo todavía envía su matriz.
export const TREAT = {};

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
