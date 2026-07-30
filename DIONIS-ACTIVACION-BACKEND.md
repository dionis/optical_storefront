# Activación del backend — qué falta y qué hacer (para Dionis)

> **Propósito de este documento.** El frontend (tienda `apps/capri-storefront` + panel del dueño)
> ya está construido y funcionando. Hay **tres funciones que ya están programadas en el frontend
> pero apagadas** porque dependen de una pieza tuya en el backend/infra: (A) **OCR de recetas**,
> (B) **notificaciones de compra por email/SMS**, y (C) **persistencia de pedidos** para que el
> seguimiento sea de verdad cliente↔admin. Aquí está, al detalle, **qué hace falta, por qué, cómo
> conectarlo y cómo probarlo**. Al final hay un resumen de variables de entorno y una nota del
> despliegue en Vercel.
>
> Este documento complementa a `TAREAS-BACKEND-DIONIS.md` (roadmap general). Aquí solo van los
> **bloqueos concretos y accionables de ahora**.
>
> _Autor: trabajo del frontend (rama `frontend`). No se tocó tu backend ni tu rama `develop`._

---

## Resumen ejecutivo (TL;DR)

| # | Función | Estado frontend | Lo que falta (tú) | Esfuerzo |
|---|---------|-----------------|-------------------|----------|
| A | **OCR de recetas** (leer la foto de la receta y prellenar) | ✅ Listo y conectado | Definir `ANTHROPIC_API_KEY` en el backend + CORS del storefront | Bajo (config) |
| B | **Notificaciones de compra** (email/SMS al cliente y al admin) | ✅ Listo (webhook) | Crear un webhook/endpoint que envíe el correo/SMS y poner su URL en `VITE_ORDER_NOTIFY_URL` | Medio |
| C | **Pedidos reales + seguimiento cross-device** | ✅ Listo (capa con “seam”) | Persistir pedidos en Medusa y exponer 4 endpoints | Medio/alto |
| — | **Despliegue en Vercel** | ✅ Código listo en `frontend` | Activar auto-deploy / hacer Redeploy (ver §4) | Bajo |

Nada de esto rompe la compra si no está: el frontend **degrada con elegancia** (cae a modo manual,
muestra el comprobante en pantalla, guarda el pedido localmente). Pero para que sea 100% real,
necesitamos estas piezas.

---

## A. OCR de recetas — leer la foto y prellenar la graduación

### Qué es
Cuando el cliente elige **“Escanear receta”** y sube una foto (incluidas recetas de laboratorio
tipo *Optical Outsource*), el frontend la envía a tu endpoint de OCR, que usa **Anthropic vision**
para extraer SPH/CYL/AXIS/ADD/DP y devolverlo en JSON. El frontend ya mapea esa respuesta y
prellena la tabla de la receta.

### Por qué está apagado
El endpoint **ya existe** en tu backend: `apps/backend/src/api/store/prescriptions/ocr/route.ts`.
Lo probé en vivo contra `https://api.161-153-9-98.sslip.io` y **responde**, pero devuelve:

```json
{ "error": "OCR no disponible. Por favor ingresa tu receta manualmente.", "fallback": true }
```
…con código **503**. Eso ocurre porque el propio route.ts hace: _“si no hay `ANTHROPIC_API_KEY`,
devuelve fallback”_. **O sea: falta la API key de Anthropic en el entorno del backend.**

### Qué tienes que hacer
1. **Definir la variable de entorno** en el servidor del backend (Medusa):
   ```
   ANTHROPIC_API_KEY=sk-ant-...   # tu llave de la consola de Anthropic
   ```
   (Opcional, para guardar la imagen en R2 como PHI: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_PRESCRIPTION_BUCKET`. Si no las pones, el OCR igual funciona: el
   route.ts manda la imagen directo a Anthropic sin guardarla.)
2. **CORS**: permitir el origen del storefront (Vercel y localhost) en `STORE_CORS` del backend,
   para que el navegador pueda llamar al endpoint. Ej.:
   ```
   STORE_CORS=https://optical-storefront-storefront.vercel.app,http://localhost:5198
   ```
3. **Publishable key** (Medusa exige `x-publishable-api-key` en rutas `/store`). Ya la dejé lista en
   el `.env` del storefront (`VITE_MEDUSA_PUBLISHABLE_KEY`). Solo confirma que esa key esté
   **activa y vinculada al Sales Channel** correcto en Medusa.

### Cómo probar que quedó bien
Desde una terminal (sustituye la key publicable si cambió):
```bash
curl -X POST "https://api.161-153-9-98.sslip.io/store/prescriptions/ocr" \
  -H "x-publishable-api-key: pk_133bc9622c239363518496fa58738223528dd50951cf491ed1d5a0d8f5a1abb1" \
  -F "file=@receta.jpg;type=image/jpeg"
```
- **Bien:** responde un JSON con `od`, `os`, `pd`, etc. (sin `fallback:true`).
- **Mal (todavía sin key):** `503 { "fallback": true }`.

### Contrato (lo que el frontend espera de vuelta) — ya lo implementa tu route.ts
```json
{
  "od": { "sph": -1.50, "cyl": -2.25, "axis": 10, "add": null, "prism": null, "base": null },
  "os": { "sph": -1.25, "cyl": -2.50, "axis": 165, "add": null, "prism": null, "base": null },
  "pd": null, "pd_od": 34.5, "pd_os": 32.5
}
```
El frontend redondea al paso del selector, y si vienen `pd_od`/`pd_os` activa el modo “dos DP”.

**Punto de conexión en el frontend:** `src/pages/LensProcess.jsx` → `handleOcr()`
(POST a `${VITE_MEDUSA_URL}/store/prescriptions/ocr`).

---

## B. Notificaciones de compra — email/SMS al cliente y al admin

### Qué es
Cuando se confirma un pedido, el cliente debe **recibir un correo (o SMS)** con su compra, y el
admin un aviso. **Enviar correos/SMS NO se puede desde el frontend** (hace falta un servicio con
credenciales), así que dejé el frontend listo con un **webhook**: al pagar, hace un `POST` con
todo el pedido a la URL que tú configures. Ahí conectas el servicio que envía.

### Qué tienes que hacer (elige UNA opción)
**Opción rápida (sin tocar backend): Zapier / Make.com**
1. Crea un “Catch Hook” (webhook) en Zapier o Make.
2. Conéctalo a Gmail/SendGrid (email) y/o Twilio (SMS).
3. Pega la URL del hook en el `.env` del storefront:
   ```
   VITE_ORDER_NOTIFY_URL=https://hooks.zapier.com/hooks/catch/xxxxx/yyyyy/
   VITE_STORE_EMAIL=pedidos@opticaelrancho.com   # a dónde le llega el aviso al admin
   ```

**Opción integrada (backend Medusa):** crea una ruta `POST /store/orders/notify` que reciba el
payload de abajo y dispare SendGrid (email) + Twilio (SMS) al cliente y al `store`. Luego pon esa
URL en `VITE_ORDER_NOTIFY_URL`.

### Payload que envía el frontend (ya implementado)
```json
{
  "order": { "id": "ORD-1785380023222", "total": 195.95,
             "items": [{ "name": "DC407", "color": "Black",
                         "specs": [{ "label": "Visión Sencilla · Índice 1.61", "price": 100 }],
                         "total": 195.95 }],
             "shipping": { "method": "ship", "cost": 3 },
             "customer": { "name": "...", "email": "...", "phone": "..." },
             "delivery": { "address": "...", "city": "...", "carrier": "..." },
             "status": "received" },
  "lang": "es",
  "to": { "customer": "cliente@correo.com", "store": "pedidos@opticaelrancho.com" },
  "text": { "subject": "Tu pedido ORD-... — Óptica El Rancho", "body": "Pedido ...\n• ..." }
}
```
El `text.subject` y `text.body` ya vienen redactados y bilingües; solo tienes que enviarlos.

### Mientras tanto (ya funciona sin backend)
- El cliente ve un **comprobante** en pantalla (nº de orden + total) y un botón **“Enviarme el
  comprobante por correo”** (abre su app de correo con todo redactado).
- El admin ve el pedido **al instante** en su panel de *Pedidos*.

**Punto de conexión en el frontend:** `src/data/orderNotify.js` (`notifyOrder`, `buildOrderText`).

---

## C. Pedidos reales + seguimiento cliente↔admin (persistencia)

### Qué es y por qué
Hoy los pedidos, favoritos, reseñas y el estado de envío se guardan en **localStorage (por
navegador)**. Consecuencia importante: **el estado que el dueño cambia en SU navegador no le llega
al del cliente** (y viceversa). Para que el seguimiento sea de verdad bilateral, los pedidos deben
vivir en el **backend** y leerse por API.

### Modelo de estados (ya unificado en el frontend)
Definí una **fuente de verdad única**: `src/data/orderStatus.js`. Son 5 estados, en este orden:
```
received  → manufacturing → shipped → in_transit → delivered
(Recibida)  (En fabricación) (Enviada) (En tránsito) (Entregada)
```
Úsalos **tal cual** (esas `key` en inglés) en el backend, para que el badge del cliente y el
selector del admin coincidan. Cada pedido también tiene un campo **`tracking`** (nº de guía) que
el admin asigna y el cliente ve.

### Qué tienes que hacer (endpoints, todos JSON)
| Acción | Endpoint sugerido | Reemplaza en el frontend a |
|---|---|---|
| Crear pedido | `POST /store/orders` | `recordOrder(order)` |
| Pedidos de un cliente | `GET /store/orders?email=` | `ordersByUser(email)` |
| Todos los pedidos (admin) | `GET /admin/orders` | `allOrders()` |
| Cambiar estado (admin) | `PATCH /admin/orders/:id` `{status}` | `updateOrderStatus(id,status)` |
| Asignar nº de guía (admin) | `PATCH /admin/orders/:id` `{tracking}` | `updateOrderTracking(id,tracking)` |

El **objeto pedido** que ya arma el frontend (guárdalo tal cual):
```json
{ "id": "ORD-...", "t": "2026-07-30T...", "status": "received", "tracking": null,
  "user": "cliente@correo.com", "total": 195.95, "itemsCount": 1,
  "items": [{ "sku": "DC407", "name": "DC407", "brand": "Di Caprio", "kind": "frame",
              "color": "Black", "design": "sv", "material": "1.61", "photo": null,
              "ar": "ar-green-basic",
              "specs": [{ "label": "Visión Sencilla · Índice 1.61", "price": 100 },
                        { "label": "AR Green Básico", "price": 60 }], "total": 195.95 }],
  "shipping": { "method": "ship", "cost": 3 },
  "customer": { "name": "...", "surname": "...", "email": "...", "phone": "..." },
  "delivery": { "recipient": "...", "phone": "...", "email": "...", "address": "...",
                "city": "...", "zone": "...", "carrier": "..." } }
```

**Puntos de conexión en el frontend:** `src/admin/analytics.js` (todas las funciones de arriba) y
`src/data/orderStatus.js` (el modelo de estados). Cambiar solo esa capa deja todo lo demás igual.

> Lo mismo aplica a **favoritos** (`src/components/CartContext.jsx`), **reseñas**
> (`src/components/reviewsStore.js`) y **precios** (`src/admin/priceStore.js`): ver el roadmap
> general en `TAREAS-BACKEND-DIONIS.md`.

---

## Config del frontend — variables de entorno (`apps/capri-storefront/.env`)

Todas las `VITE_*` viajan al navegador → **solo llaves públicas/publicables, nunca secretas.**
Las secretas (Anthropic, Twilio, SendGrid, Stripe secret) van **solo en el backend**.

| Variable | Para qué | Estado |
|---|---|---|
| `VITE_MEDUSA_URL` | URL del backend Medusa | ✅ puesta (`https://api.161-153-9-98.sslip.io`) |
| `VITE_MEDUSA_PUBLISHABLE_KEY` | Auth de rutas `/store` (incluye OCR) | ✅ activada por mí |
| `VITE_ORDER_NOTIFY_URL` | Webhook de notificaciones (§B) | ⬜ falta ponerla |
| `VITE_STORE_EMAIL` | Correo del admin para avisos | ⬜ falta ponerla |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe (checkout) — publicable | ✅ puesta |
| `VITE_USE_MEDUSA` | Activa la capa Medusa | ✅ `true` |
| `VITE_ENABLE_TRY_ON` | Probador AR on/off | (según decidan) |

Secretas del **backend** que faltan: `ANTHROPIC_API_KEY` (OCR), y — si haces las notificaciones en
el backend — `SENDGRID_API_KEY` / `TWILIO_*`.

---

## 4. Despliegue en Vercel (importante)

Todo lo anterior está en la rama **`frontend`** en GitHub. En Vercel la *Production Branch* es
`frontend`, pero **el auto-deploy no está publicando** los push (lo verifiqué: empujé y producción
siguió con el build viejo). Para verlo en producción:

1. Vercel → proyecto → **Deployments** → en el último commit de `frontend` → **⋯ → Redeploy**
   (desmarca “use existing build cache”).
2. **Settings → Git**: activar el **auto-deploy** de `frontend` (o revisar “Ignored Build Step”).

_Alternativa de estrategia:_ si quieren que producción incluya también tu trabajo de Medusa, la
rama `develop` (commit `0c4d65c`) ya tiene **el rediseño + tu Medusa** reconciliados; se podría
apuntar la Production Branch a `develop`. Eso lo deciden entre ustedes.

---

## Checklist para Dionis

- [ ] **OCR:** `ANTHROPIC_API_KEY` en el backend + `STORE_CORS` con el dominio del storefront.
- [ ] **Notificaciones:** crear webhook (Zapier/Make o ruta Medusa) y poner `VITE_ORDER_NOTIFY_URL`
      + `VITE_STORE_EMAIL`.
- [ ] **Pedidos/seguimiento:** persistir pedidos en Medusa y exponer los 5 endpoints (§C), usando
      las `key` de estado de `orderStatus.js`.
- [ ] **Vercel:** activar auto-deploy de `frontend` o hacer Redeploy.
- [ ] Confirmar la **publishable key** vinculada al Sales Channel correcto.

Cualquier duda de los contratos JSON o de dónde engancha cada cosa, está señalado archivo por
archivo arriba. — Gracias.
