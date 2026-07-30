# Changelog — cambios hechos por Claude (asistente de Daniel)

> Registro detallado de lo que se toca en el repo. Se actualiza cada vez que Daniel pide "actualiza".

## 2026-07-29 — Probador virtual (rama `frontend`) + hallazgo de divergencia con `develop`

### Cambios en el código (rama `frontend`, solo `apps/capri-storefront`)
- **`src/components/TryOn.jsx`**
  - **Fix del bucle de render muerto:** en dev, React StrictMode monta/desmonta el componente dos veces; el cleanup de la cámara dejaba `runningRef.current = false` y al remontar nunca se re-armaba, por lo que el `requestAnimationFrame` salía de inmediato y la montura quedaba invisible (opacidad 0, sin posicionar) y MediaPipe no rastreaba. Se agregó `runningRef.current = true;` al inicio del efecto del bucle.
  - **Ajuste de colocación:** ancho de montura `eyeDist * 1.85 * size` (antes 2.05), sesgo vertical `-ih*0.06` para apoyarla sobre los ojos; modo manual reducido a `W*0.42` (antes 0.6) y anclaje vertical 0.40.
- **`src/styles/index.css`**
  - `.tryon-frame`: se quitó `drop-shadow` (dibujaba la sombra del rectángulo de la foto) y se agregó `filter: contrast(1.22) brightness(1.06) saturate(1.05)` para que el fondo casi-blanco de la foto se funda limpio con `mix-blend-mode: multiply` (elimina el recuadro gris).

### Limitación conocida del probador
Las fotos del catálogo (caprioptics) están en **ángulo 3/4**, no son recortes frontales con fondo transparente. Por eso, de frente, algunas monturas se ven "viradas". Solución real = imágenes frontales (PNG transparente) o modelo 3D por producto. Es un tema de *assets*, no de código.

### Configuración LOCAL (NO commiteada — `.env` está en .gitignore)
Solo en la máquina de Daniel, para levantar todo en local:
- `apps/backend/.env`: `STORE_CORS` ahora incluye `http://localhost:5198` (para que capri:5198 pueda llamar al backend). `STRIPE_SECRET_KEY` = llave **test** de Stripe (local). Intento de apuntar `DATABASE_URL` a Supabase quedó **bloqueado por seguridad** (no se pudo).
- Región local de Medusa: se habilitó el proveedor de pago **Stripe** (`pp_stripe_stripe`).
- Precios de los 4 productos demo locales corregidos a centavos.

### Hallazgo importante — divergencia con `develop` (trabajo de Dionis)
`develop` va por delante de `frontend` en `apps/capri-storefront`. Dionis ya agregó (commits del 2026-07-29):
`src/data/medusa.js`, `src/data/medusaCatalog.js`, `src/data/medusaCart.js`, `src/data/lensCatalog.js`, `src/pages/MedusaCheckout.jsx`, `src/components/Feedback.jsx`, `.env.example`, y varios arreglos del probador (*"Fix try-on blinding"*, *"Show glass in face fixed"*).

**Decisión:** NO se sincronizó `frontend → develop` para **no borrar** la integración Medusa ni los arreglos de Dionis. Ver `NOTIFICACION-DIONIS-2026-07-29.md`.


## 2026-07-29 (2) — El deploy debe cargar el catálogo DESDE EL BACKEND

Pedido de Daniel: en `https://optical-storefront-storefront.vercel.app/marca/candy-shoppe`
deben cargar TODOS los espejuelos, y **desde el backend Medusa** (no el `catalog.json` estático).

### Diagnóstico (código de `develop`)
`apps/capri-storefront/src/data/catalogStore.js` → `loadLive()`:
- Si `USE_MEDUSA` (`VITE_USE_MEDUSA === "true"`) → llama `loadFromMedusa()` contra `VITE_MEDUSA_URL`.
  Si falla o devuelve vacío, **se queda con la semilla incrustada (~7 productos)** silenciosamente.
- Si es `false` → hace fetch de `/catalog.json` (550) y los muestra.

El build desplegado tiene `VITE_USE_MEDUSA=true` pero `VITE_MEDUSA_URL` apunta a `http://localhost:9000`
(default). En producción esa llamada falla (no hay localhost desde el navegador del visitante) → cae a
la semilla de 7. Por eso `/marca/candy-shoppe` sale casi vacía.

### Checklist para que el deploy cargue desde el backend (infra — Dionis)
1. **Desplegar el backend Medusa** en una URL pública HTTPS (ver `docs/deploy-backend-coolify-oracle.md`).
   Ej.: `https://api.opticaelrancho.com`.
2. **Poblar el catálogo en Supabase**: correr el scraper (`apps/scraper`) para ingestar los 550 frames
   (requiere admin API key + R2). Hoy solo hay ~7-11 sembrados.
3. **CORS del backend** (`STORE_CORS`): incluir el dominio de Vercel
   `https://optical-storefront-storefront.vercel.app` (y `http://localhost:5198` para dev).
4. **Env vars en Vercel** (Settings → Environment Variables, Production):
   - `VITE_USE_MEDUSA=true`
   - `VITE_MEDUSA_URL=https://<backend-publico>`
   - `VITE_MEDUSA_PUBLISHABLE_KEY=<pk_ de Supabase, ligada al sales channel>`
5. **Redeploy** en Vercel.

Resultado esperado: `catalogStore.loadLive()` toma el camino Medusa, trae el catálogo del backend, y
`/marca/candy-shoppe` muestra sus monturas desde la Store API.

### Qué NO pudo hacer el asistente (fuera de alcance por diseño)
- No hay acceso al dashboard de Vercel (env vars / redeploy).
- No hay acceso al servidor de despliegue del backend (Oracle/Coolify).
- Escribir credenciales de la base externa (Supabase) está bloqueado por el clasificador de seguridad.
Por eso los pasos 1, 2, 4 y 5 los debe ejecutar Dionis. Este documento es el detalle para él.


---

## 2026-07-29 — Rediseño de la portada (capri-storefront) · SOLO LOCAL (no subido a git)

Rama `frontend`. Cambios en `apps/capri-storefront`. No toca backend ni la pasarela de pago de Dionis.

**Hero → carrusel editorial estilo Zeelool**
- `src/pages/Home.jsx`: nuevo hero `.hero-zee` (retrato grande + tira lateral de miniaturas `HERO_THUMBS` + badge circular). Carrusel de 3 slides con avance automático (5.5s), flechas y puntos. Paleta rojo/azul/blanco (barra tricolor bajo el kicker, badge rojo, puntos degradado rojo→azul).
- `src/styles/index.css`: bloques v7 (carrusel base) y v8 (`.hero-zee`, `.hero-zee-main`, `.hero-badge`, `.hero-zee-strip`, responsive).
- Textos del hero en i18n: `hero.s1/s2/s3.title|sub|badge` (ES/EN) en `src/i18n/translations.js`.

**Secciones alternadas + divididas (30/70 · 70/30)**
- Orden: icons → images → icons → images (chips, moods, formas, collage, props, más vendidos, marcas).
- Moods = split 70/30 (imágenes + panel aside "Estilos para cada ocasión"). Formas = split 30/70 (aside + iconos).
- CSS v5 `.split`, `.split-30-70`, `.split-70-30`, `.split-aside`, `.aside-kicker` (responsive: apilan en móvil).

**Collage interactivo**
- Quitado el modelo duplicado (gm/pt eran el mismo hombre). Ahora 6 retratos distintos; se agregó `SL.jpg` (mujer) → marca `simply-lite`. `Millennial-Male59` ligado a `grande`.
- Corregido el marco recortado en hover: `.collage-frame` se veía con `object-fit:cover` por especificidad; override v4 → `contain`, grande y completo, con degradado de fondo.

**Los más vendidos → carrusel de 4 con desplazamiento**
- `.product-scroller` (CSS v6): 4 visibles en desktop, scroll horizontal con snap y barra degradada rojo/azul. `featured = slice(0,12)`.

**Marcas**
- `src/components/Header.jsx`: la opción "Marcas" del nav ahora hace scroll suave a la sección `#marcas` (handler `goBrands`; navega a "/" si no estás en la home).

**Chat**
- Botón flotante de chat `.chat-fab` DESHABILITADO (gris, tooltip "Próximamente") global en Header.

**Calidad de imagen (menos escalado + degradado)**
- Hero de marca `/marca/:slug`: imagen anclada a la derecha (`.brand-hero-media` ~62% ancho) con degradado lateral al color de marca → sin pixelar. CSS v4.

**Multilingüe**: todo el texto nuevo pasa por `t()` con claves ES/EN en `translations.js` (`home.*`, `hero.s*`).


---

## 2026-07-29 (parte 2) — Marcas dinámicas, hero clicable, filtros y multilingüe/responsive · SOLO LOCAL

**Sección Marcas (home) — panel dinámico**
- `src/pages/Home.jsx`: al pasar el cursor por un logo de marca, el panel derecho cambia foto + explicación (estado `hoverBrand`); al hacer clic va a `/marca/<slug>`. Círculo activo resaltado en azul.
- `src/data/brandMedia.js`: `BRAND_INFO` ahora bilingüe (es/en) y `brandInfo(slug, lang, fallback)`. La foto del panel = `brandHeroImage(slug)` (la misma de la página de la marca; sin repetir imágenes en pantalla).
- CSS: `.brand-circle.is-active`, transición `.brand-feature`, más `gap` entre iconos y panel (feedback "muy pegado").

**Hero editorial**
- Foto principal y miniaturas ahora son clicables (llevan a la marca/marcos). Elementos más grandes. Toque rojo/azul/blanco (franja tricolor superior, botón outline azul, aro blanco en foto activa, miniaturas con hover azul).

**Página de cada marca (`/marca/:slug`)**
- Hero con explicación breve (`brandInfo`), logo más grande, contador "N monturas" en pastilla degradada rojo→azul, y franja tricolor ABAJO del hero (feedback: no encima).

**Filtros desde la home**
- Formas, chips "Define tu estilo" y tarjetas "Estilos para cada ocasión" ahora **filtran de verdad**: cada mood lleva a un filtro real (`gender=Unisexo`, `shape=Cuadrado`, `shape=Redondo`).
- `src/pages/Catalog.jsx`: el encabezado refleja el filtro de la URL (`tv(shape/gender/age)`) y el grupo de filtro correspondiente se **auto-abre** con la casilla marcada, para que se vea claro que está filtrando.

**Multilingüe (ES/EN) — repaso**
- Se pasaron a i18n los textos que quedaban fijos: banda promocional (`home.promo.*`), tooltip del chat (`chat.soon`), descripciones de marca, contador "monturas"/"frames" (`brand.frames`). Verificado el cambio ES↔EN en toda la portada.

**Responsive — detallado (CSS v11)**
- Breakpoints afinados: hero 3→2→1 columnas (1040/760), tira lateral oculta en tablet, tipografías y controles compactos en ≤480px, botones del hero a ancho completo en móvil, `product-scroller` a ~82% en móvil, y salvaguardas anti-desborde horizontal.

**Chat**: tooltip del botón deshabilitado ahora bilingüe.


---

## 2026-07-29 (parte 3) — Probador OFF, fotos de marca de Capri y sin imágenes repetidas · SOLO LOCAL

**Probador virtual (AR) desactivado en todo el sitio**
- Nuevo `src/config.js` con `TRYON_ENABLED = false` (interruptor único; poner en `true` reactiva todo).
- `src/components/ProductCard.jsx` y `src/pages/ProductDetail.jsx`: los botones "Probador AR" y el componente `<TryOn>` se ocultan con el flag (4 puntos de entrada).
- Copys que anunciaban el probador se cambiaron por mensajes de calidad/envío/receta: slide 2 del hero, banda promocional (`home.promo.*`), propuesta de valor (`prop.ar`). Todo bilingüe.
- Verificación con git: Dionis SÍ tocó el probador (commits `5fd15a5 "Update try on process"`, `b996c57 "Fix try-on bliniding"`). El flag es a nivel de UI y no interfiere con su trabajo.

**Fotos de marca = las mismas de caprioptics**
- `src/data/brandMedia.js`: `BRAND_MEDIA` ahora usa la imagen oficial que Capri muestra por marca (menú de marcas de caprioptics.com), para las 17 marcas — incluidas las que antes caían en una foto genérica (artistik-galerie, eyeleos, ago, artistik-eyewear, case, millennial, prorx). Cada marca tiene su propia foto, no se repiten entre marcas.

**Auditoría de imágenes repetidas (home)**
- Reasignadas las fotos para que NINGUNA imagen se repita en la portada:
  - Hero (grande, four-you, versailles) + tira lateral (artistik-galerie, ago, prorx) → 6 fotos.
  - Collage (di-caprio, candy-shoppe, simply-lite, trendy, peachtree, millennial) → 6 fotos.
  - Moods (3 estilos de vida) → 3 fotos. Panel de marca por defecto: Flexure (no usada en el resto de la home).
- Verificado en el navegador: 16 imágenes en la portada, 0 duplicadas.
- Nota: el panel de Marcas, al pasar el cursor, muestra la foto oficial de cada marca (las mismas fotos de Capri); solo se ve una a la vez y en otra sección, por lo que nunca hay dos iguales en la misma vista.


---

## 2026-07-29 (parte 4) — Lookbook: 16 fotos propias etiquetables por marca/modelo · SOLO LOCAL

- Daniel subió 16 fotos de modelos (frames del video de Capri). Se optimizaron a JPEG web y se guardaron en `apps/capri-storefront/public/lookbook/model-01.jpg … model-16.jpg`.
- Nuevo manifiesto `src/data/lookbook.js`: cada foto con `id`, `src`, `gender`, `desc` (precargados) y campos **`brand` y `model` para rellenar** (etiqueta de referencia). Helper `lookbookTag(id)`.
- Se usan en la portada, sin repetir ninguna: hero principal (fotos 2, 5, 14), tira lateral (7, 11, 4), collage (1, 3, 6, 8, 9, 13) y estilos/moods (16 pareja→"En familia", 15 blazer→"Business casual", 10 tweed→"Clásicos").
- Cada imagen renderiza `data-model` (y el collage además `data-brand` + `data-sku`) como etiqueta invisible de referencia, lista para enlazar a la compra cuando se rellenen marca/modelo.
- PENDIENTE del usuario: rellenar `brand` y `model` de cada foto en `src/data/lookbook.js` (no se pueden deducir con certeza desde la imagen).

## 2026-07-30 — Documentación: pendientes y logística (rama `frontend`)

Se agregó **`PENDIENTES-Y-LOGISTICA.md`** (raíz) con la lista de requisitos que pasó Daniel:
- Funciones pendientes: autocompletado de dirección (Google Maps), infografía de materiales
  (adelgazamiento del cristal, refs Pinterest), infografía de fotocromático (refs Pinterest),
  seguimiento de orden bilateral, notificación de estado al cliente, tracking del cliente.
- Tiempos: fabricación de lentes = 5 días.
- Tabla de logística/envíos (UPS): lab→Osmany $2.75 (3d), CAPRI→Osmany $1.00 (3d),
  nacional USA $3.00 (3d), Cuba vía consignataria = por definir.
- Preguntas abiertas registradas (key de Google, canal de notificaciones, tarifa Cuba, fuente del tracking).

Es solo documentación; no toca código de la app ni el backend.

## 2026-07-30 — Proceso de lentes rediseñado estilo Zeelool (rama `frontend`)

Se reescribió `src/pages/LensProcess.jsx` para replicar el flujo de compra de lentes de Zeelool
(https://www.zeelool.com/lens-process), usando nuestros propios datos de `lensPricing.js`.
Flujo a **pantalla completa**, 5 pasos + confirmación, con iconografía SVG propia:
1. **Tipo de receta** — Visión Sencilla / Bifocal FT-28 / Progresivo Gama Media / Gama Alta / Solo montura (tarjetas con icono + "desde $").
2. **¿Cómo añadir la receta?** — Escanear (foto) / Rellenar manual + enlace a receta guardada.
3. **Ingresar receta** — tabla OD/OS · SPH·CYL·AXIS + PD (+ ADD en bifocal/progresivo), banner SPH(−)/(+), enlace "Aprende a leer tu receta" y modal **"¿Coincide con tu receta?"** (Editar/Confirmar).
4. **Tratamiento del lente** — fotocromáticos/Transitions (desplegables con swatches de color) + antirreflejos, precios de nuestra lista.
5. **Índice/grosor** — CR-39 → 1.74 con badge **"Recomendado"** según graduación y banner de capas incluidas.
Panel izquierdo permanente: montura + resumen acumulado + subtotal; barra de progreso arriba.

Archivos: `src/pages/LensProcess.jsx` (reescrito), `src/styles/index.css` (bloque `.zl`), `src/i18n/translations.js` (~30 claves ES/EN nuevas). Build verificado en entorno idéntico a Vercel (Linux, install limpio). Solo frontend; no toca el backend de Dionis.

## 2026-07-30 (2) — Proceso de lentes v2 + marcas activas (rama `frontend`)

**Proceso de lentes (mejoras sobre el flujo Zeelool):**
- **El menú/header queda siempre visible** (se quitó el overlay a pantalla completa); barra de progreso pegada bajo el menú y botón "Continuar" pegado abajo.
- **Detección de receta por imagen (OCR):** "Escanear receta" sube la foto a `POST {VITE_MEDUSA_URL}/store/prescriptions/ocr` (Anthropic vision en el backend), con estado "Analizando…", prellenado de SPH/CYL/AXIS/PD/ADD y fallback a manual si el backend no responde.
- **Entrada manual mejorada:** ADD por diseño, opción "dos números de DP (OD/OS)".
- **Iconos rediseñados a dos tonos azul/rojo**; textos con azul/rojo del tema (total azul, precios rojos, "Incluido" verde, badges azul).
- **Primera opción siempre incluida** y **precios por delta**: en tratamiento (Transparente/Ninguno = Incluido) y en índice (el más barato = Incluido, el resto "+$").
- **Modal de confirmación** de receta más detallado (OD/OS con SPH·CYL·AXIS·ADD y DP).
- Bilingüe ES/EN y responsive.

**Marcas activas (decisión de negocio):** se dejan solo **9** — Di Caprio, Peachtree, Flexure, Four You, Trendy, Millennial, Grande, ProRx y Cases. Se retiran del sitio candy-shoppe, artistik-galerie, eyeleos, versailles-palace, slimfold, ago, artistik-eyewear y simply-lite. Filtro por allowlist en `data/brands.js` + `data/catalogStore.js` (quedan 432 monturas de las 118 quitadas). Solo frontend.

## 2026-07-30 (3) — Flujo de lentes: receta primero + auto-diseño; OCR conectado

- **Reordenado:** la 1ª pantalla ahora es la RECETA (Escanear / Rellenar manual / "No necesito graduación"). El sistema **auto-selecciona el diseño** a partir de la receta: sin ADD → **Visión Sencilla** (automático, sin paso extra); con ADD → **multifocal** y muestra Bifocal FT-28 / Progresivo Gama Media (recomendado, pre-seleccionado) / Progresivo Gama Alta. "No necesito graduación" = solo montura → directo al carrito. Campo ADD siempre visible en la receta (rotulado "solo multifocales") para poder deducir el tipo.
- **OCR (lectura de receta por imagen):** el frontend sube la imagen a `POST {VITE_MEDUSA_URL}/store/prescriptions/ocr` con header `x-publishable-api-key` y mapea `od/os/pd/pd_od/pd_os/add` (incluye recetas de laboratorio tipo "Optical Outsource" con FPD/NPD monoculares → dos DP). Verificado contra el backend en vivo: el endpoint **responde pero devuelve `503 {fallback:true}` porque falta `ANTHROPIC_API_KEY` en el backend** → el lector está apagado del lado servidor. En cuanto Dionis configure esa key (y el CORS del storefront), el OCR leerá automáticamente. Mientras tanto cae a modo manual con aviso claro. Se descomentó `VITE_MEDUSA_PUBLISHABLE_KEY` en el `.env` local (no commiteado, está en .gitignore).
- Archivos: `src/pages/LensProcess.jsx`, `src/i18n/translations.js` (claves nuevas), `src/styles/index.css`. Solo frontend; no toca el backend de Dionis.

## 2026-07-30 (4) — QA/hardening: precio consistente, seguimiento bilateral, confirmación de compra, robustez

**Precio consistente (cliente = orden = admin):** el carrito ahora conserva el desglose legible del lente (`specs`: etiqueta + precio) además de diseño/material/foto/AR y color; `checkout()` lo pasa íntegro a la orden. Así el MISMO desglose lo ven el comprobante del cliente, "Mis compras" y el panel del admin. Favoritos ahora usan el precio EN VIVO del catálogo (no el congelado). El lente registra su marca (analítica del admin correcta).

**Seguimiento de orden unificado (cliente + admin):** nuevo módulo `data/orderStatus.js` = fuente de verdad ÚNICA con 5 estados bilingües (Recibida → En fabricación → Enviada → En tránsito → Entregada). Lo usan `TrackingTimeline` (cliente), `AccountPage` (cliente), `AdminDashboard` (tienda), `analytics.recordOrder/updateOrderStatus` y el seed. Se corrigió el vocabulario divergente y la clave i18n faltante. Nº de rastreo: el admin lo asigna en el pedido y el cliente lo ve en su cuenta. (Limitación real: las órdenes viven en localStorage por navegador; el sync cliente↔admin entre dispositivos requiere backend.)

**Confirmación + notificación de compra:** al pagar, el cliente ve un COMPROBANTE (nº de orden + total) en vez de un alert, con botón "enviarme el comprobante por correo" (mailto) y "ver mi pedido". El admin ve la orden al instante en su panel. Nuevo `data/orderNotify.js` con `notifyOrder()` que hace POST a un webhook configurable (`VITE_ORDER_NOTIFY_URL`) — punto único para conectar email+SMS reales (Zapier/Make/Twilio/SendGrid o Medusa). Sin configurar, no rompe la compra.

**Robustez anti-caídas:** nuevo `ErrorBoundary` global (main.jsx) evita la pantalla en blanco si una vista lanza. Guards en `ProductDetail` (material no-array), `Home` (lookups del lookbook con `?.`) y accesos a `user.email`.

**Bilingüe:** errores de login ahora son claves i18n; aria-labels del carrusel/collage, "Anónimo", título del footer y fechas ahora respetan el idioma. Claves ES/EN añadidas.

**Responsive:** CSS del ShippingEstimator (clases actuales) + stacks móviles para `.ship-methods`, `.rx-extra` (con "dos DP") y `.co-two`.

**Código:** comentarios/documentación añadidos en todos los módulos tocados.

**QA hecho:** build en entorno tipo Vercel ✓; recorrido en navegador ✓ (checkout→comprobante, orden en cuenta con estado "Recibida" + desglose + rastreo, línea de seguimiento 5 pasos, ES/EN, 0 errores de consola). Admin verificado por código+build (login corporativo protegido). Archivos: 19 (2 nuevos data/, 1 ErrorBoundary + 16 tocados). Solo frontend; no toca el backend de Dionis.
