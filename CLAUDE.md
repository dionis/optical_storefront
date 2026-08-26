# Eyewear Store — CLAUDE.md

## Project overview

Online store for prescription eyeglasses. Catalog ingested via scraping from caprioptics.com (WooCommerce B2B supplier). Lens-selection funnel mirrors Zeelool. Includes virtual try-on and AI prescription OCR.

## Monorepo structure

```
eyewear-store/
├── apps/
│   ├── backend/           # Medusa.js v2, Node 20, TypeScript strict
│   ├── capri-storefront/  # React 18 + Vite storefront (static catalog, admin panel)
│   └── scraper/           # Python 3.12 catalog ingestion
├── packages/
│   └── shared/        # Shared TS types (Prescription, LensConfig, FrameAttributes) + Meilisearch doc/settings + i18n locale-text helpers
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   └── github-actions/
└── CLAUDE.md
```

## Development phases

1. **Scaffold** — monorepo, docker-compose, Medusa boots, Next.js boots, shared types, CI skeleton ✅
2. **Catalog** — scraper MVP, Meilisearch indexing, listing page with filters
3. **Product & funnel** — PDP, lens-config module, 4-step wizard, dynamic pricing, cart
4. **Prescription OCR** — upload endpoint, Anthropic vision, prefill+confirm UX
5. **Payments** — Stripe → PayPal → Square custom provider
6. **Try-on** — rembg pipeline, MediaPipe overlay
7. **Production** — prod compose, Coolify deploy, backups, full scraper, smoke tests

## Key conventions

- Conventional commits; one phase = one or more focused commits
- TypeScript strict mode everywhere
- All code, comments, identifiers in English; UI copy goes through the `t(key)` dictionary in `apps/capri-storefront/src/i18n/translations.js` (`es` default, `en` second — language is toggled client-side and persisted in `localStorage`, there are no locale-prefixed URLs). Never hardcode UI strings in components — add the key to both `es` and `en`. Esto **incluye el panel corporativo** (`/admin`, namespace `adm.*`) y los `aria-label`/`title`/`placeholder`, no solo el texto visible. Excepciones legítimas: nombres propios (marca, tienda) y datos configurables por el dueño (`priceStore.js`), que no son copy.
  - **Módulos sin hook de idioma** (`adminApi.js`, `adminAuth.js`, `analytics.js`, tablas de constantes) nunca devuelven prosa: devuelven **claves** (`"adm.err.badCredentials"`, `label: "adm.dow.1"`) y traduce quien pinta. Un módulo que no puede llamar a `useLang()` tampoco puede elegir el idioma.
  - **Errores del backend**: las rutas mandan un `reason` (código) además del `message` (nota en inglés para logs). El panel lo convierte en `adm.err.stage.<reason>`; ver `stageErrorText()` en `adminOrders.js`. Una frase en español desde el servidor sería la única cadena de la pantalla que ignora el idioma elegido.
  - Formato de moneda y fechas también sigue el idioma (`money(v, currency, lang)`, `shortDate(v, lang)`): un panel que se queda con formato español tras cambiar a inglés está traducido a medias.
  - `pnpm check:i18n` (también dentro de `pnpm test`) falla si una clave existe en un idioma y no en el otro, o si un `t("…")` literal no resuelve. `t()` cae en silencio al nombre de la clave, así que sin este check el fallo solo lo ve quien cambió de idioma.
- Product catalog content (title/description) is translated at scrape time by the AI translation pipeline (`apps/scraper/scraper/translate.py`) into `product.metadata.i18n.{es,fr}`; the storefront resolves display text via `resolveLocalizedFrameText`/`resolveLocalizedProductMetadataText` in `@eyewear/shared`, never by re-translating client-side
- Never trust client-side totals — price always computed server-side. This includes display-only filler fields (rating, review count, best-seller flag, "compare at" price) generated deterministically by `apps/scraper/scraper/filler.py` — they are presentation metadata only and must never feed into actual pricing/checkout math
- Prescriptions are health data: R2 prescription bucket is private, presigned URLs only
- Never commit credentials; all secrets via env vars
- Check `node_modules` package types before inventing Medusa v2 API signatures
- Tests: unit tests for prescription validation + pricing, integration tests for scraper parser (no live HTTP in CI)

## Commands

```bash
# Start all services (backend + storefront + vto-web; vision-measure is Python,
# started separately — see dev:backend below)
pnpm dev

# Start just the storefront + the try-on app together
pnpm dev:frontend

# Start just the Medusa backend + the vision-measure AI service together
# (uv resolves/installs apps/vision-measure's own .venv on first run — no setup step)
pnpm dev:backend

# Lint / typecheck
pnpm lint
pnpm typecheck

# Tests
pnpm test

# Full Meilisearch reindex
pnpm reindex

# Scraper
cd apps/scraper
python -m scraper sync [--full] [--collection SLUG] [--dry-run]
```

## Checkout, notifications & store settings

- **Checkout (`apps/capri-storefront/src/pages/MedusaCheckout.jsx`)**: full order summary above "Finalizar compra" (lens type via `DESIGN_LBL`, material/photo/AR codes, "✓ con receta", subtotal/envío/impuestos/total); patient mobile phone captured organically (sent in `shipping_address.phone` + cart `metadata`); "card = patient" checkbox autofills Stripe `billingDetails`; email/SMS confirmation checkboxes → cart `metadata.notify_email/notify_sms`. Anti-double-click loaders on the buy transition and checkout buttons.
- **Notifications (`apps/backend`)**: `order.placed` subscriber sends **email** (Resend provider, `src/modules/notification-resend`) and **SMS** (Twilio provider, `src/modules/notification-twilio`) to the customer (when opted in) and the store owner. Each provider registers only when its credentials exist; otherwise the channel falls back to `notification-local` (logs) so the backend always boots. Env: `RESEND_*`, `TWILIO_*`, `STORE_ORDER_NOTIFICATION_EMAIL/SMS`.
- **Store settings (`src/modules/store-settings`)**: single-row admin-configurable config (owner email, owner SMS, active payment provider), resolved via `src/lib/store-settings.ts` with env fallback. Routes: `GET/POST /admin/store-settings`, `GET /store/store-settings` (public: payment provider only). Mirrors the `ocr-config` module pattern.
- **Seguimiento de pedidos (invitados)**: el checkout es de invitado, así que la identidad es "control probado de un correo". `POST /store/order-access/request` manda un enlace mágico (token HMAC, 30 min), `POST /store/order-access/verify` lo canjea por un token de sesión (90 días, en `localStorage`), y `GET /store/my-orders` devuelve **todos** los pedidos de esa dirección con su etapa. Sin tabla ni migración: los tokens son firmados y sin estado (`src/lib/order-access.ts`); rotar `ORDER_ACCESS_SECRET` los invalida todos. La página es `/my-orders` en el storefront. `POST /store/order-support` abre un hilo con soporte desde ahí (motivo enumerado, nunca asunto libre). **Medusa deja `GET /store/orders/:id` sin autenticar** (hay un TODO en su propio código) y nuestros pedidos referencian `prescription_id`, así que esa ruta se bloquea en `src/api/middlewares.ts`.
- **Cancelación por el cliente**: `cancelEligibility` en `src/lib/order-status.ts` es la política de la tienda, no la de Medusa. El cliente solo puede cancelar cuando **se cumplen las dos condiciones**: (1) han pasado los `LAB_BUSINESS_DAYS` (10 días hábiles, sin calendario de festivos) desde la compra, y (2) el pedido salió de la óptica hace más de `SHIPPING_GRACE_HOURS` (24 h). El reloj de envío arranca en `shipped_at` del último *fulfillment* vivo, con respaldo en `packed_at`/`created_at` — el dueño marca `in_transit` a mano y no siempre llega a hacerlo. Si no se cumple, la respuesta es **409 con `reason` + `window`** (números e instantes ISO, nunca prosa): la página pinta los dos plazos con `orders.cancelWhy*` en el idioma elegido. Mantener los 10 días sincronizados con `order_confirmation_next_steps_body` en `lib/email/copy.ts`.
  - **Ejecución**: Medusa no puede cancelar un pedido con un *fulfillment* vivo (`cancelValidateOrder`) ni cancelar un *fulfillment* ya enviado (`cancelOrderFulfillmentValidateOrder`), y esta política solo se abre cuando ya salió algo. Así que la ruta cancela primero los *fulfillments* sin `shipped_at` y, si no queda ninguno vivo, corre `cancelOrderWorkflow` (`status: "canceled"`, reembolso automático). Si el paquete ya iba en camino no hay nada en Medusa que lo cancele: se registra la cancelación autorizada en `order.metadata.cancellation_*` y responde `status: "pending_return"`. **Las dos respuestas tienen correo distinto** — decirle al cliente que le devolvimos el dinero cuando no se ha movido es el peor fallo posible aquí.
  - **Aviso a los administradores**: el correo lleva quién canceló (la dirección que probó control del pedido), cuándo, el motivo enumerado (`cancelReason.*`, nunca texto libre en el asunto), la nota opcional y la frase de política que explica **por qué se permitió**. En `pending_return` el asunto empieza por `ACCIÓN:` porque es una tarea, no un recibo.
- **Etapas del pedido**: `src/lib/order-status.ts` combina `payment_status` + `fulfillment_status` + `metadata.lab_stage` (paso manual del laboratorio, que Medusa no modela) en una sola etapa: `confirmed → in_lab → shipped → in_transit → delivered`. El envío real siempre gana sobre la nota manual. Cancelado/reembolsado/pago pendiente son `terminal`, no etapas. Mantener `ORDER_STAGES` sincronizado con `STEPS` en `TrackingTimeline.jsx` y con `STAGES` en `apps/capri-storefront/src/admin/adminOrders.js` — son la misma línea de tiempo vista desde tres sitios.
- **Panel del dueño (pestaña Pedidos)**: `/admin` en el storefront, backend en `src/api/admin/order-board/`. `GET /admin/order-board` lista con búsqueda libre, rango de fechas, etapa, estado terminal y con/sin receta; `POST /admin/order-board/:id/stage` traduce una etapa a la operación real de Medusa (nota `lab_stage` → `createOrderFulfillment` → `createOrderShipment` → `markAsDelivered`). La etapa **no es una columna** (sale de tres fuentes, una en `metadata`), así que solo el rango de fechas se filtra en la base de datos: el resto se aplica sobre una ventana acotada (`MAX_BOARD_SCAN`) y la respuesta trae `truncated` — el panel debe mostrarlo, no paginar en silencio sobre una respuesta parcial. El panel solo ofrece `next_stages` (lo que el servidor acepta), nunca decide por su cuenta. Login = credenciales de Medusa (`/auth/user/emailpass`), y las llamadas admin van por el proxy mismo-origen `/medusa` para no depender de `adminCors`. Las otras pestañas (Resumen/Ventas/Productos) siguen leyendo datos demo de `localStorage`.
- **Notificación a varios administradores**: `store_setting.admin_notification_emails` (lista separada por comas, editable en el dashboard) con respaldo en `STORE_ADMIN_NOTIFICATION_EMAILS`. `resolveStoreSettings` la devuelve ya deduplicada e incluyendo al dueño — itera **esa** lista, no `owner_notification_email`, o se manda dos veces. El subscriber envía un correo por destinatario para que no se vean las direcciones entre ellos.
- **Deploy split**: storefront (Vercel) deploys from `develop`; backend (Coolify) deploys from `main`. Work lands on `develop`; backend changes go live only after a `develop`→`main` merge.
- **Tax note**: per-line tax exemption by prescription is **not** expressible in Medusa v2 — the tax layer only sees `product_id`/`product_type_id`, never line metadata (`get-item-tax-lines` `normalizeLineItemsForTax`). Requires modeling prescription lenses as a tax-exempt product type. No custom tax provider can read `prescription_id`.

## Try-on (3D probador)

Portado desde un proyecto hermano (`3d_framework_glass_try-on/web_tryon` + `services/{api,vision_measure}`), en reemplazo del probador procedural anterior (React + Three.js in-tree, calibrado con cámara real pero limitado a geometría genérica). Dos piezas nuevas:

- **`apps/vto-web/`** — la app de try-on en sí (Vite + TypeScript vanilla + Three.js + MediaPipe FaceLandmarker). Tracking facial en vivo, overlay 3D de gafas, calibración con tarjeta de crédito (85.6mm) para milímetros reales, medidas ópticas (DIP, alturas), evaluación de par GLB+ficha JSON, y el panel "Opción 2 — Medición con IA" (2 fotos → proveedor multimodal). No es un componente React: corre como página propia y se embebe por `<iframe>`, nunca montada directamente en el árbol de React (IDs de DOM y CSS globales, colisionarían). Catálogo de SKUs con modelo 3D real: solo `sample-frame` (`public/models/sample-frame.glb`, ejemplo genérico, sin medidas publicadas) — el resto de las 550 monturas reales cae en el mesh procedural de respaldo hasta que se generen sus `.glb` (pipeline GPU aparte, ver más abajo). `?sku=`/`?lang=` en la URL seleccionan estado inicial; emite `postMessage({source:'eyewear-vto', event:'ready', sku})` al padre cuando termina de arrancar.
- **`apps/vision-measure/`** — código fuente FastAPI que da servicio a la "Opción 2" de IA: sin GPU, sin estado, llama a OpenAI/Anthropic/Gemini/Qwen/Mistral/xAI/OpenRouter por HTTPS. **No es su propia app de Coolify**: en producción se copia dentro de la imagen de `apps/backend` y corre como segundo proceso del mismo contenedor (ver más abajo). Sigue siendo el sitio correcto para correrlo suelto en desarrollo (`.env` propio en esa carpeta, nunca en la raíz ni en `apps/backend/.env`) — ver su `README.md` para el contrato completo de rutas.
- **Proxy Medusa** (`apps/backend/src/api/vision-measure/`) — `route.ts`, `providers/route.ts`, `models/route.ts`, `health/route.ts` reenvían a `http://127.0.0.1:8008` (`proxy.ts`), fuera de `/store` y `/admin` a propósito: esos prefijos exigen `x-publishable-api-key`/sesión respectivamente, y un proxy puro no tiene ni necesita contexto de tienda. `POST /vision-measure` necesita `bodyParser: { sizeLimit: "10mb" }` en `src/api/middlewares.ts` — las dos fotos viajan como data URLs base64 dentro del JSON, y superan el límite por defecto de Medusa incluso ya reducidas a 1568px por el cliente.
- **`TryOn3D.jsx`** (`apps/capri-storefront/src/components/`) — el lanzador: abre `vto-web` en un `<iframe allow="camera *">` a pantalla completa. Sustituye a `TryOn.jsx` (que se queda en disco, sin usar — no se borró código calibrado por si hace falta rescatar algo, pero ya no está enganchado en `ProductDetail.jsx` ni `ProductCard.jsx`). Mismo flag que antes: `VITE_ENABLE_TRY_ON` en `src/config/features.js` (default `false`, decisión de producto).
- **Pipeline de generación 3D deliberadamente fuera de este repo**: `services/inference/` en el proyecto origen (Hunyuan3D/SF3D/TRELLIS, GPU CUDA, ~141MB+ antes de pesos, repo git anidado) es una herramienta de autoría offline para producir `.glb` nuevos a partir de fotos — no cabe en el presupuesto de infra (Hetzner CX22, ver abajo) y no es algo que este backend opere. Se corre aparte, a mano, cuando toca generar un modelo nuevo; el resultado (`.glb` + ficha JSON a juego) se copia a `apps/vto-web/public/models/` y se declara como SKU en `apps/vto-web/index.html`. `3d-samples/` en la raíz de este repo son los datos de referencia (7 monturas reales, fotos + descriptor) ya preparados como entrada de ese pipeline — todavía no generaron ningún `.glb`.
- **Hosting en producción**: `vto-web` se compila e inyecta en `apps/capri-storefront/public/tryon-3d/` como parte del mismo build (`VITE_VISION_API_BASE=/medusa/vision-measure` para que el panel de IA le pegue al backend por el proxy Medusa de arriba, no a su propio origen). **El `buildCommand` que de verdad importa es el de `apps/capri-storefront/vercel.json`, no el de la raíz** — el proyecto de Vercel tiene Root Directory = `apps/capri-storefront`, así que ese es el único `vercel.json` que Vercel lee; el de la raíz queda solo como referencia y hay que mantenerlo en paralelo a mano. `vision-measure` va dentro de la MISMA app de Coolify que `backend` (un segundo proceso en el contenedor, `apps/backend/docker-entrypoint.sh`, restart-loop en `sh` en vez de un supervisor real porque Alpine no trae bash) — nunca tiene dominio ni puerto público propio. Coste variable por llamada a IA, a diferencia del resto de la infra — vigilar contra el presupuesto.
- **Dev**: `pnpm dev` levanta `vto-web` en paralelo (puerto 3000, tiene `package.json` como cualquier app del workspace) junto a backend y storefront; `vision-measure` es Python (`uv`, igual que `apps/scraper`) y se arranca aparte — a mano (`cd apps/vision-measure && uv run python services/api/vision_api.py`) o junto al backend con `pnpm dev:backend`. En ambos casos Medusa lo alcanza igual, por `127.0.0.1:8008` — el proxy no distingue "proceso hermano en el host" de "proceso hermano en el mismo contenedor".

## Environment variables

See `.env.example` in each app.

## Infrastructure budget

Target: single Hetzner CX22 VPS (~€4/mo) managed by Coolify. Total infra < $75/month.
