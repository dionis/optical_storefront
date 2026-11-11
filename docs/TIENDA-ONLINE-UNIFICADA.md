# La tienda online y las tiendas físicas en un solo panel

_Revisado el 11-nov-2026 contra lo que está desplegado. Decisión del dueño: **un
solo backend**, el del panel (`opticaelrancho.com/admin`), para las tres tiendas
físicas y para la tienda online (`www.rubilens.com`). Este documento dice cómo
está hoy, qué cambió en el código y lo que falta para que una compra de la web
se cobre y aparezca en el panel._

> **Corrección (11-nov-2026).** La primera versión de esta guía (10-nov) decía
> que la web seguía en el backend de producción y pedía mover dominios en
> Coolify y cambiar la clave publicable en Vercel. **No hace falta**: la web ya
> usa el backend del panel desde el 8-nov (§1). Esa versión se escribió con una
> copia vieja de la rama `develop` y sin mirar el sitio desplegado.

---

## 1. Cómo está hoy (comprobado el 11-nov-2026, 03:45 UTC)

| | Tienda online | Panel y tiendas físicas |
|---|---|---|
| Dirección | `www.rubilens.com` | `opticaelrancho.com/admin` |
| Rama del storefront (Vercel) | `develop` + `BACKEND_TARGET_OVERRIDE=staging` | `develop_optical_storepos` |
| Prefijo de API | `/medusa-staging` | `/medusa-staging` |
| Backend (Coolify) | **el del panel** (`api-staging.161-153-9-98.sslip.io`) | el mismo |
| Base de datos | **la del panel** | la misma |

- El 8-nov-2026 se unió a `develop` el interruptor `BACKEND_TARGET_OVERRIDE`
  (PR #5, decisión del dueño): con `staging` en el proyecto de Vercel, la web
  habla con el backend del panel aunque su rama sea `develop`. El sitio
  desplegado lo lleva puesto (`VITE_BACKEND_TARGET: "staging"` en su código).
- Por la API pública que usa la web: 584 productos, una región con Stripe y
  dos opciones de envío. La web **ya está conectada** al backend del panel.
- El backend de producción antiguo (`api.161-153-9-98.sslip.io`,
  `api.rubilens.com`) responde `503 no available server`. La tienda ya no lo
  usa: que esté caído no le afecta.

**Por qué no aparece ninguna compra de la web en el panel.** Seguridad →
«Tienda online» → «Último pedido de la web recibido aquí»: **ninguno todavía**.
No es que se pierdan: ninguna compra ha llegado a completarse. La causa que
muestran los datos:

- la web lleva la clave publicable de Stripe **en vivo** (`pk_live_…`);
- el backend del panel tiene Stripe **en modo de pruebas** (Seguridad → Pagos:
  «Stripe en modo en vivo · test»).

Con una clave en vivo en la web y una de pruebas en el servidor, Stripe rechaza
el pago: el cliente llega al final del checkout y no puede pagar. Hasta que el
backend tenga la clave en vivo (§4, paso 2) no entrará ningún pedido web.

Además, Seguridad marca 12 puntos en ese backend, que ahora es el real:
secretos de sesión débiles (`JWT_SECRET`, `COOKIE_SECRET`,
`ORDER_ACCESS_SECRET`), `VISION_INTERNAL_SECRET`, bucket privado de recetas,
`STORE_CORS` vacío, `STOREFRONT_URL` sin https, Stripe en pruebas, SMS, perfil
de la óptica y puesta en marcha. Los secretos débiles son lo más grave: con el
valor por defecto se pueden falsificar sesiones de administrador.

## 2. Cómo queda

```
www.rubilens.com  (marca RUBI LENS, rama develop,       ─┐
   BACKEND_TARGET_OVERRIDE=staging)                      │
                                                         ├─►  UN backend (Coolify):
opticaelrancho.com/admin  (panel, develop_optical_…)    ─┘    3 tiendas, equipo, precios,
        las dos por /medusa-staging                           costos, reglas + pedidos web
```

Una compra en `rubilens.com` es un pedido de Medusa sin venta de caja
(`channel = web`). En cuanto se pueda cobrar, entra sola en:

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
  no mueve el precio de la web (decisión C8 de `docs/PRICE-MATRIX.md`).
- **«Op4 · Online Optical Store»** de la lista de Tiendas es un establecimiento
  (una columna de precios y una caja), **no** la tienda online: los pedidos de
  la web no entran por él. La tienda online es la tarjeta «Tienda online».

## 3. Qué cambió en el código (parches 0058–0062)

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

## 4. Lo que falta (lo hace Daniel: Coolify y Stripe)

Ninguno toca código. Los valores están preparados en
`secrets/coolify-staging-seguridad.txt` de su PC (carpeta ignorada por git);
las claves de Stripe salen de su panel de Stripe, nunca por chat.

1. **Coolify → backend del panel → Environment Variables**: pegar el
   **Bloque 1** del archivo (secretos de sesión, `STORE_CORS` con los dominios
   de la web, `STOREFRONT_URL`, `ADMIN_PANEL_URL`) y el **Bloque 3**
   (`STOREFRONT_URLS` y `STOREFRONT_BRANDS`). Borrar `DEPLOY_ENV` si existe:
   este backend ya no es un staging de pruebas.
   Efecto al redesplegar: todos vuelven a iniciar sesión en el panel.
2. **Stripe en vivo en ese mismo servicio**: `STRIPE_SECRET_KEY` = la
   `sk_live_…` y `STRIPE_WEBHOOK_SECRET` = el `whsec_…` de un endpoint **live**
   que apunte a
   `https://api-staging.161-153-9-98.sslip.io/hooks/payment/stripe_stripe`
   (eventos `payment_intent.succeeded` y
   `payment_intent.amount_capturable_updated`). El endpoint anterior apuntaba al
   backend antiguo, que está caído. Crear el endpoint nuevo da un secreto nuevo,
   que es lo que hay que usar (el anterior quedó expuesto).
3. **Redeploy** del backend.
4. **Bucket privado de recetas** (Bloque 2 del archivo): crear el bucket
   `rubilens-recetas` y poner `R2_PRESCRIPTION_BUCKET`. Sin él no se guardan la
   foto de la receta ni la del probador de un cliente de la web, ni las fotos
   privadas del punto de venta.
5. **Vercel**, rama `develop_optical_storepos`: `VITE_STRIPE_PUBLISHABLE_KEY` =
   `pk_live_…` (la vista previa de El Rancho usa el mismo backend, que ya
   cobrará en vivo).

**Comprobar**

6. Panel → Administración → Seguridad: «Pagos» en verde («Stripe en modo en
   vivo · live») y «Tienda online» con «Marca de la tienda online ·
   www.rubilens.com → RUBI LENS».
7. Compra real en `www.rubilens.com` con tarjeta propia (montura barata):
   - el pago se completa;
   - el correo de confirmación llega a nombre de **RUBI LENS**, con su logo;
   - en el panel: Pedidos («Online · RUBI LENS»), Ejecutivo → Tienda online,
     Rentabilidad, Pacientes, y el contador «En laboratorio»;
   - mover la etapa a «Preparado» y ver el correo de etapa;
   - reembolsar desde Stripe y ver «Reembolsado».
8. Una venta de prueba en caja: el recibo sigue a nombre de **Óptica El
   Rancho**.

**Volver atrás**: quitar `BACKEND_TARGET_OVERRIDE` del proyecto de Vercel y
redesplegar `develop` devuelve la web al backend antiguo, que hoy está caído:
habría que levantarlo antes.

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

## 6. Lo que hay que saber

- **Pedidos web anteriores al 8-nov**: están en la base del backend antiguo
  (servicio caído). No aparecen en el panel ni en «Mis pedidos» de la web. Si
  hace falta pasarlos, se puede preparar una importación aparte; hoy no existe.
- **Numeración**: los pedidos de la web siguen la numeración de la base del
  panel.
- **Cuentas de clientes de la web** creadas en la base antigua: no pasan; el
  cliente se registra de nuevo (el seguimiento por correo no necesita cuenta).
- **Precios e impuestos de la web**: son los de la base del panel. Revisar en
  Productos y precios que el maestro es lo que debe cobrar la web, y la regla
  de impuestos (`STORE_FRAME_TAX_RATE`).
- **Datos del panel**: hay ventas reales y de prueba mezcladas. No usar la
  «Puesta a cero» de Seguridad (borra todo). Las de prueba se eliminan una a
  una desde la ficha de la venta (Eliminar, motivo «Venta de prueba»; solo
  dueño y superadmin): salen de todos los informes y quedan en «Eliminadas».
- **`rubilens.com/admin`** abre un panel con el código de `develop` (más
  antiguo) sobre los mismos datos. El panel de trabajo es
  `opticaelrancho.com/admin`.
- **La web corre con el código de `develop`** y el backend con el de
  `develop_optical_storepos`: las 18 rutas `/store/*` que usa esa web existen
  en este backend y las del carrito no han cambiado entre ramas (comprobado
  sobre el código y leyendo catálogo, región y envíos del sitio real; una
  compra completa es el paso 7).
- **Correo**: los correos de la web salen con el nombre RUBI LENS (cuando esté
  `STOREFRONT_BRANDS`) pero desde la dirección de `RESEND_FROM_EMAIL` hasta que
  se verifique `rubilens.com` en Resend y se ponga un remitente en el campo 6.
- **Dos equipos suben a la rama**: antes de trabajar, `git fetch` y partir de
  `origin` (`sync-repo.bat` lo hace y, si no cabe limpio, deja el trabajo local
  en una rama `backup/local-…`).

## 7. Después (no urgente)

- Unir las ramas: PR de `develop_optical_storepos` → `develop` y `main`
  (158 commits por delante, 2 por detrás de `develop`), para que la web y el
  panel salgan del mismo código. Tras eso el backend único se despliega desde
  `main`.
- Renombrar en Coolify el servicio «staging» y su dominio `api-staging…`: ya es
  el de producción (cambiar el dominio obliga a cambiar el rewrite
  `/medusa-staging` de `vercel.json` y el webhook de Stripe).
- Decidir qué se hace con el backend antiguo (hoy caído): borrarlo o dejarlo
  como archivo de los pedidos anteriores.
- Verificar `rubilens.com` en Resend y poner su remitente.
- Decisión C8 (precio propio para la web) si se quiere que la web no cobre el
  maestro.
