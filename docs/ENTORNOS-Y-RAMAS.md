# Entornos, ramas y despliegue

Qué rama alimenta cada entorno, cómo elige el storefront su backend y qué impide que la tienda en vivo hable con staging. Escrito tras el incidente del 27 oct 2026: una URL de staging fijada en una rama llegó a `develop` y durante horas la tienda real mandó carrito, pago, pedidos y la medición con IA del probador al backend (y a la base de datos) de staging.

## Ramas y entornos

| Rama | Storefront (Vercel) | Backend (Coolify) | Para qué |
|---|---|---|---|
| `develop` | **www.rubilens.com** (dominio de rama, despliegues *Preview*) | — | Tienda en vivo |
| `main` | — | **api.161-153-9-98.sslip.io** (producción) | Backend en vivo |
| `develop_optical_storepos` | Preview de la rama | **api-staging.161-153-9-98.sslip.io** | Staging: punto de venta y multi-tienda |

Reglas de trabajo:

- `develop_optical_storepos` es **independiente**: no recibe nada de `develop` ni de `main` (ni merges, ni rebases, ni cherry-picks). Que GitHub la marque "behind develop" es normal.
- A `develop` y `main` solo se llega por **pull request** (ruleset de GitHub con PR obligatorio y checks en verde). No se hace push directo.
- `www.rubilens.com` está enlazado a la rama `develop`, cuyos despliegues son *Preview*: **Instant Rollback no está disponible**. Para volver atrás: *Redeploy* de un despliegue anterior de `develop`, o *Promote to Production* y reasignar el dominio.

## Cómo elige el storefront su backend

1. **`apps/capri-storefront/vercel.json` es igual en todas las ramas** y tiene dos rewrites fijos:
   - `/medusa/*` → producción
   - `/medusa-staging/*` → staging

   Un merge no puede cambiar a dónde apunta la tienda. No hay `vercel.ts`: Vercel valida sus propiedades estáticas leyendo el código y rechazó todas las variantes con valores calculados.
2. **`apps/capri-storefront/backend-target.mjs`** decide el prefijo de cada compilación a partir de la rama (`VERCEL_GIT_COMMIT_REF`): `develop` y `main` → `/medusa`, siempre; cualquier otra → `/medusa-staging`.
3. **`apps/capri-storefront/scripts/vercel-build.sh`** exporta esa decisión como:
   - `VITE_BACKEND_PROXY`: el prefijo de todas las llamadas (`data/medusa.js`, `admin/adminApi.js`, `data/visionMeasure.js` y el probador). En Vercel tiene prioridad sobre `VITE_MEDUSA_URL` y `VITE_ADMIN_MEDUSA_URL`, así que ninguna variable del panel de Vercel puede desviar la tienda en vivo.
   - `VITE_BACKEND_TARGET`: `production` o `staging`; lo usa la salvaguarda del build.

   Si una rama en vivo no queda en `/medusa`, **el build falla** y Vercel sigue sirviendo el despliegue anterior.
4. **En local** no se define nada: `/medusa` y el proxy de Vite, como siempre.

Para apuntar una rama a otro backend: añadir un rewrite fijo nuevo en `vercel.json` y su prefijo en `backend-target.mjs`. Nunca escribir una URL de backend en otro sitio.

## Panel y backend de versiones distintas

El backend publica en `GET /version` la lista `features`. El panel solo muestra las pestañas multi-tienda (punto de venta, tiendas, ventas, alertas, costos de tienda, aprobaciones, auditoría, perfil) si el backend incluye `"multistore"` (`src/admin/backendFeatures.js`). Así, un storefront más nuevo que su backend (`develop` contra el backend de `main`) muestra el panel que puede servir, en lugar de pestañas con errores.

## Comprobaciones automáticas

| Comprobación | Dónde | Qué evita |
|---|---|---|
| `node scripts/check-vercel-config.mjs` (`pnpm check:vercel`, dentro de `pnpm test`) | Local y CI | `vercel.json` con otra dirección, un `vercel.ts` al lado, `develop`/`main` resolviendo a staging, código que no use `VITE_BACKEND_PROXY`, URL de staging escrita en el código |
| `Deploy wiring & i18n` | CI | Lo anterior, más claves de traducción que falten en un idioma |
| `Backend migrates and boots on an empty database` | CI | Migraciones que fallan o un backend que no arranca (lo que tumbó staging con `price_rule`). Usa una clave de Stripe de mentira: el módulo de pagos exige una para arrancar. |
| `Lint & Typecheck`, `Backend unit tests`, `Scraper parser tests` | CI | Errores de código |
| `Vercel – optical-storefront-capri-storefront` | Vercel | Un despliegue que Vercel rechaza |

El CI corre en push a `main`, `develop` y `develop_optical_storepos`, y en pull requests hacia `main` y `develop`. En el ruleset de GitHub, todas las anteriores deberían ser obligatorias.

## Si la tienda vuelve a apuntar al backend equivocado

1. Comprobar: `https://www.rubilens.com/medusa/version` debe mostrar el commit de `main` (producción).
2. Volver a un despliegue bueno de `develop` en Vercel (*Redeploy*).
3. Revisar en la base de datos de staging los pedidos de clientes reales hechos mientras tanto.
