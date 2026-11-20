// Buscador global del panel (OmniSearch.jsx, dentro de GlobalFilterBar.jsx):
// la caja con autocompletado que sale en TODAS las pestañas. Claves adm.omni.*.
//
// Tres familias:
//  · la caja en sí (marcador de posición, aria, borrar, atajo de teclado);
//  · los estados del desplegable (apunte con la caja vacía, mínimo de letras,
//    buscando, sin resultados, error, acceso de demostración);
//  · un encabezado por grupo (adm.omni.group.<kind>) y la explicación del
//    destino de cada tipo (adm.omni.go.<kind>), que va en el `title` de la
//    opción para que el operador sepa a dónde lo va a llevar ANTES de pulsar.
//
// `group.*` y `go.*` se arman con el `kind` que manda el servidor
// (`t(\`adm.omni.group.${kind}\`, kind)`), así que un tipo nuevo del backend no
// rompe nada: cae en su propio nombre hasta que se le añada la clave. El tipo
// desconocido se agrupa con `other`.
export default {
  es: {
    // ── La caja ───────────────────────────────────────────────────────────
    "adm.omni.aria": "Búsqueda global del panel",
    "adm.omni.label": "Buscar en todo el panel",
    "adm.omni.placeholder": "Buscar venta, pedido, paciente, vendedor, tienda, montura…",
    "adm.omni.placeholderShort": "Buscar en el panel…",
    "adm.omni.title": "Busca cualquier cosa: nº de venta o pedido, paciente, vendedor, tienda o montura",
    "adm.omni.clear": "Borrar la búsqueda",
    "adm.omni.close": "Cerrar los resultados",
    "adm.omni.listAria": "Resultados de la búsqueda",
    // Atajo de teclado: el nombre de las teclas, igual en los dos idiomas.
    "adm.omni.kbd.mac": "⌘K",
    "adm.omni.kbd.other": "Ctrl K",
    "adm.omni.shortcut": "Atajo: {keys}",
    // ── Estados del desplegable ───────────────────────────────────────────
    "adm.omni.hint.title": "Qué puedes buscar aquí",
    "adm.omni.hint.body": "Nº de venta o de pedido, nombre o teléfono del paciente, vendedor, tienda o modelo de montura.",
    "adm.omni.min": "Escribe al menos {n} letras.",
    "adm.omni.searching": "Buscando…",
    "adm.omni.empty": "Sin resultados para «{q}»",
    "adm.omni.emptyHint": "Prueba con el nº de pedido, el teléfono del paciente o el código del vendedor.",
    "adm.omni.error": "No se pudo buscar",
    "adm.omni.errorHint": "Revisa la conexión y vuelve a intentarlo.",
    "adm.omni.retry": "Volver a intentar",
    "adm.omni.demo": "La búsqueda necesita el servidor",
    "adm.omni.demoHint": "Con el acceso de demostración no hay datos reales que buscar.",
    // ── Grupos por tipo ───────────────────────────────────────────────────
    "adm.omni.group.sale": "Ventas",
    "adm.omni.group.order": "Pedidos",
    "adm.omni.group.patient": "Pacientes",
    "adm.omni.group.seller": "Vendedores",
    "adm.omni.group.store": "Tiendas",
    "adm.omni.group.frame": "Monturas",
    "adm.omni.group.other": "Otros",
    // ── A dónde lleva cada tipo ───────────────────────────────────────────
    "adm.omni.go.sale": "Abrir la ficha de esta venta en Pedidos de tienda",
    "adm.omni.go.order": "Abrir la ficha de este pedido en Pedidos de tienda",
    "adm.omni.go.patient": "Ver los pedidos de este paciente",
    "adm.omni.go.seller": "Ver los pedidos de este vendedor",
    "adm.omni.go.store": "Fijar esta tienda en el filtro de todo el panel",
    "adm.omni.go.frame": "Ver esta montura en el catálogo",
    "adm.omni.go.other": "Buscar esto en Pedidos de tienda",
  },
  en: {
    "adm.omni.aria": "Panel-wide search",
    "adm.omni.label": "Search the whole panel",
    "adm.omni.placeholder": "Search sale, order, patient, seller, store, frame…",
    "adm.omni.placeholderShort": "Search the panel…",
    "adm.omni.title": "Search anything: sale or order number, patient, seller, store or frame",
    "adm.omni.clear": "Clear the search",
    "adm.omni.close": "Close the results",
    "adm.omni.listAria": "Search results",
    "adm.omni.kbd.mac": "⌘K",
    "adm.omni.kbd.other": "Ctrl K",
    "adm.omni.shortcut": "Shortcut: {keys}",
    "adm.omni.hint.title": "What you can search here",
    "adm.omni.hint.body": "Sale or order number, patient name or phone, seller, store or frame model.",
    "adm.omni.min": "Type at least {n} characters.",
    "adm.omni.searching": "Searching…",
    "adm.omni.empty": "No results for “{q}”",
    "adm.omni.emptyHint": "Try the order number, the patient's phone or the seller's code.",
    "adm.omni.error": "Search failed",
    "adm.omni.errorHint": "Check the connection and try again.",
    "adm.omni.retry": "Try again",
    "adm.omni.demo": "Search needs the server",
    "adm.omni.demoHint": "The demo login has no real data to search.",
    "adm.omni.group.sale": "Sales",
    "adm.omni.group.order": "Orders",
    "adm.omni.group.patient": "Patients",
    "adm.omni.group.seller": "Sellers",
    "adm.omni.group.store": "Stores",
    "adm.omni.group.frame": "Frames",
    "adm.omni.group.other": "Other",
    "adm.omni.go.sale": "Open this sale in Store orders",
    "adm.omni.go.order": "Open this order in Store orders",
    "adm.omni.go.patient": "Show this patient's orders",
    "adm.omni.go.seller": "Show this seller's orders",
    "adm.omni.go.store": "Pin this store in the panel-wide filter",
    "adm.omni.go.frame": "Show this frame in the catalog",
    "adm.omni.go.other": "Search this in Store orders",
  },
};
