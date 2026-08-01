# Rediseño del funnel de lentes + educación + checkout del paciente (preview)

> Rama: `frontend_medusa` · App: `apps/capri-storefront` (React 18 + Vite)
> Estado: **preview** — `npx vite build` pasa (227 módulos, sin errores).
> Todo el copy nuevo pasa por el diccionario `t(key)` en `src/i18n/translations.js`
> (`es` + `en`); ningún string queda hardcodeado en los componentes.

Este documento resume el rediseño completo del embudo de compra de lentes
graduados, la capa educativa "estilo vendedor", las tarjetas estilo Amazon y el
checkout con datos del paciente. Los números entre paréntesis (req N) son los
requisitos del pedido, y quedan como comentarios en el código para trazabilidad.

---

## 1. Funnel flotante sobre la montura (req 1, 2, 3)

Archivo: `src/pages/LensProcess.jsx` (reescrito, ~665 líneas)
Estilos: `src/styles/index.css` (clases `zlx-*`, +251 líneas)

El configurador dejó de ser un wizard de pasos apilados. Ahora es una sola
pantalla (`.zlx`) con la **montura flotando** en el centro (`.zlx-float`) y los
botones de acción **encima de la imagen** (`.zlx-float-btns` → `.zlx-fab`):

- **Receta / uso** (`rx`): tipo de lente + graduación.
- **Material** (`material`): índice del lente.
- **Tratamientos** (`treat`): fotocromático + antirreflejo.

Cada botón:
- Muestra su estado actual como subtítulo (opción elegida o "pendiente").
- Se marca con un check (`zlx-fab-ok`) cuando ya tiene selección.
- Se **deshabilita** hasta que el paso previo tiene sentido (p. ej. material se
  activa sólo tras elegir el uso; tratamientos, tras elegir material).

Los botones **no navegan a otra vista**: abren un **popover que flota sobre la
escena** (`ZlxPop`), de modo que la montura sigue visible mientras se configura.
El popover:
- Se cierra con `Esc`, con la "X", o haciendo clic en el fondo transparente
  (`.zlx-pop-backdrop`) — sin ocultar la montura.
- Es `role="dialog"` `aria-modal`.

## 2. Sin "Continuar" — CTA único (req sin-continuar)

No hay botones de "siguiente paso" que obliguen a avanzar. La única meta es el
CTA de compra en el resumen lateral (`.zlx-summary` → `.zlx-buy`). El gate:

```
canBuy = !!designId && (frameOnly || !!matId) && !awaitingRxConfirm && ocr.status !== "loading"
```

- Se necesita elegir un uso; si lleva lentes, un material.
- Si hay una lectura OCR pendiente, hay que confirmarla antes de comprar
  (`awaitingRxConfirm`).
- El resumen (`.zlx-summary-list`) siempre está visible con el desglose de
  precio y el total, y muestra avisos (`zlx-summary-warn`) de lo que falta.

Al comprar (`finish`) se persiste la receta como registro de salud en el backend
(`createPrescription`) y sólo se manda su `id` al carrito; los valores crudos de
la receta nunca viajan al cliente. Después navega directo a `/checkout`.
Un fallo al añadir **se hace visible con toast** (nunca navega como si hubiera
funcionado — ese era el bug de "carrito vacío en checkout").

## 3. Educación bilingüe estilo vendedor (req 5)

Archivo nuevo: `src/data/lensEducation.js` (~266 líneas)

Contenido comercial `{es,en}` que explica cada opción como lo haría un vendedor:
**para qué sirve / para qué NO / nota de precio**. Se renderiza con el
componente `EduBlock` (bueno ✓ / malo ✕ / precio 🏷) dentro de cada popover.

Cubre:
- **Material del lente** (`MATERIAL_EDU`): `cr39`, `poly`, `1.56`, `1.61`,
  `1.67`, `1.74`.
- **Fotocromático / Transitions** (`PHOTO_EDU`): un bloque único.
- **Antirreflejo** (`AR_EDU`): estándar, azul, premium — mapeado por id de
  catálogo (soporta ids nuevos y legados: `ar-green-basic`, `adequate`,
  `ar-green-plus`, `crystal`, `flawless`, `ar-blue-protect`, `blue-uv-445`).
- **Material de la montura** (`FRAME_MATERIAL_EDU`): acetato, metal, TR90,
  titanio, acero inoxidable, aluminio, plástico inyectado — con función
  `frameMaterialKey()` que normaliza el nombre del catálogo (sin acentos,
  variantes ES/EN) a la clave.

Los **títulos** salen del catálogo (label bilingüe); aquí sólo vive el cuerpo
educativo. No toca precios ni el flujo Medusa. El material recomendado se calcula
por la graduación (`recommendedMat`, según `maxAbs`) y para niños fuerza `poly`.

## 4. Selector semicircular por grados (req 7)

Componente `ZlxDial` en `LensProcess.jsx` + estilos `.zlx-dial*`.

Un **dial semicircular** (SVG 200×120) para elegir la esfera (SPH) arrastrando,
tocando o con teclado:
- Traduce el ángulo del puntero (0..π sobre la mitad superior) al índice de
  opción más cercano; la mitad inferior se recorta al extremo próximo.
- Arco de progreso con `strokeDasharray` + thumb + valor central.
- Accesible: `role="slider"`, `aria-valuemin/max/now/text`, flechas del teclado.

El resto de campos (CYL, AXIS, PD, ADD) usan `ZlxPicker`: una rueda fina que
muestra sólo 5 valores (seleccionado ±2), con rueda del ratón, flechas y clic.

## 5. OCR de receta (integrado en el popover de receta)

La carga de una foto de receta (`handleRxUpload` → `ocrPrescription`) rellena los
selectores con `nearest()` (ajusta la lectura al valor de opción más cercano).
La lectura del modelo debe **revisarse y confirmarse** (`ocr.confirmed`) antes de
poder comprar; el backend rechaza una receta OCR sin confirmar. Todo fallo de
OCR es recuperable escribiendo los valores a mano — el funnel nunca se bloquea.

## 6. Ficha comercial del marco (req 6)

- En el funnel: bloque `.zlx-frameinfo` + popover `frame` con modelo (SKU),
  colección (marca), material y la copia de calidad de `FRAME_MATERIAL_EDU`.
- En la PDP (`src/pages/ProductDetail.jsx`): chips `.frame-id` (modelo /
  colección / material) y bloque `.frame-quality` con la explicación de calidad
  del material (para qué sirve / para qué no), bilingüe.

## 7. Tarjetas estilo Amazon (req 11)

Archivos: `src/components/ProductCard.jsx`, `src/components/CaseCard.jsx`

- **Añadir al carrito** añade **sólo la montura** (`addVariant`, precio base del
  servidor) — botón `.card-add` con feedback "✓ añadido".
- Al **hover** aparece un icono flotante **Comprar** (`.buy-pill`):
  - En monturas → lleva al flujo completo `/recetas/:slug?color=N`
    (receta → material → tratamientos), no al carrito.
  - En estuches (`CaseCard`, sin receta) → añade y va directo a `/checkout`.
- Clic en la imagen del espejuelo → abre la PDP.
- `favoritos` ahora guarda el `variantId` para que se pueda comprar desde favs.
- Los handlers usan `stopPropagation` para no disparar la navegación del `Link`.

## 8. Checkout con datos del paciente, sin pickup, autocompletado (req 14, 15)

Archivo: `src/pages/MedusaCheckout.jsx` · helpers de carrito: `src/data/medusaCart.js`

- **Sin recoger en tienda (req 14):** `listShippingOptions()` filtra cualquier
  opción de envío que parezca pickup/recogida (`isPickupOption`: por tipo de
  fulfillment, flag de metadata `pickup`/`is_pickup`, o nombre en ES/EN:
  `pickup|recoger|recogida|en tienda|in-store|collect`). El cliente sólo puede
  elegir envío a domicilio.
- **Datos del paciente:** el paso de contacto captura nombre, apellido, email y
  dirección separada en calle / ciudad / código postal / país, con
  `autoComplete` nativo en cada campo.
- **Autocompletado estilo Google Maps (req 15):** archivo nuevo
  `src/data/addressAutocomplete.js`. Cuando hay clave de Maps configurada,
  adjunta Google Places al campo de calle y, al elegir un lugar, rellena de
  golpe calle / ZIP / ciudad / país (`parsePlace` desglosa
  `address_components`). Se muestra un hint `📍` sólo cuando hay clave.
- **Región US:** `country_code` cae a `"us"` si el país autocompletado no se
  reconoce, para que la búsqueda de opciones de envío / la finalización nunca se
  rompan.

### ⚠️ Falta: `VITE_GOOGLE_MAPS_KEY` para el autocompletado completo

El autocompletado de dirección **sólo se activa si se define
`VITE_GOOGLE_MAPS_KEY`** (Google Maps JavaScript API, librería Places). Ya está
documentada en `.env.example`:

```
# Google Maps JavaScript API key (Places library). When set, the checkout's
# "Patient details" street field gets Google-style address autocomplete...
VITE_GOOGLE_MAPS_KEY=
```

**Sin la clave, el checkout funciona igual** con los campos separados manuales:
`addressAutocomplete.js` está diseñado para que el build **nunca dependa** de que
Google esté disponible (si no hay clave o el script falla, es un no-op silencioso
y quedan los inputs manuales). Para tener el autocompletado en producción hay que:

1. Crear una clave en Google Cloud con la **Maps JavaScript API** + **Places API**
   habilitadas.
2. Restringirla por dominio (HTTP referrers) al dominio de la tienda.
3. Ponerla en el `.env` de `capri-storefront` como `VITE_GOOGLE_MAPS_KEY=...`.

## 9. Responsive + bilingüe

- **Bilingüe:** todo el copy nuevo tiene clave en `es` y `en`
  (`src/i18n/translations.js`): `card.buy`, `card.addFrameOnly`, `lens.*`
  (buy, sph, cyl, axis, treatBtn, frameInfo, confirmRx, needChoice, etc.),
  `frame.*` (model, collection, material, qualityTitle, goodFor, badFor),
  `checkout.*` (contact, address, country, addrHint, ...). El idioma se
  persiste en `localStorage`; no hay URLs con prefijo de idioma.
- **Responsive:** las clases `zlx-*` en `src/styles/index.css` incluyen los
  breakpoints para reordenar la montura flotante, los FABs, los popovers y el
  resumen en pantallas pequeñas; los popovers pasan a ocupar el ancho útil y el
  resumen se coloca bajo la montura.

## 10. Verificación

```bash
cd apps/capri-storefront && npx vite build
# ✓ 227 modules transformed. built in ~4.7s — sin errores.
```

(El aviso de chunk > 500 kB es preexistente: `TryOn` arrastra three.js y ya se
carga en modo lazy; no es un error del build.)

## Archivos tocados

| Archivo | Cambio |
| --- | --- |
| `src/pages/LensProcess.jsx` | Funnel flotante, popovers, dial semicircular, picker fino, educación, OCR, CTA único |
| `src/data/lensEducation.js` | **nuevo** — copy comercial bilingüe (materiales, tratamientos, monturas) |
| `src/data/addressAutocomplete.js` | **nuevo** — Google Places con fallback manual |
| `src/pages/MedusaCheckout.jsx` | Datos del paciente + país + autocompletado |
| `src/data/medusaCart.js` | Filtro de opciones de pickup (envío-solo) |
| `src/components/ProductCard.jsx` | Tarjeta Amazon: añadir montura + hover Comprar |
| `src/components/CaseCard.jsx` | Tarjeta Amazon del estuche: añadir + Comprar |
| `src/pages/ProductDetail.jsx` | Ficha comercial + calidad del material del marco |
| `src/i18n/translations.js` | Claves `es`/`en` nuevas |
| `src/styles/index.css` | Estilos `zlx-*`, tarjetas, checkout, responsive |
| `.env.example` | `VITE_GOOGLE_MAPS_KEY` documentada |
