// ─────────────────────────────────────────────────────────────
// Contenido educativo bilingüe para el configurador de lentes.
// El vendedor virtual explica cada MATERIAL de lente, cada TRATAMIENTO y el
// MATERIAL DE LA MONTURA con el mismo criterio: para qué sirve, para qué NO y
// una nota comercial de precio. Todo {es,en}; el componente resuelve con L().
//
// Los TÍTULOS salen del catálogo (label bilingüe de cada opción); aquí sólo vive
// el cuerpo educativo. El mapeo material-id → bloque usa la copia comercial más
// cercana provista por el negocio (no toca precios ni el flujo Medusa).
// ─────────────────────────────────────────────────────────────

// Material del LENTE. Clave = id del material del catálogo (cr39, poly, 1.56, …).
export const MATERIAL_EDU = {
  cr39: {
    es: {
      good: "El más económico y común; ideal para graduaciones bajas y uso diario, y para quienes buscan la mejor óptica al menor costo.",
      bad: "No recomendado para graduaciones altas (se ve grueso) ni para deportes o niños por su menor resistencia a impactos.",
      price: "La opción de entrada, la más barata del mostrador.",
    },
    en: {
      good: "The cheapest and most common; ideal for low prescriptions and everyday wear, and for those wanting the best optics at the lowest price.",
      bad: "Not recommended for high prescriptions (looks thick) or for sports and kids due to lower impact resistance.",
      price: "The entry-level option, the most affordable at the counter.",
    },
  },
  poly: {
    es: {
      good: "Ligero y muy resistente a impactos; ideal para niños, deportes, lentes de seguridad y armazones al aire (sin marco). Incluye protección UV.",
      bad: "No es la opción más nítida en los bordes; menos recomendado si buscas la máxima calidad óptica en graduaciones muy altas.",
      price: "Precio medio-bajo, gran relación seguridad-costo.",
    },
    en: {
      good: "Lightweight and highly impact-resistant; ideal for kids, sports, safety glasses and rimless frames. Includes UV protection.",
      bad: "Not the sharpest at the edges; less recommended if you want top optical quality in very high prescriptions.",
      price: "Low-to-mid price, great safety-to-cost value.",
    },
  },
  "1.56": {
    es: {
      good: "Tan resistente como el policarbonato pero con mejor nitidez óptica y más ligero; ideal para armazones al aire y quien quiere seguridad sin sacrificar visión.",
      bad: "No adelgaza tanto como los índices altos en graduaciones fuertes; poco justificado si tu graduación es muy baja.",
      price: "Precio medio, un escalón por encima del policarbonato.",
    },
    en: {
      good: "As tough as polycarbonate but with sharper optics and lighter weight; ideal for rimless frames and anyone wanting safety without sacrificing clarity.",
      bad: "Doesn't thin down as much as high-index lenses in strong prescriptions; hard to justify if your prescription is very low.",
      price: "Mid-range price, a step above polycarbonate.",
    },
  },
  "1.61": {
    es: {
      good: "Más delgado y estético que el plástico estándar; ideal para graduaciones medias que quieren un lente más fino y ligero.",
      bad: "No es necesario para graduaciones bajas; menos resistente a impactos que el policarbonato para deporte.",
      price: "Precio medio; el primer paso hacia lentes delgados.",
    },
    en: {
      good: "Thinner and more attractive than standard plastic; ideal for medium prescriptions wanting a slimmer, lighter lens.",
      bad: "Overkill for low prescriptions; less impact-resistant than polycarbonate for sports.",
      price: "Mid price; the first step toward thin lenses.",
    },
  },
  "1.67": {
    es: {
      good: "Notablemente delgado y estético; ideal para graduaciones altas que quieren evitar el efecto 'fondo de botella'.",
      bad: "No se justifica en graduaciones bajas o medias por su costo; puede requerir antirreflejante para máximo rendimiento.",
      price: "Precio alto, para quien prioriza estética en graduación fuerte.",
    },
    en: {
      good: "Noticeably thin and flattering; ideal for high prescriptions wanting to avoid the 'coke-bottle' look.",
      bad: "Not worth it for low or medium prescriptions given the cost; benefits from anti-reflective coating for best performance.",
      price: "High price, for those prioritizing looks in a strong prescription.",
    },
  },
  "1.74": {
    es: {
      good: "El más delgado disponible; ideal para graduaciones muy altas donde se busca el lente más fino y estético posible.",
      bad: "No recomendado para graduaciones bajas o medias; es el más caro y no aporta ventaja si no tienes graduación fuerte.",
      price: "El precio más alto de la gama; premium para máxima graduación.",
    },
    en: {
      good: "The thinnest available; ideal for very high prescriptions seeking the slimmest, most cosmetic lens possible.",
      bad: "Not recommended for low or medium prescriptions; it's the priciest and adds no benefit without a strong prescription.",
      price: "The top of the price range; premium for maximum prescriptions.",
    },
  },
};

// Fotocromático / Transitions — un solo bloque (aplica a todas las variantes).
export const PHOTO_EDU = {
  es: {
    good: "Se oscurece al sol y se aclara en interiores; ideal para quien quiere lente y gafa de sol en uno solo y entra y sale del exterior.",
    bad: "No oscurece bien dentro del auto (el parabrisas bloquea el UV) y tarda en cambiar; no sustituye a un buen lente de sol para manejar.",
    price: "Precio alto; cómodo pero es una inversión.",
  },
  en: {
    good: "Darkens in sun and clears indoors; ideal for those wanting glasses and sunglasses in one, moving in and out often.",
    bad: "Doesn't darken well inside the car (windshield blocks UV) and takes time to shift; no substitute for real sunglasses when driving.",
    price: "High price; convenient but an investment.",
  },
};

// Antirreflejo / coatings. Clave = id de la opción AR del catálogo.
const AR_STANDARD = {
  es: {
    good: "Reduce reflejos y mejora la visión y estética; ideal para uso diario y conducción, casi indispensable en lentes de alto índice.",
    bad: "El básico se ensucia y raya más fácil; no ideal para quien maltrata mucho sus lentes o busca máxima durabilidad.",
    price: "Extra económico, la mejora con mejor costo-beneficio.",
  },
  en: {
    good: "Cuts glare and improves vision and looks; ideal for daily use and driving, nearly a must on high-index lenses.",
    bad: "The basic version smudges and scratches more easily; not ideal for rough handling or maximum durability.",
    price: "Low-cost add-on, the best value upgrade.",
  },
};
const AR_BLUE = {
  es: {
    good: "Filtra parte de la luz azul de pantallas; ideal para quien pasa muchas horas frente a computadora o celular y siente fatiga visual.",
    bad: "El beneficio es modesto y debatido; no imprescindible si casi no usas pantallas.",
    price: "Precio medio, un poco más que el AR estándar.",
  },
  en: {
    good: "Filters some screen blue light; ideal for heavy computer or phone users who feel eye strain.",
    bad: "The benefit is modest and debated; not essential if you rarely use screens.",
    price: "Mid price, slightly above standard AR.",
  },
};
const AR_PREMIUM = {
  es: {
    good: "Máxima resistencia a rayaduras, repele agua, polvo y huellas; ideal para quien quiere lentes que luzcan bien y duren más.",
    bad: "No aporta ventaja óptica extra sobre el estándar; puede ser gasto innecesario en presupuestos muy ajustados.",
    price: "El AR más caro; vale la pena por durabilidad y limpieza.",
  },
  en: {
    good: "Top scratch resistance, repels water, dust and fingerprints; ideal for those wanting lenses that look good and last longer.",
    bad: "No extra optical advantage over standard; may be an unnecessary expense on a tight budget.",
    price: "The priciest AR; worth it for durability and easy cleaning.",
  },
};

export const AR_EDU = {
  "ar-green-basic": AR_STANDARD,
  adequate: AR_STANDARD,
  "ar-green-plus": AR_PREMIUM,
  crystal: AR_PREMIUM,
  flawless: AR_PREMIUM,
  "ar-blue-protect": AR_BLUE,
  "blue-uv-445": AR_BLUE,
};

// Material de la MONTURA (armazón). Clave normalizada del nombre comercial.
export const FRAME_MATERIAL_EDU = {
  acetato: {
    es: {
      quality: "Plástico de algodón premium, más rico y sólido que el plástico común. Colores profundos y acabado con cuerpo que envejece con elegancia.",
      good: "Quien busca color, texturas y monturas de aspecto grueso; pieles cálidas y estilos con personalidad.",
      bad: "Quien quiere lo más ligero posible o una montura casi invisible al rostro.",
    },
    en: {
      quality: "Premium cotton-based plastic, richer and sturdier than standard plastic. Deep colors and a substantial finish that ages gracefully.",
      good: "Anyone after color, texture and bold frames; warm skin tones and looks with character.",
      bad: "Anyone wanting the absolute lightest or a nearly invisible frame.",
    },
  },
  metal: {
    es: {
      quality: "Clásico y versátil, de perfil fino y elegante. Buen equilibrio entre resistencia y estilo atemporal a precio accesible.",
      good: "Looks discretos y profesionales; quien prefiere monturas delgadas y ligeras.",
      bad: "Pieles muy sensibles al níquel o uso rudo que doble las varillas finas.",
    },
    en: {
      quality: "Classic and versatile, with a slim, elegant profile. A solid balance of durability and timeless style at an accessible price.",
      good: "Understated, professional looks; anyone who prefers thin, lightweight frames.",
      bad: "Skin that reacts to nickel, or rough use that can bend the thin temples.",
    },
  },
  tr90: {
    es: {
      quality: "Polímero termoplástico ultraligero y flexible que recupera su forma. Prácticamente irrompible en uso diario.",
      good: "Deporte, niños y vida activa; quien busca comodidad y olvidar que trae lentes.",
      bad: "Quien prefiere el brillo y el cuerpo del acetato o acabados muy premium a la vista.",
    },
    en: {
      quality: "Ultralight, flexible thermoplastic that springs back to shape. Practically unbreakable in everyday use.",
      good: "Sport, kids and active lifestyles; anyone chasing comfort and forget-you're-wearing-them fit.",
      bad: "Anyone who prefers the gloss and body of acetate or a very premium visual finish.",
    },
  },
  titanio: {
    es: {
      quality: "La joya de las monturas: increíblemente ligero, resistente a la corrosión e hipoalergénico. Premium de verdad.",
      good: "Uso diario exigente, pieles sensibles y quien quiere lo mejor sin peso.",
      bad: "Presupuestos ajustados o quien busca colores llamativos y monturas gruesas.",
    },
    en: {
      quality: "The crown jewel of frames: remarkably light, corrosion-resistant and hypoallergenic. Genuinely premium.",
      good: "Demanding daily wear, sensitive skin and anyone wanting the best without the weight.",
      bad: "Tight budgets, or anyone after bold colors and chunky frames.",
    },
  },
  acero_inoxidable: {
    es: {
      quality: "Resistente y duradero, con buena flexibilidad y perfil fino. Aguanta el trote diario mejor que el metal común.",
      good: "Quien quiere durabilidad a buen precio y un estilo limpio y moderno.",
      bad: "Quien busca el mínimo peso absoluto del titanio o monturas voluminosas.",
    },
    en: {
      quality: "Tough and durable, with good flex and a slim profile. Handles daily wear better than standard metal.",
      good: "Anyone wanting durability at a fair price and a clean, modern look.",
      bad: "Anyone chasing titanium's absolute minimum weight or chunky frames.",
    },
  },
  aluminio: {
    es: {
      quality: "Metal ligero con acabado moderno y tecnológico. Resistente a la corrosión y con carácter distintivo.",
      good: "Estilos contemporáneos y minimalistas; quien quiere algo diferente y liviano.",
      bad: "Ajustes muy frecuentes, ya que es menos flexible que otros metales.",
    },
    en: {
      quality: "Lightweight metal with a modern, tech-forward finish. Corrosion-resistant and distinctive.",
      good: "Contemporary, minimalist styles; anyone wanting something different and light.",
      bad: "Frequent readjustments, since it flexes less than other metals.",
    },
  },
  inyectado_plastico: {
    es: {
      quality: "Plástico moldeado económico y ligero, ideal para colores y formas atrevidas a bajo costo. Honestamente, es de entrada de gama.",
      good: "Segundo par, tendencias pasajeras y presupuestos ajustados sin sacrificar estilo.",
      bad: "Quien busca durabilidad a largo plazo o el acabado noble del acetato.",
    },
    en: {
      quality: "Affordable, lightweight molded plastic, great for bold colors and shapes on a budget. Honestly, it's entry-level.",
      good: "A second pair, trend pieces and tight budgets without giving up style.",
      bad: "Anyone after long-term durability or the refined finish of acetate.",
    },
  },
};

// Normaliza un nombre de material de montura (ES, tal como viene del catálogo)
// a la clave de FRAME_MATERIAL_EDU. Devuelve null si no hay copia disponible.
export function frameMaterialKey(name) {
  const s = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (!s) return null;
  if (s.includes("acetato")) return "acetato";
  if (s.includes("titanio") || s.includes("titanium")) return "titanio";
  if (s.includes("acero") || s.includes("stainless")) return "acero_inoxidable";
  if (s.includes("aluminio") || s.includes("aluminum")) return "aluminio";
  if (s.includes("tr90") || s.includes("tr-90") || s.includes("tr 90")) return "tr90";
  if (s.includes("plastic") || s.includes("plastica") || s.includes("inyect") || s.includes("nylon")) return "inyectado_plastico";
  if (s.includes("metal")) return "metal";
  return null;
}

// Devuelve el bloque educativo {good,bad,price/quality} en el idioma dado, o null.
export const materialEdu = (id, lang) => (MATERIAL_EDU[id] ? MATERIAL_EDU[id][lang] || MATERIAL_EDU[id].es : null);
export const arEdu = (id, lang) => (AR_EDU[id] ? AR_EDU[id][lang] || AR_EDU[id].es : null);
export const photoEdu = (lang) => PHOTO_EDU[lang] || PHOTO_EDU.es;
export function frameMatEdu(name, lang) {
  const k = frameMaterialKey(name);
  if (!k) return null;
  const b = FRAME_MATERIAL_EDU[k];
  return b ? b[lang] || b.es : null;
}
