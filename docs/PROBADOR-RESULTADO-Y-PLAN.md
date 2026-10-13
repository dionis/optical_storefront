# Probador (try-on): resultado/revisión 2 columnas, zoom+descarga y PLAN completo

> Documento vivo. Recoge lo YA hecho (verificado) y las PAUTAS DETALLADAS de lo
> pendiente para que cualquiera (tú, Dionis/backend, o un agente) lo continúe.
> Fechas y commits al final de cada bloque.

---

## 1. HECHO y verificado (frontend, rama `develop`/`main`)

### 1.1 Vista de RESULTADO del probador en 2 columnas (escritorio)
Archivo: `apps/capri-storefront/src/components/TryOnStudio.jsx` (`resultViews`,
`frameAside`, `dimsPanel`) + `styles/index.css` (ETAPA 76).

- **Contenedor 1 (izquierda):** imagen frontal generada por IA, a todo el alto.
- **Contenedor 2 (derecha):** dividido en dos — **Medidas calculadas** (arriba,
  todas las filas visibles sin scroll) y **ficha del espejuelo** (abajo: foto,
  colores, badges, barra Ancho·Puente·Varilla y pie fecha+logo).
- **Tamaño FIJO 918×700 px**, centrado. Verificado idéntico a 1440 y 1920 px
  (se ve igual en cualquier laptop/PC sin importar resolución ni escala; el zoom
  del navegador escala todo por igual). Sin espacios en blanco.
- `<940px`: una sola columna (imagen → medidas → ficha).
- Commit `2fb651e`.

### 1.2 Vista "Revisa tus fotos" (revisión) en 2 columnas (escritorio)
Archivo: `TryOnStudio.jsx` (`reviewLayout`, `factsStrip`, `colorsStrip`,
`captureReview`) + `styles/index.css` (ETAPA 78 / 78b).

- **Izquierda:** las dos fotos (frontal arriba, lateral abajo, 50/50) con
  Repetir/Subir + "¿Para quién?" + "Calcular mis medidas".
- **Derecha:** material/medidas/género + colores + ficha del espejuelo.
- Misma caja FIJA 918×700, una sola pantalla. `<940px`: una columna.

### 1.3 Zoom + descarga de imágenes del probador, con nombres correctos
Helpers en `TryOnStudio.jsx`: `seriesColorBase`, `resultFileName`,
`frameFileName`, `randomPhotoName`, `downloadNamed`.

- **Foto del espejuelo (catálogo):** clic → zoom; descarga `"<serie>-<color>"`
  (serie = `product.sku`, color = color elegido). Ej.: `GR824-Crystal.png`.
- **Fotos que se toma el cliente (frontal/lateral):** clic → zoom; descarga con
  **nombre aleatorio** `foto-<rand>.jpg` (sin datos del marco).
- **Imagen generada por IA (frontal/perfil):** descarga `"<frontal|perfil>-<serie>-<color>"`
  y, en la frontal, se rotulan las medidas encima (`composeWithMeasures`).
- `downloadNamed` intenta `fetch→blob` (renombra fiable) y cae a `<a download>`
  si la imagen es remota sin CORS.

### 1.4 Footer SIEMPRE visible (sticky)
`styles/index.css` (ETAPA 77): `#root` en flex column, `min-height:100vh`,
`.site-main` flex:1, footer al fondo. El footer ya era global en `App.jsx`
(todas las rutas menos `/admin`); esto garantiza que quede al fondo también en
páginas cortas. Nota: en PRODUCCIÓN vieja (rama `frontend_dev`) no era global —
se resuelve al desplegar `develop`/`main`.

---

## 2. PENDIENTE — PAUTAS DETALLADAS

### 2.1 [FRONTEND] Zoom + descarga en TODAS las imágenes del sitio
**Objetivo:** cualquier imagen (de cualquier tipo, en cualquier página) se puede
clicar → lightbox con zoom + botón de descarga.

**Pautas:**
1. Crear un componente reutilizable `components/ImageZoom.jsx` (o un hook
   `useZoom`) con: overlay a pantalla completa, imagen centrada, botón cerrar y
   botón descargar. Reaprovechar el estilo `.vm-zoom` que ya existe.
2. Regla de nombres de descarga (centralizar en un util `data/imageNaming.js`):
   - Espejuelos (product/color conocido): `"<sku>-<color>.<ext>"`.
   - Fotos del cliente: `"foto-<rand>.<ext>"`.
   - Imágenes IA: `"<frontal|perfil>-<sku>-<color>.<ext>"`.
   - Otras (banners, lookbook): nombre descriptivo del asset.
3. Puntos donde aplicarlo: `ProductCard.jsx`, `ProductDetail.jsx` (galería/360),
   `Catalog`, `CaseCard`/`CaseDetail`, `lookbook`, `brandMedia`, y la ficha del
   probador (ya hecho). Añadir `onClick` + `cursor:zoom-in` a cada `<img>`.
4. Descarga de imágenes REMOTAS (caprioptics/R2): si no hay CORS, el renombrado
   no es fiable; dejar fallback a abrir en pestaña nueva. Evaluar proxy
   `/img?u=` en el backend para servir con CORS si se quiere renombrar siempre.

### 2.2 [FRONTEND/ARQUITECTURA] Probador como PÁGINA individual (no popup)
**Problema:** hoy `TryOnStudio` es un `createPortal(document.body)` a pantalla
completa (modal); por eso no lleva footer y "hay algo detrás".

**Pautas:**
1. Nueva ruta en `App.jsx`: `/probar/:slug` → `TryOnPage` que renderiza el
   probador como contenido normal (dentro de `<main>`), con Header + Footer.
2. Refactor de `TryOnStudio`: separar la lógica (cámara, captura, medición) de la
   envoltura. Hoy usa `position:fixed` + `createPortal`; para página, montar
   inline sin portal ni `body.overflow=hidden`.
3. Los lanzadores (`zlx-tryon-card` en `LensProcess`, botón en `ProductDetail`)
   pasan a `navigate('/probar/'+slug)` en vez de `setTryOnOpen(true)`.
4. Mantener estado entre ficha ↔ probador vía `tryOnState.js` (ya persiste
   fotos/resultado por producto) y querystring `?color=`.
5. Cuidado: la cámara exige HTTPS (ok en prod) y `getUserMedia` en una página
   normal funciona igual que en el modal.

### 2.3 [BACKEND] Al COMPLETAR la compra: guardar TODO en "data" + panel admin
Deploy por **Coolify** (rama `main`). Ya existe base: `vision-measure/result`
(guarda try-on en R2) y panel admin `tryon-results`.

**Qué guardar al confirmar el pedido (orden creada/pagada):**
- Imágenes generadas por IA del cliente (frontal + perfil) → R2 privado.
- Por cada línea: SKU/serie del espejuelo, color, nombre del modelo, marca.
- Medidas (DIP, OD/OS, corredor, bifocal, encaje, confianza).
- Receta (si la hay) y "¿para quién?" (cliente / tercero + nombre).
- Fecha/hora, id de pedido, email/teléfono del cliente, importe.

**Pautas:**
1. Subscriber de `order.placed` (junto al de notificaciones ya existente) que
   arme un "expediente" del pedido y lo escriba a R2 como
   `orders/<order_id>.json` (+ copia de las imágenes IA ya subidas en try-on,
   enlazadas por `prescription_id`/`tryon_id`). Sin migración (igual que
   `tryon-results`).
2. Ruta admin `GET /admin/order-dossier` + página `src/admin/routes/.../page.tsx`
   para listarlos (con URLs presignadas), al estilo de `tryon-results`.
3. Enlazar el try-on guardado con el pedido: al "Añadir receta"/checkout, pasar
   el `tryon_id` en `cart.metadata` para poder casarlos en el subscriber.

### 2.4 [BACKEND] Email al ADMIN + Google Sheet al completar compra (configurables)
**Email:** ya hay proveedor Resend y lista `admin_notification_emails` en
`store-settings` (editable en el panel). Extender el correo de `order.placed`
para incluir: espejuelos (serie+color), medidas, "para quién", enlaces a las
imágenes IA (presignadas) y fecha/hora.

**Google Sheet (NUEVO):**
1. Módulo backend `src/modules/sheets-sync/` (o un util `src/lib/google-sheets.ts`)
   usando `googleapis` con una **cuenta de servicio** (Service Account JSON).
2. Config en `store-settings` (editable en panel admin, patrón idéntico a
   `admin_notification_emails`):
   - `google_sheet_id` (ID de la hoja).
   - `google_service_account_json` (o ruta/secret) — **secreto**.
   - `google_sheet_tab` (pestaña), `admin_notification_emails` (ya existe).
3. En `order.placed`: append de una fila con columnas: fecha, hora, pedido,
   cliente, email/tel, SKU(s), color(es), medidas, importe, enlaces IA.
4. Env de respaldo: `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. **Requiere de Daniel:** crear la Service Account en Google Cloud, habilitar
   Google Sheets API, compartir la hoja con el email de la cuenta de servicio, y
   pegar el JSON + Sheet ID en el panel. (Sin esto, el código queda listo pero
   inactivo; cae en silencio sin romper la compra.)

### 2.5 [CHECKOUT] Flujo estilo Amazon
**Objetivo:** replicar el proceso de compra de Amazon con nuestras specs. Hoy el
checkout es `MedusaCheckout.jsx` (resumen + envío + pago Stripe/PayPal/Square).

**Pautas (fases tipo Amazon):**
1. Carrito con resumen claro (ya existe) + "proceder al pago".
2. Dirección de envío (guardable) → método de envío → método de pago → **revisar
   pedido** (pantalla de confirmación con todo el detalle) → "Realizar pedido".
3. Confirmación con número de pedido + seguimiento (ya hay `/my-orders` +
   `TrackingTimeline`).
4. Email de confirmación al cliente (ya existe vía Resend) + email/Sheet al admin
   (2.4).
5. Detallar en un doc aparte qué pasos de Amazon se copian 1:1 y cuáles se
   adaptan (p. ej. no hay "1-Click", sí "revisar antes de pagar").
> Nota: el checkout ya cubre gran parte; conviene listar diferencias concretas
> con Amazon antes de tocarlo, para no rehacer lo que ya funciona.

---

## 3. Dependencias que necesita Daniel (desbloquean lo pendiente)
- **Vercel:** confirmar que PRODUCCIÓN publique desde `develop` (o `main`) y hacer
  Redeploy (hoy probablemente sirve `frontend_dev`, rama vieja). Sin esto no se ve
  nada de lo nuevo en vivo.
- **Coolify:** confirmar redeploy del backend desde `main`.
- **Google:** Service Account + Sheets API + Sheet compartido (para 2.4).
- **Email:** dominio verificado en Resend (si aún no) para que el correo al admin
  no caiga en spam.

---

## 4. Convenciones (recordatorio)
- Deploy: storefront (Vercel) desde `develop`; backend (Coolify) desde `main`.
  Trabajo en `develop`; backend vive al mergear `develop`→`main`.
- i18n: toda cadena por `t(key)` en `i18n/translations.js` (es/en, paridad).
- Bloques CSS numerados "ETAPA N" al final de `styles/index.css`.
- No romper el cálculo de precios en servidor; el cliente nunca manda totales.
