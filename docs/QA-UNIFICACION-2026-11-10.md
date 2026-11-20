# QA — tienda online en el panel y acabado visual (10-nov-2026)

Entorno: backend y storefront en local (Postgres, Redis, almacenamiento S3
simulado), rama `develop_optical_storepos`. Backend configurado como quedará
unido: `STORE_NAME=Óptica El Rancho`, `STOREFRONT_URLS` con los dominios de
RUBI LENS y `STOREFRONT_BRANDS` con su marca. Los pedidos web se crearon por
la API pública de la tienda (`/store/*`: carrito, línea configurada con lentes
y receta, envío, pago y cierre), con la cabecera `Origin` de la web, igual que
los manda el navegador. **No se probó con Stripe en vivo ni contra los
servidores reales**: eso es el paso 7 de `docs/TIENDA-ONLINE-UNIFICADA.md` §4.

## 1. Pruebas automáticas

| Qué | Resultado |
|---|---|
| Backend: `tsc --noEmit` | sin errores |
| Backend: `eslint src tests` | 0 errores (12 avisos anteriores) |
| Backend: `jest --runInBand` | **92 suites / 1562 pruebas** (con los cuatro commits de Eyewear Dev del 10-nov ya debajo) |
| Diccionario (`check-i18n`) | 6882 claves × 2 idiomas |
| `check-vercel-config`, `check-tenant` | OK |
| Excel (`test-xlsx`) | 20 |
| Storefront: `vite build` | OK |

Pruebas nuevas: `storefront-brand.test.ts` (marca por dominio y la confirmación
real del pedido en los dos casos), `web-channel.test.ts` (comprobaciones de
«Tienda online»), `start-map.test.ts` (pendientes de la web) y
`store-frame-photo.test.ts` (rutas de fotos abiertas a los roles de tienda).

## 2. Recorrido funcional (guion `qa-web.cjs`, 12 de 12)

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Pedidos con «Tienda online» elegida: solo pedidos web | 5 filas, todas «Online» |
| 2 | El origen lleva la marca de la web | «Online · RUBI LENS» |
| 3 | Ejecutivo → Pedidos y etapas con «Tienda online» | 5 ventas |
| 4 | Ficha de un pedido web | «Tienda online · RUBI LENS» |
| 5 | Pedidos con una tienda física elegida: solo sus ventas | 17 filas, todas Op2 |
| 6 | Saludo → «Por tienda»: sin rótulos repetidos | oculto a la vista, legible por lector de pantalla |
| 7 | Saludo: la tienda online cuenta sus pedidos en laboratorio | 5 |
| 8 | Seguridad → «Tienda online» | 7 puntos |
| 9 | Etapa de un pedido web: laboratorio → preparado | #35 → preparado |
| 10 | Los pendientes siguen a la etapa | laboratorio 5→4, por entregar 0→1 |
| 11 | `GET /admin/web-channel` con un vendedor | 403 |
| 12 | Saludo de la tienda online con un vendedor | 403 |

Además, por API: la venta web entra en `sale_fact` con `channel = web`; el
resumen de ventas con `stores=web` da 5 ventas / $566.38 y «todas» las suma
con las de caja; Rentabilidad lista los pedidos web con costo y ganancia;
Pacientes muestra a los compradores de la web con su nombre.

Marca de los correos (prueba sobre la plantilla real): comprado en la web →
nombre RUBI LENS, su logo y sus enlaces, sin rastro de las tiendas; vendido en
tienda → Óptica El Rancho con el logo y colores del panel.

## 3. Acabado visual

Revisadas 26 pestañas en escritorio (1440×900 y 1280×720), tableta (601×878,
Galaxy Tab A7 Lite en vertical) y celular (390×844), en claro y en oscuro las
que cambiaron.

| Defecto | Dónde | Arreglo (`src/admin/polish.css`) |
|---|---|---|
| Guion suelto junto al título («Pedidos -», «Tiendas -»…) | Todas las pantallas con cabecera | La línea de acento llena el hueco hasta las herramientas y desaparece si no hay sitio |
| «PDF» y recargar caían a una segunda fila | Pedidos | Herramientas en una fila |
| «Nuevo vendedor» debajo del buscador | Vendedores | Ídem |
| El sexto filtro solo en una segunda línea a 1280 px | Pedidos | Filtros en rejilla |
| Rótulo de columna repetido en cada cifra | Saludo → Por tienda | El de la celda se oculta a la vista |
| El botón flotaba sobre el buscador | Vendedores en tableta | El título ocupa su fila |
| Un correo donde va el nombre | Pacientes (compradores de la web) | Nombre del último pedido (backend) |

Sin cambios de paleta ni de tokens.

## 4. Comprobado sobre lo desplegado (11-nov-2026, solo lectura)

| Qué | Resultado |
|---|---|
| GitHub `develop_optical_storepos` | `ebc81a2`, mismo árbol que el trabajo local (`c963a614…`) |
| Backend del panel (`/medusa-staging/version`) | commit `ebc81a2`, migraciones `ok` |
| Panel desplegado | Tiendas muestra la tarjeta «Tienda online»; Seguridad, el grupo «Tienda online»; el saludo ya no repite rótulos |
| `www.rubilens.com` | su código lleva `VITE_BACKEND_TARGET: "staging"`: usa el backend del panel |
| API pública desde la web | 584 productos, 1 región con Stripe, 2 opciones de envío |
| Seguridad → Pagos | Stripe **en pruebas** en el backend; la web lleva `pk_live` → no se puede pagar |
| Seguridad → Tienda online | dominios de la web listados; marca sin configurar; «último pedido: ninguno todavía» |
| Seguridad en total | 12 puntos por resolver (secretos de sesión, bucket privado, CORS, URL pública, Stripe, SMS, perfil, puesta en marcha) |
| Backend antiguo (`/medusa/version`) | 503; la tienda ya no lo usa |

No se pudo leer el resultado del CI de GitHub desde aquí; las mismas
comprobaciones pasan en local sobre ese árbol.

## 5. Lo que no se probó

- Compra con tarjeta real y webhook de Stripe en vivo.
- Una compra completa en `rubilens.com` contra este backend: se comprobó que
  sus 18 rutas `/store/*` existen, que las del carrito no cambiaron entre ramas
  y que el sitio real lee catálogo, región y envíos; no el pago.
- Entrega real de correos (en local no hay proveedor): se probó el contenido
  de la plantilla, no la bandeja de entrada.
