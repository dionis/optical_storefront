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
- **Tratamientos**: desde el 7-nov-2026 un fotocromático tiene **costo por tipo
  de lente**, como su precio (`cost_sv_cents`, `cost_bifocal_cents`,
  `cost_prog_cents` en `lens_photo_option`, migración
  `UpgradeLensPhotoCostByCategory10`, que copió el costo único donde el tipo se
  ofrece): cada fila `código:sv`, `código:bifocal`, `código:prog` muestra y
  escribe el suyo; `cost_cents` queda como respaldo de lectura. El alta y la
  edición del tratamiento piden costo y precio por tipo (`costs`/`prices`
  `{ sv, bifocal, prog }`). Ninguna columna de costo sale por la matriz pública
  (`PRIVATE_COST_COLUMNS` en `lens-matrix.ts`). Una categoría sin precio en el maestro no
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

---

# v2 — 7-nov-2026 (petición del dueño tras verlo en staging)

Hallazgos en staging: (1) **los 556 modelos salen «falta» de costo**: el costo se busca por SKU (`capriKeyOf(sku)`) y en staging los SKU son `dc-50-di-caprio-grey` (el scraper los inventa cuando no hay UPC); hay que casar por **modelo** (título del producto «DC 50» → `DC50`), y por SKU como respaldo; (2) **miniaturas rotas**: `product.thumbnail` es una clave de R2, no una URL; (3) sin logos de marca; (4) Comisiones con mucho espacio vacío.

## Costos: 2026 primero, la lista anterior como respaldo

`capri-price-list-2026.ts` (julio 2026, 609 filas) manda. Si un modelo no está en 2026, se usa la **lista anterior** (el `PRICE_BOOK` mayorista de agosto, `git show e3bb8ba:apps/backend/src/data/wholesale-prices.ts`, que el dueño llama «2024»), guardada como módulo propio `capri-price-list-prev.ts`. `store_frame_cost.source` gana `supplier_list_prev`. Un `owner_edit` nunca se pisa. Script/migración idempotente que siembra/actualiza los costos de todos los modelos del catálogo con esa precedencia.

## Marcas (nuevo registro)

Tabla `catalog_brand` (módulo store-pricing o un módulo `catalog` nuevo): `slug` (único), `name`, `logo_url`, `kind` (`frame` | `case`), `source` (`capri` | `manual`), `active`, `sort`. Siembra: las marcas de Capri presentes en el catálogo con su logo de `apps/capri-storefront/public/brands/logo-<slug>.png` (los slugs del catálogo pueden diferir: four-you↔4u, etc. — mapa explícito).

Rutas: `GET /admin/catalog/brands` (ahora con `logo_url`, `kind`, `active`, `models`), `POST /admin/catalog/brands` {name, kind, logo_url}, `POST /admin/catalog/brands/:slug` {name?, logo_url?, active?, sort?}, `DELETE /admin/catalog/brands/:slug` (solo sin modelos; si no, 409 `brand_has_models`).

## Archivos (logo, fotos)

`POST /admin/catalog/uploads` (multipart, un archivo, imagen ≤ 8 MB, jpg/png/webp) → `{ url }` con el módulo de archivos de Medusa (R2 público si está configurado; en local, disco). Thumbnails y logos siempre se devuelven como URL absoluta (`R2_PUBLIC_URL` + clave cuando es clave).

## Modelos (montura / estuche): alta, edición, baja

`POST /admin/catalog/frames` acepta además `images[]`, `material`, `shape`, `style`, `gender`, `age_group`, `features[]`, `description` (los mismos campos de la ficha de la tienda online). `POST /admin/catalog/frames/:id` edita los mismos campos (y colores: añadir/renombrar; quitar solo si esa variante nunca se vendió). `DELETE /admin/catalog/frames/:id`: si nunca se vendió, se borra; si se vendió, pasa a descontinuado (draft) — respuesta `{ deleted | archived }`.

## Precio y descuento por marca

En la cabecera del acordeón, por tienda: **precio de marca** (todos los modelos de esa marca a ese precio en esa tienda) y **desc % de marca**. Datos: `store_price_rule` con `scope` frame|case, `target` `brand:<slug>`, `mode` override; `store_item_discount` con `item_kind` `brand`, `item_key` slug. Precedencia en `storeLinePrice` (y por tanto en la caja, la matriz, la hoja y el Excel): **precio exacto del modelo > precio de marca > ajuste de la tienda > banda > maestro**. Descuento: el del modelo si existe, si no el de la marca. Filas de la matriz con `source: "brand"` cuando el precio viene de la marca. API: `POST /admin/pricing/matrix/cell` con `kind: "brand"`, `key: <slug>`, `field: price|discount`, `store`. El GET devuelve en cada grupo `stores[est].brand_price_cents` y `brand_discount_pct`.

## Tratamientos

`POST /admin/pricing/treatments/:code` (editar etiquetas, grupo, costo) y `DELETE` (si nunca se vendió; si se vendió, `is_active=false`).

## Exportar / importar

Todo lo anterior entra en el Excel de la matriz (hoja «Marcas» con precio/desc de marca por tienda). Reglas y comisiones exporta/importa su propio libro (ver docs/CONTABILIDAD.md).

## Implementación v2 (backend, 7-nov-2026)

Lo que sigue es lo que el backend hace de verdad con el contrato v2 de
arriba, con los detalles que el contrato no fijaba. Nada de v1 cambia de
forma: todo lo nuevo son campos o rutas añadidos.

### Archivos

| Qué | Dónde |
|---|---|
| Costo por **modelo** (candidatos, precedencia, alias del catálogo) | `apps/backend/src/lib/frame-cost.ts` (`frameCostCandidates`, `frameCostRowFrom`, `frameCostKeyFor`, `frameCostRowExact`, `costRefOf`, `loadCatalogAliases`) |
| Lista anterior del proveedor | `src/modules/store-pricing/capri-price-list-prev.ts` (`CAPRI_PREV_PRICE_LIST`, 460 filas de `e3bb8ba`, `capriPrevCostCents`) |
| Siembra de la lista anterior | `src/modules/store-pricing/frame-cost-seed.ts` (`prevFrameCostSeedRows`, `frameCostSeedStatements(rows, source)`) |
| URL absolutas de imágenes | `src/lib/image-url.ts` (`absoluteImageUrl`, `absoluteImageUrls`, `publicAssetBase`, `catalogUploadKey`) |
| Registro de marcas | modelo `src/modules/store-pricing/models/catalog-brand.ts` (`CatalogBrand`, prefijo `cbr`), puro `src/lib/catalog-brand.ts`, datos `src/lib/catalog-brand-data.ts`, siembra `src/modules/store-pricing/catalog-brand-seed.ts` |
| Precio / descuento de marca | `src/lib/store-pricing.ts` (`brandTarget`, `brandOfTarget`, `brandPriceRule`, `StoreLineInput.brand`), `src/lib/price-matrix.ts` (`productDiscountOf(…, brandSlug)`, `brandStoreCell`, `planCellWrite` kind `brand`, import «Marcas»), `src/lib/price-matrix-data.ts` (`executeCellOp` → `executeBrandOp`, `loadBrandGroup`, `brandExists`) |
| Editar / borrar modelos | puro `src/lib/catalog-frame.ts` (`cleanFrameExtras`, `cleanCatalogFramePatch`, `planColorEdit`, `attributeMetadata`), datos `src/lib/catalog-frame-data.ts` (workflows de Medusa) |
| Editar / borrar tratamientos | puro `cleanTreatmentPatch` / `photoPricesAfter` en `src/lib/price-matrix.ts`, datos `src/lib/treatment-data.ts` |
| Rutas nuevas | `src/api/admin/catalog/brands/route.ts` (GET + POST), `brands/[slug]/route.ts` (POST, DELETE), `frames/[id]/route.ts` (POST, DELETE), `uploads/route.ts` (POST), `src/api/admin/pricing/treatments/[code]/route.ts` (POST, DELETE); `pricing/matrix/cell` acepta `kind: "brand"` |
| Migraciones (módulo store-pricing) | `CreateCatalogBrand8.ts` (tabla + CHECK de `kind`/`source` + índice único parcial por `slug` + siembra), `UpgradeStoreFrameCostPrev9.ts` (CHECK de `source` con `supplier_list_prev` + siembra de la lista anterior). Idempotentes, con `down`; probadas contra la base local de QA (`medusa db:migrate`). |
| Tests | `tests/price-matrix-v2.test.ts` (claves y precedencia de costo con ejemplos reales, lista anterior, imágenes, precedencia de precio de marca, descuentos, matriz, celda, import «Marcas», registro de marcas, alta/edición de modelos, tratamientos), `tests/price-matrix-v2-routes.test.ts` (la caja con precio y descuento de marca, el escritor de la celda de marca, guardias y razones de las rutas nuevas, subida) |

### 1. Costos: por modelo, no por SKU

- **Candidatos** (`frameCostCandidates`), en este orden: el **modelo** (título
  del producto, mayúsculas y solo A-Z0-9: «DC 50» → `DC50`; también sin una
  palabra de marca delante o detrás: «Grande GR 801» → `GR801`, «SimplyLite
  SL101» → `SL101`; y las dos formas que ya conocía `capriKeyOf`: `YC21102` →
  `21102`, `DI CAPRIO CASE` → `DICAPRIOCAS`), luego **cada SKU** de los colores
  igual, luego **cada SKU cortado por palabras** (el SKU que inventa el
  scraper sin UPC, `dc-50-di-caprio-grey` → `DC50DICAPRIO`, `DC50DI`, `DC50`…;
  palabras enteras, nunca `DC501`), y al final **los UPC**
  (`metadata.upc_by_color`).
- **Precedencia** (`frameCostRowFrom`), en tres pasadas sobre esos candidatos:
  (1) una fila **`owner_edit`** bajo cualquiera de las claves (el dueño gana
  donde sea que la pantalla vieja la haya guardado, p. ej. bajo
  `DC50DICAPRIOGREY`); (2) cualquier fila guardada (las sembradas de la lista);
  (3) las listas compiladas: **2026 → anterior → nada** (nunca 0).
- **Quien solo tiene un SKU** (`frameCostCents(sku, storeId)`: costing,
  sales-insights, **store-pnl**): la caché de costos carga ahora también los
  **alias del catálogo** (SKU / UPC normalizado → título, una consulta Knex
  por minuto, `loadCatalogAliases`) y busca primero por ese modelo. **Las
  firmas no cambian**; `FrameCostLookup` gana un tercer argumento opcional
  `model` y `CostOrderLike.items[].model` es opcional. `store-pnl.ts` no se
  tocó: con los alias, el `sku` que ya pasa (`sale_fact.sku`) se costea por
  modelo.
- **Matriz**: cada fila de montura/estuche trae `cost_key` (solo con
  `cost_access`): la clave del modelo bajo la que vive (o se escribiría) su
  costo. Escribir la celda de costo usa esa clave, ya no el SKU del color, así
  que un modelo de staging guarda su costo en `DC50` y lo leen todos. La vista
  entre tiendas, la hoja («Costos monturas»), `GET /admin/pricing/frames/costs`
  (precio unido al costo por la clave del modelo) y el resumen de cobertura
  usan la misma resolución.
- **Comprobado en la base de QA** (133 modelos, 613 filas de costo): con los
  SKU que el scraper inventaría (`<handle>-<color>`), v1 encontraba costo para
  0 de 133; v2 para 133 de 133 por modelo, 133 por el SKU solo (cortes por
  palabra) y 133 por `frameCostCents` con los alias. La matriz real
  (`loadMatrixSection`) de QA: 126/126 monturas y 7/7 estuches con costo.

### 2. Lista anterior

- `capri-price-list-prev.ts` = el `PRICE_BOOK` de `e3bb8ba` (marca, modelo,
  clave en mayúsculas, `wholesale_cents`; lo que el libro viejo solo
  **estimaba** queda en `null` = sin costo, no una suposición).
- `store_frame_cost.source` acepta `supplier_list_prev` (modelo y CHECK);
  `FRAME_COST_SOURCES`/`FRAME_COST_ORIGINS` lo incluyen y la hoja lo rotula
  «Lista anterior del proveedor». Vaciar el costo de un modelo que solo está
  en la lista anterior vuelve a ella con ese `source`.
- La siembra solo añade claves que 2026 no tiene y con cifra real, con la
  guarda `WHERE store_frame_cost.source = 'supplier_list_prev'`: nunca toca una
  fila de 2026 ni un `owner_edit`. **Hoy no añade ninguna fila**: las 460
  claves del libro viejo están en 2026 salvo tres (DI CAPRIO CASE, GRANDE CASE,
  SIMPLYLITE CASE) que no tenían cifra. El respaldo queda cableado para la
  próxima lista.
- Una fila de costo por clave del proveedor ES una fila por modelo del
  catálogo: todo modelo, tenga los SKU que tenga, se resuelve a esa clave. No
  hace falta sembrar por producto (y una migración no puede leer `product`,
  que es de otro módulo).

### 3. Imágenes

`absoluteImageUrl`: una clave del bucket → `R2_PUBLIC_URL` (o
`VITE_R2_PUBLIC_URL`, o el bucket de la tienda por defecto, el mismo que usan
los correos) + clave; `http(s)://`, `data:`, `blob:` y `//…` se dejan igual;
**una ruta que empieza por `/` también** (los logos `/brands/…` los sirve el
origen del panel). Aplicado en: filas de la matriz (`thumbnail`), logos de
marca, búsqueda del POS (`thumbnail`, `images[]`, `variants[].image`), ficha
de catálogo por tienda (`/admin/store-assortment/:id/products` y la ficha),
vista entre tiendas, tablero de pedidos (`items[].thumbnail`) y la lista de
modelos nuevos de la sincronización. El panel ya no tiene que prefijar nada.

### 4. Marcas (`catalog_brand`)

- Columnas: `slug` (único entre vivas), `name`, `logo_url`, `kind`
  (`frame`|`case`), `source` (`capri`|`manual`), `active`, `sort`,
  `created_by`, `updated_by`, timestamps, `deleted_at`.
- Siembra (migración): Di Caprio, Flexure, Millennial, Peachtree, Four You
  (`4u`), Trendy, Simplylite (`simply-lite`, sin logo), Grande, ProRx, Cases
  (`case`, kind `case`), con `sort` 10…100 en el orden de la tienda y
  `logo_url` = `/brands/logo-<archivo>.png` según el mapa explícito
  `BRAND_LOGO_FILES` (`four-you`→`4u`, `cases`→`case`, …; el resto `null`).
  `ON CONFLICT DO NOTHING`: nunca pisa una edición.
- **Registro al leer**: `GET /admin/catalog/brands` (y la matriz) inserta las
  marcas que algún modelo lleva y el registro no tiene (`source` `manual` si
  todos sus modelos son manuales, si no `capri`; logo del mapa; `sort` 1000),
  así que una marca del catálogo nunca desaparece. Sin la tabla, la lista sale
  como en v1.
- `GET /admin/catalog/brands` → `{ brands: [{ slug, name, models, logo_url,
  kind, active, source, sort, registered }] }`, ordenadas por `sort` y nombre
  (más las conocidas sin modelos, como antes).
- `POST /admin/catalog/brands` `{ name, kind?, logo_url?, slug?, sort? }` → 201
  `{ brand }`; 409 `brand_taken` (también si el catálogo ya usa ese slug); 422
  `bad_name`/`bad_kind`/`bad_slug`/`bad_logo`/`bad_value`.
- `POST /admin/catalog/brands/:slug` `{ name?, logo_url?, active?, sort?, kind? }`
  → `{ brand }`; 404 `brand_not_found`; 422 `nothing_to_change` y los de arriba.
  El nombre nuevo es la etiqueta del grupo en la matriz; no reescribe
  `metadata.brand` de los productos.
- `DELETE /admin/catalog/brands/:slug` → `{ deleted: true }`; 409
  `brand_has_models` con `models` (cuenta todo modelo no borrado, también los
  descontinuados).
- `logo_url` acepta una URL http(s) (la de una subida) o una ruta del origen
  (`/brands/…`); `""`/`null` lo quita.
- La matriz pone `logo_url` en cada grupo de marca.

### 5. Subidas

`POST /admin/catalog/uploads` (multipart, campo `file`) → 201 `{ url }`
absoluta. Middleware `catalogUpload` en `src/api/middlewares.ts` (multer en
memoria, un archivo, JPEG/PNG/WEBP, ≤ 8 MB → 415 `unsupported_media_type`, 413
`file_too_large`; esas dos respuestas ahora llevan también `reason`), y el
módulo de archivos de Medusa como las fotos de reseñas (`createFiles`,
`access: "public"`, clave `catalog/<ms>-<nombre>`): R2 público si está
configurado, disco local si no. Solo dueño/superadmin (403
`forbidden_role`); 400 `file_required`; 503 `upload_failed`.

### 6. Modelos

- `POST /admin/catalog/frames` acepta además `images[]` (URL http(s), máx. 20;
  la primera es la portada, luego las fotos de los colores), `material` (texto
  o lista), `shape`, `style`, `gender`, `age_group`, `features[]` y
  `description` (→ `product.description`), con las **mismas claves de
  `metadata` que escribe el scraper**. Razones nuevas: `bad_images`,
  `bad_attribute`, `bad_description`.
- `POST /admin/catalog/frames/:id` edita solo lo enviado: `model` (título),
  `brand`/`brand_slug`, `status` (`published`|`draft`), medidas, `images[]`,
  los atributos (un `null` borra la clave), `description` y `colors`: la lista
  **completa** deseada — `{ variant_id, name, image? }` mantiene o renombra
  (y añade el valor a la opción «Color»), `{ name }` crea (SKU `<SKU del
  modelo>-<color>`, nunca uno ya usado, precio Medusa del modelo) y un color
  que falta se borra **solo si nunca se vendió**; si no, 409 `variant_sold`
  con `variant_ids` y no se escribe nada. Responde `{ product_id, row }`.
  `metadata` se **fusiona** (Medusa la reemplaza) y gana `edited_at`/`edited_by`.
  Razones: `product_not_found` (404), `bad_sku`, `bad_brand`, `bad_status`,
  `bad_measure`, `bad_colors`, `bad_images`, `bad_attribute`,
  `bad_description`, `nothing_to_change` (422). Probado contra QA (renombrar y
  devolver un color de un producto de prueba con los workflows reales).
- `DELETE /admin/catalog/frames/:id` → `{ deleted: true }` (nunca vendido:
  `deleteProductsWorkflow`) o `{ archived: true }` (vendido: pasa a `draft`,
  con `archived_at`/`archived_by`).
- «Vendido» = una línea en `order_line_item` (web y caja) o en `sale_fact`.
- Auditoría `catalog.update` / `catalog.delete` (añadidas a `AUDIT_ACTIONS`;
  el panel necesita sus etiquetas).
- **Límite conocido**: en un modelo **del scraper** (no manual), la siguiente
  sincronización vuelve a escribir los campos que el scraper posee (título,
  descripción, atributos). Hacer que una edición del dueño sobreviva exige un
  cambio en `apps/scraper/scraper/medusa_push.py` (respetar, p. ej.,
  `metadata.edited_at` o una lista de campos bloqueados) — fuera de este
  cambio; hay que decidirlo con Eyewear Dev. Renombrar un color deja el valor
  viejo en la opción «Color» (sin variantes; inofensivo).

### 7. Precio y descuento de marca

- Datos: `store_price_rule` (`establishment_id`, `scope` `frame`|`case`,
  `target` **`brand:<slug>`**, `mode` `override`, `source`
  `price-matrix-brand`) y `store_item_discount` (`item_kind` **`brand`**,
  `item_key` = slug). Sin migración: las columnas ya son texto libre.
- `storeLinePrice` recibe `brand` (el slug de la marca del modelo): **precio
  exacto del modelo > precio de marca > ajuste de la tienda > banda >
  maestro**. El precio de marca, como el exacto, no se ajusta ni lo mueve la
  banda; un ajuste fijo antiguo (`scope all`) pasa a los lentes.
  `frame_source` gana `"brand"`. Solo la marca de **esa** tienda y de ese
  `scope`; sin `brand` todo es como antes (y la montura del cliente nunca
  toma precio de marca).
- Descuento: el del modelo (`frame`/`case`) si existe, si no el de su marca
  (`productDiscountOf(index, store, productId, brandSlug)`).
- Dónde se aplica: la caja (`quoteSale` pasa el `brand_slug` de la metadata
  del producto; `QuotedLine.frame_source` puede ser `brand`), la búsqueda del
  POS, la matriz (celdas con `source: "brand"`), la vista entre tiendas
  (`source: "brand"`), la ficha de catálogo por tienda, la hoja y el Excel.
  `rulesByTarget(rules)(productId, brandSlug)` añade las reglas de la marca a
  la porción de cada modelo (sigue siendo una pasada).
- Matriz: cada grupo de marca trae en `stores[est]` además
  `brand_price_cents` (centavos o `null`) y `brand_discount_pct` (`null` sin
  descuento). En «Monturas» se leen las reglas `scope: "frame"`; en
  «Estuches», `scope: "case"`.
- `POST /admin/pricing/matrix/cell` `{ kind: "brand", key: <slug>, field:
  "price"|"discount", store, value, scope? }` (`scope` por defecto `case`
  para la marca `case`/`cases`, `frame` para el resto). Responde **`{ group }`**
  (el grupo de esa marca con su cabecera y todas sus filas recalculadas), no
  `{ row }`. Razones: `bad_field` (costo), `store_required`, `unknown_item`
  (slug mal formado o marca que no existe), `discount_range`, `bad_value`.
  Audita `price.change` (`price_rule` / `item_discount`).
- `GET /admin/store-pricing/:id` ya no lista los precios de marca entre los
  exactos de modelo: van aparte en `brand_prices: [{ scope, brand, price,
  since }]`; Precios → Monturas (vista antigua) tampoco los muestra como
  modelos.
- Importar: filas `{ section: "brands", key: <slug>, stores: { <código>: {
  price, discount } } }` (ausente = no se toca, `null` vacía, igual =
  `unchanged`). `cost` en una marca → `bad_row`. Cada cambio del plan trae
  `kind: "brand"`, `key` = slug y `scope`. Se aplican con el mismo escritor
  que la celda.

### 8. Tratamientos

- `POST /admin/pricing/treatments/:code` `{ type?, label_es?, label_en?,
  ar_group? (solo AR), cost?, is_active?, prices? }` — `prices` para un
  fotocromático es `{ sv?, bifocal?, prog? }` (solo las categorías enviadas;
  `null` = deja de ofrecerse, pero debe quedar al menos una → `bad_value`), para
  un AR un número. `type` solo hace falta si el código existiera en las dos
  listas (`bad_type`). Responde `{ type, code, rows }`. Un `cost` necesita
  «Gestionar costos». 404 `treatment_not_found`; 422 `bad_label`, `bad_value`,
  `nothing_to_change`.
- `DELETE /admin/pricing/treatments/:code[?type=]` → `{ deleted: true, type }`
  (nunca vendido: se borra la fila — su código queda libre — y los precios
  propios / descuentos de tiendas de esa opción) o `{ archived: true, type }`
  (vendido: `is_active = false`). «Vendido» = `sale_fact.lens_photo` /
  `lens_ar` = código, o `order_line_item.metadata.lens_config.photo_code` /
  `ar_code` = código (web y caja).

### 9. La tienda online (decisión C8)

- **Cómo salen hoy los precios de la web**: la web en modo Medusa
  (`VITE_USE_MEDUSA`) pinta `variants[].calculated_price` (precio de la
  variante en Medusa) y la línea del carrito (`/store/carts/:id/configured-line`)
  cobra ese mismo `calculated_amount` + lentes. Ese precio de variante es el
  **maestro**: lo escribe el job `price-sync` cada 4 h (precio global del
  dueño si lo fijó; si no, la conversión del libro mayorista + la banda de la
  cadena). Sin `VITE_USE_MEDUSA` la web usa el catálogo estático empaquetado.
  Ningún establecimiento interviene: «Op4 Online Optical Store» es solo una
  columna más (`establishment.kind` es `own|family|partner|consignment`, no
  hay un tipo «online»), y lo que se escriba en su columna solo lo cobra una
  caja de Op4.
- **No se implementó** que un precio de esa columna mueva el precio Medusa:
  no es contenido ni seguro. El precio de la variante es a la vez la **base de
  todas las tiendas** (`productPrices` → `storeLinePrice`), así que escribirlo
  cambiaría el precio de todas las cajas que heredan; y `price-sync` lo
  sobrescribiría a las 4 h.
- **Lo que haría falta** (para decidir): (1) marcar qué establecimiento es la
  web (`establishment.kind = 'online'` — migración del CHECK/enum — o un
  `web_establishment_id` en `store_setting`); (2) que el precio de la web se
  calcule con `storeLinePrice` + descuentos de ese establecimiento **sobre la
  base Medusa** en el servidor: en `configured-line` (lo que se cobra) y en
  una ruta pública de precios del catálogo (o un campo calculado en
  `/store/products`) que la tienda lea en lugar de `calculated_price`; (3)
  cambiar la tienda (`medusaCatalog.js priceOf`) para leer ese precio. La
  alternativa — un *price list* de Medusa para la web — no sirve: las reglas
  de price list de Medusa v2 son por grupo de clientes/región, no por canal de
  venta. Mientras tanto, la forma de mover el precio de la web es el precio
  **maestro** (celda del maestro / precio global del dueño), que `price-sync`
  respeta.

### 10. Correcciones de la QA v2 contra el backend real (7-nov-2026)

- **Subidas**: el contenido va al módulo de archivos en **base64** (los
  proveedores `file-local`/`file-s3` 2.17 decodifican base64 y, si no, UTF-8:
  con `"binary"` cada byte ≥ 0x80 se duplicaba y todo PNG/JPEG salía roto). Lo
  mismo en las fotos de reseñas.
- **Editar modelo**: los colores conservados viajan como `variant_id` (el panel
  mandaba `id` y el servidor planeaba cada color como nuevo → 500 «Variant …
  already exists»; también acepta `id` como alias). La galería se rehace como en
  el alta (fotos extra + fotos de los colores): antes `images: []` dejaba el
  producto sin galería ni portada. `cost` y `prices` del diálogo se escriben con
  los escritores de la celda **solo si cambian** (`frameEditCellWrites`; antes se
  ignoraban en silencio); un costo necesita «Gestionar costos».
- **Estuches sin marca**: `brandOf` (y su SQL `brandSqlOf`) da `case` a un
  producto `metadata.kind = case` sin marca propia, así que el precio, el
  descuento y el interruptor de la cabecera «Estuches» les llegan (matriz, caja,
  búsqueda del POS, Excel «Marcas», conteo de modelos de la marca).
- El panel lee el modelo a editar de `GET /admin/products/:id` (no existe un
  `GET /admin/catalog/frames/:id`; el intento dejaba dos 404 en consola).


### 11. Interruptor general de la marca y lo desactivado al final (7-nov-2026)

- **«Todas»** en la cabecera de cada marca (monturas y estuches) es el
  interruptor de la cadena: `POST /admin/catalog/brands/:slug { active }`
  (`catalog_brand.active`). Apagado, la marca no se vende en el POS de ninguna
  tienda, ni los modelos que lleguen después: `effectiveAssortmentRules`
  (`store-assortment-data.ts`) antepone una regla sintética `chain_brand` a las
  de cada tienda, y `isExposed`/`brandExposed`/`exposureSource` la miran antes
  que nada (fuente `"chain"`). Las reglas de cada tienda no se tocan: al
  encenderla vuelve a mandar el interruptor de cada tienda. La matriz lo lee de
  `MatrixGroup.active` y, mientras está apagada, los interruptores por tienda y
  los ojos de los modelos quedan bloqueados. La tienda online no cambia (C8).
- **Orden**: lo que no se vende en ninguna de las tiendas visibles va al final,
  bajo un separador — marcas (`groupOff`: apagada en la cadena, todos sus
  modelos fuera, o sin modelos y oculta en todas) y, dentro de cada marca, los
  modelos (`rowOff`: descontinuado, marca apagada u oculto en todas las
  columnas). Con el selector global en una tienda, «todas» = esa tienda.
- **Filtro «Desactivados u ocultos»**: modelos ocultos en al menos una tienda
  visible, descontinuados o de marca apagada, más las marcas apagadas sin
  modelos (`rowHiddenSome`, `filterGroups`). Pruebas en `scripts/test-xlsx.mjs`.

### 12. Diseños de lente: alta, edición y baja (9-nov-2026)

- **Lentes** tiene el botón «Diseño de lente» y un ⋯ en cada diseño (Añadir
  material · Editar diseño · Eliminar diseño); cada fila con precio tiene un ⋯
  «Quitar este material». **Tratamientos**: además del ⋯ de cada fila (editar,
  eliminar) y «+ Tratamiento», el ⋯ de los grupos Fotocromáticos y Antirreflejo
  abre el alta con el tipo ya elegido.
- Rutas (dueño y superadmin; un costo pide «Gestionar costos"):
  `POST /admin/pricing/lens-designs` `{ label_es, label_en, category, requires_add?, tier?, use_es?, use_en? }`,
  `POST|DELETE /admin/pricing/lens-designs/:code`,
  `POST /admin/pricing/lens-designs/:code/cells` `{ material_code | new_material, finish?, price, cost? }`,
  `DELETE …/cells?material=&finish=` y `GET /admin/pricing/lens-materials`.
  Validación pura en `lib/lens-design.ts`, escritura en `lib/lens-design-data.ts`.
- La **categoría** (visión sencilla, bifocal, progresivo) no cambia después
  de crear el diseño: de ella dependen los acabados (un progresivo solo tiene
  celda digital, `finish_unavailable`). `requires_add` por defecto: sí en
  bifocal y progresivo.
- **Eliminar un diseño**: si nunca se vendió (`sale_fact.lens_design` ni
  `metadata.lens_config.design_code` de una línea) se borra con sus celdas,
  sus precios de tratamiento por diseño y los precios/descuentos propios de
  las tiendas; si se vendió se **archiva** (`is_active = false`: fuera del
  POS, la web y la matriz; las ventas pasadas conservan su nombre). Quitar un
  material es borrado suave de la celda (y de sus precios por tienda).
- Los grupos de diseño llevan `design` (categoría, nombres, ADD, gama, para
  quién) para el diálogo de edición. Pruebas: `tests/lens-design.test.ts` y
  la QA local t25.
