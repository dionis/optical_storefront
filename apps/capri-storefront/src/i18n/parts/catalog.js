// Diccionario de «Productos» (admin/CatalogManager.jsx + admin/BrandAccordion.jsx),
// la pantalla del grupo Comercial donde el dueño ve el catálogo agrupado en un
// acordeón por marca: cabecera que ya lo resume todo cerrada (logo, modelos,
// colores, rango de precio, costo medio y margen medio) y, dentro, una fila por
// modelo con SKU, colores, medidas, costo de proveedor, precio de venta y el
// interruptor de surtido.
//
// Español primero, inglés con las MISMAS claves (scripts/check-i18n.mjs falla si
// una existe en un idioma y no en el otro).

const es = {
  "adm.cm.title": "Catálogo por marca",
  "adm.cm.intro":
    "Cada marca es un acordeón que ya se lee cerrado: modelos, colores, precio y margen. Dentro, una fila por modelo con su costo, su precio y si se vende en la tienda elegida.",

  // ── Alcance (el selector de tienda de la barra de arriba) ──
  "adm.cm.scope.all": "Todas las tiendas · maestro",
  "adm.cm.scope.store": "Tienda {store}",
  "adm.cm.scope.needStore":
    "Los interruptores actúan sobre UNA tienda. Elige una arriba para habilitar o deshabilitar marcas y modelos en ella; «Descontinuar» sí afecta a todas.",

  // ── Buscador ──
  "adm.cm.search": "Buscar modelo, SKU o marca…",
  "adm.cm.noMatch": "Ningún modelo con ese texto.",
  "adm.cm.clearSearch": "Limpiar la búsqueda",

  // ── Cabecera de la marca (resumen cerrado) ──
  "adm.cm.logoAlt": "Logo de {name}",
  "adm.cm.b.models": "modelos",
  "adm.cm.b.colors": "colores",
  "adm.cm.b.price": "precio",
  "adm.cm.b.cost": "costo medio",
  "adm.cm.b.margin": "margen medio",
  "adm.cm.b.off": "descatalogados",
  "adm.cm.b.hidden": "oculta en {store}",
  "adm.cm.b.range": "{min} – {max}",

  // ── Columnas de la fila de modelo ──
  "adm.cm.col.sku": "SKU",
  "adm.cm.col.colors": "Colores",
  "adm.cm.col.size": "Medidas",
  "adm.cm.col.cost": "Costo prov.",
  "adm.cm.col.price": "Precio venta",
  "adm.cm.col.own": "Precio propio",
  "adm.cm.col.sale": "A la venta",

  "adm.cm.none": "—",
  "adm.cm.colorsMore": "+{n}",
  "adm.cm.colorList": "Colores de {name}: {list}",
  "adm.cm.sizeHint": "Calibre □ puente varilla, en milímetros",
  "adm.cm.costHint": "Lo que cuesta la montura al proveedor (lista de Capri Optics).",
  "adm.cm.rulePrice": "Precio por la regla de precios",
  "adm.cm.ownBadge": "Propio",
  "adm.cm.ownHint": "Este modelo tiene precio propio: la regla no le aplica.",
  "adm.cm.ownPlaceholder": "Propio",
  "adm.cm.ownAria": "Precio propio de {name} en dólares",
  "adm.cm.savePrice": "Guardar el precio propio de {name}",
  "adm.cm.clearPrice": "Devolver {name} a la regla de precios",
  "adm.cm.priceSaved": "{name}: precio propio {price}.",
  "adm.cm.priceCleared": "{name} vuelve a la regla de precios.",
  "adm.cm.rule": "Regla: {rule}",
  "adm.cm.rulePercent": "{v} % sobre el base",
  "adm.cm.ruleDelta": "{v} sobre el base",
  "adm.cm.ruleNone": "sin regla",

  // ── Interruptor de surtido (expone o oculta en UNA tienda) ──
  "adm.cm.swBrand": "Vender la marca {name} en {store}",
  "adm.cm.swModel": "Vender {name} en {store}",
  "adm.cm.swNoStore": "Elige una tienda arriba para usar este interruptor",
  "adm.cm.swNoId": "Este modelo aún no está enlazado con el catálogo del servidor",
  "adm.cm.swInherit": "Hereda de la marca",
  "adm.cm.brandShown": "{name} vuelve a venderse en {store}.",
  "adm.cm.brandHidden": "{name} queda oculta en {store}.",
  "adm.cm.modelShown": "{name} vuelve a venderse en {store}.",
  "adm.cm.modelHidden": "{name} queda oculto en {store}.",
  "adm.cm.swFailed": "No se pudo cambiar el surtido.",
  "adm.cm.assortFailed": "No se pudo leer el surtido de la tienda.",

  // ── Estuches ──
  "adm.cm.cases": "Estuches",
  "adm.cm.casesSub": "El mismo trato que las monturas, sin medidas ni costo de proveedor.",

  // ── Descontinuar (saca el modelo del catálogo entero) ──
  "adm.cm.discontinue": "Descontinuar {name} del catálogo",
  "adm.cm.diffTitle": "Ocultar en una tienda no es descontinuar",

  // ── Ayuda contextual (HelpTip topic="catalog.assortVsOff") ──
  "adm.help.catalog.assortVsOff.title": "Ocultar en una tienda vs. descontinuar",
  "adm.help.catalog.assortVsOff.short":
    "El interruptor oculta el modelo en UNA tienda. «Descontinuar» lo saca del catálogo entero, en todas.",
  "adm.help.catalog.assortVsOff.what":
    "Son dos cosas distintas que se confunden con facilidad. El interruptor de cada marca y de cada modelo es el SURTIDO de la tienda elegida arriba: decide qué puede vender ese mostrador, y nada más. «Descontinuar» cambia el producto en el catálogo: desaparece de la tienda en línea y de todos los mostradores a la vez.",
  "adm.help.catalog.assortVsOff.how":
    "Elige arriba la tienda sobre la que quieres decidir.\nApaga el interruptor de una marca para que esa tienda no venda ninguno de sus modelos; apaga el de un modelo para quitar solo ese.\nUn modelo manda sobre su marca: si apagas la marca y enciendes un modelo, ese modelo se vende.\nUsa «Descontinuar» solo cuando el modelo deja de existir para el negocio.",
  "adm.help.catalog.assortVsOff.why":
    "Una tienda pequeña no expone las ocho marcas, y una marca apagada también tapa los modelos que el sincronizador añada mañana (la regla se guarda por marca, no modelo a modelo). Descontinuar, en cambio, conserva el historial de ventas pero quita el modelo de todas partes: es la decisión grande.",
  "adm.help.catalog.assortVsOff.example":
    "Trendy es infantil y en el local del centro no se vende: apaga Trendy con la tienda del centro elegida. El modelo DC241 se rompió y el proveedor no lo repone: descontinúalo.",
  "adm.help.catalog.assortVsOff.pitfalls":
    "Con «Todas las tiendas» arriba los interruptores están apagados a propósito: no hay un surtido maestro, y escribir en todas de golpe no se puede deshacer.\nDescontinuar no se nota en los interruptores: el modelo simplemente deja de aparecer en la lista de la marca.",
};

const en = {
  "adm.cm.title": "Catalog by brand",
  "adm.cm.intro":
    "Each brand is an accordion that already reads closed: models, colours, price and margin. Inside, one row per model with its cost, its price and whether the chosen store sells it.",

  "adm.cm.scope.all": "All stores · master",
  "adm.cm.scope.store": "Store {store}",
  "adm.cm.scope.needStore":
    "The switches act on ONE store. Pick one above to show or hide brands and models in it; “Discontinue” does affect them all.",

  "adm.cm.search": "Search model, SKU or brand…",
  "adm.cm.noMatch": "No model matches that text.",
  "adm.cm.clearSearch": "Clear the search",

  "adm.cm.logoAlt": "{name} logo",
  "adm.cm.b.models": "models",
  "adm.cm.b.colors": "colours",
  "adm.cm.b.price": "price",
  "adm.cm.b.cost": "avg. cost",
  "adm.cm.b.margin": "avg. margin",
  "adm.cm.b.off": "discontinued",
  "adm.cm.b.hidden": "hidden in {store}",
  "adm.cm.b.range": "{min} – {max}",

  "adm.cm.col.sku": "SKU",
  "adm.cm.col.colors": "Colours",
  "adm.cm.col.size": "Size",
  "adm.cm.col.cost": "Supplier cost",
  "adm.cm.col.price": "Sale price",
  "adm.cm.col.own": "Own price",
  "adm.cm.col.sale": "On sale",

  "adm.cm.none": "—",
  "adm.cm.colorsMore": "+{n}",
  "adm.cm.colorList": "{name} colours: {list}",
  "adm.cm.sizeHint": "Eye □ bridge temple, in millimetres",
  "adm.cm.costHint": "What the frame costs you from the supplier (Capri Optics list).",
  "adm.cm.rulePrice": "Price from the pricing rule",
  "adm.cm.ownBadge": "Own",
  "adm.cm.ownHint": "This model has its own price: the rule does not apply to it.",
  "adm.cm.ownPlaceholder": "Own",
  "adm.cm.ownAria": "Own price for {name} in dollars",
  "adm.cm.savePrice": "Save the own price for {name}",
  "adm.cm.clearPrice": "Send {name} back to the pricing rule",
  "adm.cm.priceSaved": "{name}: own price {price}.",
  "adm.cm.priceCleared": "{name} is back on the pricing rule.",
  "adm.cm.rule": "Rule: {rule}",
  "adm.cm.rulePercent": "{v} % on the base",
  "adm.cm.ruleDelta": "{v} on the base",
  "adm.cm.ruleNone": "no rule",

  "adm.cm.swBrand": "Sell brand {name} in {store}",
  "adm.cm.swModel": "Sell {name} in {store}",
  "adm.cm.swNoStore": "Pick a store above to use this switch",
  "adm.cm.swNoId": "This model is not linked to the server catalog yet",
  "adm.cm.swInherit": "Inherits from the brand",
  "adm.cm.brandShown": "{name} is sold again in {store}.",
  "adm.cm.brandHidden": "{name} is now hidden in {store}.",
  "adm.cm.modelShown": "{name} is sold again in {store}.",
  "adm.cm.modelHidden": "{name} is now hidden in {store}.",
  "adm.cm.swFailed": "The assortment could not be changed.",
  "adm.cm.assortFailed": "The store assortment could not be read.",

  "adm.cm.cases": "Cases",
  "adm.cm.casesSub": "Same treatment as frames, without measurements or supplier cost.",

  "adm.cm.discontinue": "Discontinue {name} from the catalog",
  "adm.cm.diffTitle": "Hiding in one store is not discontinuing",

  "adm.help.catalog.assortVsOff.title": "Hiding in one store vs. discontinuing",
  "adm.help.catalog.assortVsOff.short":
    "The switch hides the model in ONE store. “Discontinue” removes it from the whole catalog, everywhere.",
  "adm.help.catalog.assortVsOff.what":
    "They are two different things that are easy to mix up. The switch on each brand and each model is the ASSORTMENT of the store chosen above: it decides what that counter may sell, nothing else. “Discontinue” changes the product in the catalog: it disappears from the online store and from every counter at once.",
  "adm.help.catalog.assortVsOff.how":
    "Pick above the store you want to decide about.\nTurn a brand's switch off so that store sells none of its models; turn a model's switch off to remove just that one.\nA model wins over its brand: turn the brand off and one model on, and that model is sold.\nUse “Discontinue” only when the model stops existing for the business.",
  "adm.help.catalog.assortVsOff.why":
    "A small store does not carry all eight brands, and a brand turned off also covers the models the sync adds tomorrow (the rule is stored per brand, not model by model). Discontinuing, instead, keeps the sales history but removes the model everywhere: it is the big decision.",
  "adm.help.catalog.assortVsOff.example":
    "Trendy is for kids and the downtown shop does not sell it: turn Trendy off with the downtown store selected. Model DC241 broke and the supplier will not restock it: discontinue it.",
  "adm.help.catalog.assortVsOff.pitfalls":
    "With “All stores” above the switches are off on purpose: there is no master assortment, and writing to every store at once cannot be undone.\nDiscontinuing does not show up on the switches: the model simply stops appearing in its brand's list.",
};

export default { es, en };
