# Plan de reconciliación de ramas (`develop` ⟷ `frontend_dev`)

> **No he tocado nada de esto todavía.** Es un análisis + plan para que decidas
> la dirección antes de ejecutar. Al final hay 3 preguntas concretas.

## El hallazgo (la raíz del problema)

`develop` y `frontend_dev` **no comparten historia git**. No es que hayan
divergido desde un ancestro común: literalmente tienen raíces distintas y
`git merge-base` no devuelve nada.

| | `develop` | `frontend_dev` (en Vercel) |
|---|---|---|
| Raíz | `0bad0d3` | `ac23e2b` |
| Commits | 58 | 19 |
| Ancestro común | **ninguno** | **ninguno** |

Consecuencia: un `git merge` normal es inviable. Forzarlo con
`--allow-unrelated-histories` intentaría combinar dos árboles completos y
generaría conflictos en casi todos los archivos. **No es el camino.**

## Las funcionalidades están repartidas (ninguna rama es superconjunto)

**Solo en `develop`** (integración con Medusa — el trabajo ORDEN, lo difícil de
rehacer):

- `data/medusa.js`, `data/medusaCart.js`, `pages/MedusaCheckout.jsx` — carrito y
  checkout con precio en servidor, Stripe, recuperación de pedidos.
- `components/Feedback.jsx` (toasts que usa todo el flujo de carrito).
- `config/features.js`, `data/lensCatalog.js`, TryOn completo.

**Solo en `frontend_dev`** (lo que está vivo en Vercel):

- El **rediseño de UI aprobado** (portada con hero/carrusel, ~550 monturas,
  lookbook) — es la interfaz que ya te gusta y está en producción.
- El **proxy `/medusa`** en `vercel.json` (evita CORS; `develop` llama al
  backend directo, lo que exige CORS abierto en el backend).
- `components/ErrorBoundary.jsx`, `data/orderNotify.js`, `data/orderStatus.js`.

Además, archivos compartidos han divergido mucho por su cuenta (p. ej.
`LensProcess.jsx` difiere en ~785 líneas, `translations.js` ~268, `styles` ~297).
O sea: **cada rama tiene la mitad de lo necesario, sobre una base de UI distinta.**

## Por qué esto importa

- Producción (Vercel) sirve `frontend_dev`, que **no tiene** el carrito/checkout
  de Medusa. Todo el trabajo ORDEN vive en `develop`, que **no está desplegado**.
- Mientras sigan separadas, o falta el checkout (en la UI viva) o falta la UI
  aprobada (en la rama con checkout).

## Opciones

### Opción A — `develop` como canónica; portar la UI de `frontend_dev`
Mover el rediseño + proxy + ErrorBoundary/orderNotify/orderStatus encima de
`develop`.
- ➖ Es mucha UI diverguida (LensProcess, styles, translations, Home…). Alto
  riesgo de perder pulido visual o introducir regresiones. Mucho trabajo manual.
- ➕ El checkout (lo correcto/crítico) queda intacto.

### Opción B — `frontend_dev` como canónica; portar la integración Medusa _(recomendada)_
Llevar los 9 archivos de integración de `develop` + los cambios ORDEN encima de
la UI viva y aprobada de `frontend_dev`.
- ➕ La UI que ya te gusta y está en producción no se toca.
- ➕ La integración Medusa es **modular** y yo la escribí, así que la puedo
  re-aplicar limpio, archivo por archivo, con QA.
- ➖ Los cambios ORDEN sobre archivos compartidos (CartContext, StorePanels,
  LensProcess, ProductDetail, Case*, AccountPage, translations) hay que
  re-aplicarlos sobre las versiones de `frontend_dev`, que difieren. Es acotado
  pero requiere cuidado.
- ⚠️ Implica que **todo el trabajo ORDEN futuro apunte a `frontend_dev`**, no a
  `develop`. Esto hay que coordinarlo con Dionis (su backend y el spec ORDEN
  asumían `develop`).

### Opción C — no reconciliar aún
Seguir en `develop` hasta cerrar ORDEN 2–9 y probar E2E; reconciliar al final.
- ➕ No frena el avance funcional.
- ➖ El riesgo estructural sigue ahí y crece con cada commit.

## Recomendación

**Opción B**, pero **ejecutada por fases y solo tras tu visto bueno**:

1. Confirmar que `frontend_dev` es la UI canónica (está viva y aprobada).
2. Portar los 9 archivos Medusa-only de `develop` a una rama nueva a partir de
   `frontend_dev` (p. ej. `frontend_medusa`), sin tocar la UI.
3. Re-aplicar los cambios ORDEN sobre los archivos compartidos, uno a uno, con
   build + QA tras cada uno.
4. Decidir proxy vs CORS directo (ver pregunta 2).
5. Probar en un preview de Vercel antes de promover a producción.

No se borra `develop`: queda como referencia hasta que la rama unificada esté
verificada en producción.

## Decisiones que necesito de ti (y de Dionis) antes de tocar nada

1. **¿Cuál UI es la canónica** — la de `frontend_dev` (viva en Vercel, Opción B)
   o la de `develop` (Opción A)?
2. **¿Proxy o CORS directo?** `frontend_dev` usa el proxy `/medusa` (sin CORS).
   `develop` llama directo al backend (necesita CORS abierto para el dominio de
   Vercel). ¿Con cuál nos quedamos?
3. **¿Se puede eliminar `apps/storefront`?** Es una app extra (Next.js) que solo
   existe en `frontend_dev` y parece legado. Confirmar con Dionis que está muerta.

Con esas tres respuestas preparo el plan de ejecución detallado (archivo por
archivo) y lo hago por fases, verificando en cada paso.
