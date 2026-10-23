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
Estadísticas y panel público acotados a la ventana del board (300 pedidos).

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
