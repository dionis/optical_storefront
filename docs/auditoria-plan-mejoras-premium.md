# Auditoría técnica + Plan de mejoras premium — RUBI_LENS / Óptica El Rancho

> Documento vivo. Auditoría de frontend, backend y experiencia, con un plan
> priorizado para llevar la tienda a nivel **premium** (calidad de producto,
> rendimiento, escalabilidad y estética de diseñador senior en apps de ópticas).
>
> Fecha de corte: 2026-09-02 · Rama de trabajo: `develop` (storefront → Vercel),
> `main` (backend → Coolify). Autoría técnica asistida por Claude.

---

## 1. Resumen ejecutivo

El proyecto es un monorepo con tres piezas bien separadas:

- **Storefront** (`apps/capri-storefront`): React 18 + Vite, i18n propio (es/en),
  catálogo, checkout Medusa, cuenta/pedidos, panel admin y el **probador virtual
  con medición óptica por IA** (diferenciador del producto).
- **Backend** (`apps/backend`): Medusa v2 con módulos propios (recetas/PHI, pagos
  PayPal y Square, configuración de lentes, reseñas, notificaciones, ajustes de
  tienda) + subscribers de correo.
- **Servicio de visión** (`apps/vision-measure`): FastAPI (Python) que mide y
  genera el montaje fotorrealista con Gemini; se empaqueta dentro de la imagen del
  backend.

Volumen: **199 archivos de código, ~32.200 líneas**. El código es funcional y ya
está en producción, pero muestra señales típicas de crecimiento rápido: archivos
muy grandes (varios >1.000 líneas), CSS monolítico con reglas duplicadas por
parches sucesivos, ausencia de tests automatizados, y una capa visual sólida pero
no unificada como sistema de diseño.

**Objetivo del plan:** consolidar calidad y escalabilidad sin frenar el negocio,
y elevar la percepción a "premium" con un sistema de diseño coherente y una
experiencia de probador impecable, que es lo que diferencia a esta óptica online.

---

## 2. Arquitectura general

```
OPTICA-TIENDA/
├─ apps/
│  ├─ capri-storefront/     # React + Vite (Vercel, rama develop)
│  │  └─ src/
│  │     ├─ components/     # UI + probador (TryOnStudio, MeasureReport…)
│  │     ├─ pages/          # Catalog, ProductDetail, LensProcess, Checkout…
│  │     ├─ admin/          # Panel propio (charts, analytics, dashboard)
│  │     ├─ data/           # Acceso a datos + lógica (medusa, opticalMeasure…)
│  │     ├─ i18n/           # translations.js (2.087 líneas)
│  │     └─ styles/         # index.css (monolítico, ~3.200 líneas)
│  ├─ backend/              # Medusa v2 (Coolify, rama main)
│  │  └─ src/
│  │     ├─ modules/        # prescription, payment-*, lens-config, reviews…
│  │     ├─ api/            # admin/, store/, vision-measure/
│  │     ├─ lib/            # email/, order-board, s3, lens-compat…
│  │     └─ subscribers/    # order-placed…
│  └─ vision-measure/       # FastAPI: measure.py, providers.py, compositor.py
└─ docs/                    # Documentación (este archivo incluido)
```

**Flujos críticos**

1. **Catálogo → Producto → Receta → Checkout**: catálogo cacheado en el cliente
   (`catalogStore`), producto con configurador de lentes (`LensProcess`), pago vía
   Medusa (PayPal/Square).
2. **Probador virtual**: captura frontal+lateral → medición propia (MediaPipe,
   `opticalMeasure.js`) → job asíncrono al backend/Gemini que genera el rostro con
   los espejuelos → resultado en la misma ventana + guardado con la receta.
3. **Recetas = PHI**: valores en Postgres (Knex directo), imágenes en bucket R2
   privado con URLs prefirmadas; el correo solo señala la presencia, nunca expone
   la URL.

---

## 3. Auditoría Frontend

### 3.1 Calidad de código y mantenibilidad

| # | Hallazgo | Severidad | Recomendación |
|---|----------|-----------|---------------|
| F1 | `index.css` monolítico (~3.260 líneas) con reglas **duplicadas** por parches sucesivos: varios bloques `@media (max-width:560px)` para el mismo selector del probador que se sobrescriben entre sí (deuda real). Nota: `.zlx-tryon-*` **SÍ está en uso** (`LensProcess.jsx`, botón "Probar con cámara") — no eliminar. | Alta | Consolidar los bloques responsive del probador en uno solo por componente; migrar a tokens + utilidades. Verificar SIEMPRE el uso real (grep en JSX) antes de borrar cualquier selector. |
| F2 | Componentes gigantes: `LensProcess.jsx` (1.394), `AdminDashboard.jsx` (1.021), `TryOnStudio.jsx` (995), `charts.jsx` (1.239). | Alta | Extraer subcomponentes y hooks (`useMeasureJob`, `useCamera`, `useResultPersistence`) para bajar cada archivo a <400 líneas. |
| F3 | `translations.js` (2.087) es un único objeto plano es/en. | Media | Partir por dominio (`catalog`, `tryon`, `checkout`) y validar claves faltantes es↔en en CI. |
| F4 | Lógica de dominio mezclada con UI (medición, formato, descarga dentro de `TryOnStudio`). | Media | Mover `composeWithMeasures`, `resultFileName`, `glassesScore` a `data/` como utilidades puras y testeables. |
| F5 | Sin tests automatizados (unit/E2E). | Alta | Vitest para utilidades puras (medición, formato) + Playwright para el flujo probador→receta→checkout. |

### 3.2 Rendimiento

| # | Hallazgo | Severidad | Recomendación |
|---|----------|-----------|---------------|
| P1 | Bundle inicial. ✅ **Hecho**: el probador ya era `lazy`; ahora también las rutas secundarias (admin, checkout, receta, cuenta, pedidos, estuche) → chunks separados (AdminPage ~63 kB JS + 18 kB CSS, LensProcess ~40 kB, Checkout ~12 kB fuera del bundle inicial). | Media | Siguiente: `rollup-plugin-visualizer` para medir y afinar vendor chunks. |
| P2 | Imágenes del catálogo sin estrategia explícita de tamaños/formatos. | Media | `srcset`/`sizes`, `loading="lazy"`, y AVIF/WebP donde el origen lo permita. |
| P3 | Persistencia de resultados en `localStorage` con downscale — bien resuelto, pero la cuota sigue siendo frágil. | Baja | Migrar a IndexedDB para históricos de medición (más espacio, sin bloquear el hilo). |
| P4 | Recalcular medición y componer imágenes en el hilo principal. | Media | Mover composición/medición pesada a un Web Worker; el canvas de rótulos puede ir en `OffscreenCanvas`. |

### 3.3 Accesibilidad (a11y)

| # | Hallazgo | Severidad | Recomendación |
|---|----------|-----------|---------------|
| A1 | El probador es un `role="dialog"` a pantalla completa; falta trampa de foco y retorno de foco al cerrar. | Media | Focus-trap, `aria-labelledby`, cerrar con `Esc`, devolver foco al disparador. |
| A2 | Botones solo-icono (ampliar/descargar/favorito) — ya tienen `aria-label`, verificar contraste sobre foto. | Baja | Sombra/opacidad de fondo garantizada; test de contraste AA. |
| A3 | Mensajes de guía de captura por color (verde/rojo) sin refuerzo textual/icono en algunos estados. | Baja | Añadir icono + texto, no depender solo del color. |

### 3.4 El probador (núcleo del producto)

Estado tras las últimas correcciones: resultado en la misma ventana, dos fotos
lado a lado en móvil, medidas en el flujo, descarga rotulada, detección de
espejuelos y guardado con la receta. Pendientes de robustez:

- **Precisión**: el PD monocular ya se corrige por inclinación y línea media nasal;
  falta **calibrar los umbrales contra mediciones reales de óptico** (data set).
- **Detección de espejuelos**: heurística por bordes/reflejos, conservadora;
  necesita calibración con casos reales (`?capdbg`) o un clasificador ligero TF.js.
- **Estados de error**: unificar copy y reintentos; telemetría de fallos de Gemini.

---

## 4. Auditoría Backend

### 4.1 Medusa v2 (`apps/backend`)

| # | Hallazgo | Severidad | Recomendación |
|---|----------|-----------|---------------|
| B1 | Lecturas de receta con **Knex directo** porque los métodos del módulo lanzan; patrón frágil ante upgrades de Medusa. | Alta | Encapsular en un repositorio (`lib/prescription-read.ts`) con tests; revisar por qué el ORM del módulo falla y corregir el modelo. |
| B2 | `order-confirmation.ts` (885) y `copy.ts` (517): plantillas de correo muy grandes. | Media | Plantillas por bloque + snapshots de render; separar copy de estructura. |
| B3 | Migraciones se aplican en cada arranque (`docker-entrypoint`). Correcto para este flujo, pero sin verificación de estado. | Media | Log de migraciones aplicadas + healthcheck que falle si hay migraciones pendientes en producción. |
| B4 | Middleware de límites de body (8mb) para imágenes en base64 subidas al checkout. | Media | Migrar la subida de imagen a **URL prefirmada directa a R2** (el navegador sube al bucket), evitando pasar base64 por el backend. |

### 4.2 Seguridad y privacidad (PHI)

| # | Hallazgo | Severidad | Recomendación |
|---|----------|-----------|---------------|
| S1 | Recetas e imágenes son **PHI**. Ya: Postgres + R2 privado + URLs prefirmadas, correo solo señala presencia. Buen diseño. | — | Mantener. Añadir cifrado en reposo a nivel de columna para valores sensibles y rotación de credenciales R2. |
| S2 | `GEMINI_API_KEY` solo en entorno del servidor. Correcto. | — | Auditar que nunca llegue al bundle del cliente (grep en CI del build). |
| S3 | TTL de URLs prefirmadas configurable. | Baja | Reducir TTL al mínimo operativo; registrar accesos. |
| S4 | Acceso a "Mis pedidos" por email/teléfono verificado una vez en el navegador. | Media | Revisar el token/verificación para evitar enumeración; rate-limit en endpoints públicos. |

### 4.3 Servicio de visión (`apps/vision-measure`)

| # | Hallazgo | Severidad | Recomendación |
|---|----------|-----------|---------------|
| V1 | `providers.py` (1.132): reintentos, timeouts y modelos configurables por env. Buen diseño operativo. | — | Añadir métricas (latencia por modelo, tasa de fallo) y circuit-breaker. |
| V2 | Render por vista aislado (una falla no tumba la otra). Correcto. | — | Cache de render por (foto+montura+modelo) para no re-generar en reintentos del cliente. |
| V3 | Cálculo geométrico en `measure.py` duplica conceptos con `opticalMeasure.js` del cliente. | Media | Definir el contrato de medición en un solo lugar (esquema compartido) y documentar cuál manda. |

---

## 5. Hallazgos QA priorizados (tabla maestra)

Prioridad = Impacto × Probabilidad. P0 = corregir ya, P3 = mejora.

| ID | Área | Descripción | Prioridad | Estado |
|----|------|-------------|-----------|--------|
| QA-01 | Probador móvil | Medidas se solapaban con la ficha y tapaban "Añadir receta". | P0 | ✅ Resuelto (`946b2e0`) |
| QA-02 | Cache | HTML cacheado servía versión vieja. | P0 | ✅ Resuelto (vercel.json no-store) |
| QA-03 | Medición PD | Reparto OD/OS asimétrico por inclinación/yaw. | P1 | ✅ Mitigado; falta calibrar con óptico |
| QA-04 | Probador | Detección de espejuelos sin calibrar (falsos +/–). | P1 | ⏳ Umbral conservador; calibrar |
| QA-05 | CSS | Reglas duplicadas/muertas en index.css. | P2 | ⏳ Pendiente limpieza |
| QA-06 | Tests | Sin cobertura automatizada. | P1 | ⏳ Pendiente |
| QA-07 | Subida imagen | Base64 por backend (límite 8mb). | P2 | ⏳ Migrar a R2 directo |
| QA-08 | a11y | Falta focus-trap en el probador. | P2 | ⏳ Pendiente |

---

## 6. Plan de mejoras — UI/UX premium (diseñador senior, ópticas)

### 6.1 Principios

Una óptica premium transmite **precisión, confianza clínica y estilo**. La interfaz
debe sentirse como un instrumento óptico: limpia, con mucho aire, tipografía
nítida, y una paleta sobria con un acento de marca. Menos elementos, mejor
jerarquía, microinteracciones sutiles.

### 6.2 Sistema de diseño (design tokens)

Definir tokens en un solo lugar (`styles/tokens.css` con variables CSS) y consumir
desde todos los componentes:

- **Color**: navy `#182a4e` (autoridad/óptica), acento `#0E5AD0` (acción), neutros
  cálidos (`#f7f6f3` fondo, `#17191f` tinta), estados (éxito/aviso/error) con AA.
- **Tipografía**: una serif elegante para titulares de producto + una sans
  geométrica para UI; escala modular (12/14/16/20/28/40). Números tabulares para
  medidas.
- **Espaciado**: escala 4/8/12/16/24/32/48. **Radios**: 10/14/16. **Sombras**: 2
  niveles (elevación sutil + modal).
- **Movimiento**: 150–250ms, `ease-out`; nada estridente.

### 6.3 Componentes clave a elevar

1. **Tarjeta de producto**: foto grande y limpia, acciones como iconos (ya hecho);
   añadir "quick view" y estado de stock elegante.
2. **Ficha de la montura**: ya usa el patrón navy + iconos; unificar TODO el sistema
   a ese lenguaje (el panel de medidas ya lo sigue).
3. **Probador**: es el "momento wow". Pulir: encuadre guiado con overlay tipo
   cámara profesional, transiciones entre pasos, resultado tipo "informe óptico"
   descargable con marca (ya se rotula la foto — siguiente paso: PDF de informe).
4. **Checkout**: reducir fricción, resumen fijo, estados de pago claros.
5. **Cuenta / Mis pedidos**: timeline de pedido premium (ya existe `TrackingTimeline`)
   con estética consistente.

### 6.4 Consistencia

Auditar y unificar: botones (primario/secundario/fantasma), inputs, badges,
cards, modales. Hoy conviven estilos de distintas épocas; un pase de consistencia
sube la percepción de calidad inmediatamente.

---

## 7. Roadmap por fases (impacto / esfuerzo)

### Fase 0 — Estabilización (en curso)
- [x] Corregir solapamientos y visibilidad de medidas en móvil.
- [x] Anti-cache del HTML.
- [ ] Consolidar los bloques `@media` duplicados del probador (QA-05). (Nota: `.zlx-tryon-*` NO es muerto.)

### Fase 1 — Base de calidad (1–2 semanas)
- [x] `styles/tokens.css` creado (base del sistema de diseño). Pendiente: migrar botones/inputs/cards a tokens.
- [x] Rutas secundarias con `React.lazy` (bundle inicial más liviano).
- [ ] Extraer hooks del probador (`useCamera`, `useMeasureJob`).
- [ ] Vitest para utilidades de medición y formato; CI que valide claves i18n.
- [ ] Focus-trap + a11y del probador.

### Fase 2 — Escalabilidad (2–3 semanas)
- [ ] Subida de imágenes a R2 con URL prefirmada directa (quitar base64 del backend).
- [ ] IndexedDB para históricos de medición.
- [ ] Web Worker para medición/composición.
- [ ] Métricas del servicio de visión (latencia, fallos) + cache de render.

### Fase 3 — Premium UX (2–4 semanas)
- [ ] Rediseño con sistema de diseño completo (tipografía + color + movimiento).
- [ ] Informe óptico en PDF descargable con marca.
- [ ] Pulido de checkout y cuenta.
- [ ] Playwright E2E del flujo completo.

### Fase 4 — Diferenciación (continuo)
- [ ] Calibrar medición y detección de espejuelos con datos reales de óptico.
- [ ] Recuperación comercial (midió y no compró → email/WhatsApp con su imagen).
- [ ] Métricas de conversión del probador en el panel admin.

---

## 8. Métricas de éxito

- **Rendimiento**: LCP < 2.5s en catálogo; bundle inicial del catálogo sin el
  probador; probador cargado bajo demanda.
- **Calidad**: 0 solapamientos/bugs P0 en móvil; cobertura de tests en utilidades
  de medición > 80%.
- **Precisión**: error de PD < ±1.5mm vs óptico en el 90% de tomas de alta confianza.
- **Negocio**: tasa de "probó → añadió receta → compró"; % de descargas del informe.
- **Percepción**: consistencia visual (un solo sistema de diseño) y NPS del probador.

---

## 9. Registro de cambios de esta iniciativa

| Fecha | Commit | Cambio |
|-------|--------|--------|
| 2026-09-02 | `0cb38ce` | Estudio ajustado a pantalla + panel de medidas con estética de la montura. |
| 2026-09-02 | `c85f3c0` | PD monocular fiable (eje inter-iris + cresta nasal + guarda de giro). |
| 2026-09-02 | `7ad203c` | Móvil: fotos del resultado completas. |
| 2026-09-02 | `79be5fe` | Ampliar/descargar fotos + no cachear HTML + bloqueo de scroll de fondo. |
| 2026-09-02 | `2d9c998` | Quitar aviso de encaje "ancha/estrecha". |
| 2026-09-02 | `11f8ce8` | Marco 4:3 de la foto en móvil. |
| 2026-09-02 | `53296e5` | Medidas visibles en móvil (debajo de las fotos). |
| 2026-09-02 | `0454962` | Descargar fotos con medidas rotuladas + scroll natural. |
| 2026-09-02 | `0620927` | Detección de espejuelos en la captura. |
| 2026-09-02 | `fa30124` | Móvil: dos fotos lado a lado + medidas debajo. |
| 2026-09-02 | `946b2e0` | Medidas una sola vez en el flujo (fin de solapamientos; vuelve "Añadir receta"). |
| 2026-09-02 | `8cc1ccc` | Documento de auditoría + plan + base de design tokens (`tokens.css`). |
| 2026-09-02 | (este) | Rutas secundarias con `React.lazy` (admin/checkout/receta/cuenta/pedidos fuera del bundle inicial). |

---

*Siguiente paso inmediato (Fase 0): limpieza de CSS muerto/duplicado y arranque de
`styles/tokens.css` como base del sistema de diseño premium.*
