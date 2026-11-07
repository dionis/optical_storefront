# Productos y precios — matriz única (contrato, 6-nov-2026)

Petición del dueño: fusionar **Productos** con **Precios y costos** en una sola
pantalla, en acordeón por marca/colección, donde cada fila es un artículo
(montura, estuche, celda de lente, tratamiento) y las columnas son:

| Artículo | Costo | Tienda A · Precio | Tienda A · Desc % | Tienda B · Precio | Tienda B · Desc % | … |

- **Costo**: una sola casilla (la lista de Capri cuando existe; editable).
- **Precio por tienda**: el precio de venta efectivo en esa tienda (el mismo
  que cobra la caja). Escribir un número fija el precio exacto de esa tienda;
  vaciar la casilla vuelve a la regla (ajuste %, banda, maestro).
- **Desc %** por tienda: descuento propio de ese artículo en esa tienda
  (promoción del dueño). Lo aplica el servidor al cotizar; los descuentos
  del vendedor y sus límites van **encima** del precio ya rebajado.
- Se pueden **añadir** marcas/colecciones, monturas/estuches y tratamientos,
  cada uno con su costo y, por tienda, precio y descuento.
- Todo vive en la base de datos (Postgres), se refleja en la hoja de Google
  y se **exporta/importa en Excel** con el mismo formato.

Solo dueño y superadmin (`/admin/pricing/*` y `/admin/catalog/*` quedan
fuera de la lista de roles restringidos). Los costos se omiten del JSON para
quien no tenga `costs.view`/`costs.manage` (los administradores los tienen).

## Datos

| Qué | Dónde | Notas |
|---|---|---|
| Costo de montura/estuche | `store_frame_cost.cost_cents` (por SKU) | ya existe; `source` `owner_edit` al editar |
| Precio exacto por tienda (montura/estuche) | `store_price_rule` (`establishment_id`, `scope` frame\|case, `target` product_id, `mode` override) | ya existe; vaciar = cerrar la regla |
| Precio efectivo mostrado | `storeLinePrice()` (lib/store-pricing.ts) | el mismo cálculo que la caja |
| Celda de lente (diseño×material×acabado) | `lens_base_price` (`price_cents`, `cost_cents`) + `lens_store_price` kind `base`, key `lensBaseKey()` | ya existe |
| Fotocromático por categoría | `lens_photo_option.price_{sv,bifocal,prog}_cents` + `lens_store_price` kind `photo`, key `code:category` | **nuevo** `cost_cents` |
| Antirreflejo | `lens_ar_option.price_cents` + `lens_store_price` kind `ar`, key `code` | **nuevo** `cost_cents` |
| Descuento por artículo y tienda | **nueva** tabla `store_item_discount` | ver abajo |

### `store_item_discount` (módulo store-pricing, migración `CreateStoreItemDiscount7`)

`id` (prefijo `sidc`), `establishment_id`, `item_kind` (`frame` \| `case` \|
`lens` \| `photo` \| `ar`), `item_key` (product_id; o la key de
`lens_store_price` del tipo), `pct` (float 0–90, 2 decimales), `created_by`,
`updated_by`, timestamps, `deleted_at`. Índice único parcial
(`establishment_id`, `item_kind`, `item_key`) donde `deleted_at IS NULL`.
Un 0 o `null` borra la fila (soft delete).

### Cómo se aplica el descuento

En `quoteSale` (lib/pos-data.ts), por línea: precio de tienda de la montura
→ `× (1 − pct/100)` con su descuento; cada parte del lente (celda, foto, AR)
igual con el suyo. Redondeo a centavos por parte. La línea guarda en su
metadata `promo: { frame_pct, lens_pct, photo_pct, ar_pct, before_cents }` y
su `list` es el precio **ya rebajado**: el descuento del vendedor, su límite y
la aprobación se calculan sobre ese precio. Los recibos muestran el precio
antes de la promoción tachado y «Promoción −x %» cuando `promo` existe.
`GET /admin/pos/products` y `GET /admin/pos/lens-matrix?store=` devuelven el
precio rebajado y el de antes.

## API

### `GET /admin/pricing/matrix?section=frames|cases|lenses|treatments[&q=]`

```json
{
  "section": "frames",
  "cost_access": true,
  "stores": [{ "id": "est_…", "code": "Op1", "name": "Katy", "color": "#2e7d32" }],
  "groups": [
    {
      "key": "di-caprio",
      "label": "Di Caprio",
      "kind": "brand",
      "rows": [
        {
          "kind": "frame",
          "key": "prod_…",
          "product_id": "prod_…",
          "sku": "DC407",
          "title": "DC407",
          "thumbnail": "https://…",
          "status": "published",
          "cost_cents": 1650,
          "cost_source": "supplier_list",
          "stores": {
            "est_…": {
              "price_cents": 6000,
              "source": "store_exact",
              "exact": true,
              "discount_pct": 10,
              "final_cents": 5400,
              "exposed": true
            }
          }
        }
      ]
    }
  ]
}
```

- `frames`: grupos = marcas (`metadata.brand_slug`), filas = modelos
  (`kind` frame), sin estuches. `cases`: un grupo «Estuches» (o por marca si
  la tienen). `lenses`: grupos = diseños (`lens_design`), filas =
  material × acabado (`key` = `lensBaseKey(design, material, finish,
  category)`, `title` «CR-39 · stock»). `treatments`: grupos «Fotocromáticos»
  (filas = opción × categoría, key `code:category`) y «Antirreflejo» (filas =
  opción, key `code`).
- `source` por celda: `store_exact` (precio fijado en esa tienda), `rule`
  (ajuste %/delta de la tienda), `band`, `master`/`base`.
- `exposed` solo aplica a monturas/estuches (surtido de la tienda); en lentes
  y tratamientos es `true`.
- Sin `cost_access` las claves `cost_cents`/`cost_source` no existen.

### `POST /admin/pricing/matrix/cell`

```json
{ "kind": "frame", "key": "prod_…", "field": "cost" | "price" | "discount", "store": "est_…", "value": 54.00 }
```

- `value` en dólares para `cost`/`price`, porcentaje para `discount`;
  `null` o `""` vacía la casilla (precio → vuelve a la regla; descuento →
  sin descuento; costo de montura → vuelve a la lista de Capri si existe).
- `store` obligatorio para `price` y `discount`; prohibido para `cost`
  (el costo es uno solo).
- Respuesta: `{ "row": <fila con el mismo formato del GET> }` para que la
  pantalla pinte la fila sin recargar todo.
- Razones: `bad_kind`, `bad_field`, `bad_value`, `store_required`,
  `store_not_allowed`, `store_not_found`, `unknown_item`, `discount_range`
  (0–90), `forbidden_role`, `save_failed`.
- Audita `price.change` con antes/después; refresca la hoja (best-effort) y
  las cachés de precio/costo.

### `POST /admin/pricing/matrix/import`

```json
{ "apply": false, "rows": [
  { "section": "frames", "sku": "DC407", "cost": 16.5,
    "stores": { "Op1": { "price": 60, "discount": 10 }, "Op2": { "price": null, "discount": null } } },
  { "section": "lenses", "key": "sv:cr39", "cost": 8, "stores": { "Op1": { "price": 40 } } },
  { "section": "treatments", "key": "ar-green-basic", "cost": 3, "stores": { "Op1": { "price": 25, "discount": 0 } } }
] }
```

- Identifica monturas/estuches por `sku`, el resto por `key`; tiendas por su
  `code`. Una celda ausente no se toca; `null` vacía.
- `apply: false` → `{ plan: { changes: [{ row, section, item, field, store, before, after }], errors: [{ row, reason, detail }], counts: {…} } }`
  sin escribir nada. `apply: true` → aplica el mismo plan (solo si no hay
  errores; si los hay responde 422 `import_has_errors`) y devuelve
  `{ applied: n }`. Audita `price.import`.

### `GET /admin/catalog/brands`

`{ "brands": [{ "slug": "di-caprio", "name": "Di Caprio", "models": 34 }] }`

### `POST /admin/catalog/frames` (HU-07)

```json
{ "kind": "frame" | "case", "brand": "Di Caprio", "brand_slug": "di-caprio", "sku": "DC999", "model": "DC999",
  "colors": [{ "name": "Black", "image": "https://…" }], "eye_size": 52, "bridge_size": 18, "temple_length": 140,
  "cost": 16.5, "prices": { "est_…": { "price": 60, "discount": 0 } } }
```

- Una marca nueva = un `brand` que aún no existe (el `brand_slug` se deriva
  del nombre si no viene). Crea el producto como lo crea el scraper
  (`apps/scraper/scraper/medusa_push.py`: opción Color, una variante por
  color, `manage_inventory: false`, metadata con `brand`, `brand_slug`,
  `collection_slug`, medidas, `kind`), con `metadata.source = "manual"` y
  `first_seen_at`; precio base Medusa = `sellingPrice(cost)`; escribe el
  costo en `store_frame_cost` (`owner_edit`) y los precios/desc. por tienda.
- Razones: `bad_brand`, `bad_sku`, `sku_taken`, `bad_colors`, `bad_measure`,
  `bad_value`.
- La sincronización del catálogo **no** debe pasar a borrador ni sobrescribir
  un producto con `metadata.source = "manual"`.

### `POST /admin/pricing/treatments`

```json
{ "type": "photo" | "ar", "label_es": "…", "label_en": "…", "cost": 4,
  "ar_group": "all" | "sv" | "bifprog",
  "prices": { "sv": 30, "bifocal": 35, "prog": 40 } | 25 }
```

Crea la opción en `lens_photo_option`/`lens_ar_option` con un `code` derivado
único. Razones: `bad_type`, `bad_label`, `bad_value`, `code_taken`.

## Pantalla

Pestaña **Productos y precios** (`?tab=products`, grupo Comercial) con
subpestañas Monturas · Estuches · Lentes · Tratamientos · Reglas y
comisiones. «Precios y costos» (`?tab=pricing`) redirige aquí. Lo que hacía
la pestaña Productos (interruptor por marca y por modelo en cada tienda,
descontinuar) sigue en la matriz: interruptor de la marca por tienda en la
cabecera del acordeón y ojo por celda de modelo. Las reglas que no son de un
artículo (ajuste general por tienda, banda piso/techo, comisiones, costos de
tienda, importar lista) quedan en «Reglas y comisiones».

Excel: **Exportar** genera un libro con portada (fecha, tiendas con su
color), una hoja por sección, cabecera de dos filas (tienda / Precio · Desc
%) con el color de cada tienda, formatos de moneda y porcentaje, filas de
marca en negrita, paneles inmovilizados y autofiltro. **Importar** acepta ese
mismo libro, enseña el plan de cambios y aplica con confirmación.

## Implementación (backend, 6-nov-2026)

Todo lo de arriba está implementado tal cual; lo que sigue son los detalles
que el contrato no fijaba y las pocas diferencias, para que la pantalla no
tenga que adivinarlos.

### Archivos

| Qué | Dónde |
|---|---|
| Lógica pura (filas, celdas, descuento, plan de escritura, plan de importación, línea de la caja con promoción, códigos de tratamiento) | `apps/backend/src/lib/price-matrix.ts` |
| Lecturas y escrituras (una consulta por cosa, nunca por modelo ni por tienda) | `apps/backend/src/lib/price-matrix-data.ts` |
| Quién puede qué (`is_admin` para escribir, `costs.view`/`costs.manage` para el costo) | `apps/backend/src/lib/price-matrix-route.ts` |
| Montura/estuche manual: validación y producto de Medusa | `apps/backend/src/lib/catalog-frame.ts` |
| Escritura del maestro de lentes (antes privada en `POST /admin/pricing/lenses`, ahora compartida) | `apps/backend/src/lib/lens-price-write.ts` |
| Rutas | `src/api/admin/pricing/matrix/{route,cell/route,import/route}.ts`, `src/api/admin/pricing/treatments/route.ts`, `src/api/admin/catalog/{brands,frames}/route.ts` |
| Modelo | `src/modules/store-pricing/models/item-discount.ts` (`StoreItemDiscount`, prefijo `sidc`) |
| Migraciones | `store-pricing/migrations/CreateStoreItemDiscount7.ts` (tabla + índice único parcial + índice por tienda), `lens-config/migrations/UpgradeLensListOptionCost9.ts` (`cost_cents INTEGER NULL` en `lens_photo_option` y `lens_ar_option`; ordena después de `UpgradeLensListFinish8`). Idempotentes, con `down`. |
| Tests | `tests/price-matrix.test.ts` (filas, descuento, plan de escritura e importación, caja), `tests/price-matrix-data.test.ts` (despacho de cada celda a su escritor, descuentos), `tests/price-matrix-routes.test.ts` (guardias, redacción del costo, importación con errores, producto manual, recibo, hoja), `apps/scraper/tests/test_medusa_push.py` (`TestManualProducts`) |

### `GET /admin/pricing/matrix`

- Lista modelos **publicados y en borrador** (no borrados): la fila trae
  `status` para pintar los descontinuados.
- `discount_pct` es **`null`** cuando no hay descuento (nunca 0); `final_cents`
  es entonces igual a `price_cents`. `price_cents`/`final_cents` son `null`
  cuando el modelo no tiene precio en Medusa ni precio fijado en la tienda.
- Campos **añadidos** (no rompen el contrato): en toda fila `master_cents`
  (precio del maestro: el del dueño si lo fijó, si no la base de Medusa / la
  celda del maestro); en monturas/estuches `skus` (todos los colores),
  `brand_slug` y `price_scope` (`frame`|`case`, cómo la cobra la caja); en
  lentes `design_code`, `material_code`, `finish`, `category`; en
  tratamientos `code`, `category` (foto), `ar_group` (AR), `label_es`,
  `label_en` y `by_material`. En los grupos de marca, `stores: { est_…:
  { brand_rule: true|false|null, exposed_rows } }` para el interruptor de la
  cabecera del acordeón (el interruptor sigue escribiendo por
  `POST /admin/store-assortment/:id/rule`).
- Títulos y etiquetas de grupo de lentes/tratamientos salen en español
  (`label_es` del maestro; «Fotocromáticos» / «Antirreflejo» con `key`
  `photo` / `ar`). El título de una celda de lente es «<material> · <finish
  code>»: la pantalla puede rearmarlo traducido con `material_code` y `finish`.
- **Estuches**: un modelo va a la sección «Estuches» si su marca es `case`,
  si `metadata.kind = "case"` o si el dueño ya le puso reglas de estuche. El
  precio se calcula con el MISMO alcance que usa la caja (`caseProductIds` de
  `pos-data.ts`: solo es «case» si tiene reglas de estuche). Escribir el precio
  de una fila de estuche crea una regla `scope: "case"` (y cierra un precio
  fijado que hubiera quedado en `scope: "frame"`), así matriz y caja siguen
  cuadrando.
- **Tratamientos**: el costo de un fotocromático es **uno por opción** (la
  columna nueva está en `lens_photo_option`), así que las filas `código:sv`,
  `código:bifocal`, `código:prog` muestran el mismo costo y escribirlo en
  cualquiera lo cambia en las tres. Una categoría sin precio en el maestro no
  tiene fila. `by_material: true` avisa que la caja cobra ese tratamiento por
  la tabla diseño × material (`lens_treatment_price`: AR Green/Blue, y el
  fotocromático cuando esa tabla tiene filas `photo`) siempre que exista la
  celda; el precio de la fila es el de respaldo. El precio propio de la tienda
  y su descuento sí se aplican siempre encima.
- `q` en lentes/tratamientos filtra por título, clave o nombre del grupo.
- Rendimiento: la sección Monturas hace 5 consultas en total (catálogo con
  todos los SKU y el precio USD en una sola consulta Knex; `openRules` de
  todas las tiendas; descuentos; surtido; costos). Armar 600 modelos × 4
  tiendas con 1.400 reglas toma ~20 ms (las reglas se indexan por producto).
  Si la subconsulta del precio fallara (tabla de enlace distinta en otra
  versión de Medusa) cae a `productPrices` en páginas de 200, con aviso en el log.
- Razones: `bad_section` (422), `load_failed` (500).

### `POST /admin/pricing/matrix/cell`

- Códigos HTTP: 403 `forbidden_role`, 404 `store_not_found`, 422 el resto,
  500 `save_failed`. Además de las del contrato puede llegar
  `finish_unavailable` (costo de una celda de progresivo escrita como stock).
- Escritores: costo de montura → `setOwnerFrameCost` (`owner_edit`, vaciar =
  lista de Capri o «sin costo»), `cost.change` en `frame_cost`; precio de
  montura → `replaceRule` (familia `price`, `source: "price-matrix"`, audita
  `price.change`); costo de lente/tratamiento → `writeLensMaster` (vaciar =
  desconocido), `cost.change` en `lens_price`; precio de lente/tratamiento →
  `upsertStoreLensPrice` (vaciar = vuelve al maestro / su %), `price.change`
  en `lens_price`; descuento → `store_item_discount` (soft delete al vaciar),
  `price.change` en `item_discount` con antes/después. Un descuento de producto
  se guarda bajo el `kind` de la fila (`frame` o `case`) y se borra el del otro
  kind, para que haya una sola respuesta.
- Tras escribir: se vacían las cachés (costo de montura, costo de celda de
  lente, banda de precio) y la hoja se refresca en segundo plano.
- La respuesta `{ row }` sale ya sin `cost_*` para quien no ve costos.

### `POST /admin/pricing/matrix/import`

- `apply: true` limpio responde `{ applied, failed: [{ row, reason }] }`
  (`failed` vacío lo normal). Con errores, 422 `import_has_errors` **con el
  `plan`** en el cuerpo. `bad_rows` si `rows` no es una lista (máx. 5.000 filas;
  cuerpo hasta 5 MB, `middlewares.ts`).
- Cada cambio del plan trae además `title`, `kind`, `key` (la del escritor) y
  `store_code`; `store` es el id. `before` es la cifra efectiva de hoy (dólares
  para costo/precio, % para descuento); `after` la nueva (`null` = vaciar).
- Una celda que ya tiene ese valor no es cambio y suma en `counts.unchanged`
  (reimportar el libro exportado no cambia nada). Vaciar un precio solo es
  cambio si estaba fijado; vaciar el costo de una montura solo si era del
  dueño (`owner_edit`). `counts`: `rows, changes, errors, cost, price,
  discount, unchanged`.
- Errores por fila: `unknown_item` (SKU o clave que no existe; `detail` = lo
  que vino), `store_not_found` (`detail` = el código), `bad_section`,
  `bad_row`, `bad_value` / `discount_range` (`detail` = `cost` o
  `<código>.price|discount`). El SKU se compara sin mayúsculas ni signos
  (`dc-407` = `DC407`) contra el de cualquier color. Una clave de lente se
  acepta también con el acabado explícito (`prog-mid:cr39:digital` →
  `prog-mid:cr39`).
- Si el plan cambia algún costo hace falta «Gestionar costos» (403).
- Se aplica de a 4 escrituras a la vez, con los mismos escritores que `/cell`
  (cada celda deja su `price.change`/`cost.change`) y un `price.import` con
  los conteos al final.

### `GET /admin/catalog/brands`

Marcas con modelos publicados o en borrador, más las conocidas
(`KNOWN_BRANDS`) aunque tengan 0, ordenadas por nombre.

### `POST /admin/catalog/frames`

- 201 `{ product_id, handle, row }` (`row` = la fila de la matriz). 409
  `sku_taken` (handle o SKU de algún color ya existe), 404 `store_not_found`,
  422 `bad_kind`/`bad_brand`/`bad_sku`/`bad_colors`/`bad_measure`/`bad_value`/
  `discount_range`, 403 `forbidden_role` (incluye mandar `cost` sin
  «Gestionar costos»).
- `kind` por defecto `frame`; `model` por defecto el SKU; sin colores crea una
  variante «Default» (como el scraper); un estuche sin marca queda en la marca
  `case`. SKU de la variante: el primer color lleva el SKU del modelo (es la
  clave de costo y precio), los demás `<SKU>-<color>`.
- `cost` es opcional si viene al menos un precio de tienda: el precio base de
  Medusa es `sellingPrice(cost)` y, sin costo, el mayor precio de tienda escrito.
- Canales: el canal por defecto de la tienda Medusa **y** el de cada
  establecimiento (activo o no), para que se venda en la web y en toda caja.
- `metadata`: `brand`, `brand_slug`, `collection_slug`, `kind`, medidas,
  `source: "manual"`, `created_by`, `first_seen_at`. Auditoría nueva
  `catalog.create` (añadida a `AUDIT_ACTIONS`; el panel necesita su etiqueta
  en la Auditoría).
- **Sincronización**: la decisión de pasar a borrador vive en el scraper
  Python. `apps/scraper/scraper/medusa_push.py` ahora salta todo producto con
  `metadata.source == "manual"` al listar los publicados para la
  reconciliación (`_list_published_handles`) y en `upsert_product` (si Capri
  publica un modelo con el mismo handle no lo sobrescribe). Con pytest. Hay
  que avisar a Eyewear Dev: requiere redeplegar la app del scraper.

### `POST /admin/pricing/treatments`

201 `{ type, code, rows }` (`rows` = las filas nuevas de la sección
Tratamientos). Acepta un `code` opcional (minúsculas, dígitos y guiones; 409
`code_taken` si ya existe, también borrado: la columna es única); sin él se
deriva del nombre (`ar-…` para AR, `photo-…` salvo que ya empiece por
`photo`/`trans`, con `-2`, `-3`… si choca). La opción nueva queda activa al
final de la lista; sus precios por tienda y descuentos son celdas normales.

### La caja

- `quoteSale`: por línea, el precio de tienda de la montura menos su
  descuento; cada parte del lente (celda, fotocromático, AR) menos el suyo,
  redondeado al centavo por parte, y el lente ya rebajado pasa por
  `storeLinePrice` (el ajuste general antiguo de la tienda que cubría lentes
  se aplica a lo que de verdad se cobra). `list` es el precio rebajado; el
  descuento del vendedor, su límite, el mínimo y la aprobación trabajan sobre
  él. `QuotedLine.promo` (`{ frame_pct, lens_pct, photo_pct, ar_pct,
  before_cents }`, cada % `null` si esa parte no tiene) sale en
  `POST /admin/pos/quote` y se guarda en la metadata de la línea del pedido.
- `GET /admin/pos/products`: `price` = rebajado, `price_before` = antes (igual
  a `price` sin promoción), `discount_pct` = `null` sin promoción.
- `GET /admin/pos/lens-matrix?store=`: las celdas con descuento traen el precio
  rebajado en su campo de siempre y además `price_before_cents` +
  `discount_pct` (celdas base y AR) o `price_before: { <cat>: cents }` +
  `discount_pct: { <cat>: pct }` (fotocromáticos). Sin descuentos el cuerpo es
  idéntico al de antes. La lista pública (`/store/lens-config/matrix`) nunca
  lleva el `cost_cents` nuevo de las opciones (`publicOptionRow`).
- Documentos: `DocLine.promo = { before, pct, frame_pct, lens_pct, photo_pct,
  ar_pct }` o `null`; `before` en dólares y `pct` el % efectivo de la línea
  con un decimal (si solo la montura tiene 10 %, la línea completa baja menos
  de 10 %). El recibo por correo (simple y detallado, texto y HTML) imprime
  «Precio antes $X · Promoción −Y %» / «Price before $X · Promotion −Y%».

### Hoja de Google

La pestaña «Costos monturas» lleva, tras las columnas «Costo <tienda>», un par
«Precio <tienda>» (lo que cobra esa caja por la montura sola) y «Desc %
<tienda>» (vacía sin promoción) por tienda activa. Mejor esfuerzo: si no se
pueden leer reglas o descuentos, la pestaña sale como antes.
