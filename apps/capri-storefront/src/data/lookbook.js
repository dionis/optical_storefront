// LOOKBOOK — fotos de modelos (frames del video de Capri) subidas por Daniel.
// Están en /public/lookbook/. Cada foto se ETIQUETA con su MARCA y MODELO reales
// como referencia: rellena `brand` y `model` (aparecen como data-brand / data-model
// en el HTML, invisibles al usuario, y se pueden usar para enlazar a la compra).
// `gender` y `desc` ya vienen precargados como ayuda visual.
export const LOOKBOOK = [
  { id: 1,  src: "/lookbook/model-01.jpg", gender: "hombre", desc: "Redonda metálica al aire, transparente/plata", brand: "", model: "" },
  { id: 2,  src: "/lookbook/model-02.jpg", gender: "hombre", desc: "Redonda de pasta transparente", brand: "", model: "" },
  { id: 3,  src: "/lookbook/model-03.jpg", gender: "mujer",  desc: "Ojo de gato azul/metal", brand: "", model: "" },
  { id: 4,  src: "/lookbook/model-04.jpg", gender: "mujer",  desc: "Redonda metálica plata", brand: "", model: "" },
  { id: 5,  src: "/lookbook/model-05.jpg", gender: "mujer",  desc: "Ojo de gato rosa/transparente", brand: "", model: "" },
  { id: 6,  src: "/lookbook/model-06.jpg", gender: "hombre", desc: "Cuadrada negra de pasta", brand: "", model: "" },
  { id: 7,  src: "/lookbook/model-07.jpg", gender: "mujer",  desc: "Cuadrada azul oscuro de pasta", brand: "", model: "" },
  { id: 8,  src: "/lookbook/model-08.jpg", gender: "mujer",  desc: "Aviador transparente", brand: "", model: "" },
  { id: 9,  src: "/lookbook/model-09.jpg", gender: "mujer",  desc: "Ojo de gato burdeos", brand: "", model: "" },
  { id: 10, src: "/lookbook/model-10.jpg", gender: "mujer",  desc: "Ojo de gato oscura (tweed)", brand: "", model: "" },
  { id: 11, src: "/lookbook/model-11.jpg", gender: "hombre", desc: "Aviador dorada de metal", brand: "", model: "" },
  { id: 12, src: "/lookbook/model-12.jpg", gender: "mujer",  desc: "Gafas de sol redondas negras", brand: "", model: "" },
  { id: 13, src: "/lookbook/model-13.jpg", gender: "hombre", desc: "Cuadrada negra con interior rojo", brand: "", model: "" },
  { id: 14, src: "/lookbook/model-14.jpg", gender: "mujer",  desc: "Redonda roja/dorada de metal", brand: "", model: "" },
  { id: 15, src: "/lookbook/model-15.jpg", gender: "hombre", desc: "Cuadrada negra de pasta (blazer)", brand: "", model: "" },
  { id: 16, src: "/lookbook/model-16.jpg", gender: "pareja", desc: "Montura fina dorada (pareja)", brand: "", model: "" },
];

export const LOOKBOOK_BY_ID = Object.fromEntries(LOOKBOOK.map((m) => [m.id, m]));

// Devuelve la etiqueta de referencia (marca · modelo) o la descripción si aún no se rellenó.
export function lookbookTag(id) {
  const m = LOOKBOOK_BY_ID[id];
  if (!m) return "";
  const bm = [m.brand, m.model].filter(Boolean).join(" ");
  return bm || m.desc;
}
