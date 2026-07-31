# Estado del proyecto y pendientes para producción

_Actualizado tras probar el backend EN VIVO (vía proxy `/medusa`). Rama desplegable: `frontend_medusa`._

## Hallazgo importante: el backend YA está listo

Se probó el backend desplegado (`https://api.161-153-9-98.sslip.io`) endpoint por
endpoint, en vivo. Todo responde 200:

| Prueba | Resultado |
|---|---|
| `/store/regions` | ✅ 200 — "United States", USD, país `us` |
| `/store/products` | ✅ 200 — productos publicados, variantes con `id`, la publishable key funciona (sin 401) |
| `/store/lens-config/options` | ✅ 200 — **el 500 (raíz de 1.1) está RESUELTO** |
| `/store/lens-config/quote` | ✅ 200 — precio de lente calculado en servidor (contrato coincide con el front) |
| crear carrito + añadir variante | ✅ 200 — total correcto |
| `configured-line` (lente configurado) | ✅ 200 — precio servidor + metadata (`frame_price`, `lens_config`, `prescription_id`) |
| opciones de envío | ✅ 200 — "Recoger en tienda" + "Envío estándar" |
| sesión de pago Stripe | ✅ 200 — devuelve `client_secret` (PaymentIntent real) |
| **test negativo (ORDEN 9)** | ✅ inyectar `price:1` → el servidor lo ignora, mantiene el total real |

**Conclusión:** ORDEN 2 (región, sales channel + publishable key, proveedor de
pago, envíos, productos publicados) está **hecho**, y el módulo lens-config está
**arriba**. Los bloqueadores que asumían los docs anteriores ya no aplican.

## Lo que quedó hecho en el frontend (rama `frontend_medusa` = `develop` + proxy)

- ORDEN 1: carrito unificado con Medusa, precio en servidor, sin fallback local.
- ORDEN 6: recuperación "pagó pero no se creó la orden" (marcador + reintentos
  idempotentes + pantalla de pendiente + recuperación al recargar).
- ORDEN 4/5 (front): retorno de Stripe 3D Secure; endurecido con QA adversarial.
- Proxy `/medusa` same-origin para desplegar en Vercel sin CORS.
- Todo compila, con i18n es/en, responsive, comentado y con QA.

## Lo único que queda para producción (necesita acceso a Vercel)

1. **Desplegar `frontend_medusa` a un preview de Vercel** con estas variables de
   entorno:
   - `VITE_USE_MEDUSA=true`
   - `VITE_MEDUSA_PUBLISHABLE_KEY=pk_4207238465abeb79cf080e8ab85278a23aecbf56f92cb67c1f4735c375be2e61`
   - `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_51Txnrg…` (la de test que ya está en el `.env`)
   - `VITE_MEDUSA_URL=` **vacía** (o `/medusa`) → para que use el proxy, no modo directo
   - `VITE_R2_PUBLIC_URL=…` (la de assets, si aplica)
   - `VITE_DEFAULT_PAYMENT_PROVIDER=pp_stripe_stripe` (opcional; es el valor por defecto)
2. **Prueba E2E en el preview** con la tarjeta de test `4242 4242 4242 4242`
   (comprar una montura con lentes → checkout → pago). Es la validación final de
   ORDEN 9 sobre la UI real.
3. **Promover a producción** solo si el E2E pasa (cambiar la rama de producción
   de Vercel a `frontend_medusa`, o hacer merge a la rama que Vercel despliega).

## Pendientes menores (no bloquean el cobro)

- ORDEN 4/5 (backend): registrar el webhook de Stripe en
  `{BACKEND_URL}/hooks/payment/stripe_stripe` (para confirmar pagos de forma
  asíncrona; el front ya cubre la confirmación en vivo).
- ORDEN 6 (backend): subscriber de reconciliación (red de seguridad server-side).
- ORDEN 8: email de pedido (Resend + dominio verificado). Requiere la
  `ANTHROPIC_API_KEY` en Coolify (pendiente de Daniel) solo si el email/OCR lo usa.

## Nota sobre reconciliación de ramas

`frontend_medusa` (esta) desciende de `develop` y lleva todo lo anterior. La UI
más pulida de `frontend_dev` se puede ir trayendo por partes DESPUÉS de que esto
esté en producción y estable. Ver `RECONCILIACION-RAMAS.md`.
