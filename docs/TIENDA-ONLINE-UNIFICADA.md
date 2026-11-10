# La tienda online y las tiendas físicas en un solo panel

_10-nov-2026. Decisión del dueño: **un solo backend**, el que ya usa el panel
(`opticaelrancho.com/admin`), para las tres tiendas físicas y para la tienda
online (`www.rubilens.com`). Este documento explica por qué hoy no se veían las
compras de la web, qué cambió en el código y los pasos exactos para unirlo._

---

## 1. Qué pasaba

| | Tienda online | Panel y tiendas físicas |
|---|---|---|
| Dirección | `www.rubilens.com` | `opticaelrancho.com/admin` |
| Rama del storefront (Vercel) | `develop` | `develop_optical_storepos` |
| Prefijo de API | `/medusa` | `/medusa-staging` |
| Backend (Coolify) | producción (`api.161-153-9-98.sslip.io`, `api.rubilens.com`) | staging (`api-staging.161-153-9-98.sslip.io`) |
| Base de datos | la de producción | la de staging |

Eran **dos backends con dos bases de datos**. Una compra en la web se guardaba
en la base de producción; el panel lee la de staging. Por eso ninguna compra de
`rubilens.com` aparecía en el panel: no era un fallo de una pantalla, eran datos
en otro sitio.

El código del panel ya trataba la web como una tienda más («Tienda online» en
el selector de tienda, canal `web` en ventas, costos, estado de resultados,
pacientes y pedidos). Lo que faltaba era que la web escribiera en el mismo
backend, y unos pocos huecos que solo se ven cuando conviven las dos cosas
(§3).

> **Aviso del 10-nov-2026, 20:26 UTC:** el backend de producción respondía
> `503 no available server` (`https://www.rubilens.com/medusa/version`). La
> página de `rubilens.com` carga, pero sin backend no hay catálogo ni cobro.
> La unión de abajo lo resuelve de paso; si no se hace hoy, reiniciar ese
> servicio en Coolify.

## 2. Cómo queda

```
www.rubilens.com  (marca RUBI LENS, rama develop)      ─┐
   /medusa → api.161-153-9-98.sslip.io                  │
                                                        ├─►  UN backend (Coolify)
opticaelrancho.com/admin  (panel, develop_optical_…)    │    el del panel: 3 tiendas,
   /medusa-staging → api-staging.161-153-9-98.sslip.io ─┘    equipo, precios, costos,
                                                             reglas + pedidos de la web
```

- **No cambia ninguna dirección pública** ni ningún `vercel.json`: el servicio
  del panel en Coolify pasa a atender también los dominios de API de
  producción. Para la web, `/medusa` sigue siendo `/medusa`.
- **No se vuelve a cargar nada en el panel**: tiendas, equipo, precios, costos,
  reglas y ventas se quedan como están.
- Una compra en `rubilens.com` es un pedido de Medusa sin venta de caja:
  `channel = web`. Entra sola en:

| Pantalla | Qué se ve de la web |
|---|---|
| Comercial → **Pedidos** | El pedido con su etapa. Columna **Origen**: «Online · RUBI LENS» o la tienda. El selector de tienda de la barra filtra (Todas / Tienda online / una tienda). |
| Resumen → **Ejecutivo** | Elegir «Tienda online»: ventas, costo real, ganancia, pedidos y etapas. En «Todas las tiendas» suma con las físicas. |
| Saludo del día / «Ahora mismo» | Los pedidos web sin terminar cuentan en **En laboratorio** y **Por entregar**, y en su línea de «Por tienda». |
| Comercial → **Rentabilidad** | Ficha de costo de cada pedido web (montura, lentes, envío, impuestos, comisión del cobro, vendedor). |
| Comercial → **Pacientes** | Quien compra en la web aparece con su nombre, sus compras y su receta. |
| Tiendas → **Tienda online** | Tarjeta con sus dominios, su marca, pedidos de 30 días y el último recibido. |
| Administración → **Seguridad** → «Tienda online» | Siete comprobaciones de que la web está bien conectada (§5). |
| Estado de resultados (Reglas y comisiones) | Columna «Tienda en línea» y consolidado. |
| Alertas | Las reglas con «incluir la web» avisan también de pedidos online. |

- **Lo que la web no tiene** (por diseño): caja, estado de cuenta ni costos fijos
  de tienda (renta, sueldos). Su resultado es venta − costo de montura y lentes
  − comisión del cobro − comisión del vendedor.
- **Precios de la web**: los del **maestro** de Productos y precios (el job
  `price-sync` los escribe en Medusa cada 4 h). La columna de una tienda física
  no mueve el precio de la web (decisión C8 de `docs/PRICE-MATRIX.md`, sin
  cambios).

## 3. Qué cambió en el código (parches 0058–0060)

### 3.1 Dos marcas sobre un backend

El backend tiene una identidad (`STORE_NAME`, la marca del panel): la de las
tiendas, **Óptica El Rancho**. La web es **RUBI LENS**. Antes, un backend que
servía dos dominios cambiaba el enlace de los correos pero no la marca: un
cliente de `rubilens.com` habría recibido su confirmación a nombre de Óptica El
Rancho.

Nueva variable **`STOREFRONT_BRANDS`** (`lib/tenant.ts`):

```
STOREFRONT_BRANDS=dominio|nombre|color principal|color de acento|URL del logo|remitente ; …
```

- Solo dominio y nombre son obligatorios. El dominio debe estar en
  `STOREFRONT_URLS`.
- Un pedido comprado en ese dominio lleva `metadata.storefront_origin`; sus
  correos (confirmación, copia a administradores, cambios de etapa, «Mis
  pedidos») y sus SMS se arman dentro de ese dominio y ahí `tenant()` responde
  con **esa** marca: nombre, colores y logo (`<dominio>/logo-oficial.png` si no
  se da otro). La marca que el dueño guardó en el panel (colores y logo de las
  tiendas) **no** se aplica a esos correos.
- Todo lo demás —caja, recibos, ficha de laboratorio, correos del personal,
  alertas, hoja— sigue con la marca del backend.
- `GET /store/tenant` no devuelve la marca del panel a una web con marca propia
  (no la repinta con los colores de las tiendas).
- Remitente opcional por web (campo 6), de un dominio verificado en Resend.

Pruebas: `tests/storefront-brand.test.ts` (incluye la confirmación real del
pedido en los dos casos).

### 3.2 La web en «pendientes»

`lib/start-map.ts`: los pedidos web sin terminar entran en **En laboratorio**
(confirmado / en laboratorio) y **Por entregar** (preparado / en camino), para
el dueño y superadmin mirando «Todas» o «Tienda online». La etapa sale de la
misma proyección que Pedidos (`fetchBoardOrdersByIds`), así que no pueden
discrepar. Antes el Ejecutivo decía «el laboratorio está al día» con pedidos
web esperando.

### 3.3 Pedidos: de dónde viene cada uno

- `lib/order-board.ts`: cada fila lleva `storefront: { host, name }` (la web
  donde se compró y su marca).
- `Pedidos` (AdminDashboard.jsx): columna **Origen**, filtro por la tienda de
  la barra (`store=web|<id>`), y el origen en el CSV. `GlobalFilterBar`: Pedidos
  muestra el selector de tienda.
- Ficha del pedido: «Tienda online · RUBI LENS».

### 3.4 Pacientes de la web con nombre

El checkout de la web es de invitado: el cliente de Medusa solo guarda el
correo. `fillWebNames` (`lib/patient-history-data.ts`) toma nombre, teléfono y
dirección del último pedido. Antes la lista mostraba un correo donde va un
nombre.

### 3.5 Comprobaciones y tarjeta

- `lib/web-channel.ts` + `GET /admin/security-status`: grupo **Tienda online**.
- `GET /admin/web-channel` (dueño y superadmin) + `WebStoreCard.jsx` en Tiendas.

### 3.6 Acabado visual

`src/admin/polish.css` (se carga antes de `responsive.css`): cabeceras de
pantalla en una fila con su línea de acento (antes un guion suelto junto al
título y botones que caían a una segunda fila), filtros de Pedidos en rejilla,
«Por tienda» del saludo sin rótulos repetidos. Detalle y capturas:
`docs/QA-UNIFICACION-2026-11-10.md`.

## 4. Pasos para unirlo (los hace Daniel: Coolify, Vercel y Stripe)

Ninguno toca código. Orden recomendado; del 3 al 6 la web queda unos minutos
sin servicio (hoy ya lo está).

**Antes**

1. `sync-repo.bat` → **S** y **Redeploy** del backend del panel en Coolify.
   Comprobar `https://opticaelrancho.com/medusa-staging/version`.
2. **Copia de seguridad** de la base del panel (Coolify → base de datos →
   Backups → Backup now). Es la base que pasa a ser la única.

**Coolify — servicio del backend del panel**

3. Variables (Environment Variables):

   | Variable | Valor |
   |---|---|
   | `DEPLOY_ENV` | quitarla (o `production`): deja de ser un staging que no cobra |
   | `STRIPE_SECRET_KEY` | la `sk_live_…` (la misma del servicio de producción) |
   | `STRIPE_WEBHOOK_SECRET` | el `whsec_…` del webhook **live** (aprovechar para rotarlo: paso 7) |
   | `STOREFRONT_URLS` | añadir `https://www.rubilens.com,https://rubilens.com` |
   | `STORE_CORS` | añadir `https://www.rubilens.com,https://rubilens.com` |
   | `STOREFRONT_BRANDS` | `https://www.rubilens.com\|RUBI LENS\|#0b2f66\|#b8921e;https://rubilens.com\|RUBI LENS\|#0b2f66\|#b8921e` |

   `STORE_NAME`, `STOREFRONT_URL` y `ADMIN_PANEL_URL` se quedan como están.
   Los valores secretos se copian de un servicio a otro dentro de Coolify; nunca
   por chat.

4. En el **servicio de producción antiguo**: quitar sus dominios
   (`https://api.161-153-9-98.sslip.io` y `https://api.rubilens.com` si está) y
   **detenerlo**. No borrarlo: su base de datos es el archivo de los pedidos web
   anteriores.
5. En el **servicio del panel** → Domains: añadir esos mismos dominios a los que
   ya tiene (separados por comas) → **Redeploy**.
   Comprobar: `https://www.rubilens.com/medusa/version` debe dar el mismo
   `commit` que `https://opticaelrancho.com/medusa-staging/version` y
   `"features":["multistore"]`.

**Medusa Admin del backend del panel** (`…/app`)

6. Settings → Regions → la región → Payment providers: **Stripe** activado.
   Settings → Publishable API keys: copiar la clave (`pk_…`) del canal de la web.

**Stripe (modo live)**

7. Developers → Webhooks → el endpoint `…/hooks/payment/stripe_stripe`: si usa
   `api.rubilens.com` no cambia nada; si usa otro dominio, apuntarlo al del
   panel. **Roll secret** y pegar el nuevo `whsec_` en el paso 3 (el anterior
   quedó expuesto en una captura).

**Vercel**

8. `VITE_MEDUSA_PUBLISHABLE_KEY` del build que sirve `www.rubilens.com` (rama
   `develop`): la clave del paso 6. **Redeploy** de `develop` sin caché.
   Sin esto la web no muestra productos (todas las llamadas `/store` dan 400).
9. `VITE_STRIPE_PUBLISHABLE_KEY` de la rama `develop_optical_storepos`:
   `pk_live_…` (el backend ya cobra en vivo; con `pk_test_` esa vista previa no
   podría pagar).

**Comprobar**

10. Panel → Administración → Seguridad → **Tienda online**: los siete puntos
    en verde. Tiendas → tarjeta «Tienda online · RUBI LENS».
11. Compra real en `www.rubilens.com` con tarjeta propia (montura barata):
    - el correo de confirmación llega a nombre de **RUBI LENS**, con su logo;
    - en el panel: Pedidos («Online · RUBI LENS»), Ejecutivo → Tienda online,
      Rentabilidad, Pacientes, y el contador «En laboratorio»;
    - mover la etapa a «Preparado» y ver el correo de etapa;
    - reembolsar desde Stripe y ver «Reembolsado».
12. Una venta de prueba en caja: el recibo sigue a nombre de **Óptica El
    Rancho**.

**Volver atrás** (si algo falla): quitar los dominios de producción del
servicio del panel, devolverlos al servicio antiguo e iniciarlo; restaurar la
`VITE_MEDUSA_PUBLISHABLE_KEY` anterior en Vercel y redesplegar `develop`. Las
ventas hechas en el panel mientras tanto no se pierden.

## 5. Comprobaciones de «Tienda online» (Seguridad)

| Punto | Falla cuando | Arreglo |
|---|---|---|
| Dominios de la tienda online | Una entrada de `STOREFRONT_URLS` no es una URL, o es http en producción | Corregir la variable |
| Marca de la tienda online | Una entrada de `STOREFRONT_BRANDS` tiene un color o logo mal escrito, está repetida, o su dominio no está en `STOREFRONT_URLS` | Corregir la variable (el detalle dice cuál) |
| Clave publicable unida a un canal | No hay ninguna | Medusa Admin → Publishable API keys |
| Productos publicados en el canal de la web | El canal de esa clave no tiene productos | Medusa Admin → Products → Sales channels |
| Cobro con tarjeta activo en la región | En producción, la región no tiene Stripe / PayPal / Square | Medusa Admin → Regions |
| Opciones de envío | No hay ninguna | Medusa Admin → Locations & Shipping |
| Último pedido de la web recibido aquí | Nunca falla: dice número, fecha, dominio y cuántos en 30 días | — |

## 6. Lo que hay que saber antes

- **Pedidos web anteriores**: se quedan en la base antigua (servicio detenido,
  no borrado). No aparecerán en el panel ni en «Mis pedidos» de la web. Si hace
  falta pasarlos, se puede preparar una importación aparte; hoy no existe.
- **Numeración**: los pedidos nuevos de la web siguen la numeración de la base
  del panel (no empiezan en #1 ni continúan la antigua).
- **Cuentas de clientes de la web**: las que existieran en la base antigua no
  pasan; el cliente se registra de nuevo (el seguimiento por correo no necesita
  cuenta).
- **Precios e impuestos de la web**: pasan a ser los de esta base. Antes de
  abrir, revisar en Productos y precios que el maestro es lo que debe cobrar la
  web, y la regla de impuestos (`STORE_FRAME_TAX_RATE`).
- **Datos del panel**: hay ventas reales y de prueba mezcladas. No usar la
  «Puesta a cero» de Seguridad (borra todo). Las de prueba se eliminan una a
  una desde la ficha de la venta (Eliminar, motivo «Venta de prueba»; solo dueño y superadmin): salen de todos
  los informes y quedan en «Eliminadas».
- **`rubilens.com/admin`**: seguirá abriendo un panel (con el código de
  `develop`, más antiguo) sobre los mismos datos. El panel de trabajo es
  `opticaelrancho.com/admin`.
- **Compatibilidad de la web actual**: las 18 rutas `/store/*` que usa el
  storefront de `develop` existen en este backend y las del carrito no han
  cambiado entre ramas (comprobado sobre el código, no con una compra real: es
  el paso 11).
- **Correo**: los correos de la web salen con el nombre RUBI LENS pero desde la
  dirección configurada en `RESEND_FROM_EMAIL` hasta que se verifique
  `rubilens.com` en Resend y se ponga un remitente en el campo 6 de
  `STOREFRONT_BRANDS`.

## 7. Después (no urgente)

- Unir las ramas: PR de `develop_optical_storepos` → `develop` y `main`
  (158 commits por delante, 2 por detrás de `develop`), para que la web y el
  panel salgan del mismo código. Tras eso el backend único se despliega desde
  `main`.
- Renombrar en Coolify el servicio «staging» y su dominio `api-staging…`: ya es
  el de producción.
- Verificar `rubilens.com` en Resend y poner su remitente.
- Decisión C8 (precio propio para la web) si se quiere que la web no cobre el
  maestro.
