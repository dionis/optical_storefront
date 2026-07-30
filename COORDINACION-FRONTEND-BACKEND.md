# Coordinación Frontend ⇄ Backend (Medusa) — estado de la conexión

Fecha: 2026-07-30 · Rama: `frontend_dev` · Backend probado en vivo: `https://api.161-153-9-98.sslip.io`

Objetivo: que el frontend (`apps/capri-storefront`) empiece a tomar datos del backend de
Dionis **sin modificar el backend**, quitando datos hardcodeados **cuando el backend ya
los soporte**. Donde el backend todavía no da el dato/servicio, se documenta aquí para
coordinar (no se borra el hardcode, para no romper la tienda en vivo).

---

## 1. Lo que YA funciona contra el backend

- **`.env` del storefront** ya apunta al backend live:
  - `VITE_MEDUSA_URL=https://api.161-153-9-98.sslip.io`
  - `VITE_MEDUSA_PUBLISHABLE_KEY=<presente>`
  - `VITE_USE_MEDUSA=true`, `VITE_STRIPE_PUBLISHABLE_KEY=<presente>`
- **Salud del backend:** `GET /health` → 200. `GET /store/regions` → 200 (región `usd`).
- **OCR de recetas:** el frontend YA consume `POST /store/prescriptions/ocr`
  (en `LensProcess.jsx`, con `x-publishable-api-key`). El endpoint responde (400 sin
  archivo = validando input, correcto). *Pendiente de confirmar que `ANTHROPIC_API_KEY`
  esté puesta en el backend para que no caiga en fallback.*
- **Productos:** `GET /store/products` → 200, **221 productos** cargados en Medusa.
  Con `region_id` los precios calculados vienen (ej. DC407 → calculated_amount 129).

## 2. BLOQUEADORES — el backend todavía no soporta esto (necesito coordinar con Dionis)

### 2.1 Atributos de montura ausentes en los productos de Medusa
El storefront depende de atributos que **no vienen** en `/store/products`:

| Dato que usa el frontend | ¿Está en Medusa hoy? |
|---|---|
| Marca / `brand_slug` (filtro de 9 marcas, páginas de marca) | ❌ vacío (no en metadata, ni tags, ni collection/type) |
| Forma (`shape`), género, edad (`Niños`/`Adulto`) | ❌ ausente |
| Tamaños (ojo / puente / patilla) | ❌ ausente |
| Descripción del producto | ❌ `description` vacío |
| Color (variantes) | ✅ sí — `options.Color[Black, Light Blue, Light Pink]` |
| Imagen | ⚠️ ruta **relativa** (`products/…webp`), falta base pública (CDN R2) |
| Precio | ⚠️ requiere `region_id`; además **difiere** del catálogo actual (Medusa 129 vs tienda 35.95) |

**Impacto:** si migro el catálogo a Medusa hoy, se rompen los filtros por marca/forma/
género/edad, las páginas de marca, la ficha (tabla de especificaciones) y la
recomendación de material por edad (`edad = Niños → policarbonato`). Por eso **NO** quito
`catalog.json` / `products.js` todavía.

**Necesito de Dionis (una de estas):**
- (a) Que los productos de Medusa lleven esos atributos en `metadata` (o tags/collection),
  **o**
- (b) Que exista un endpoint/JSON que sirva el catálogo enriquecido (equivalente al
  `catalog.json` que hoy genera el scraper), con base de imágenes pública (R2_PUBLIC_URL).
- Confirmar la **fuente de verdad de precios** (¿Medusa o el catálogo? hoy no coinciden).

### 2.2 Lens-config caído (500)
- `GET /store/lens-config/options` → **500 Internal Server Error**
- `GET /store/lens-config/coatings` → **500 Internal Server Error**
- `POST /store/lens-config/price` (no probado por depender del módulo)

**Impacto:** no se puede mover el precio de lentes al backend. Hoy el frontend usa su
propia matriz (`data/lensPricing.js` estilo Zeelool: diseños × materiales, fotocromáticos,
AR). Además el modelo del backend (`usage_type` + `options`/`coatings` + `computePrice`)
**no coincide 1:1** con el modelo Zeelool del frontend.

**Necesito de Dionis:**
- Arreglar el 500 (probable: falta correr migración/seed del módulo `lens-config`).
- Confirmar el modelo definitivo de lentes: ¿el backend se adapta al modelo Zeelool del
  frontend, o el frontend se re-arma al modelo `usage_type/options/coatings` del backend?
  (esto define un rework grande; conviene acordarlo antes de tocar).

### 2.3 Órdenes / carrito / checkout
- El frontend hoy guarda órdenes en `localStorage` (`admin/analytics.js`).
- Medusa tiene carrito/orden estándar, pero **no está integrado** en el frontend.
- No hay endpoint propio de órdenes en el backend (solo `admin/prescriptions/[id]`).

**Necesito de Dionis:** definir si el checkout pasa a carrito/orden de Medusa (Phase 5 —
pagos Stripe/PayPal/Square). Es una integración grande; hoy queda en localStorage.

### 2.4 Sin categorías, sin metadata
- `GET /store/product-categories` → 0 categorías.

## 3. Variables hardcodeadas / sin respaldo en backend (inventario)

Estas siguen locales **porque el backend aún no las provee** (ver bloqueadores):
- Catálogo y atributos: `data/products.js`, `public/catalog.json` (seed + fuente real hoy).
- Marcas permitidas: `data/brands.js` (`ALLOWED_BRAND_SLUGS`).
- Precios de lentes: `data/lensPricing.js` + overrides admin `admin/priceStore.js`.
- Config de tienda/envío (dirección de recogida, zonas): `admin/priceStore.js`.
- Órdenes/analítica: `admin/analytics.js` (localStorage).

Se quitarán/migrarán **en cuanto el backend exponga el equivalente** (secciones 2.1–2.4).

## 4. Plan de migración incremental propuesto (cuando se resuelvan los bloqueadores)

1. **Catálogo** → cliente Medusa `getProducts(region_id)` detrás de `VITE_USE_MEDUSA`,
   con `catalog.json` como fallback, **una vez** que los productos traigan marca/atributos
   e imágenes con base pública. Mapear a la forma que espera `catalogStore`.
2. **Recetas**: además del OCR (ya conectado), conectar `POST /store/prescriptions/validate`.
3. **Precio de lentes** → `POST /store/lens-config/price` una vez arreglado el 500 y
   acordado el modelo.
4. **Checkout** → carrito/orden Medusa (fase de pagos).

Cada paso queda detrás de flag y con fallback, para no romper la versión estable
(`frontend`, tag `estable-checkout-2026-07-30`).
