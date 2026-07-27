# Análisis: qué adaptar de `sync-catalog.mjs` al scraper Python

Status: **análisis / decisión de ingestión (Fase 1 del plan)**. Compara el script
estático [`apps/capri-storefront/scripts/sync-catalog.mjs`](../apps/capri-storefront/scripts/sync-catalog.mjs)
con el pipeline Python [`apps/scraper`](../apps/scraper) — que es el que se usará
para poblar Medusa periódicamente — e identifica qué lógica del primero conviene
portar al segundo.

## Hallazgo principal

**El scraper YA empuja a Medusa.** No hay que construir la ingestión desde cero:
`apps/scraper/scraper/medusa_push.py` ya hace upsert de productos vía Admin API
(`POST /admin/products`, búsqueda por `handle`), con precios reales de
`pricing.yaml`, traducciones es/fr en `metadata.i18n`, imágenes re-hospedadas en R2
y detección de cambios por `content_hash` (`state.db`). El flujo completo está en
`sync.py`: Store API → parser → translate → imágenes/R2 → `upsert_product`.

Por tanto la tarea real es **cerrar las brechas** entre lo que el scraper produce
hoy y lo que la SPA + Meilisearch esperan — y varias de esas brechas ya están
resueltas dentro de `sync-catalog.mjs`.

## Tabla comparativa

| Capacidad | `sync-catalog.mjs` | `apps/scraper` | Acción |
|---|---|---|---|
| Fuente de datos | WooCommerce Store API | Store API + fallback HTML | scraper ya es superior |
| Precio | hash-de-SKU (sintético) | `pricing.yaml` por colección | scraper ya es superior |
| Empuje a Medusa | ❌ (emite JSON) | ✅ Admin API upsert | scraper ya lo hace |
| Traducción i18n | ❌ | ✅ es/fr en `metadata.i18n` | scraper ya lo hace |
| Imágenes R2 | ❌ (hotlink) | ✅ download→optimize→R2 | scraper ya lo hace |
| **Gate de disponibilidad (`is_in_stock`)** | ✅ salta agotados | ❌ ingesta todo | **PORTAR (alta)** |
| **Descatalogado (self-healing)** | ✅ desaparece solo | ❌ queda `published` | **PORTAR (alta)** |
| **Imagen por color** | ✅ tokenMatch nombre↔URL | ⚠️ posicional (frágil) | **PORTAR (alta)** |
| **Nombre bonito de marca** | ✅ mapa slug→"Di Caprio" | ❌ solo `collection_slug` | **PORTAR (media)** |
| **Normalización de atributos** | ✅ ES canónico + buckets mm | ⚠️ inglés crudo | **DECISIÓN (ver abajo)** |
| Descubrimiento de marcas | ✅ auto desde categorías | lista fija en `config.py` | opcional (baja) |
| Meta/history diario (added/removed) | ✅ para admin | ❌ (hay `state.db`) | probablemente descartar |
| **Asociar sales channel** | n/a | ❌ falta | **BLOQUEANTE Fase 1** |

## Brechas críticas (bloquean la Fase 1)

### 1. El payload NO asocia sales channel — BLOQUEANTE

`_build_medusa_payload` (medusa_push.py:48-81) crea el producto con
`status: "published"` pero **sin `sales_channels`**. En Medusa v2 la Store API
filtra productos por sales channel vía la publishable key. **Si el producto no está
ligado al sales channel de la SPA, el storefront no lo verá** aunque esté publicado.

- **Acción:** añadir `"sales_channels": [{ "id": config.medusa_sales_channel_id }]`
  al payload, y una env var `MEDUSA_SALES_CHANNEL_ID` en `config.py`. El ID sale del
  sales channel que se crea en la Fase 0 (ver `docs/phase-0-setup.md`).

### 2. Gate de disponibilidad + descatalogado

`parse_store_api_product` ingesta todo; no mira `is_in_stock`. `sync-catalog.mjs`
salta lo agotado (`if (p.is_in_stock !== true) continue`, línea 172) y, al
regenerar el catálogo entero, lo agotado desaparece solo.

- **Acción (ingesta):** propagar `is_in_stock` desde el Store API al `ScrapedProduct`
  y, en `sync.py`, saltar (o marcar `status: "draft"`) los no disponibles.
- **Acción (self-healing):** como el scraper es incremental (no regenera todo),
  necesita un paso de reconciliación: los productos en Medusa cuyo `handle` ya no
  aparece en el sync más reciente deben pasar a `status: "draft"`/unpublished. Hoy
  no existe — `state.db` solo detecta cambios, no ausencias. Es la pieza de
  "catálogo auto-sanador" que `sync-catalog.mjs` tenía gratis y aquí hay que añadir.

### 3. Correspondencia color ↔ imagen

`medusa_push` asigna `r2_image_keys[idx]` a la variante `idx` por **posición**
(medusa_push.py:40-42), lo que no garantiza que la variante "Black" reciba la foto
"Black". `sync-catalog.mjs` resuelve esto con `tokenMatch()`: casa los tokens del
nombre del color contra la URL de la imagen (líneas 112-120, 212-222).

- **Acción:** portar `tokenMatch` a Python y mapear color→imagen por nombre antes de
  subir a R2, en vez de por índice. Guardar la asociación para que la variante de
  cada color apunte a su R2 key correcta.

## Decisión pendiente (te la pregunto)

### Normalización de atributos: ¿en el scraper o en el storefront?

`sync-catalog.mjs` normaliza a **español canónico + buckets de milímetros**
(`"square"`→`"Cuadrado"`, `52`→`"51-53 mm"`) — justo lo que los filtros de la SPA
esperan hoy. El scraper guarda valores **crudos en inglés** (`material`, `shape`
en minúscula del HTML; `eye_size` numérico). `product-to-document.ts` los pasa a
Meilisearch tal cual, así que las facetas de filtro quedarían en inglés crudo.

Hay dos caminos coherentes (no ambos):

- **A — Normalizar en el scraper:** portar los mapas `SHAPE/MAT/GEN/AGE` y las
  funciones `bEye/bBridge/bTemple` de `sync-catalog.mjs` a Python, y escribir en
  `metadata` valores ya canónicos. Pro: la SPA y Meilisearch reciben datos limpios
  y filtrables sin lógica extra. Con: la normalización idioma-específica vive en el
  pipeline; añadir un tercer idioma obliga a re-scrapear.
- **B — Normalizar en el storefront:** guardar los atributos crudos (como ahora) y
  traducir/bucketizar en la SPA con el helper `tv()` (traduce valores) que ya existe
  en `translations.js`. Pro: separa datos de presentación; multi-idioma sin
  re-scrapear. Con: hay que mantener el diccionario `tv()` y los buckets en cliente,
  y las facetas de Meilisearch seguirían en crudo (habría que bucketizar en el
  índice o en la query).

Mi recomendación: **híbrido** — bucketizar las **medidas** (eye/bridge/temple) en el
scraper porque es idioma-neutral y Meilisearch necesita las facetas ya agrupadas;
y traducir los **valores nominales** (shape/material/gender/age) en el storefront
vía `tv()`, consistente con la regla de CLAUDE.md de que la UI se traduce con `t()`
y el contenido de catálogo (título/descripción) ya viene traducido en
`metadata.i18n`.

## Brechas menores

- **Nombre de marca:** portar el mapa `BRAND` (slug→"Di Caprio", "4u"→"Four You")
  y escribir `metadata.brand` + `metadata.brand_slug`. Hoy solo hay
  `collection_slug`; la SPA muestra `product.brand` bonito.
- **Descubrimiento de colecciones:** `config.py` fija 17 colecciones a mano;
  `sync-catalog.mjs` autodetecta marcas nuevas desde las categorías (con un set
  `IGNORE`). Baja prioridad: la lista fija funciona, pero una marca nueva del
  proveedor no aparece hasta añadirla. Opcional portar la autodetección.
- **Try-on:** el scraper ya genera `r2_tryon_keys` (PNGs sin fondo). A futuro el
  probador virtual podría usar esas imágenes recortadas en vez del truco
  `mix-blend-mode: multiply` — no es parte de esta fase pero es un buen enganche.

## Puntos a verificar en el payload de Medusa v2 (no asumir)

- **Precios de variante:** el payload usa `"prices": [{ "currency_code": "usd",
  "amount": ... }]`. En Medusa v2 los precios de variante pueden requerir
  price sets / región. Verificar contra la Admin API v2.8 que este shape crea
  precios correctamente (o ajustar a price lists).
- **`variant["images"]`:** las variantes de producto en Medusa v2 no tienen campo
  `images` nativo (las imágenes son a nivel de producto). Ese campo probablemente
  se ignora en silencio. Para imagen-por-color, la vía correcta es guardar la R2 key
  del color en `variant.metadata` y que la SPA la resuelva, o usar la galería de
  producto ordenada por color.

## Resumen de trabajo a portar (orden sugerido)

1. **Sales channel** en el payload + env var (bloqueante). 
2. **`is_in_stock`** → saltar/marcar draft agotados.
3. **Reconciliación de descatalogados** → unpublish lo ausente.
4. **Color↔imagen por `tokenMatch`** (no posicional).
5. **Mapa de marca** (slug→nombre) en metadata.
6. **Medidas bucketizadas** en el scraper (parte de la decisión híbrida).
7. Verificar shape de precios y estrategia de imagen-por-color en Admin API v2.

Nada de esto reemplaza al scraper: son parches sobre `medusa_push.py`,
`parser.py`, `models.py`, `config.py` y `sync.py`. `sync-catalog.mjs` queda como
referencia (y como fallback estático de la SPA) pero deja de ser la fuente de
verdad de ingestión.
