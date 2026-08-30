# Probador virtual + medición óptica + imágenes de receta

> Documentación del sistema construido para Óptica El Rancho / RUBI_LENS: probador
> con cámara, medición de DIP y altura de corredor, montaje de los espejuelos con
> IA, y guardado de la medición + imágenes ligadas a la orden.
>
> Complementa (no reemplaza) `docs/tryon-ai-measurement.md` (motor de medición de
> Dionis) y el `README.md` (sección "Probador (try-on)").

## 1. Resumen

El cliente abre el **probador** desde la página de la receta (o la ficha del
producto), la cámara guía dos fotos (frontal + lateral), el navegador **calcula
las medidas** (DIP / distancia pupilar y altura de corredor) con MediaPipe y las
dimensiones reales de la montura, y **Gemini solo monta los espejuelos** en el
rostro (no calcula medidas). El resultado se muestra en la **misma ventana** con
las imágenes de los espejuelos puestos y un botón **"Añadir receta"** que lleva
las medidas al flujo de compra. Al finalizar la compra, la medición viaja en los
correos a tienda y cliente, y la imagen generada + la receta subida quedan
**guardadas ligadas a la orden**.

Principios:

- **La IA NO calcula medidas.** DIP y altura salen de MediaPipe (iris como regla
  invisible) + calibre/puente/altura de lente de la montura. Gemini solo hace el
  montaje visual.
- **Nunca se corta la generación.** Arquitectura asíncrona: el navegador arranca
  un trabajo y consulta el estado; el proxy de Vercel corta a ~120 s una petición
  larga, pero el trabajo sigue vivo en el servidor.
- **Datos sensibles server-side.** Los valores de la receta y las imágenes (foto de
  receta subida y render del probador) viven en Postgres / R2 privado; al cliente
  y a la web solo llegan por enlaces firmados de corta duración.

## 2. Flujo del cliente

1. **Abrir el probador.** Botón "Probar con cámara" (tarjeta secundaria al pie de
   la ficha del espejuelo, sin tapar la foto). También desde la ficha de producto.
2. **Captura guiada.** Dos cajas: (1) frontal cuando está de frente y cerca; (2)
   lateral al girar la cabeza. Captura automática al sostener la pose ~3 s; también
   se puede subir cada foto manualmente. **Suena el obturador** en cada toma
   (obturador completo en la frontal, clic de cierre en la lateral).
3. **Calcular.** En responsive, el botón "Calcular mis medidas" queda fijo y
   visible en cuanto están las dos fotos. Antes de calcular se elige **"¿Para quién
   son?"** (para mí / para otra persona + nombre).
4. **Espera con carrusel comercial.** Mientras se calcula, capa translúcida sobre
   el estudio desenfocado con mensajes rotativos (garantía, envío, AR, etc.) y aviso
   de "muchas peticiones activas — no cierres la ventana". Si el proveedor de IA está
   saturado, se ofrece aviso por correo/WhatsApp (no hay que esperar mirando).
5. **Resultado en la misma ventana.** Las dos imágenes con los espejuelos puestos
   (con badges de DIP y altura), un panel de **dimensiones en la esquina inferior
   derecha**, y los botones **"Añadir receta"** / **"Medir de nuevo"**.
6. **Persistencia.** El resultado se guarda por producto en `localStorage`: si el
   cliente cierra y reabre el mismo espejuelo, se **restaura la última generación**
   sin re-generar.
7. **Añadir receta.** Pre-rellena DIP y altura de montaje en la receta de la página
   y guarda la imagen para adjuntarla a la orden al comprar.
8. **Compra.** La receta (con DIP/altura) se guarda como registro PHI; la imagen del
   probador y la receta subida quedan ligadas a la orden. Correos a tienda y cliente
   con la medición. Las imágenes se ven en "Mis pedidos" (cliente) y en el admin.

## 3. Arquitectura y archivos

### Frontend (`apps/capri-storefront`)

| Archivo | Rol |
|---|---|
| `src/components/TryOnStudio.jsx` | Interfaz de cliente del probador: cámara + captura automática, sonido de obturador, medición propia, arranque del trabajo async, resultado en la misma ventana, panel de dimensiones, "Añadir receta" / "Medir de nuevo", persistencia y restauración. |
| `src/components/MeasureReport.jsx` | Capa de carga/error (spinner + carrusel comercial + aviso "muchas peticiones" + formulario "avísame cuando esté listo"). Ya NO renderiza el resultado (vive en el estudio). |
| `src/components/TryOnSwitch.jsx` | Selecciona la interfaz (`prod` = TryOnStudio por defecto, `dev`, `legacy`) y envuelve en un ErrorBoundary. Reenvía props (incl. `onAddPrescription`). |
| `src/data/opticalMeasure.js` | Medición en el navegador (MediaPipe): DIP + altura de corredor con iris (HVID 11.7 mm) + método de "boxing" (A calibre, DBL puente, B alto de lente). |
| `src/data/visionMeasure.js` | Cliente del trabajo async (`startMeasurementJob` / `pollMeasurementJob` / `armMeasurementNotification`) y utilidades (imagen del marco, encogido). |
| `src/data/tryOnState.js` | Estado fuera de React: qué producto está abierto, trabajo en curso por producto, y **resultado generado persistido** (`saveMeasureResult` / `getMeasureResult` / `clearMeasureResult`, `localStorage`, con tope y descarte por cuota). |
| `src/pages/LensProcess.jsx` | Página de receta: botón "Probar con cámara", recibe la medición (`applyTryOnMeasurement`) y la pre-rellena en la receta, guarda la imagen del probador y la envía en `createPrescription` al comprar. |
| `src/data/medusaCart.js` | `createPrescription`: envía la receta + la imagen del probador (con encogido y **reintento sin imagen** si el backend aún no la acepta). |
| `src/i18n/translations.js` | Claves es/en (probador, carrusel comercial `vm.ad1..6`, dimensiones, etc.). |
| `src/styles/index.css` | Estilos del estudio, resultado, dimensiones, carrusel, responsive. |

### Backend (`apps/backend` + `apps/vision-measure`)

| Archivo | Rol |
|---|---|
| `apps/vision-measure/services/api/vision_api.py` | API de medición/render. Endpoints **async** `POST /api/vision-measure/job` y `GET /api/vision-measure/job/{id}`. Campo `sideImage` (foto lateral real). |
| `apps/vision-measure/services/vision_measure/compositor.py` | Prompts de Gemini. `TRY_ON_PROMPT` (frontal, mismo encuadre/fondo) y `PROFILE_PROMPT` (lateral real, conserva el entorno). `GEMINI_IMAGE_SIZE=1K` para velocidad. |
| `apps/backend/src/api/vision-measure/job/route.ts` + `job/[id]/route.ts` | Proxy del backend Medusa hacia el servicio de visión. |
| `apps/backend/src/modules/prescription/models/index.ts` | Modelo de receta. Campos `file_url` (foto de receta subida) y **`tryon_image_url`** (render del probador). |
| `apps/backend/src/modules/prescription/migrations/` | `AddSegHeightToPrescription2.ts` (altura) y **`AddTryonImageToPrescription3.ts`** (imagen del probador). |
| `apps/backend/src/api/store/prescriptions/route.ts` | `POST /store/prescriptions`: guarda la receta (PHI) y sube la **imagen del probador** (`tryon_image` data URL) a R2. |
| `apps/backend/src/api/store/my-orders/route.ts` | Devuelve al cliente (token de sesión) enlaces firmados de su **receta subida** (`rx_image`) y su **imagen del probador** (`tryon_image`). |
| `apps/backend/src/api/admin/prescriptions/[id]/route.ts` | Admin: enlaces firmados de ambas imágenes; el borrado GDPR elimina ambos objetos de R2. |
| `apps/backend/src/subscribers/order-placed.ts` | Al pagar: correos a tienda y cliente (con DIP/altura) + SMS. **No adjunta imágenes** (por decisión: "solo guardar"). |
| `apps/backend/src/lib/s3.ts` | Cliente R2/S3, bucket privado de recetas, `presignPrescriptionUrl`. |
| `packages/shared/src/prescription.ts` | Tipo `Prescription` compartido (incluye `tryon_image_url`). **Requiere rebuild** del paquete para que el backend lo vea. |

## 4. Variables de entorno

**Backend (Coolify):**

- `GEMINI_API_KEY` — obligatorio para el montaje con IA. **Solo en Coolify; nunca en el repo ni en el chat.**
- `ANTHROPIC_API_KEY` — OCR de receta (lectura de la receta subida).
- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PRESCRIPTION_BUCKET` (o `R2_BUCKET`) — almacenamiento privado de recetas e imágenes del probador. Ya configurado (lo usan las recetas).
- Notificaciones (correo/SMS) — ya configuradas (las usa `order-placed`).

**Frontend (Vercel):**

- `VITE_TRYON_UI` — `prod` (por defecto), `dev` o `legacy`. Dejar vacío o `prod` para el probador nuevo. **Verificar que NO esté en `legacy`.**
- `VITE_USE_MEDUSA=true`, `VITE_MEDUSA_URL` (vacío usa el proxy same-origin).

## 5. Despliegue

- **Frontend:** rama `develop` → Vercel (automático al hacer push).
- **Backend:** rama `main` → Coolify (**redeploy manual** de Daniel). Los archivos de
  backend son idénticos entre `develop` y `main` (se llevan a `main` con checkout de
  rutas, no merge de frontend).
- **Migraciones:** correr `npx medusa db:migrate` (o el paso de migración del deploy)
  para `seg_height` y `tryon_image_url`. Son idempotentes (`ADD COLUMN IF NOT EXISTS`).
- **Paquete compartido:** el backend ve `@eyewear/shared` desde `dist` (gitignored),
  así que el build del backend debe reconstruir `packages/shared` antes de compilar
  (ya lo hace para el código existente).
- **Orden de despliegue:** no es frágil. Si el frontend sale antes que el backend, la
  compra no se rompe: `createPrescription` reintenta sin la imagen y la guarda en
  cuanto el backend esté listo.

## 6. Seguridad / PHI

- Valores de receta y nombres: solo en Postgres server-side; nunca en el carrito,
  metadata de la orden ni `localStorage`.
- Imágenes (receta subida + render del probador): bucket R2 **privado**; se leen solo
  por enlaces firmados de corta duración (`PRESCRIPTION_URL_TTL_SECONDS`).
- `my-orders` entrega enlaces firmados solo con token de sesión firmado que prueba el
  control del correo del pedido.
- Borrado GDPR (admin DELETE) elimina el registro y **ambos** objetos de R2.
- `GEMINI_API_KEY` y demás secretos: solo en variables de entorno del servidor.

## 7. Pendientes y verificación

### A. Acciones para activar lo hecho (Daniel)
1. Redeploy del backend desde `main` (trae async job, render de perfil, `sideImage`,
   velocidad, `tryon_image_url`, `my-orders` con imágenes, admin).
2. Correr migraciones (`seg_height`, `tryon_image_url`).
3. Confirmar `GEMINI_API_KEY` en Coolify.
4. Verificar en Vercel que `VITE_TRYON_UI` no esté en `legacy`.

### B. Verificar en vivo (con cara real)
5. DIP y altura correctos. 6. Espejuelos en ambas vistas conservando el entorno.
7. Velocidad de generación. 8. Sonido, carrusel, responsive, restauración al reabrir.
9. Flujo completo hasta correos + imágenes visibles.

### C. Construido esta sesión (frontend/admin)
10. Mostrar las imágenes en "Mis pedidos" (endpoint listo). — EN PROGRESO
11. Widget de admin para ver las imágenes. — EN PROGRESO
12. Persistir "¿Para quién son?" con la orden. — EN PROGRESO

### D. Opcional
13. Limpiar CSS muerto `.zlx-tryon-btn`.
14. Adjuntar la imagen también en los correos (hoy: "solo guardar").

## 8. Historial de cambios de esta sesión

- Probador nuevo por defecto (`prod`) + ErrorBoundary (arreglo de "se cae y redirige").
- Se quitó el iframe 3D pesado del arranque; botón "Probar con cámara" rediseñado como
  tarjeta secundaria (no tapa el producto).
- Arquitectura async del trabajo de medición (nunca corta la generación).
- Render de perfil desde la foto lateral real conservando el entorno; ambas vistas con
  espejuelos. Velocidad: `gemini-2.5-flash-image` + 1K.
- Medición propia (MediaPipe) que sobrescribe los números de la IA.
- Sonido de cámara; "Calcular" inmediato en responsive; carrusel comercial en la espera.
- Persistencia del resultado generado (no re-generar al reabrir).
- Resultado en la misma ventana + dimensiones en la esquina + "Añadir receta".
- Responsive de la receta: foto de la armadura protagonista, pasos como iconos.
- Guardado de la imagen del probador y de la receta subida ligadas a la orden;
  visibles por el cliente (`my-orders`) y el admin.


## 9. Mejoras posteriores (ronda 2)

Cuatro frentes de mejora, todos desplegados:

1. **Precisión / confianza de la medición.** `opticalMeasure.js` ahora calcula la
   calidad de cada toma (resolución del iris, inclinación *roll*, giro *yaw*,
   simetría del iris) y devuelve `quality { level, score, estErrorMm, reasons }`.
   El resultado muestra una banda de confianza (verde/ámbar/rojo); si es baja, un
   botón para repetir las fotos (mejor dato en origen). El panel de dimensiones
   muestra la confianza y el margen ± mm.

2. **Conversión — compartir la prueba.** Botón "Compartir" en el resultado: en
   móvil usa `navigator.share` con la imagen (WhatsApp, etc.); en escritorio
   descarga la imagen y abre WhatsApp con un mensaje. (El CTA del probador en la
   ficha de producto y en las tarjetas ya existía.)

3. **Correo a la tienda — señal de prueba virtual.** El correo de la tienda añade
   una fila "Prueba virtual: incluida — verla en el panel" (solo copia de tienda,
   como el nº de registro). **No** se envía enlace firmado por correo (es un token
   portador); el dueño la ve autenticado en el panel (widget del §7.11).

4. **Rendimiento + métricas.** `index.html` precalienta la conexión al CDN de
   MediaPipe y al host del modelo (`preconnect`/`dns-prefetch`) para que el estudio
   abra más rápido — el probador ya está en chunks *lazy* y usa el modelo `flash`.
   `order-board` añade un flag `has_tryon` por orden (consulta por lote de
   `tryon_image_url`, solo la señal) y el panel muestra un badge 📷 "Usó el
   probador virtual" para ver adopción/conversión de un vistazo.

### Ideas para seguir mejorando (backlog)
- Calibrar la medición contra medidas reales de óptico (5–10 casos) y ajustar
  umbrales de calidad / `ANCHOR_BRIDGE_FROM_TOP`.
- Chequeo de calidad de foto ANTES de calcular (bloquear/avisar si la toma es mala).
- Recuperación: si el cliente midió y no compró, enviarle su imagen por correo/WhatsApp
  (usar la infra de aviso existente).
- Aviso de encaje: comparar ancho de cara vs A/DBL para sugerir si la montura le queda
  ancha/estrecha.
- Persistir el nivel de confianza con la receta (columna) para mostrárselo al óptico.
- Métrica de conversión probador→compra en el panel de analítica (además del badge).
