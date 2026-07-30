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
// `desc` = explicación breve y DIFERENCIADORA, pensada para alguien que no sabe
// de óptica: qué lo distingue y para quién conviene (no solo "delgado/muy delgado").
export const MATERIALS = [
  { id: "cr39",  maxAbs: 2,  label: { es: "CR-39 (Resina)", en: "CR-39 (Resin)" },
    desc: { es: "El más económico. Bien para graduaciones bajas; en graduaciones altas queda grueso.",
            en: "The cheapest. Fine for low prescriptions; gets thick on strong ones." } },
  { id: "poly",  maxAbs: 3,  label: { es: "Policarbonato",  en: "Polycarbonate" },
    desc: { es: "Casi irrompible y ligero, con protección UV. Ideal para niños, deporte y monturas al aire.",
            en: "Almost unbreakable, light, with UV protection. Best for kids, sport and rimless frames." } },
  { id: "1.56",  maxAbs: 3,  label: { es: "Índice 1.56",    en: "Index 1.56" },
    desc: { es: "Un paso más delgado y ligero que el estándar. Buen equilibrio precio/estética.",
            en: "A step thinner and lighter than standard. Good price/look balance." } },
  { id: "1.61",  maxAbs: 4,  label: { es: "Índice 1.61",    en: "Index 1.61" },
    desc: { es: "Delgado y estético para graduación media. El borde del lente se nota mucho menos.",
            en: "Thin and good-looking for medium Rx. The lens edge shows far less." } },
  { id: "1.67",  maxAbs: 6,  label: { es: "Índice 1.67",    en: "Index 1.67" },
    desc: { es: "Muy delgado, para graduaciones altas: evita el efecto 'fondo de botella'.",
            en: "Very thin, for strong prescriptions: avoids the thick 'coke-bottle' edge." } },
  { id: "1.74",  maxAbs: 99, label: { es: "Índice 1.74",    en: "Index 1.74" },
    desc: { es: "El más delgado que existe. Para graduaciones muy altas cuando quieres el lente más disimulado.",
            en: "The thinnest available. For very strong Rx when you want the most discreet lens." } },
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
// `desc` = qué aporta CADA capa y por qué elegirla (lenguaje sencillo).
export const AR = {
  sv: [
    { id: "ar-green-basic",  label: { es: "AR Green Básico", en: "AR Green Basic" }, price: 60,
      desc: { es: "Quita los reflejos molestos y verás más nítido, sobre todo de noche. La capa esencial.",
              en: "Removes annoying glare so you see sharper, especially at night. The essential coating." } },
    { id: "ar-green-plus",   label: { es: "AR Green Plus",   en: "AR Green Plus" },  price: 90,
      desc: { es: "Antirreflejo reforzado: además repele agua, grasa y polvo, se limpia fácil y dura más.",
              en: "Reinforced anti-glare: also repels water, grease and dust; easier to clean and lasts longer." } },
    { id: "ar-blue-protect", label: { es: "AR Blue Protect", en: "AR Blue Protect" },price: 90,
      desc: { es: "Filtra la luz azul de pantallas (celular, PC). Ideal si pasas muchas horas frente a dispositivos.",
              en: "Filters blue light from screens (phone, PC). Ideal if you spend hours on devices." } },
  ],
  bifprog: [
    { id: "adequate",    label: { es: "Adequate",    en: "Adequate" },    price: 50,
      desc: { es: "Antirreflejo básico: menos reflejos para ver más claro. Buena opción de entrada.",
              en: "Basic anti-glare: fewer reflections for clearer vision. A good entry option." } },
    { id: "crystal",     label: { es: "Crystal",     en: "Crystal" },     price: 80,
      desc: { es: "Antirreflejo que además repele agua y huellas: se ensucia menos y se limpia fácil.",
              en: "Anti-glare that also repels water and fingerprints: stays cleaner, wipes off easily." } },
    { id: "flawless",    label: { es: "Flawless",    en: "Flawless" },    price: 120,
      desc: { es: "El más completo: antirreflejo + antirrayado + repelente. Máxima transparencia y durabilidad.",
              en: "The most complete: anti-glare + scratch-resistant + repellent. Top clarity and durability." } },
    { id: "blue-uv-445", label: { es: "Blue UV 445", en: "Blue UV 445" }, price: 120,
      desc: { es: "Filtra luz azul de pantallas Y rayos UV del sol a la vez: protege por dentro y por fuera.",
              en: "Filters screen blue light AND the sun's UV at once: protects indoors and outdoors." } },
  ],
};

// Colores disponibles (para mostrar swatches). `note` = para qué sirve cada tono,
// porque el cliente online no sabe qué color elegir.
export const PHOTO_COLORS = {
  grey:  { es: "Gris",  en: "Grey",  hex: "#5b6068", note: { es: "tono neutral, el más popular", en: "neutral tint, most popular" } },
  brown: { es: "Marrón",en: "Brown", hex: "#6b4a2b", note: { es: "realza el contraste, ideal para días soleados", en: "boosts contrast, great on sunny days" } },
  green: { es: "Verde grafito", en: "Graphite green", hex: "#3f5b4a", note: { es: "reduce el deslumbramiento", en: "cuts glare" } },
};

// Helpers
export const designById = (id) => DESIGNS.find((d) => d.id === id) || null;
export const materialById = (id) => MATERIALS.find((m) => m.id === id) || null;
// categoría de AR para un diseño: sv -> "sv", bifocal/prog -> "bifprog"
export const arGroupFor = (design) => (design && design.cat === "sv" ? "sv" : "bifprog");
export const arListFor = (design) => AR[arGroupFor(design)] || [];
export const L = (obj, lang) => (obj ? (obj[lang] || obj.es || "") : "");
