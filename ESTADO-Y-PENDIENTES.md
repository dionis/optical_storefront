# Estado del proyecto y pendientes — HECHOS COMPROBADOS

_Actualizado tras probar el backend EN VIVO (curl a `https://api.161-153-9-98.sslip.io`)
y el código en la rama `develop` (commit 6dfc8da). Cada punto dice si está
VERIFICADO o NO verificado. Nada aquí es suposición._

## ✅ FUNCIONA — verificado en vivo hoy

| Prueba (en vivo) | Resultado |
|---|---|
| `GET /store/regions` | **200** |
| `GET /store/products` | **200** |
| `GET /store/lens-config/options` | **200** |
| `POST /store/lens-config/quote` | **200** — `total_cents: 18900` (montura 12900 + lente 6000) |
| `POST /store/carts/:id/configured-line` | **200** — carrito `total: 189`, 1 item (precio en servidor) |
| `POST /store/carts/:id/shipping-methods` | **200** |
| `POST /store/payment-collections` | **200** |
| `POST .../payment-sessions` (Stripe) | **200** — `client_secret` real, provider `pp_stripe_stripe` |

### 1.1 (precio de lentes) — INTEGRADO front ↔ back ✅
- El frontend pide el precio al backend en `LensProcess.jsx` (`POST /store/lens-config/quote`)
  y al añadir al carrito en `medusaCart.js` (`POST /store/carts/:id/configured-line`).
- El backend (de Dionis) tiene esos endpoints y responden 200; el precio se calcula en el
  servidor. El cliente nunca manda un total.

### 1.3 (carrito → checkout → pago) — VERIFICADO end-to-end a nivel API ✅
- Flujo completo probado en vivo: cart → configured-line (189) → shipping (200) →
  payment-collection (200) → payment-session Stripe (200, `client_secret`).

### Cableado "de cara al backend" — VERIFICADO ✅
- `medusa.js`: modo proxy same-origin por defecto → llamadas a `${origin}/medusa/...`.
- `vercel.json`: rewrite `/medusa/:path*` → `https://api.161-153-9-98.sslip.io/:path*`.
- `.env.local` local: `VITE_USE_MEDUSA=true`, `VITE_MEDUSA_URL` vacío (usa proxy).

### Frontend — VERIFICADO ✅
- i18n es/en: **444 = 444 claves, 0 faltantes** en cada idioma.
- Responsive: 44 media queries; render verificado a 430px (móvil) y desktop en smoke tests.
  (No probado exhaustivamente en todos los breakpoints.)
- Build OK (vite build) + smoke test runtime del funnel (popovers, dial, diagramas,
  DP dual OCR) sin errores en consola.

### Integración de ramas — VERIFICADO ✅
- `develop` (6dfc8da) = **backend de Dionis + nuestro frontend** en UNA sola rama (monorepo).
- Construido sobre `1ccf66a` (lo último de Dionis); no hay commits de Dionis posteriores.
- `origin/develop` = 6dfc8da y el equipo local (device) = 6dfc8da → **sincronizados en origin**.
  (No se puede verificar el local de Dionis; él debe hacer `git pull` de `develop`.)
- Backup: rama `develop-backup-preintegracion` @ `1ccf66a` pusheada a origin.

## ❌ NO funciona / PENDIENTE — verificado

- **OCR / lectura de receta (1.2):** `POST /store/prescriptions/ocr` con imagen real →
  **503** `"No se pudo procesar la imagen... fallback:true"`. Falta **`ANTHROPIC_API_KEY`
  en Coolify**. (acción de Daniel)
- **Producción en Vercel:** hoy producción = rama vieja `frontend_dev` (e4380e4, flujo
  localStorage). El flujo Medusa NO está desplegado. Hay que desplegar `develop` (o
  `frontend_medusa`) en Vercel con `VITE_USE_MEDUSA=true` y `VITE_MEDUSA_URL` vacío.
  (acceso a Vercel de Daniel)
- **Prueba E2E real** en el preview con tarjeta `4242 4242 4242 4242` (validación final de UI).

## ⚠️ Pendiente para 100% seguro/estable — NO verificado en vivo (marcado)

- **Emails de pedido** (Resend + dominio verificado) — NO verificado. (backend/Dionis + dominio)
- **Webhook de Stripe** en backend (`/hooks/payment/stripe_stripe`) — NO verificado si está
  registrado. (backend/Dionis)
- **Subscriber de reconciliación** server-side ("pagó pero no se creó la orden") — NO verificado.
- **"Recoger en tienda":** el backend aún la devuelve en shipping-options (verificado); el
  frontend la filtra, pero conviene deshabilitarla también en backend. (backend/Dionis)
- **Try-on:** presente en `develop` (de Dionis), no lo toqué; no re-probado por mí esta sesión.

## Resumen de quién desbloquea qué
- **Daniel:** (1) `ANTHROPIC_API_KEY` en Coolify → OCR/emails; (2) deploy de `develop` en Vercel + E2E.
- **Dionis (backend):** webhook Stripe, subscriber de reconciliación, emails Resend, deshabilitar pickup.
- **Nosotros (front):** hecho e integrado en `develop`; a la espera del deploy para probar en vivo.
