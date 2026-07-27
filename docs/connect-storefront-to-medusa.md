# Plan: conectar `capri-storefront` (SPA) al backend Medusa

Status: **plan / no implementado**. Documenta el trabajo necesario para migrar la
SPA de un modelo 100 % cliente (catálogo estático + `localStorage`) a uno
respaldado por el backend Medusa v2 (`apps/backend`).

## Punto de partida

Hoy `apps/capri-storefront` **no habla con Medusa en ningún punto**. Es una SPA
React + Vite que:

- Lee el catálogo desde JSON estáticos (`public/catalog.json`, `cases.json`)
  regenerados por [`scripts/sync-catalog.mjs`](../apps/capri-storefront/scripts/sync-catalog.mjs)
  vía GitHub Actions.
- Genera **precios sintéticos** por hash del SKU en cliente
  ([`src/data/products.js`](../apps/capri-storefront/src/data/products.js)).
- Calcula el total del lente en cliente
  ([`src/pages/LensProcess.jsx`](../apps/capri-storefront/src/pages/LensProcess.jsx)).
- Persiste carrito, favoritos, usuarios, órdenes, reseñas y overrides de precio
  en `localStorage`.
- **Descarta la receta**: nunca se persiste ni se sube; el `<input type=file>`
  solo guarda el nombre del archivo.
- Autentica admin y clientes con puertas demo-abiertas (cualquier email entra).

El backend, en cambio, **ya tiene implementado** casi todo lo que la SPA finge en
cliente. La tarea es principalmente de **integración**, no de construcción desde cero.

### Inventario de lo que el backend YA expone

| Capacidad | Endpoint / módulo | Estado |
|---|---|---|
| Precio de lente server-side | `POST /store/lens-config/price` → `LensConfigModuleService.computePrice` | ✅ existe |
| Opciones de lente por uso | `GET /store/lens-config/options?usage_type=…` | ✅ existe |
| Opciones de tratamientos | `GET /store/lens-config/coatings` | ✅ existe |
| OCR de receta (Anthropic vision) | `POST /store/prescriptions/ocr` (multer, ≤10 MB, sube a R2) | ✅ existe |
| Validación de receta | `POST /store/prescriptions/validate` | ✅ existe |
| Leer/borrar receta (admin, audit log) | `GET`/`DELETE /admin/prescriptions/:id` | ✅ existe |
| Pagos Stripe + PayPal + Square | `medusa-config.ts` → payment providers | ✅ configurado |
| Almacenamiento R2 (bucket privado) | `medusa-config.ts` → file-s3 | ✅ configurado |
| Búsqueda Meilisearch | subscribers + `reindex` script | ✅ existe |
| Catálogo de productos (Store API) | `GET /store/products` (nativo Medusa) | ⚠️ falta poblar |

**Gaps de datos y contrato** — lo que NO existe todavía:

- Los productos de caprioptics **no están en la base de datos de Medusa**. El
  scraper Python (`apps/scraper`) debe ingestarlos, o hay que portar el
  `sync-catalog.mjs` para que escriba productos Medusa vía Admin API en vez de JSON.
- El enum de la SPA (`sv`/`bifocal`/`prog-mid`/`prog-high` × `cr39`/`poly`/`1.56`…)
  **no coincide** con el del backend (`single_vision_distance`/`reading`/
  `progressive`/`non_prescription` × índices `1.57`/`1.61`/`1.67`/`1.74`, coatings
  `anti_reflective`/`blue_light`/`photochromic`/`polarized`/`tint`). Hay que decidir
  una fuente de verdad y mapear.
- La matriz de precios 2026 (`lensPricing.js`, diseño×material, fotocromáticos,
  AR) es más rica que el modelo `LensOption`/`CoatingOption` del backend (que solo
  tiene `price_modifier_cents` plano por índice). O se enriquece el modelo backend,
  o se aplana la lógica de la óptica. **Decisión de negocio pendiente.**
- No hay endpoint de carrito propio en la SPA: hay que usar el flujo de **cart /
  line items** nativo de Medusa con `lens_config` + `prescription_id` en el
  `metadata` del line item (el tipo `CartLensMetadata` en
  `@eyewear/shared` ya prevé esto).

---

## Arquitectura objetivo

```
capri-storefront (Vite SPA en Vercel)
      │
      │  @medusajs/js-sdk  (VITE_MEDUSA_URL + publishable API key)
      ▼
Medusa v2 backend (Coolify / Oracle VM)
      ├─ Store API nativa: products, cart, checkout, customers, orders
      ├─ /store/lens-config/*      (precio + opciones server-side)
      ├─ /store/prescriptions/*    (OCR + validación)
      ├─ Postgres (Supabase)   · Redis · Meilisearch
      └─ R2 (bucket privado de recetas, presigned URLs)
```

Regla rectora (de `CLAUDE.md`): **el precio y el total SIEMPRE se calculan en el
servidor**. La SPA solo muestra; nunca envía totales al checkout.

---

## Fases de implementación

Ordenadas para que cada fase deje la app funcionando. Se puede desplegar
incrementalmente detrás de un flag `VITE_USE_MEDUSA`.

### Fase 0 — Fundaciones (backend + SDK cliente) — ✅ COMPLETA Y VALIDADA (2026-07-26)

**Estado:** validada end-to-end contra el backend vivo (Supabase). El seed por
defecto ya traía **"Default Sales Channel"** y **"Default Publishable API Key"**
(asociados) — se reutilizaron, no se creó nada nuevo. `GET /store/products` con la
publishable key → 200; CORS confirmado para `http://localhost:5198`
(`Access-Control-Allow-Origin` en GET y preflight). Valores en `apps/backend/.env`
(`STORE_CORS`) y `apps/capri-storefront/.env` (`VITE_MEDUSA_PUBLISHABLE_KEY`,
`VITE_USE_MEDUSA=false`). Runbook: [`phase-0-setup.md`](./phase-0-setup.md).

**Objetivo:** que la SPA pueda hablar con Medusa aunque todavía no use nada.

1. Añadir `@medusajs/js-sdk` a `apps/capri-storefront/package.json`.
2. Crear un cliente único: `src/data/medusa.js`
   ```js
   import Medusa from "@medusajs/js-sdk";
   export const medusa = new Medusa({
     baseUrl: import.meta.env.VITE_MEDUSA_URL,
     publishableKey: import.meta.env.VITE_MEDUSA_PUBLISHABLE_KEY,
   });
   ```
3. Backend: crear una **publishable API key** y un **sales channel**, y añadir
   `storeCors` con el dominio de Vercel de la SPA en `medusa-config.ts`
   (`STORE_CORS`).
4. Variables de entorno nuevas en el `.env` de la SPA:
   `VITE_MEDUSA_URL`, `VITE_MEDUSA_PUBLISHABLE_KEY`, `VITE_USE_MEDUSA=false`.
5. Feature flag: `export const USE_MEDUSA = import.meta.env.VITE_USE_MEDUSA === "true";`
   para poder mezclar rutas viejas (JSON estático) y nuevas (Medusa) durante la migración.

**Entrega:** SDK conectado, CORS verde, sin cambio visible aún.

### Fase 1 — Catálogo desde Medusa — 🟡 EN CURSO (validada con datos de prueba, 2026-07-26)

**Estado:** el camino de datos SPA → Store API funciona end-to-end. `catalogStore.js`
carga desde Medusa cuando `VITE_USE_MEDUSA=true` (adaptador en
[`medusaCatalog.js`](../apps/capri-storefront/src/data/medusaCatalog.js) → forma que
esperan los componentes; atributos híbrido: tokens EN del scraper → ES canónico →
`tv()`). Validado en navegador: listado (11 productos sembrados, precios reales de
`pricing.yaml`, marcas, colores, imágenes) y PDP (specs + buckets) sin errores.

Scraper **terminado y testeado** (55 tests): `sales_channels` + gate `is_in_stock`
+ color↔imagen (`tokenMatch`) + mapa de marca + medidas bucketizadas +
reconciliación de descatalogados. Además se corrigieron 2 bugs reales que impedían
el push: auth Admin API (Bearer→**Basic**) y falta de `options` en el payload v2.

**Pendiente de Fase 1:** poblar el catálogo completo (correr el scraper real con
secret key + R2, o ampliar el seed); `original_price_cents`/compare-at en el
adaptador; considerar Meilisearch para el listado con filtros a escala. Seed de
desarrollo: `apps/scraper/scripts/seed_medusa_dev.py`.

**Objetivo:** que armaduras y estuches vengan de la Store API, no de los JSON.

1. **Poblar productos.** Decidir la ruta de ingestión:
   - **Opción A (recomendada):** adaptar `apps/scraper` para que escriba productos
     Medusa vía Admin API (título, handle, imágenes por variante-color, atributos
     en `metadata`, precio en la region/price list). Encaja con la fase "Catálogo"
     del roadmap.
   - **Opción B (rápida):** reescribir `sync-catalog.mjs` para hacer upsert de
     productos vía Admin API en lugar de emitir `catalog.json`.
   - Los **precios reales** dejan de ser hash-de-SKU: se cargan en una price list
     de Medusa. El dueño los edita desde el admin nativo de Medusa (reemplaza el
     `priceStore.js` de `localStorage`).
2. **Capa de datos.** Reescribir [`src/data/catalogStore.js`](../apps/capri-storefront/src/data/catalogStore.js)
   para que `loadLive()` llame a `medusa.store.product.list({ ... })` con paginación,
   o mejor, buscar contra Meilisearch para el listado con filtros.
   - Mapear el producto Medusa → la forma que ya esperan los componentes
     (`{ sku, name, brand, colors:[{name,image,hex}], attributes, price, slug }`)
     en un adaptador, para no reescribir `ProductCard`, `Catalog`, `ProductDetail`.
3. **Mantener el seed estático** como fallback offline (ya existe ese patrón).
4. **i18n de catálogo:** el texto de título/descripción se resuelve con
   `resolveLocalizedFrameText`/`resolveLocalizedProductMetadataText` de
   `@eyewear/shared` leyendo `product.metadata.i18n`, no re-traduciendo en cliente.

**Entrega:** listado, PDP y detalle de estuche sirviendo datos de Medusa con
precios reales. Try-on y reseñas siguen igual (el try-on no depende del backend).

### Fase 2 — Configurador de lentes con precio server-side

**Objetivo:** eliminar el cálculo de total en cliente de `LensProcess.jsx`.

1. **Unificar el vocabulario de lentes.** Crear un mapa
   SPA↔backend (`usage_type`, `index`, `coatings`) en `@eyewear/shared` o en un
   `src/data/lensMap.js`. Resolver el desajuste de la matriz 2026:
   - Si el negocio necesita la matriz diseño×material completa (bifocal FT-28,
     progresivo gama media/alta, fotocromáticos por categoría, dos familias de AR),
     hay que **extender los modelos del backend** (`LensOption`/`CoatingOption`) y
     el seed. Esta es la subtarea de mayor riesgo — confirmar con el dueño la lista
     de precios definitiva antes de codificar.
2. **Paso 0/2 del wizard** consumen `GET /store/lens-config/options` y `/coatings`
   en vez de las constantes locales `DESIGNS`/`MATERIALS`/`PHOTO`/`AR`.
3. **Total:** cada cambio en el wizard llama a
   `POST /store/lens-config/price` con `{ frame_price_cents, lens_config }` y muestra
   `total_cents` devuelto. Se borra el `useMemo` de total local.
4. **Precios editables por el dueño:** dejan de vivir en `priceStore.js`
   (`localStorage`) y pasan a los `price_modifier_cents` de los modelos de lente,
   editables desde el admin de Medusa.

**Entrega:** el total mostrado es el que dictará el checkout; imposible manipularlo
desde el navegador.

### Fase 3 — Receta (dato de salud) con OCR y persistencia

**Objetivo:** que la receta se capture, valide, (opcionalmente) se lea por OCR, y
se guarde con el tratamiento PHI que exige `CLAUDE.md`.

1. **Subida + OCR:** el `<input type=file>` del paso 1 hace
   `POST /store/prescriptions/ocr` (multipart). La respuesta prefila el formulario
   `rx` y marca `verified_by_user=false`. El archivo se sube al bucket **privado**
   de R2 desde el backend (ya implementado); la SPA nunca toca R2 directamente.
2. **Confirmación humana obligatoria:** UX de "revisa y confirma los valores"
   antes de permitir continuar (el backend ya devuelve ese `message` y el flag).
3. **Validación:** `POST /store/prescriptions/validate` con `usage_type` y
   `eye_size` de la armadura; mostrar warnings/errores.
4. **Persistencia:** al añadir al carrito, crear el registro de receta y guardar su
   `id` en el `metadata` del line item (`CartLensMetadata.prescription`). **Nunca**
   meter valores de receta crudos en `localStorage`.
5. **Cuenta del cliente:** la página "Mi cuenta" lista recetas del customer
   autenticado (requiere Fase 4).

**Entrega:** receta capturada, validada y almacenada como PHI; auditable y
borrable vía `DELETE /admin/prescriptions/:id`.

### Fase 4 — Autenticación real de clientes

**Objetivo:** reemplazar la puerta demo-abierta de `userAuth.js`.

1. Usar el **auth de clientes de Medusa** (`medusa.auth.*` / customer sessions)
   en vez de guardar `{email,phone}` en `localStorage`.
2. `AuthPanel` y `AccountPage` pasan a login/registro reales; el token se maneja
   con el SDK (JWT o cookie de sesión según `authCors`).
3. Órdenes, recetas y favoritos se asocian al `customer_id` real.
4. **Favoritos/reseñas:** decidir si migran a un módulo custom del backend o siguen
   en cliente. Recomendación: favoritos → wishlist en backend; reseñas → módulo
   custom o servicio externo (hoy son `localStorage` por producto).

**Entrega:** identidad de cliente real, base para historial de pedidos.

### Fase 5 — Carrito y checkout nativos de Medusa

**Objetivo:** el carrito y el pago dejan de ser `localStorage` + `alert()`.

1. **Carrito:** reescribir [`CartContext.jsx`](../apps/capri-storefront/src/components/CartContext.jsx)
   sobre el **cart de Medusa**:
   - `medusa.store.cart.create({ region_id, sales_channel_id })`, guardar solo el
     `cart_id` en `localStorage`.
   - `addItem` → `createLineItem` con `variant_id` (color) + `metadata`
     (`lens_config`, `prescription_id`, breakdown de precio).
   - El total lo devuelve Medusa; la SPA nunca lo suma.
2. **Envíos:** reemplazar `ShippingEstimator` + zonas de `priceStore.js` por
   **shipping options / fulfillment** de Medusa (regiones, tarifas, pickup).
3. **Checkout:** flujo de payment sessions de Medusa con los providers ya
   configurados (Stripe/PayPal/Square). Completar el cart → order.
4. **Confirmación de orden real** en vez de `alert(t("cart.done"))`.

**Entrega:** pedido real, cobrado, con receta y configuración de lente adjuntas.

### Fase 6 — Panel admin

**Objetivo:** decidir el destino del dashboard cliente actual.

1. El `AdminDashboard.jsx` (analytics de `localStorage`, charts, overrides de
   precio) es **por navegador** y no sirve para SaaS multi-dispositivo.
   Recomendación: **retirarlo** en favor del **admin nativo de Medusa** para
   catálogo, precios, pedidos y recetas.
2. Si se quiere conservar analytics propias, mover los `track*`/`recordOrder`
   (el "seam" ya señalado en `analytics.js`) a eventos POSTeados a un endpoint del
   backend.
3. La autenticación admin real la da Medusa (`/auth/user`), reemplazando
   `adminAuth.js`.

**Entrega:** una sola fuente de verdad administrativa.

---

## Decisiones (RESUELTAS — 2026-07-26)

1. **Matriz de precios de lentes:** ✅ **Extender el backend a la matriz 2026
   completa** (diseño×material + fotocromáticos por categoría + dos familias de AR).
   Ampliar `LensOption`/`CoatingOption` y el seed. Es el trabajo de mayor riesgo de
   la Fase 2. *(Antes de codificar, confirmar la lista de precios definitiva de la
   óptica.)*
2. **Ingestión de catálogo:** ✅ **Usar `apps/scraper` (Python)** como pipeline de
   ingestión periódica. Ya empuja a Medusa vía Admin API. Portar de
   `sync-catalog.mjs` lo que falta (sales channel, gate `is_in_stock`,
   reconciliación de descatalogados, color↔imagen por `tokenMatch`, nombre de marca,
   medidas bucketizadas). Detalle en
   [`scraper-medusa-ingestion-analysis.md`](./scraper-medusa-ingestion-analysis.md).
3. **Reseñas y favoritos:** ✅ **Ambos en backend** (módulos custom Medusa ligados a
   `customer_id`). Reemplaza el `localStorage` actual.
4. **Normalización de atributos de filtro:** ✅ **Híbrido** — medidas
   (eye/bridge/temple) bucketizadas en el scraper (idioma-neutral, para las facetas
   de Meilisearch); valores nominales (forma/material/género/edad) traducidos en la
   SPA vía `tv()`.
5. **Pagos:** ✅ **Stripe como pasarela principal**, manteniendo la arquitectura
   multi-pasarela **Stripe / PayPal / Square** ya configurada en `medusa-config.ts`.
6. **Try-on:** se mantiene tal cual (cliente + MediaPipe CDN). No requiere backend.
   Único apunte: hoy carga MediaPipe y el modelo desde CDNs externos — evaluar si se
   self-hostean para el deploy productivo. (A futuro podría usar los
   `r2_tryon_keys` sin fondo que ya genera el scraper.)

**Alcance de la ronda actual:** Fase 0 completa y **validada** antes de avanzar a
la Fase 1.

## Riesgos y notas

- **CORS y publishable key** son la causa #1 de fricción inicial: verificar
  `STORE_CORS`, sales channel y key antes de nada (Fase 0).
- **Migración incremental:** el flag `VITE_USE_MEDUSA` permite migrar página por
  página sin romper producción. Sugerido: catálogo → lentes → receta → auth →
  checkout.
- **Datos de salud:** hasta que la Fase 3 esté completa y verificada, la receta NO
  debe persistirse en ningún sitio del cliente. El backend ya trata R2 como bucket
  privado con presigned URLs y audit log — no reintroducir atajos en cliente.
- **Precio nunca en cliente:** cualquier PR que envíe un total calculado en el
  navegador al checkout viola `CLAUDE.md` y debe rechazarse.

## Estimación de secuencia

| Fase | Depende de | Riesgo |
|---|---|---|
| 0 Fundaciones | — | bajo |
| 1 Catálogo | 0, decisión #2 | medio (ingestión de datos) |
| 2 Lentes | 1, decisión #1 | **alto** (desajuste de modelo) |
| 3 Receta | 1 | medio (PHI, UX de confirmación) |
| 4 Auth cliente | 0 | bajo |
| 5 Carrito/checkout | 1,2,4 | **alto** (pagos, envíos) |
| 6 Admin | 1,2 | bajo (mayormente retirar código) |
