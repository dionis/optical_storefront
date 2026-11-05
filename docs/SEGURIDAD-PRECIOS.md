# Costes de proveedor y precios públicos

## Qué se encontró (auditoría 4-nov-2026)

`apps/capri-storefront/src/data/capriPrices.js` contiene la lista de precios
mayoristas de Capri Optics (julio 2026) y se compila dentro del bundle público:
cualquier visitante de la tienda puede abrir el JavaScript y leer el coste de
cada montura. Además, cada objeto de producto llevaba `supplierPrice` y
`markup` a la vista en el estado de la aplicación.

## Qué se cambió

- Los objetos de producto públicos ya **no** llevan `supplierPrice` ni `markup`
  (`enrichProducts` en `src/data/products.js`). El panel del dueño (pestaña
  Precios) los calcula con `supplierPriceFor(sku)`, que sigue exportada para él.

## Qué NO se puede arreglar solo en el frontend (y por qué)

La regla de negocio vigente es **precio público = coste × `FRAME_MARKUP` (3)**,
calculada en el navegador a partir de esa tabla. Mientras sea así:

- la tabla tiene que viajar al navegador para que la tienda muestre precios, y
- aunque se ocultara, el coste se deduce dividiendo cualquier precio entre 3.

La única solución real es que el precio público venga **del servidor**, donde ya
existe (los precios por variante de Medusa, cargados con `price-list-2026` y
editables en Tiendas → Precios), y que el navegador nunca conozca el coste:

1. Activar el catálogo desde Medusa en Vercel: `VITE_USE_MEDUSA=true` (+
   `VITE_MEDUSA_URL`, `VITE_MEDUSA_PUBLISHABLE_KEY`). El storefront ya tiene el
   camino (`src/data/medusaCatalog.js`, `catalogStore.js`).
2. Comprobar en staging que fichas, filtros, estuches y checkout muestran los
   mismos precios que hoy (hay 550 modelos; `docs/connect-storefront-to-medusa.md`
   describe el flag y sus huecos conocidos).
3. Entonces `capriPrices.js` puede salir del bundle (quedar solo en el backend,
   para el cálculo de coste/margen de `costing.ts`).

Es una decisión del dueño porque cambia de dónde salen los precios que ve el
cliente; no se activó en esta auditoría.
