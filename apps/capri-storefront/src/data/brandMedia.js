// Imágenes de modelo/estilo por marca (del propio sitio caprioptics), para el hero
// profesional de cada página de marca (/marca/:slug). Clave = brand slug.
const IMG = "https://caprioptics.com/wp-content/uploads/";

// Foto oficial de cada marca en caprioptics.com (misma imagen que usa Capri en su menú
// de marcas). Cada marca tiene su propia imagen, por lo que no se repiten entre marcas.
// Las marcas con foto propia (subida por Daniel, etiquetada por marca) usan /lookbook/brands/…;
// el resto conserva la imagen oficial de caprioptics.
// Recortadas al modelo izquierdo, mejoradas y en WebP (carga rápida). Eyeleos usa el
// modelo derecho de la foto de Millennial (Capri no tenía una imagen buena de Eyeleos).
const LB = "/lookbook/brands/";
export const BRAND_MEDIA = {
  "di-caprio": LB + "brand-di-caprio.webp",
  "candy-shoppe": LB + "brand-candy-shoppe.webp",
  "simply-lite": LB + "brand-simply-lite.webp",
  "grande": LB + "brand-grande.webp",
  "flexure": LB + "brand-flexure.webp",
  "millennial": LB + "brand-millennial.webp",
  "trendy": LB + "brand-trendy.webp",
  "peachtree": LB + "brand-peachtree.webp",
  "4u": LB + "brand-4u.webp",
  "eyeleos": LB + "brand-eyeleos.webp",
  "versailles-palace": IMG + "VPM.jpg",
  "artistik-galerie": IMG + "artistik-galerie-menu-img.png",
  "slimfold": IMG + "sfm.jpg",
  "ago": IMG + "ago-menu-img.png",
  "artistik-eyewear": IMG + "artistik-eyewear-menu-img.png",
  "case": IMG + "cases.jpg",
  "prorx": IMG + "prorx-menu-img.png",
};

// Imagen de respaldo cuando una marca no tiene foto de modelo propia.
export const BRAND_MEDIA_DEFAULT = IMG + "brand-menu-default.png";

export function brandHeroImage(slug) {
  return BRAND_MEDIA[slug] || BRAND_MEDIA_DEFAULT;
}

// Descripción por marca (ES/EN) para el panel dinámico de la sección Marcas.
export const BRAND_INFO = {
  "versailles-palace": { title: "Palacio de Versalles", es: "Colección de metal con escalones, de diseño clásico y estilo atemporal.", en: "Metal collection with a stepped design — classic and timeless." },
  "di-caprio": { title: "Di Caprio", es: "Elegancia en acetato con acabados premium para un look sofisticado.", en: "Acetate elegance with premium finishes for a sophisticated look." },
  "candy-shoppe": { title: "The Candy Shoppe", es: "Monturas coloridas y divertidas que le dan personalidad a tu mirada.", en: "Colorful, fun frames that give your look personality." },
  "trendy": { title: "Trendy", es: "Estilos a la moda, atrevidos y llenos de actitud.", en: "On-trend styles, bold and full of attitude." },
  "peachtree": { title: "Peachtree", es: "Diseños versátiles y cómodos, perfectos para el día a día.", en: "Versatile, comfortable designs — perfect for every day." },
  "grande": { title: "Grande", es: "Monturas de mayor tamaño, con presencia y carácter.", en: "Larger frames with presence and character." },
  "4u": { title: "Four You", es: "Para toda la familia: ligeras, resistentes y con estilo.", en: "For the whole family: light, durable and stylish." },
  "flexure": { title: "Flexure", es: "Titanio con memoria: flexibles, ultraligeras e irrompibles.", en: "Memory titanium: flexible, ultralight and unbreakable." },
  "slimfold": { title: "Slimfold", es: "Monturas plegables y compactas, listas para llevar contigo.", en: "Foldable, compact frames ready to take anywhere." },
  "simply-lite": { title: "Simplylite", es: "Monturas ultraligeras pensadas para la máxima comodidad.", en: "Ultralight frames built for maximum comfort." },
  "artistik-galerie": { title: "Artistik Galerie", es: "Diseño artístico y detalles únicos que marcan tendencia.", en: "Artistic design and unique details that set trends." },
  "artistik-eyewear": { title: "Artistik Eyewear", es: "Vanguardia y creatividad en cada montura.", en: "Avant-garde and creativity in every frame." },
  "eyeleos": { title: "Eyeleos", es: "Estilo contemporáneo con líneas limpias y modernas.", en: "Contemporary style with clean, modern lines." },
  "ago": { title: "Ago", es: "Diseño con raíces africanas, colorido y expresivo.", en: "African-rooted design, colorful and expressive." },
  "prorx": { title: "ProRx", es: "Monturas técnicas, pensadas para lentes graduados.", en: "Technical frames designed for prescription lenses." },
  "case": { title: "Estuches", es: "Protege tus espejuelos con estilo.", en: "Protect your eyewear in style." },
};

export function brandInfo(slug, lang, fallbackName) {
  const b = BRAND_INFO[slug];
  if (b) return { title: b.title, desc: lang === "en" ? b.en : b.es };
  return {
    title: fallbackName || "Colección",
    desc: lang === "en" ? "Discover this collection of designer eyewear." : "Descubre esta colección de espejuelos de marca.",
  };
}
