# Estado del proyecto y pendientes para producción

_Actualizado: rama `develop` a `56f13c1`._

## Qué quedó hecho (integrado en `develop`)

**ORDEN 0 — lectura de lo existente.** Se partió de los archivos ya presentes
en `develop` (medusaCart.js, MedusaCheckout.jsx, ruta configured-line, subscriber
order-placed, medusa-config.ts) sin reescribirlos.

**ORDEN 1 — carrito unificado con Medusa** (`85d7d10`). El carrito del storefront
es ahora el carrito de Medusa, con precios calculados en el servidor. El cliente
nunca envía totales. Todos los puntos de "añadir al carrito" usan `variant_id`
real; sin variante, el botón se deshabilita con aviso (sin fallback local). La
receta viaja como PHI: solo el `prescription_id` llega al carrito.

**ORDEN 6 — recuperación "pagó pero no se creó la orden"** (`74614bb`). Al
confirmar Stripe el cobro se persiste un marcador y se completa el pedido con
reintentos y backoff exponencial, de forma idempotente (completar un carrito ya
completado devuelve el mismo pedido: nunca doble cobro). Si tras los reintentos
no hay orden, se muestra "Pago recibido — confirmando tu pedido" y el marcador
se conserva para recuperación posterior.

**ORDEN 4/5 (parte front) — retorno de Stripe 3D Secure** (`56f13c1`). Si el
banco exige autenticación, Stripe redirige y al volver el checkout retoma el
pedido. Endurecido con QA adversarial: TTL de 24 h en el marcador, distinción de
errores terminales (4xx) vs transitorios (5xx/red), y una salida "Cancelar y
empezar de nuevo" para que un marcador atascado nunca bloquee el checkout.

Todo lo anterior compila limpio (Vite build OK), con textos en **es/en**,
responsive, código comentado y revisado por QA.

## Bloqueadores actuales (nada de esto es código de front)

1. **ORDEN 2 — datos maestros en Medusa Admin (Dionis).** Región, sales channel
   + publishable key, Stripe habilitado en la región, stock location +
   fulfillment + opciones de envío, y productos/estuches publicados. Sin esto la
   Store API responde 401 o el checkout se queda a medias. Guía detallada:
   `ORDEN-2-MEDUSA-ADMIN-DIONIS.md`.

2. **Clave de OCR en Coolify (Daniel).** Poner `ANTHROPIC_API_KEY` en las
   variables de entorno del backend en Coolify y redeploy. (Revocar la clave que
   se expuso en el chat y crear una nueva.)

## Pendiente después de desbloquear

- **ORDEN 3** — verificar que con el entorno Medusa activo el catálogo devuelve
  `variantId` en producción (ya confirmado en código; falta la validación viva).
- **ORDEN 4/5 (backend)** — Stripe secret key + registrar el webhook en
  `{BACKEND_URL}/hooks/payment/stripe_stripe`.
- **ORDEN 6 (backend)** — subscriber de reconciliación (pago capturado → asegura
  la orden aunque el navegador se cierre). Es la red de seguridad del front ya
  hecho.
- **ORDEN 7** — política de inventario (`manage_inventory`) en el scraper.
- **ORDEN 8** — email de pedido (Resend + dominio verificado), cliente y admin.
- **ORDEN 9** — prueba E2E con la tarjeta `4242 4242 4242 4242` + test negativo
  (el cliente no puede manipular el precio).

## Riesgo estructural abierto

Las ramas `develop` y `frontend_dev` (la desplegada en Vercel) tienen
**historias git no relacionadas** y funcionalidades divididas. Ver el plan de
reconciliación en `RECONCILIACION-RAMAS.md`. Requiere una decisión antes de
tocar nada.
