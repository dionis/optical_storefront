# Panel corporativo (`/admin`) — guía de diseño y funcionamiento

Rediseño del 23/10/2026: el panel pasa de pestañas horizontales a un **panel de
operaciones** (barra lateral de iconos contraíble, cajón hamburguesa en móvil,
100 % responsive) con el mismo lenguaje visual que la tienda y la hoja de Google
(Fraunces + Inter, azul marino `#0b2f66`, dorado `#b8921e`, azul `#0e5ad0`, rojo
`#d6123e`). Dos secciones nuevas: **Costos** (ficha de costo por venta) y
**Vendedores** (enlaces de referido y panel propio).

## Estructura (storefront)

| Archivo | Papel |
| --- | --- |
| `src/admin/AdminShell.jsx` | Armazón: barra lateral (`NAV_GROUPS`, `TABS`), barra superior (buscador global `/`, idioma, usuario, salir), cajón móvil. Estado contraído en `localStorage.adm_nav_collapsed`. |
| `src/admin/icons.jsx` | Iconografía profesional (trazos estilo Lucide, SVG inline, `currentColor`). `<Icon name="orders" size={18} />`. Nombre desconocido → círculo. |
| `src/admin/admin.css` | Sistema visual completo con tokens `--adm-*`. Tablas con `className="responsive"` + `data-label` en cada `td` se convierten en tarjetas en móvil (≤768 px). |
| `src/admin/AdminDashboard.jsx` | Secciones y enrutado `?tab=` (los enlaces de la hoja abren `?tab=orders&order=<id>`). Pedidos: filtros (texto, fechas, etapa, estado, receta, vendedor), CSV, detalle con receta, línea de tiempo, guía y nota editables, mini ficha de costo. |
| `src/admin/Costs.jsx` | Rentabilidad (por pedido, por concepto, semáforo de margen) y Fichas de costo (reglas por grupo). `OrderCostSheet` edita la ficha de un pedido. |
| `src/admin/Sellers.jsx` | Alta/edición/baja de vendedores, enlace de referido con botones de compartir, enlace privado al panel del vendedor, ranking y comisiones. |
| `src/pages/SellerDashboard.jsx` | Página pública `/vendedor?t=TOKEN` para el vendedor (sin login): su enlace, ventas, comisión; solo iniciales del cliente. |
| `src/data/referral.js` | Captura `?ref=CODIGO` (30 días en `localStorage.rl_ref`) y `fetchSellerDashboard`. El checkout manda `cart.metadata.seller_code`. |
| `src/admin/adminCosting.js`, `src/admin/adminSellers.js`, `src/admin/adminOrders.js` | Clientes del API (`/admin/costing/*`, `/admin/sellers*`, `/admin/order-board/:id/{tracking,note}`), CSV, compartir/copiar. Devuelven claves, nunca prosa. |

Todo el copy va por `t()` (`adm.nav.*`, `adm.cost.*`, `adm.sel.*`, `vd.*`) en
`es` y `en`; `pnpm check:i18n` lo vigila. Sin emojis: los KPI reciben un
`<Icon>` como `icon`.

## Paridad con la hoja de Google

| Acción | Panel | Hoja | Réplica |
| --- | --- | --- | --- |
| Cambiar etapa | botones "Avanzar" | columna Estado | ambos sentidos (`transitionOrderStage`) |
| Guía del courier | detalle → Guía | columna Guía (tracking) | ambos sentidos |
| Nota interna | detalle → Nota interna | columna Notas (`Nota: …`) | panel → hoja |
| Ficha de costo | Costos → ficha del pedido | columnas Costo / Margen | panel → hoja |
| Vendedor | automático por `?ref=` | columna Vendedor | tienda → ambos |
| Buscar/filtrar | filtros de Pedidos, CSV | pestaña Buscar | — |

## Costos (ficha de costo por venta)

Reglas (`cost_rule`) por tipo: `frame_brand` (precio mayorista Capri por marca),
`frame_sku` (manda sobre la marca; enlace "ver en Capri"), `lens_design`,
`lens_material`, `lens_photo`, `lens_ar`, `order_fixed` (laboratorio, embalaje,
estuche, otros), `shipping` (`actual` = lo cobrado al cliente, o fijo),
`order_percent` (comisión Stripe %), `payment_fixed` (fijo por cobro). La
comisión del vendedor sale de su ficha (`commission_pct`), no es una regla.
Importe 0 = sin definir (el panel lo marca). Un pedido puede tener su ficha
ajustada a mano (`order.metadata.cost_sheet`) y volver a las reglas cuando se
quiera. Capri Optics no publica precios sin login: el dueño los introduce.

## Vendedores

`seller` (código único A-Z0-9 3–12, comisión %, activo, redes, `token_version`).
Enlace de referido `https://www.rubilens.com/?ref=CODIGO`; enlace privado del
panel `https://www.rubilens.com/vendedor?t=<token HMAC>` (se invalida con
"Nuevo enlace"). Atribución: `cart.metadata.seller_code` → `order.metadata`.
Desde el 5-nov-2026 la pantalla Vendedores (`GET /admin/sellers/stats`) lee
**`sale_fact`** como el Ejecutivo: una venta de mostrador es de quien la
registró (`seller.user_id`), un pedido web del código de referido, una venta
una sola vez (`attributeSale`, `docs/CONTABILIDAD.md` §7); `by_source` lleva
`counter` («Mostrador») además de las redes. Ya no hay ventana de 300 pedidos
(`truncated` solo pasadas 20 000 ventas). El panel público `/vendedor` sigue
leyendo la ventana del board por código.

**Mi perfil**: la persona edita contacto, preferencias y, desde el 5-nov-2026,
su **nombre para mostrar** y su foto (`SELF_EDITABLE_FIELDS` en
`lib/staff-profile.ts`, con prueba); el código de vendedor lo genera el
sistema y las condiciones de trabajo, la emergencia y las notas siguen siendo
del dueño (QA D-15).

## Equipo: desactivar sin borrar y cierre de sesiones

Además de **Eliminar**, cada fila del Equipo tiene **Desactivar / Reactivar**
(`POST /admin/team/:id/status { active }`, HU-04). Desactivar pone
`staff_profile.disabled_at` + `disabled_by` y no borra nada: la persona conserva
usuario, rol, perfil, ficha de vendedor e historial, y al reactivarla vuelve con
el rol que tenía. Mismos vetos y códigos que Eliminar (`super_admin` para el
dueño, `self`, `owner_only` para un superadmin si no eres el dueño,
`forbidden_role`); la lista expone `disabled_at` e `is_disabled` y el panel pinta
el chip «Inactivo». Queda en Auditoría como `user.deactivate` / `user.reactivate`.

**Cierre de sesiones.** Los JWT de Medusa no se pueden revocar en el servidor sin
una lista negra, y `authenticate` no comprueba que el usuario siga existiendo.
Por eso `getStaffScope` (`src/lib/staff-scope.ts`), que corre en **cada**
petición a `/admin`, comprueba que el usuario exista y que no tenga
`disabled_at`: si falla cualquiera de las dos, resuelve a «sin acceso» (rol
`null`) y el guard responde 403 `inactive`. Esa comprobación por petición **es**
la revocación, con un retraso máximo de 30 s (la caché del scope, que la ruta
vacía para la persona afectada). Antes, un usuario eliminado con un token aún
válido quedaba sin filas de rol y la regla «sin filas = admin anterior a los
roles» lo convertía en superadmin fantasma hasta que el token caducara.

**Cerrar sesión en todos los equipos** (quien conserva su cuenta,
`src/lib/session-control.ts`). `staff_profile.sessions_revoked_at` marca el
instante; el guard compara el `iat` del JWT con esa marca y rechaza con **401
`session_revoked`** todo token anterior (el panel suelta la sesión y vuelve al
login). La escriben: `DELETE /admin/team/me/sessions` («Cerrar sesión en todos
mis equipos», en Mi perfil → Contraseña, cualquier rol, la propia sesión
incluida), `DELETE /admin/team/:id/sessions` («Cerrar sus sesiones» en Equipo;
dueño y superadmin, nunca sobre uno mismo: mismos vetos que restablecer
contraseña) y **todo cambio de contraseña** — la propia (`POST
/admin/team/password`; el panel vuelve a iniciar sesión con la nueva en el acto,
`adminTeam.js changeOwnPassword`), la temporal puesta por un admin
(`POST /admin/team/:id/password`) y la recuperación por correo (al 200 de
`POST /auth/user/emailpass/update`). Un token emitido en el mismo segundo que la
marca sobrevive (es el que se acaba de emitir). Auditoría: `session.revoke` con
el motivo (`password_changed`, `password_reset`, `password_recovered`,
`remote_logout`, `self_logout`). Migración `StaffProfileSessions5`.

## Recuperar la contraseña uno mismo (HU-03)

En el login hay «¿Olvidaste tu contraseña?». El flujo es el de Medusa, sin
tabla ni ruta propia:

1. El panel manda `POST /auth/user/emailpass/reset-password { identifier }`
   (por el proxy `/medusa`). Medusa responde **201 siempre** y solo emite
   `auth.password_reset` si la identidad existe; el panel muestra «Si el correo
   existe, te enviamos un enlace» en todos los casos (no se filtra qué cuentas
   hay).
2. El subscriber `src/subscribers/auth-password-reset.ts`
   (`src/lib/password-reset.ts`) busca el usuario por el correo, y **no envía
   nada** si no hay usuario del panel con esa dirección o si la persona está
   desactivada (`staff_profile.disabled_at`: quien fue dado de baja no se
   readmite solo). Si procede, manda el correo
   (`src/lib/email/password-reset-email.ts`, es/en, misma plantilla que los
   demás) con el enlace `${ADMIN_PANEL_URL}?reset=<token>&email=…` (por
   defecto `${STOREFRONT_URL}/admin`; pon `ADMIN_PANEL_URL=https://opticaelrancho.com/admin`
   cuando el panel se sirva bajo el dominio de la óptica). El
   token nunca se escribe en el log. Queda en Auditoría como
   `password.reset_requested` (sin actor; `after.delivered` dice si salió el
   correo).
3. El enlace abre el formulario «Nueva contraseña» (mín. 8, dos veces). El
   panel manda `POST /auth/user/emailpass/update { email, password }` con
   `Authorization: Bearer <token>`. El token vale **15 minutos y un solo uso**
   (constante de Medusa, `RESET_TOKEN_TTL_MINUTES` en `password-reset.ts`), y
   pedir uno nuevo invalida el anterior; un 401 es «el enlace caducó o ya se
   usó». Al guardar, el panel limpia la URL y vuelve al login con la nota de
   éxito.

Límites (`src/lib/security.ts`, `src/api/middlewares.ts`): 5 peticiones de
enlace por IP y por correo cada 15 min (`PASSWORD_RESET_RATE_LIMIT`), 10 envíos
de contraseña nueva por IP cada 15 min (`PASSWORD_RESET_UPDATE_RATE_LIMIT`).
`/auth/user/emailpass/register` sigue cerrado. Si la persona tenía una
contraseña temporal (`must_change_password`), la marca no se borra por este
camino: al entrar, el candado de primer acceso le pedirá cambiarla otra vez.
Claves de texto en `src/i18n/parts/auth.js`.

## QA

Playwright (`chromium` del sistema) con `VITE_ADMIN_DEMO_LOGIN=true` para la
maquetación a 1440 px y 390 px; verificación funcional en producción con la
sesión real del dueño. Backend: `npx tsc --noEmit` y `npx jest`.

## Actualización 23/10/2026 (tarde): Ejecutivo en pestañas, todo clicable, exportar, distribución %

- **Ejecutivo** (`ExecutiveHub.jsx`) tiene cuatro pestañas pensadas para caber en una pantalla (tamaños con `clamp()`/`vh`, `useChartHeight`): **Ventas** (`Executive.jsx`), **Costos operacionales** (`ExecutiveCosts.jsx`: ingreso/costo/margen/objetivo, reparto del ingreso, costo y margen por día, costo de monturas por marca, por vendedor, últimos pedidos con margen, partidas), **Resumen** y **Ventas** (los antiguos Resumen/Ventas, ahora embebidos). `?tab=overview|sales|prices` siguen funcionando (mapa `LEGACY_TABS`).
- **Todo clicable**: `go(tab, params)` en `AdminDashboard.jsx` salta a cualquier pantalla con filtros (`orders` acepta `stage`, `terminal`, `preset`, `seller`, `order`, `q`; `costs` acepta `sub` y `order`). `KpiCard` admite `onClick` + `hint`; `DonutChart` admite `onSelect`; las tarjetas usan `Card` (`ui.jsx`) con título clicable (ir a), globo de ayuda (`InfoTip`) y exportación.
- **Exportar**: `exportUtils.js` — CSV de columnas explícitas o de lo que hay en pantalla (`elementToCsv`), y PDF mediante impresión aislada del nodo (`printElement`, hoja `#adm-print-root`; "Guardar como PDF" en el diálogo). Cada tarjeta (`ExportMenu`), cada tabla, cada pestaña del Ejecutivo y de Costos.
- **Pedidos**: lista desplegable "Cambiar estado" (`StageSelect`, mismas etapas que acepta el servidor), preset "Hoy", PDF de la tabla.
- **Costos y precios** (`Costs.jsx`): sub-pestañas Rentabilidad, Fichas de costo (importes), **Distribución %** (partidas por porcentaje: atención al cliente, renta, webmaster, impuestos, marketing… como reglas `order_percent`; y **ganancia objetivo** = regla `order_percent:profit_target`, que NO es costo: el backend la excluye y devuelve `profit_target_pct/amount/gap`), y Precios (el antiguo Precios). `AllocationBar` pinta el reparto del ingreso con la marca ◆ del objetivo.
- **Vendedores**: `social_links` del backend → un enlace por red (`?ref=CODIGO&src=instagram`…) con compartir/copiar y ventas por red (`by_source`); `referral.js` guarda `src` y el checkout manda `seller_source`. El panel público `/vendedor` muestra los mismos enlaces y la red de cada venta.
- **Hoja de Google**: pestaña nueva **Costos** (fichas y distribución, solo lectura) y columna "Desglose costo" en Pedidos/Historial; Vendedor = `CODIGO · red`.

## Actualización 23/10/2026 (noche): modelo de costos "deducciones primero", seguridad de dependencias, Node 22

**Modelo de dinero de cada venta** (`apps/backend/src/lib/costing.ts`, `computeCostSheet` es la única fuente):
1. `gross` = lo que pagó el cliente (`order.total`).
2. Deducciones (no son del dueño): envío (`shipping:actual` = `shipping_total`, o fijo), impuestos (`tax:order` = `tax_total`), comisión de Stripe (`order_percent:payment_fee` sobre el bruto + `payment_fixed`). `net_base = gross − deducciones`.
3. Materiales en importe fijo (montura por SKU/marca, lentes, laboratorio, embalaje…).
4. Partidas por porcentaje (`order_percent` salvo `payment_fee`/`profit_target`) y comisión del vendedor: **% del neto**.
5. `cost_total` = 2 + 3 + 4; `margin` (ganancia del dueño) = gross − cost_total; `profit_pct_net` = margin / net_base.
6. Objetivo `profit_target` (30 % por defecto, sembrado): `profit_target_amount = net_base × pct`, `profit_gap = margin − objetivo`.
7. Precio sugerido (solo informativo, los precios de la web no cambian): `net* = M / (1 − p − g)`, `suggested_price = (net* + S + F) / (1 − f)` (M materiales, p partidas+vendedor, g objetivo, S envío+impuestos, F fijo Stripe, f % Stripe).
Cada línea lleva `kind` y `group` (`deduction|material|percent|seller|manual`). El panel pinta la cascada (`Waterfall` en `Costs.jsx`) y el reparto por grupos (`AllocationBar`), y Rentabilidad muestra neto, % del neto y precio sugerido por pedido.

**Seguridad de dependencias**: `pnpm.overrides` en el `package.json` raíz fuerzan versiones parcheadas de paquetes transitivos con CVE (proxy-addr, qs, compression, multer, axios, handlebars, shell-quote, follow-redirects, lodash, nanoid, browserslist, source-map-js, postcss, uuid, react-router, ajv, morgan, @graphql-tools/utils…); `sharp` subido a ^0.35.5. Los rangos son **caret dentro del mismo major** (`^1.1.21`, `react-router-dom@6: ^6.30.6`): un `>=` cruza de major y rompió el primer despliegue (react-router 7 sin `json`, brace-expansion 5 y nanoid 6 solo ESM). Lo que queda en `pnpm audit --prod` son transitivas de Medusa sin parche dentro de su major o que no se ejecutan en producción (vite/esbuild del admin-bundler, otel/grpc de telemetría, braces sin versión parcheada, csv-parse 5 y uuid 9 dentro de Medusa, react-router 6 del dashboard). Node 20 llegó a fin de vida sin parches (la tanda de seguridad de Node de octubre 2026 —Brotli RCE CVE-2026-111497 y TLS— solo cubre 22/24/26): Dockerfiles, CI y `engines` pasan a **Node 22**. En Vercel, comprobar que el proyecto compila con Node 22 (Settings → General → Node.js Version). No hay PHP en este proyecto (caprioptics.com es WordPress del proveedor y solo se lee con el scraper).

## Panel de ventas: desglose de ventas y ganancia

Pestaña **Panel de ventas** (`SalesBoard.jsx`). Cada usuario ve lo suyo: dueño y superadmin, todas las tiendas y la web; supervisor y encargado, sus tiendas; vendedor, sus propias ventas.

- **Periodo**: hoy, ayer, 7 y 30 días, este mes, mes pasado, este año, 5 años, una fecha o un rango libre.
- **Ver por**: hora del día, día, mes o año. La hora suma todos los días del periodo; para las horas de un día concreto se elige «Una fecha».
- **Desglose**: por tienda, vendedor o producto, y en «Otro desglose» marca, categoría, lente, forma de pago o punto de venta. Un clic en una fila filtra todo el panel y baja de nivel, hasta las ventas una a una.

| Quién | Ventas | Su comisión | Comisiones de todos, costo y ganancia |
| --- | --- | --- | --- |
| Dueño y superadmin | Sí | — | Sí |
| Supervisor y encargado | Sí, de sus tiendas | — | Solo con el privilegio de costos |
| Vendedor | Sí, las suyas | Sí | Solo con el privilegio de costos, sobre sus ventas |

**Ganancia** = ventas sin impuestos − costo de monturas, lentes y fijos por pedido (reglas de Costos) − comisión del cobro − comisión del vendedor. No resta la renta ni otros gastos del mes: esos siguen en el resultado de cada tienda. Si a una montura o lente le falta su costo, el panel avisa, porque la ganancia mostrada sería mayor que la real.

Tras desplegar, correr una vez `npx medusa exec ./src/scripts/backfill-sale-fact.ts` para que las ventas web anteriores hechas con enlace de vendedor aparezcan bajo ese vendedor.

## Precios: un modelo en todas las tiendas (HU-13) e historial con quién y antes → después (HU-15), 5-nov-2026

- **HU-13 — `GET /admin/pricing/frames/across?q=<texto o SKU>`** (`src/lib/pricing-across.ts`, bloque «Un modelo en todas las tiendas» en Precios y costos → Monturas, `FramesSection.jsx` → `AcrossBlock`). Hasta 20 modelos publicados cuyo título o el SKU de cualquier color contiene `q`; cada fila trae `base_cents`, el precio del maestro (`master_price_cents`, `master_source` `owner|band|rule|base`) y una celda por tienda **activa** `{ establishment_id, code, name, color, price_cents, source, exposed }`. Las celdas salen de `storeLinePrice` (la función de la caja) y el maestro de `catalogSellingPrices` (la del panel de costos): nunca una segunda fórmula. `source` = `exact` (precio exacto de la tienda) · `band` (lo movió el suelo/techo) · `adjusted` (ajuste general) · `base`; `exposed` viene del surtido por tienda (`isExposed`) y el panel pinta «oculto» sin esconder el precio. El costo (`cost_cents` en la fila = la cadena; en la celda = lo que paga esa tienda, variación incluida) solo viaja con «Ver costos»/«Gestionar costos» (`frameCostsDenied`, el mismo filtro de `frames/costs`); sin permiso se quita en el servidor (`redactAcrossCosts`) y la columna no aparece. Solo dueño/superadmin (sin entrada en la lista de roles restringidos). Clic en una celda = elegir esa tienda en el selector global (`setActiveStore`), con lo que el panel entero pasa a sus precios. Tests puros: `tests/pricing-across.test.ts`.
- **El maestro lleva la regla general (5-nov-2026).** La regla escrita en «Todas las tiendas» (`POST /admin/pricing/frames/rule` sin `store`, `establishment_id` null) es la de la cadena: la aplica toda tienda sin regla propia (`generalAdjustment` en `lib/store-pricing.ts`), y desde hoy también **el precio maestro** (`masterLinePrice`, puro: precio propio del dueño → base × regla general → suelo y techo), que es el precio del que parte cada tienda. Antes el maestro mostraba el base y una tienda que heredaba mostraba el base +10 %, así que la columna «Maestro» y el «Precio venta» de Costos de monturas no coincidían con ninguna tienda. `catalogSellingPrices` (`frames/costs`, `frames/across`) devuelve `source` / `price_source` y el panel etiqueta «regla general» (`adm.price.across.src.rule`); el precio que el dueño teclea para un modelo sigue sin tocarse. La web (precios de Medusa, `price-sync`) no aplica esta regla: la regla es de las tiendas. Tests: `tests/store-pricing.test.ts` (`masterLinePrice`), `tests/frame-cost-store.test.ts`, `tests/pricing-across.test.ts`.
- **HU-15 — historial de precios con quién, cuándo, antes y después.** `GET /admin/store-pricing/:id` → `history[]` enriquecido en `lib/store-pricing-data.ts` (`pairPreviousValues` puro + `enrichRuleHistory` en lotes: una consulta de usuarios, una de perfiles y una de productos para toda la lista, nunca por fila): `created_by_name` / `closed_by_name` (nombre de perfil, si no nombre y apellido, si no la parte local del correo), `product_title` / `product_sku` en reglas de un modelo, `family` (`adjustment|price|minimum`), `previous_rule_id/value/mode` (la regla de la misma tienda+alcance+modelo+familia cerrada en el instante en que se abrió esta, ±2 s, que es como escribe `replaceRule`) y `replaced_by` (null en una cerrada = se quitó, no se sustituyó). **Incluye las reglas de la cadena** (`establishment_id` null: `/admin/pricing/frames/rule` y los precios globales del dueño) marcadas `chain: true`, porque la tienda las hereda; es una consulta más. Tiendas → Precios (`StorePricing.jsx`) pinta la tabla Cuándo · Quién · Qué (modelo + SKU, o «Todas las monturas/estuches», con chip «Cadena») · Antes → Después (y «Quitado el … por …» cuando se retiró) · Tipo. Textos en `src/i18n/parts/pricing-across.js`. Tests: `tests/store-pricing.test.ts` (bloque `pairPreviousValues`).

## Productos y precios: una sola pantalla (matriz), 6-nov-2026

Petición del dueño: fusionar **Productos** con **Precios y costos**. Contrato de la API: `docs/PRICE-MATRIX.md` (lo implementa el backend en paralelo; el panel se programó estrictamente contra él).

- **Pestaña** `products` («Productos y precios», grupo Comercial; `?tab=products`). `?tab=pricing` y `go("pricing", …)` caen aquí (`LEGACY_TABS` en `AdminDashboard.jsx`, que ahora conserva el `sub`/`q` del enlace). La entrada «Precios y costos» salió del menú (`AdminShell.jsx`). `CatalogManager.jsx`, `BrandAccordion.jsx` y `catalog-manager.css` se borraron (nadie más los importaba).
- **Subpestañas** (`?sub=`): `frames` · `cases` · `lenses` · `treatments` · `rules`. Los `sub` viejos se traducen (`frames`, `lenses`, `lenses-prog`, `treatments` → su matriz; `costs`, `sheets` → `rules`). `PricingPanel.jsx` es el contenedor; la matriz es `pricing/PriceMatrix.jsx` (+ `pricing/matrix/*`, estilos en `pricing/price-matrix.css`).
- **Matriz**: cabecera pegada de dos filas (tienda con franja superior de 4 px y fondo teñido de su color · debajo «Precio | Desc %»); columnas pegadas a la izquierda: artículo (miniatura 28 px en monturas/estuches, título, SKU/clave) y costo. Acordeón por grupo (marca, diseño, familia) con número de artículos, costo promedio y margen promedio (sobre el precio final), y por tienda su margen y —en marcas— el interruptor «Visible» (surtido, `setAssortmentRule(..., { scope: "brand" })`, luego se relee la sección porque la regla del modelo manda sobre la de la marca). Solo se pintan los grupos abiertos (se recuerdan por sección en `localStorage`); al buscar o filtrar se abren los grupos con resultados.
- **Casillas** (`matrix/NumCell.jsx`): texto con `inputMode="decimal"` (sin flechas), alineado a la derecha; guarda al salir o con Enter (que baja a la misma columna de la fila siguiente; Mayús+Enter sube), Esc deshace, Tab recorre la fila. Optimista: rayado discreto mientras guarda, ✓ al confirmar, y si el servidor responde un `reason` la casilla vuelve a la cifra anterior con `adm.err.pricing.<reason>` pegado debajo. El navegador comprueba antes lo obvio (`bad_value`, `discount_range`). Precio = el efectivo de la caja; un precio fijado en la tienda (`store_exact`) va en negrita con un punto del color de la tienda y una «×» que lo devuelve a la regla; el globo dice el origen (regla / banda / maestro) y el margen. El descuento enseña debajo el precio final. El ojo de cada celda de montura expone/oculta ese modelo en esa tienda. El botón de encendido de la fila descontinúa/reactiva el modelo (`setProductStatus`, con confirmación). Sin `cost_access` la columna de costo no existe.
- **Barra**: búsqueda (con retardo; filtra en el navegador y, si el servidor marca la respuesta como `truncated`, también manda `q`), filtros «Sin costo · Con descuento · Precio fijado» (con su cuenta), expandir/contraer, «+ Marca/colección» y «+ Montura»/«+ Estuche» (`matrix/AddFrameDialog.jsx` → `POST /admin/catalog/frames`; la marca nueva es el mismo diálogo con «nueva marca» elegida), «+ Tratamiento» (`matrix/AddTreatmentDialog.jsx` → `POST /admin/pricing/treatments`), Exportar e Importar. El selector de tienda global deja solo las columnas de esa tienda (útil en el teléfono).
- **Excel** (`exportXlsx.js`, sin dependencias): `downloadXlsx(name, sheets)` sigue igual para los demás; nuevo `buildStyledXlsx` (estilos dinámicos: negrita, rellenos por color con texto blanco u oscuro según contraste `inkOn`, bordes finos, `$#,##0.00`, `0.0%`, celdas combinadas, paneles inmovilizados, autofiltro, columnas ocultas, fórmulas con valor en caché) y `readXlsx` (zip STORE o DEFLATE con `DecompressionStream("deflate-raw")`, cadenas compartidas o en línea). Libro (`matrix/matrixXlsx.js`): Portada (fecha y hora, quién, leyenda de tiendas con su color, cuántos artículos por hoja, cómo importar) + Monturas, Estuches, Lentes, Tratamientos, con fila de grupo en negrita y columnas Marca | Modelo | SKU | Costo | por tienda Precio, Desc %, Final (fórmula). Columna oculta `_key` = `sección|clave`. El botón Excel de la barra global exporta el mismo libro.
- **Importar**: lee el mismo libro en el navegador, mapea columnas por el texto de la cabecera (código de tienda en la fila de tiendas, celdas combinadas incluidas; palabras en es/en) y **solo manda lo que cambió** respecto a la matriz actual — un precio igual al efectivo de hoy no se manda (re-importar el archivo sin tocar no convierte las reglas en precios fijos); vaciar un precio fijado lo devuelve a la regla; vaciar un descuento lo quita; un % de celda con formato porcentaje llega como fracción (0.1 = 10 %). `POST /admin/pricing/matrix/import { apply: false }` → diálogo con cuentas, tabla de cambios (artículo, tienda, campo, antes → después; en ámbar lo que baja a menos de la mitad) y errores → «Aplicar» (`apply: true`) → se relee la matriz.
- **Reglas y comisiones**: lo que no es de un artículo, con los componentes de antes y el selector de tienda (maestro / variación): regla general de monturas y estuches y % de lentes (`RuleRow`, `AdjustRow`), suelo y techo (`BandBlock`), comisiones, costos de la tienda y por venta e impuesto (`CostsSection`), importar la lista del navegador (`PriceImport`) y, plegadas, las fichas de costo por pedido (`Profitability`). Registra el informe de precios de siempre en la barra (PDF/Excel/CSV): `BAR_TABS.products` pasa a `export: true`.
- **Promoción en recibos**: si la línea trae `promo` (contrato), el recibo térmico y el doble enseñan debajo «Precio antes ~~$X~~ · Promoción −Y %» (el precio de la línea ya es el rebajado); la ficha de laboratorio, que no lleva importes, solo «Promoción −Y %»; el resumen de la venta (`PosSaleSummary.jsx`) lo mismo que el recibo. Cálculo en `pricing/promo.js` (un solo % si todas las partes rebajadas llevan el mismo; si no, el efectivo de la línea).
- **Banco de pruebas**: `harness/exec.html?tab=products&sub=frames|cases|lenses|treatments|rules[&mode=dark][&lang=en]` con el backend simulado `harness/matrix-mock.js` (4 tiendas, 3 marcas × 10 modelos, estuches, lentes, tratamientos; precio > 5000 → `bad_value`, SKU `DC401` → `sku_taken`). Prueba del Excel: `node apps/capri-storefront/scripts/test-xlsx.mjs` (escribir → leer, re-zip DEFLATE con cadenas compartidas como guarda Excel, mapeo y diff de importación, validaciones y `promoOf`).
- **i18n**: `src/i18n/parts/price-matrix.js` (`adm.pm.*` y los `adm.err.pricing.<reason>` nuevos), registrado el último en `parts/index.js` porque renombra `adm.tab.products` a «Productos y precios».
