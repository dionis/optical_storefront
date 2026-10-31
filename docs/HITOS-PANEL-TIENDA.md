# Panel de tienda (POS y contabilidad) — hitos del 31-oct-2026

Rama: `develop_optical_storepos` (staging: <https://rubilens-staging.vercel.app/admin_stores>, backend `api-staging`).
La tienda online (`develop` / www.rubilens.com) **no se toca** desde esta rama.

## Cómo se trabaja en esta rama (acordado con Eyewear Dev)

- **Origin manda.** Lo que está en GitHub es la verdad; la copia local de Daniel nunca hace `force-push`.
- Flujo: `fetch` → rebase de lo local encima de `origin` → `push` normal. Si GitHub rechaza, se vuelve a ejecutar.
- `sync-repo.bat` (en la raíz del proyecto en la máquina de Daniel, no versionado) hace exactamente eso, con pausas entre pasos, copia de seguridad `backup/local-<fecha>` si hay commits locales y confirmación antes de subir. El viejo `push-elrancho.bat` (rebase sobre `origin/develop` + `--force-with-lease`) era lo que pisaba el trabajo ajeno: eliminado.
- Claude trabaja en una copia en la nube y entrega el trabajo como parches (`git format-patch`) que se aplican con `git am` en la máquina de Daniel; el push lo hace Daniel con el `.bat`.
- i18n: cada módulo nuevo tiene su diccionario en `apps/capri-storefront/src/i18n/parts/<modulo>.js` y se registra en `parts/index.js`; así varios cambios en paralelo no chocan en `translations.js`. `pnpm check:i18n` sigue validando el conjunto.
- CSS: cada módulo nuevo lleva su hoja (`pos-rx.css`, `pos-frame-card.css`, `sales-board.css`, `cash-report.css`, `store-statement.css`, `admin-theme.css`) importada desde su componente; `admin.css` solo tokens y lo común.

## Hito 1 — Receta óptica en el POS ✅

`PosRx.jsx` (`RxForm`), `rxRules.js`, `pos-rx.css`, parte i18n `pos-rx.js`; backend `modules/prescription/validation.ts`.

- Primero se elige **Monofocal (visión sencilla)** o **Multifocal (bifocal / progresivo)**. Monofocal oculta ADD y ALT; multifocal los exige. El selector de lentes solo ofrece diseños de la categoría elegida.
- Cuadrícula compacta como la planilla de papel: filas OD / OI, columnas ESF · CIL · EJE · ADD · PRISMA · BASE · DNP · ALT. DNP por ojo (25–40 mm) con DIP binocular calculada; `pd` legado se parte en dos al cargar y se manda como suma.
- Reglas optométricas (`validateRx`): ESF −20,00…+12,00; CIL −6,00…+6,00; EJE 1–180 entero, solo si hay cilindro y obligatorio entonces; ADD 0,75…4,00 **espejada en ambos ojos**; PRISMA 0…10 con BASE obligatoria si hay prisma; ALT 10–35 mm con aviso de pasillo corto (< 14) en progresivos. Los valores se ajustan al paso de 0,25 y se muestran con signo (+2,25 / −0,75). El botón Siguiente se bloquea con cualquier error; el servidor sigue siendo la última palabra (mismos rangos en `validation.ts`, códigos `prism_out_of_range`, `prism_base_required`, `seg_height_out_of_range` en `@eyewear/shared`).
- La **graduación que usa hoy** (paso 1) usa el mismo `RxForm` en modo `worn`: origen (lensómetro / receta anterior / venta anterior), fecha exacta o aproximada y medidas del armazón actual en una sola fila.
- OCR: botones «Tomar foto» (solo en pantallas táctiles, `capture="environment"`) y «Subir archivo» (imagen o PDF), mismo endpoint `/admin/pos/prescriptions/ocr`; el vendedor confirma lo leído antes de avanzar; el tipo se infiere de la ADD.

## Hito 2 — Montura, documentos impresos y colores ✅

- **Ficha de la montura** (`PosFrameCard.jsx`): al elegirla aparece la tarjeta profesional (foto, marca, modelo, color con muestra y cambio de color, SKU / código de barras, `52 □ 18 140`, material, forma, aro, género/edad, precio) y una versión compacta encabeza los pasos de receta, lentes y precio. `GET /admin/pos/products` devuelve ahora `brand`, `images`, `specs` y `color`/`sku`/`barcode` por variante (`lib/frame-specs.ts`).
- **Una montura por venta** (de Eyewear Dev, `6ba1201`): `MAX_LINES = 1` en el servidor; el paso Montura cierra las dos vías al elegir una.
- **Recibos y ticket de laboratorio con la foto** del espejuelo (catálogo o foto de la montura del cliente por URL firmada de 15 min). `printHtml` espera a que carguen las imágenes.
- **Recibo doble en carta** (`receipt_duo`): una hoja carta apaisada con dos copias iguales lado a lado y línea de corte — «Copia del cliente» / «Copia de la tienda (archivo)». Es el recibo por defecto en impresoras normales; el rollo de 72 mm sigue para terminales térmicas (`pos_terminal.printer`). Auditoría y contador de reimpresión compartidos con `receipt`.
- **Colores por tienda** (`useStoreTheme.js`, `admin-theme.css`): el panel toma el color de la tienda en la que se trabaja (barra superior, menú, pestaña activa, botones primarios, tinte de fondo). Dueño / superadmin sin tienda: gris y negro. Por defecto (migración `CreateEstablishmentThemeColor5`, cambiable en Tiendas → Editar): Fry Family Clinic verde `#1B7F4C`, El Rancho 39 cobre `#B5651D`, El Rancho 41 fucsia `#C2185B`, tienda online azul `#0E5AD0`.
- **Modo claro / oscuro / sistema**: botón junto al idioma en la barra superior (`adm_color_mode`). Los documentos impresos siempre salen en claro.
- **Símbolo `$`**: `money()` del panel formatea `$1,234.50` también en español (es-US), como la planilla y los recibos.

## Hito 3 — Contabilidad ✅

- **Ventas de tienda** (`SalesBoard.jsx`, `lib/sales-insights.ts`): granularidad hora · día · **semana** (ISO, lunes) · mes · año; presets hoy · ayer · esta semana · semana pasada · este mes · mes pasado · este año · rango; barra de filtros fija (tienda, vendedor, comparar, PDF · Excel · CSV); franja de totales siempre visible; secciones en acordeón con conteo y total en la cabecera y fila de totales en negrita. `GET /admin/sales-analytics/insights?by=a,b,c` devuelve todos los desgloses en una llamada.
- **Caja → Movimientos** (`CashReport.jsx`, `lib/cash-report.ts`, `GET /admin/pos/cash-report`): cobros por método (efectivo, débito, crédito, Zelle, otros; aseguradoras aparte como cuentas por cobrar), movimientos manuales con **motivo** (`supplier_payment`, `expense`, `owner_withdrawal`, `bank_deposit`, `change_fund`, `refund`, `correction`, `other`; migración `CreatePos4`), arqueos con diferencias, serie diaria, totales; PDF y Excel.
- **Estado de cuenta por tienda** (`StoreStatement.jsx`, `lib/pos-statement.ts`, `GET /admin/pos/statement`): `EST-<tienda>-<AAAAMM>`, todas las ventas del período con artículos, descuentos, cobros por método y saldo; totales por vendedor y por día; liquidación (`settlement_pct`) para tiendas familiares / socias / consignación; carta imprimible y Excel. Pestaña «Estado de cuenta» para administradores, supervisores y encargados.
- **Excel sin dependencias** (`exportXlsx.js`): libro `.xlsx` real (números como números, cabecera fija con filtro, totales en negrita). `ExportMenu` ofrece PDF · Excel · CSV.

## Tras desplegar

1. Coolify (backend staging): `medusa db:migrate` — columnas `staff_profile.photo_url`, `cash_movement.category` y colores por defecto de las tiendas.
2. Vercel: despliegue automático de `develop_optical_storepos`.
3. Revisar en staging: nueva venta completa (receta monofocal y multifocal, montura del catálogo y propia, recibo doble), Ventas de tienda por semana, Caja → Movimientos, Estado de cuenta, y el botón de modo oscuro.

## Pendiente / siguientes hitos

- Plantillas para montura propia (combinaciones frecuentes de lente para «visión sencilla» y «multifocal» con un clic).
- Optimización de espacios en el resto de pantallas (Pedidos, Costos, Tiendas): una vista por pantalla, acordeones con totales.
- Toasts y diálogos del panel en modo oscuro (hoy usan las clases del storefront, fuera de `.adm-shell`).
- Seguridad: rotar el secreto del webhook de Stripe y cambiar la contraseña admin expuestos en capturas (acción de Daniel).
