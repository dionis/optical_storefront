// Tarjeta de la montura en el punto de venta (PosFrameCard.jsx): etiquetas de la
// ficha técnica compacta que ve el vendedor al elegir y durante toda la venta.
// Los valores (forma, material, aro…) los traduce frameSpecLabels.js; aquí solo
// van los rótulos y los textos accesibles de la tarjeta.
//
// La familia `adm.pos.frame.detail.*` es de la FICHA completa (AdminFrameCard),
// el modal que abre el ojo del buscador. Son casi todos textos accesibles: al
// rediseñar la ficha, las medidas pasaron a icono + número y la marca a su
// logo, así que el rótulo que antes se leía en pantalla ahora vive en el
// `title`/`aria-label` — y por eso tiene que estar traducido igual que el resto.
export default {
  es: {
    "adm.pos.frame.card.selling": "Montura en venta",
    "adm.pos.frame.card.color": "Color",
    "adm.pos.frame.card.sku": "SKU",
    "adm.pos.frame.card.barcode": "Código de barras",
    "adm.pos.frame.card.size": "Medidas (ojo □ puente patilla, mm)",
    "adm.pos.frame.card.lensHeight": "Alto del lente",
    "adm.pos.frame.card.material": "Material",
    "adm.pos.frame.card.shape": "Forma",
    "adm.pos.frame.card.rim": "Aro",
    "adm.pos.frame.card.gender": "Género",
    "adm.pos.frame.card.age": "Edad",
    "adm.pos.frame.card.price": "Precio de la montura en esta tienda",
    "adm.pos.frame.card.noPrice": "Sin precio",
    "adm.pos.frame.card.noImage": "Sin foto",
    "adm.pos.frame.card.noSpecs": "Sin ficha técnica en el catálogo",
    "adm.pos.frame.card.remove": "Quitar montura",
    "adm.pos.frame.card.changeColor": "Cambiar color",
    "adm.pos.frame.card.photoOf": "Foto de {name}",
    "adm.pos.frame.detail.colors": "Colores disponibles",
    "adm.pos.frame.detail.colorPick": "Ver el color {name}",
    "adm.pos.frame.detail.colorNo": "Color {n}",
    "adm.pos.frame.detail.brandOf": "Marca {name}",
    "adm.pos.frame.detail.lensHeight": "Alto del lente",
    "adm.pos.frame.detail.measureOf": "{label}: {value} milímetros",
    "adm.pos.frame.detail.mm": "mm",
  },
  en: {
    "adm.pos.frame.card.selling": "Frame being sold",
    "adm.pos.frame.card.color": "Colour",
    "adm.pos.frame.card.sku": "SKU",
    "adm.pos.frame.card.barcode": "Barcode",
    "adm.pos.frame.card.size": "Size (eye □ bridge temple, mm)",
    "adm.pos.frame.card.lensHeight": "Lens height",
    "adm.pos.frame.card.material": "Material",
    "adm.pos.frame.card.shape": "Shape",
    "adm.pos.frame.card.rim": "Rim",
    "adm.pos.frame.card.gender": "Gender",
    "adm.pos.frame.card.age": "Age",
    "adm.pos.frame.card.price": "Frame price in this store",
    "adm.pos.frame.card.noPrice": "No price",
    "adm.pos.frame.card.noImage": "No photo",
    "adm.pos.frame.card.noSpecs": "No technical sheet in the catalog",
    "adm.pos.frame.card.remove": "Remove frame",
    "adm.pos.frame.card.changeColor": "Change colour",
    "adm.pos.frame.card.photoOf": "Photo of {name}",
    "adm.pos.frame.detail.colors": "Available colours",
    "adm.pos.frame.detail.colorPick": "Show the {name} colour",
    "adm.pos.frame.detail.colorNo": "Colour {n}",
    "adm.pos.frame.detail.brandOf": "{name} brand",
    "adm.pos.frame.detail.lensHeight": "Lens height",
    "adm.pos.frame.detail.measureOf": "{label}: {value} millimetres",
    "adm.pos.frame.detail.mm": "mm",
  },
};
