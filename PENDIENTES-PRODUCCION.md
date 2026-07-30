# Pendientes para producción 100% funcional — Óptica El Rancho / RUBI_LENS

Fecha: 2026-07-30 · Rama frontend: `frontend` (prod, Vercel) y `frontend_dev` (dev)
Backend live: `https://api.161-153-9-98.sslip.io` · Storefront: `https://optical-storefront-storefront.vercel.app`

Leyenda de prioridad: 🔴 bloquea una compra real · 🟡 importante · 🟢 mejora

---

## 0. Lo que YA funciona en producción (para referencia)
- ✅ Catálogo halando del backend Medusa (220+ monturas) vía proxy `/medusa` (Vite dev + Vercel rewrite → sin CORS).
- ✅ Imágenes desde Supabase/R2, precios reales por región, atributos (marca/forma/género/edad/tamaños) y filtros.
- ✅ Proceso de receta: popup de confirmación (OCR + manual), campos condicionados, tipo de gafas en vivo, boucher.
- ✅ Checkout UI: recoger/domicilio, tarjeta con validación (sin guardar el PAN), consentimiento marketing, receta guardada en perfil.
- ✅ OCR de receta pega al backend desde el navegador (vía proxy).
- ✅ Bilingüe ES/EN + responsive. Punto estable etiquetado: `estable-checkout-2026-07-30` (`5478eb7`).

---

## 1. BACKEND (Dionis) — no lo puedo tocar/desplegar yo (Oracle)

### 🔴 1.1 Módulo de lentes caído (500)
- `GET /store/lens-config/options` y `/coatings`, y `POST /store/lens-config/price` → **500 Internal Server Error**.
- Causa probable: falta correr migración/seed del módulo `lens-config`, o error en runtime.
- Impacto: el precio de los LENTES no puede salir del backend; hoy se calcula con la matriz local (`lensPricing.js`).
- Acción: arreglar el 500, correr seed de opciones/tratamientos/índices, y confirmar el **modelo** (el backend usa `usage_type/options/coatings`; el frontend usa modelo Zeelool diseño×material — hay que acordar cómo casan).

### 🔴 1.2 Correos (cliente + admin) — no implementado
- No hay módulo de notificación en `medusa-config.ts`, ni subscriber de "order placed", ni endpoint de email.
- `RESEND_API_KEY` está en el `.env` pero **ningún código la usa**; `RESEND_FROM_EMAIL=orders@example.com` es placeholder (dominio no verificado → Resend rechaza).
- Acción: (a) agregar módulo de notificación Medusa + provider Resend; (b) subscriber que al crear la orden envíe comprobante al cliente y aviso al admin; (c) **verificar un dominio real** en Resend y definir el correo del admin.

### 🔴 1.3 Órdenes / carrito / pago reales
- El checkout del frontend hoy guarda la orden en `localStorage`; **no crea orden ni carrito en Medusa**.
- Los módulos de pago (Stripe / PayPal / Square) existen en el backend pero **no están conectados** al checkout.
- Acción: definir y exponer el flujo de orden (crear cart → completar → order) y el PaymentIntent de Stripe para cobrar de verdad. Sin esto no hay cobro ni inventario real ni correo automático.

### 🟡 1.4 OCR — confirmar API key
- El endpoint `/store/prescriptions/ocr` responde, pero antes caía en `fallback` por falta de `ANTHROPIC_API_KEY`.
- Acción: confirmar que `ANTHROPIC_API_KEY` está puesta en el backend desplegado para que lea la receta de verdad (no fallback).

### 🟡 1.5 Datos de producto incompletos
- Faltan marcas en Medusa: **flexure** y **prorx** (el scraper no las subió) → no aparecen en la tienda.
- `description` / `i18n` vienen **vacíos** → la ficha de producto (PDP) no muestra descripción.
- Algunos productos con `shape` vacío (salen como "Montura").
- Precios: revisar que `calculated_amount` sea el retail correcto (vi $129 y hasta $425.95); definir si el precio de venta sale de `calculated_price` u `original_price_cents`.
- Acción: completar atributos/descripciones y cargar las marcas faltantes; revisar precios.

### 🟡 1.6 CORS del dominio de producción
- `STORE_CORS` ya tiene `localhost:5198` (gracias), pero **no** el dominio de Vercel.
- Hoy no bloquea porque usamos el proxy same-origin. Si algún día se llama directo al backend desde el navegador, agregar `https://optical-storefront-storefront.vercel.app`.

### 🟢 1.7 Estuches (cases) e inventario
- La marca `case` existe en Medusa; hoy los estuches del frontend salen de `cases.json`. Definir si migran a Medusa.
- Confirmar manejo de stock/inventario (variantes) si se quiere control de existencias.

---

## 2. FRONTEND (yo) — lo puedo hacer en cuanto el backend habilite cada pieza

### 🔴 2.1 Checkout real contra Medusa (depende de 1.3)
- Reemplazar el checkout localStorage por: crear carrito Medusa → línea(s) → dirección → pago → orden.
- Integrar **Stripe Elements + PaymentIntent** (hoy la tarjeta se valida pero no cobra; solo guarda marca+últimos4).

### 🔴 2.2 Correo de orden (depende de 1.2)
- Conectar el disparo del correo (cliente + admin) al crear la orden — vía el backend (preferible) o el webhook `VITE_ORDER_NOTIFY_URL` a un servicio.

### 🟡 2.3 Precio de lentes desde el backend (depende de 1.1)
- Cuando `lens-config` funcione, mover el cálculo del lente a `POST /store/lens-config/price` (con fallback a la matriz local).

### 🟡 2.4 Validación de receta por backend (opcional)
- Conectar `POST /store/prescriptions/validate` (hoy la validación es local).

### 🟡 2.5 Descripción de producto (depende de 1.5)
- Mostrar `description`/`i18n` de Medusa en la PDP cuando existan (hoy quedaría vacío).

### 🟢 2.6 Admin / panel
- El panel de admin lee órdenes/analítica de `localStorage`. Para producción real, leer las órdenes del backend (depende de 1.3).

### 🟢 2.7 Limpieza de hardcode restante
- Config de tienda/envío (dirección de recogida, zonas) hoy en `priceStore` (localStorage). Definir si va a backend/config.
- Lista de marcas (`brands.js`) podría venir del backend.
- `catalog.json`/seed quedan como **fallback** (bien) — no se borran hasta confirmar estabilidad del backend.

### 🟢 2.8 Try-on
- `VITE_ENABLE_TRY_ON=true` — verificar que el probador virtual funciona en prod.

---

## 3. CONFIG / INFRAESTRUCTURA / ENV

### 🟡 3.1 Variables de entorno en Vercel (producción)
- Hoy el deploy funciona con **defaults públicos** en el código (`medusaCatalog.js`) para la publishable key y R2. Recomendado configurarlas como env en el proyecto Vercel:
  - `VITE_MEDUSA_PUBLISHABLE_KEY`, `VITE_R2_PUBLIC_URL`, `VITE_USE_MEDUSA=true`, `VITE_STRIPE_PUBLISHABLE_KEY`.
- Si se rota la publishable key en el backend, actualizarla aquí.

### 🟡 3.2 URL del backend en el rewrite de Vercel
- `vercel.json` tiene hardcodeada la URL del backend en el rewrite `/medusa/:path*`. Si cambia el dominio del backend, actualizar `vercel.json` (raíz y `apps/capri-storefront`).

### 🟢 3.3 Dominio propio + HTTPS
- Definir dominio final (en vez de `*.vercel.app`) y ajustarlo en Vercel + `STORE_CORS`.

### 🟢 3.4 Secretos
- Ninguna clave secreta debe ir al frontend (solo publishable). Las secretas (Resend, Stripe secret, Anthropic) viven solo en el backend.

---

## 4. Orden sugerido para llegar a "100% funcional"
1. **Backend:** arreglar `lens-config` 500 (1.1) + confirmar `ANTHROPIC_API_KEY` (1.4).
2. **Backend:** flujo de orden Medusa + Stripe PaymentIntent (1.3) → **habilita cobro real**.
3. **Frontend:** checkout real + Stripe Elements (2.1) contra lo anterior.
4. **Backend:** notificación Resend + dominio verificado (1.2) → **correos cliente/admin**.
5. **Frontend:** disparo de correo + panel admin desde backend (2.2, 2.6).
6. **Frontend:** precio de lente por backend (2.3) cuando 1.1 esté listo.
7. **Datos:** completar marcas/atributos/descripciones/precios (1.5).
8. **Config:** env en Vercel + dominio propio (3.x).

> Con los pasos 1–5 la tienda **vende de verdad** (cobra + confirma por correo + registra la orden en el backend). El resto es pulido y datos.
