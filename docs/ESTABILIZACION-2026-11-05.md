# Estabilización del POS — 5 de noviembre de 2026 (segunda tanda)

Rama `audit/estabilizacion-pos`, continuación de `ESTABILIZACION-2026-11-04.md`.
Peticiones del dueño recogidas en la sesión del 5-nov, con su solución, el código
que la lleva y cómo se comprobó. Las tiendas (Op1–Op4) no se tocan.

## 1. Medición de la cara con IA («no me está calculando»)

**Causa raíz.** En producción el contenedor del backend se quedó sin hilos del
sistema operativo (`RuntimeError: can't start new thread`, visible en los logs
de Coolify). El servicio `vision-measure` corría cada consulta de estado del
trabajo (`GET /measure/jobs/:id`, una por segundo por cliente) en un hilo de
anyio, así que un contenedor con el límite de pids/memoria alcanzado no podía
ni leer el estado del trabajo.

**Qué se cambió** (`apps/vision-measure/services/api/vision_api.py`):

- `health`, `providers`, `start_measure_job`, `set_job_notify` y
  `get_measure_job` son ahora `async def`: no consumen hilos del pool; solo el
  trabajo de medición usa `_JOB_POOL`.
- Si al arrancar un trabajo no hay hilos, la API responde **503 `server_busy`**
  con un mensaje claro (es/en) en vez de un 500 opaco; lo mismo si el fallo
  ocurre dentro del trabajo (`errorCode`, `error`, `errorEn` en el estado).
- `GET /health` publica `threads` (hilos vivos) y `jobs` (total / en curso) para
  verlo en Coolify sin entrar al contenedor.
- El storefront (`src/data/visionMeasure.js`, `MeasureReport.jsx`) enseña
  `vm.busy` («el servicio está saturado, inténtalo en un minuto») cuando llega
  ese código, en lugar del texto técnico.
- `version.py`: feature `async-job-endpoints`.

**Operación pendiente (dueño / Coolify).** Reiniciar la app de producción
(`optical-storefront` → producción) para liberar los hilos, y revisar en
*Resource limits* que el contenedor tenga pids y memoria suficientes (el backend
de Medusa + vision-measure + el pool de medición). En staging falta además
`VITE_ENABLE_TRY_ON` y el host de Supabase en `VISION_IMAGE_PROXY_ALLOWED_HOSTS`.

## 2. Receta: base del prisma y fecha anterior

| Petición | Solución | Dónde |
|---|---|---|
| «Cuando se mete la graduación se debe poder meter la base.» | El desplegable **Base** ya no está bloqueado hasta teclear prisma: se puede elegir siempre; las reglas (`validateRx`) avisan «sin prisma no hay base» o «falta la base» y la casilla se marca en rojo. Al vaciar la casilla de prisma para reescribirla la base se conserva (solo un `0` explícito la borra). | `PosRx.jsx`, `rxRules.js` |
| «Se debe poder registrar recetas con fecha anterior.» | El campo *Fecha de la receta* admite cualquier día desde 1990 hasta **hoy local**. Antes `max` se calculaba en UTC: a partir de las 18:00 en Texas «hoy» ya era mañana y el servidor rechazaba la fecha (`bad_rx_date`). Tooltip `adm.pos.rx.dateHint`. | `PosRx.jsx` (`localToday`, `RX_DATE_MIN`) |

Comprobado en el *harness* (`/harness/index.html?v=rx`): base elegible sin
prisma → error visible; al teclear prisma 1 → sin errores; `max` = fecha local.

## 3. Lentes: «donde dice bifocal tiene que decir tallado o de stock»

- Lista de precios (`price-list-2026.ts`): la fila `bifocal` («Bifocal FT-28»)
  se **retira** y entran `tallado` («Tallado» / *Surfaced*) y `stock` («De
  stock» / *Stock*), ambas en la categoría `bifocal` (así fotocromáticos y
  antirreflejos se cobran igual que antes). Arrancan con el precio que tenía el
  bifocal; **el dueño fija el de cada tienda en Tiendas → Precios**.
- Migración `SplitBifocalTalladoStock8`: inserta los dos diseños y sus precios
  base (solo si no existen), y deja `bifocal` inactivo. Idempotente; `bifocal`
  no se borra para que las ventas antiguas conserven su desglose.
- Storefront: `lensPricing.js` (respaldo estático), `LensProcess.jsx` (iconos e
  imágenes por **categoría**, no por id, para que cualquier diseño nuevo de la
  familia salga bien), textos `lens.use.desc.tallado|stock`, etiquetas de
  categoría en Precios y en el POS («Multifocal (tallado · de stock ·
  progresivo)», grupos de antirreflejo).
- Tests: `price-list-2026.test.ts` (precios de `tallado`/`stock`, y que el
  respaldo del storefront ya no lleve `bifocal`).

## 4. Materiales del cristal: cada uno con su color y aspecto de vidrio

`LensMaterialGlass` (`src/components/LensGraphics.jsx`): un disco de lente en
tres cuartos, dibujado en SVG, con tinte por material y **el grosor real de su
índice** (CR-39 el canto más grueso, 1.74 el más fino):

| Material | Color |
|---|---|
| CR-39 | azul hielo |
| Policarbonato | verde agua |
| 1.56 | ámbar |
| 1.61 | violeta |
| 1.67 | rosa |
| 1.74 | azul zafiro |

Se usa en el configurador público (paso «Elegir material del cristal») y en el
POS, donde el desplegable de material pasa a ser una fila de **fichas** con el
disco, el nombre y ★ en el recomendado por la graduación (`PosSale.jsx`,
`admin.css` `.pos-mat`). Tabla `MATERIAL_LOOK` para cambiar un color.

## 5. POS: precio de venta en vivo según la tienda

Antes la cotización solo se pedía en los pasos *Precio* y *Pago*. Ahora, desde
que hay una montura, cada cambio (línea, lente, material, descuento, **tienda**)
vuelve a pedir `POST /admin/pos/quote` al servidor, que calcula con los precios
de la tienda activa (`lens_store_price`, reglas de la tienda). Se ve:

- un **ticket en vivo** sobre los botones de navegación (`.pos-live`): tienda,
  cada línea con su importe y el total;
- en el paso *Lentes*, el precio de cada línea junto a la montura
  (`LinePrice`: montura + lentes).

Sin material elegido el lente vale 0 y en cuanto se elige aparece el importe.
En los pasos previos al precio un error de cotización no muestra aviso (la venta
está a medias). El servidor sigue siendo la única fuente del total.

## 6. Panel: cambiar de óptica en un clic

- La barra de filtros del panel (selector de tienda global) aparece también en
  **Vender** (`GlobalFilterBar.BAR_TABS.pos`).
- El POS **escucha** ese selector (`adm:active-store`): si no hay una venta
  empezada, cambia la caja a esa tienda al instante; con una venta a medias la
  tienda queda fija hasta terminarla o cancelarla. Al abrir el POS arranca en la
  tienda del filtro global (si puede vender en ella), si no en la última usada.

## 7. Pago y entrega: sin saldo completo no hay envío a domicilio

- Servidor: `shipRequiresFullPayment(delivery, balance_cents)` en `lib/pos.ts`;
  `POST /admin/pos/sales` responde `ship_requires_full_payment` si se pide envío
  con saldo pendiente (regla que el cliente no puede saltarse).
- Caja: la opción *Envío a domicilio* se desactiva mientras el saldo sea mayor
  que cero, con el motivo al lado; *Siguiente* tampoco avanza.
- Test en `pos.test.ts`.

## 8. Tickets y comprobantes

- **Ficha de laboratorio siempre doble**: una hoja carta apaisada con dos copias
  iguales (laboratorio / archivo de la tienda) y línea de corte, por cada línea
  con lentes (`jobDuoHtml`). La hoja suelta queda como `jobSheetHtml` para la
  vista previa.
- **Color de la óptica** en todos los documentos impresos: `doc.store.color`
  (el de Tiendas → Editar) viaja con el documento y pinta la banda de cabecera
  (`.band`, con `print-color-adjust: exact`) y los filetes (`--sc`). El recibo
  por correo lleva la misma banda (`storeBanner`).
- El recibo doble ya era una sola hoja con dos copias; el rollo de 80 mm sigue
  para impresoras térmicas.

Vista previa: `/harness/index.html?v=job|duo|rcpt`.

## 9. «Cliente» → «Paciente»

En todo el panel (claves `adm.*` y `vd.*`, es/en), en los documentos impresos y
en los correos del POS y de pedidos (`pos-emails.ts`, `alert-emails.ts`,
`copy.ts`). No cambian los identificadores de código (`customer_id`,
`cleanCustomer`…) ni los textos de la tienda pública dirigidos al comprador
(«atención al cliente» de la web). Script usado: solo el valor de la línea de
traducción, nunca la clave.

## 10. Datos de pago del trabajador (SSN/ITIN y cuenta bancaria)

**Petición.** «Cuando se crea un trabajador o vendedor debe poder registrarse el
social y la cuenta y ruta para el pago… tiene que ser seguro y protegido».

Es el dato más delicado que guarda la tienda, así que la forma importa tanto
como el campo. Decisiones:

- **Cifrado en reposo.** `src/lib/secret-box.ts`: AES-256-GCM con clave de 32
  bytes en `PAYROLL_ENCRYPTION_KEY` (fuera de la base). GCM además *autentica*:
  un byte cambiado en la base hace fallar el descifrado en vez de devolver
  basura. IV aleatorio por valor y prefijo de versión (`v1.…`) para poder rotar.
- **Nunca vuelve completo.** Las rutas devuelven solo método de cobro, banco,
  titular y «•••• 1234» (`viewPayroll`). No hay «ver» ni «copiar»: si se perdió
  el número se escribe de nuevo. Una sesión robada no se lleva un SSN.
- **Sin clave no se guarda nada.** 503 `payroll_key_missing` y el panel lo
  explica; antes que un SSN en claro «mientras tanto», no se guarda.
- **Validación real** (`src/lib/staff-payroll.ts`): SSN con las reglas de la SSA
  (área ≠ 000/666/9xx, grupo y serie ≠ 0), ITIN por rangos del IRS, ruta ABA con
  su dígito de control, cuenta de 4 a 17 dígitos. Un número mal copiado se
  descubre al teclearlo, no el día de la nómina.
- **Quién.** Dueño y superadmin sobre cualquiera
  (`/admin/team/:id/payroll`); cada persona sobre sí misma
  (`/admin/team/me/payroll`, en la lista de rutas abiertas a todos los roles),
  para que el número no pase por manos de nadie más.
- **Auditoría sin el valor**: acción `payroll.change` con qué campos cambiaron y
  los últimos 4 dígitos.
- **Nunca** en correos, en la hoja de Google, en logs ni en exportaciones.
- Columnas nuevas en `staff_profile` (migración `StaffProfilePayroll4`): los
  tres números solo existen cifrados (`*_enc`) y con su `*_last4` al lado.
- Panel: `src/admin/StaffPayroll.jsx`, última sección de la ficha. Campos como
  `password`, `autoComplete="off"`, y al guardar vuelven a la máscara.
- `GET /admin/security-status` añade `secret.PAYROLL_ENCRYPTION_KEY`.

**Para activarlo en producción**: generar la clave
(`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
y ponerla como `PAYROLL_ENCRYPTION_KEY` en Coolify. Si se pierde, los números
guardados ya no se pueden descifrar y hay que volver a escribirlos.

## 11. Precio por marca y por establecimiento

**Petición.** «Se debe poder poner regla de formación de precio para marcas por
separado y por establecimiento» y, acto seguido, los precios con los que vende
hoy: Peachtree 45, For You 60, Trending 50, Flexure 75, Millennials 75,
Grande 75 y Di Caprio 90.

**Qué se añadió.** Un `scope` nuevo en `store_price_rule`: `brand`, con el
*slug* de la marca en `target` — el mismo `metadata.brand_slug` que usa el
surtido, así que **los modelos que entren después heredan el precio** sin tocar
la regla. Dos formas de usarlo:

- `mode: "override"` → **precio fijo** para todas las monturas de esa marca
  («Peachtree a $45»), que es como vende la óptica;
- `mode: "percent"/"delta"` → el ajuste de siempre, pero solo para esa marca.

**Quién gana a quién** (`storeLinePrice`, `src/lib/store-pricing.ts`):

```
precio exacto del modelo en la tienda
  > precio de su marca en la tienda > precio de su marca en el maestro
  > regla de todas las monturas (tienda, luego maestro) > precio base
```

Un estuche no tiene marca: las reglas de marca solo tocan monturas.
`frame_source` de la línea gana un valor, `brand_price`, para que el recibo y
la auditoría digan de dónde salió el número.

**Los precios del dueño, ya en la base.** Migración
`CreateStorePriceBrandRules4` (store-pricing): escribe una regla por tienda
activa y marca, **solo si esa tienda no tiene ya una regla abierta** para ella
— si el dueño cambia un precio en el panel, un despliegue posterior no se lo
pisa. La tienda online no es un establecimiento, así que no la toca. Slugs del
catálogo: `peachtree` 45, `4u` (Four You) 60, `trendy` 50, `flexure` 75,
`millennial` 75, `grande` 75, `di-caprio` 90. ProRx se dejó sin regla.
El nombre del archivo empieza por «Create…» porque Medusa corre las migraciones
por orden de NOMBRE: con `BrandPriceRules4` habría corrido antes de existir la
tabla (lo detectó `tests/migration-order.test.ts`).

**Panel.** «Precios y costos» → «Monturas y estuches» lista una fila por marca
(precio fijo / % / monto / ninguna), con el número de modelos y la insignia
«Heredado» cuando la tienda abierta aún usa la del maestro. Ruta:
`POST /admin/pricing/frames/rule` con `scope: "brand"` y `brand`.

**Pruebas** (`tests/store-pricing.test.ts`): precio fijo de marca, que no toca a
otras marcas ni a los estuches, que el precio de un modelo le gana, que la
tienda gana al maestro y hereda cuando no tiene la suya, el ajuste por marca
frente a la regla general, la regla cerrada y la validación.

## 12. Cómo se probó

- `pnpm test` (backend, Windows/Node 24): 860 tests en verde tras la tanda
  (incluye `tests/staff-payroll.test.ts`, 20 casos: validación, máscara,
  auditoría sin valores y cifrado — ida y vuelta, IV distinto, valor alterado,
  clave ausente y clave equivocada).
- `pnpm typecheck`, `pnpm lint`, `node scripts/check-i18n.mjs` (5.046 claves × 2),
  build del storefront (`vite build`, 569 URLs en el sitemap). `check-i18n`: 5.082 claves × 2.
- Revisión visual en el servidor de desarrollo del PC con Chrome: ficha doble,
  recibo doble, receta (base/fecha), paso de material del configurador.
- `py_compile` de `vision_api.py`.

## 13. Pendiente

1. **Reiniciar la app de producción en Coolify** y revisar límites de recursos
   (apartado 1). Hasta entonces la medición con IA puede seguir fallando.
2. Abrir el PR `audit/estabilizacion-pos` → `develop_optical_storepos` (el
   formulario ya está preparado en GitHub; falta el visto bueno del dueño).
3. Precios de `tallado` / `stock` por tienda en Tiendas → Precios.
4. Si se quiere «paciente» también en la tienda pública (textos al comprador),
   decidirlo aparte: hoy se dejó «cliente» en esa parte.
5. Añadir `PAYROLL_ENCRYPTION_KEY` en Coolify (apartado 10) antes de que nadie
   intente guardar datos de pago.
6. ProRx no lleva regla de marca: falta decir a cuánto se vende.
7. Alta manual de marcas y monturas (precio, fotos, medidas) — pedido el 5-nov,
   pendiente de decidir si esas monturas salen también en la tienda online.
