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
- All code, comments, identifiers in English; UI copy goes through the `t(key)` dictionary in `apps/capri-storefront/src/i18n/translations.js` (`es` default, `en` second — language is toggled client-side and persisted in `localStorage`, there are no locale-prefixed URLs). Never hardcode UI strings in components — add the key to both `es` and `en`.
- Product catalog content (title/description) is translated at scrape time by the AI translation pipeline (`apps/scraper/scraper/translate.py`) into `product.metadata.i18n.{es,fr}`; the storefront resolves display text via `resolveLocalizedFrameText`/`resolveLocalizedProductMetadataText` in `@eyewear/shared`, never by re-translating client-side
- Never trust client-side totals — price always computed server-side. This includes display-only filler fields (rating, review count, best-seller flag, "compare at" price) generated deterministically by `apps/scraper/scraper/filler.py` — they are presentation metadata only and must never feed into actual pricing/checkout math
- Prescriptions are health data: R2 prescription bucket is private, presigned URLs only
- Never commit credentials; all secrets via env vars
- Check `node_modules` package types before inventing Medusa v2 API signatures
- Tests: unit tests for prescription validation + pricing, integration tests for scraper parser (no live HTTP in CI)

## Commands

```bash
# Start all services
pnpm dev

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
- **Etapas del pedido**: `src/lib/order-status.ts` combina `payment_status` + `fulfillment_status` + `metadata.lab_stage` (paso manual del laboratorio, que Medusa no modela) en una sola etapa: `confirmed → in_lab → shipped → in_transit → delivered`. El envío real siempre gana sobre la nota manual. Cancelado/reembolsado/pago pendiente son `terminal`, no etapas. Mantener `ORDER_STAGES` sincronizado con `STEPS` en `TrackingTimeline.jsx` y con `STAGES` en `apps/capri-storefront/src/admin/adminOrders.js` — son la misma línea de tiempo vista desde tres sitios.
- **Panel del dueño (pestaña Pedidos)**: `/admin` en el storefront, backend en `src/api/admin/order-board/`. `GET /admin/order-board` lista con búsqueda libre, rango de fechas, etapa, estado terminal y con/sin receta; `POST /admin/order-board/:id/stage` traduce una etapa a la operación real de Medusa (nota `lab_stage` → `createOrderFulfillment` → `createOrderShipment` → `markAsDelivered`). La etapa **no es una columna** (sale de tres fuentes, una en `metadata`), así que solo el rango de fechas se filtra en la base de datos: el resto se aplica sobre una ventana acotada (`MAX_BOARD_SCAN`) y la respuesta trae `truncated` — el panel debe mostrarlo, no paginar en silencio sobre una respuesta parcial. El panel solo ofrece `next_stages` (lo que el servidor acepta), nunca decide por su cuenta. Login = credenciales de Medusa (`/auth/user/emailpass`), y las llamadas admin van por el proxy mismo-origen `/medusa` para no depender de `adminCors`. Las otras pestañas (Resumen/Ventas/Productos) siguen leyendo datos demo de `localStorage`.
- **Notificación a varios administradores**: `store_setting.admin_notification_emails` (lista separada por comas, editable en el dashboard) con respaldo en `STORE_ADMIN_NOTIFICATION_EMAILS`. `resolveStoreSettings` la devuelve ya deduplicada e incluyendo al dueño — itera **esa** lista, no `owner_notification_email`, o se manda dos veces. El subscriber envía un correo por destinatario para que no se vean las direcciones entre ellos.
- **Deploy split**: storefront (Vercel) deploys from `develop`; backend (Coolify) deploys from `main`. Work lands on `develop`; backend changes go live only after a `develop`→`main` merge.
- **Tax note**: per-line tax exemption by prescription is **not** expressible in Medusa v2 — the tax layer only sees `product_id`/`product_type_id`, never line metadata (`get-item-tax-lines` `normalizeLineItemsForTax`). Requires modeling prescription lenses as a tax-exempt product type. No custom tax provider can read `prescription_id`.

## Environment variables

See `.env.example` in each app.

## Infrastructure budget

Target: single Hetzner CX22 VPS (~€4/mo) managed by Coolify. Total infra < $75/month.
