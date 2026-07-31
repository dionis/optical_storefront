# ORDEN 2 — Configuración de datos maestros en Medusa Admin (Dionis)

> **Objetivo:** dejar el backend listo para que el storefront pueda crear un
> carrito, calcular envío, cobrar con Stripe y convertir el carrito en pedido.
> Sin estos datos la Store API responde **401** (falta publishable key / sales
> channel) o el checkout se queda a medias (falta proveedor de pago o envíos).
>
> **Todo esto es configuración en el panel de Medusa Admin** — no es código.
> Backend desplegado: `https://api.161-153-9-98.sslip.io`
> Admin: `https://api.161-153-9-98.sslip.io/app`

Cuando termines cada bloque, marca la casilla. El orden importa: cada paso
depende del anterior.

---

## 1. Región (Region)

Define moneda e impuestos. El storefront la lee para crear el carrito.

- [ ] Admin → **Settings → Regions → Create**.
- [ ] Nombre: `United States` (o el que corresponda).
- [ ] **Currency:** `USD` (debe coincidir con los precios del catálogo, que están
      en **dólares decimales**, no centavos).
- [ ] **Countries:** añade `United States` (country code `us`). El checkout
      envía `country_code: "us"` en la dirección, así que este país **tiene que
      existir** en la región.
- [ ] Guarda. Copia el **Region ID** (`reg_...`) por si hace falta para pruebas.

---

## 2. Sales Channel + Publishable API Key

El storefront **no puede hablar** con la Store API sin una publishable key
asociada a un sales channel. Esto es lo que evita el error 401.

- [ ] Admin → **Settings → Sales Channels**. Usa el `Default Sales Channel` o
      crea uno (`Online Store`). Copia el **Sales Channel ID** (`sc_...`).
- [ ] Admin → **Settings → Publishable API Keys → Create** (o usa la existente).
- [ ] **Asocia el sales channel** a esa key (pestaña *Sales Channels* dentro de
      la key → Add). Sin esta asociación la key no autoriza nada.
- [ ] Copia la key (`pk_...`).

> **Coordinación con el front:** esa `pk_...` es la que va en el storefront como
> `VITE_MEDUSA_PUBLISHABLE_KEY`. Confirma con Daniel que la del `.env`
> (empieza por `pk_4207...`) es exactamente esta. Si no coincide → 401.

---

## 3. Proveedor de pago (Stripe) habilitado en la región

- [ ] Admin → **Settings → Regions →** (tu región) **→ Payment Providers**.
- [ ] Habilita **Stripe** (`pp_stripe_stripe`). Debe quedar en la lista de
      proveedores activos de la región.

> El storefront usa por defecto `pp_stripe_stripe`
> (`VITE_DEFAULT_PAYMENT_PROVIDER`). Si en tu instalación el id es distinto,
> avísame para ajustar la variable — **no** hardcodear.
>
> Las **claves secretas** de Stripe (secret key + webhook) son ORDEN 4/5, no
> hace falta aquí; pero el proveedor sí tiene que estar **habilitado en la
> región** ahora, o `initiatePaymentSession` falla.

---

## 4. Ubicación de stock + Fulfillment + Opciones de envío

El checkout llama a `listCartOptions` y necesita al menos **una** opción de
envío válida para la región, o el paso "Calcular envío" devuelve vacío.

- [ ] Admin → **Settings → Locations & Shipping → Stock Locations → Create**.
      Nombre p. ej. `Almacén principal`. Dirección real (o de la tienda).
- [ ] En esa location, **conecta el Sales Channel** del paso 2 (para que el
      stock de ese canal salga de aquí).
- [ ] Añade un **Fulfillment Provider** a la location (el `manual` que trae
      Medusa sirve para empezar).
- [ ] Crea un **Service Zone** que incluya el país `US`.
- [ ] Crea al menos una **Shipping Option** dentro de esa zona:
      - Nombre: `Envío estándar` (o `Recogida en tienda` si aplica).
      - Price type: **Flat rate** → precio en **USD** (ej. `5.00`; usa `0` para
        gratis). Recuerda: **dólares decimales**.
      - Asóciala a la región del paso 1.
- [ ] (Opcional) Una segunda opción `Express` o `Pickup` si la tienda lo ofrece.

> Verificación rápida: el panel de checkout del storefront muestra estas
> opciones como radios con su precio. Si no aparece ninguna, es que la service
> zone no cubre `US` o la option no está ligada a la región.

---

## 5. Publicar los productos (incluye estuches/cases)

Un producto **no publicado** o **sin sales channel** no aparece en la Store API
y su variante no se puede añadir al carrito.

- [ ] Admin → **Products**. Para cada producto que deba venderse:
      - **Status: Published**.
      - **Sales Channels:** incluye el canal del paso 2.
      - Verifica que tenga al menos **una variante** con **precio en USD**.
- [ ] **Importante — estuches (cases):** los estuches de *seed* que no tengan
      variante publicada aparecerán en el storefront con el botón **deshabilitado**
      (comportamiento correcto de ORDEN 1: sin `variantId` no se puede comprar).
      Para que se puedan comprar, publícalos igual que los frames, con su
      variante y precio.

---

## Checklist final (todo verde = listo para probar E2E)

- [ ] Región con `USD` y país `US`.
- [ ] Sales channel con publishable key asociada (y confirmada con el `.env`).
- [ ] Stripe habilitado como payment provider en la región.
- [ ] Stock location con sales channel + fulfillment provider.
- [ ] Service zone cubriendo `US` con ≥1 shipping option en USD.
- [ ] Productos (y estuches a vender) **Published** + en el sales channel + con
      precio USD.

Cuando esté todo, avísame: hago la prueba de punta a punta (ORDEN 9) con la
tarjeta de prueba `4242 4242 4242 4242` y el test negativo (que el cliente no
pueda manipular el precio).

---

### Cómo verificar sin abrir el navegador (opcional, para ti, Dionis)

```bash
# Debe devolver productos publicados (no 401). Sustituye la pk_ por la real.
curl -s https://api.161-153-9-98.sslip.io/store/products \
  -H "x-publishable-api-key: pk_XXXXReemplazar" | head -c 400

# Debe devolver una región con currency_code = usd
curl -s https://api.161-153-9-98.sslip.io/store/regions \
  -H "x-publishable-api-key: pk_XXXXReemplazar" | head -c 400
```

Un **401** aquí = falta la publishable key o el sales channel (paso 2).
Una lista **vacía** de products = falta publicar / asociar el sales channel
(paso 5).
