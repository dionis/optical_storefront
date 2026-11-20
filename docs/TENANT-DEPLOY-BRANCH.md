# Rama `tenant-deploy`: de donde se despliega toda óptica nueva

_Creada el 15-nov-2026 desde `develop_optical_storepos` (ac05293)._

## Para qué es

Toda óptica **nueva** (no RUBI LENS ni Óptica El Rancho) se despliega desde esta rama:

| Pieza | Configuración |
|---|---|
| Backend (Coolify) | app nueva, repositorio este, **rama `tenant-deploy`**, Dockerfile `apps/backend/Dockerfile` |
| Storefront (Vercel) | proyecto nuevo, Root Directory `apps/capri-storefront`, **rama de producción `tenant-deploy`**, `TENANT_FILE=tenants/<slug>/tenant.json` |

Las dos ópticas originales siguen en sus ramas: RUBI LENS (`develop`/`main`) y El Rancho (`develop_optical_storepos`).

## Qué la distingue

- **Las fichas de las ópticas nuevas viven aquí**: `tenants/<slug>/tenant.json`, su logo en `tenants/<slug>/public/` y la reescritura `/medusa-t-<slug>` en `apps/capri-storefront/vercel.json` (`pnpm tenant vercel`).
- **Un build sin `TENANT_FILE` falla** (`assertTenantDeployBuild` en `scripts/tenant/routing.mjs`), igual que uno con la ficha de RUBI LENS o de El Rancho. Fuera de esta rama, la ficha por defecto es la de El Rancho; aquí, sin la protección, una óptica nueva saldría publicada con otra marca y otro backend.
- La lista de pasos (`pnpm tenant checklist <slug>`) ya nombra esta rama para Coolify y Vercel.
- CI corre en cada push y en cada PR contra esta rama.

## Cómo se mantiene al día

El código de producto se hace en `develop_optical_storepos`; esta rama **solo lo recibe**:

```bash
git switch tenant-deploy
git merge origin/develop_optical_storepos     # merge, nunca rebase: la rama es pública
pnpm tenant vercel --check                    # vercel.json y fichas siguen coincidiendo
pnpm check:tenant
git push
```

Si el merge choca en `apps/capri-storefront/vercel.json`, se toma la versión de `develop_optical_storepos` y se vuelve a ejecutar `pnpm tenant vercel` para regenerar las reescrituras `/medusa-t-*`.

Después de cada merge, cada óptica se actualiza al redesplegar: **Deploy** en su app de Coolify (o webhook automático) y Vercel recompila solo. Las migraciones de base de datos corren al arrancar el backend.

Nada de esta rama vuelve a `develop_optical_storepos`: una corrección de código se hace allí y llega aquí con el merge.

**Hacia `develop` sí (decisión del dueño, 20-nov-2026)**: `tenant-deploy` es la versión con soporte multi-óptica y es la que debe quedar en `develop` (www.rubilens.com). El flujo es de un solo sentido y siempre por pull request con los checks en verde:

```
develop_optical_storepos  ──merge──▶  tenant-deploy  ──PR──▶  develop
```

Lo que hace seguro llevarla a `develop`:

- **La web de RUBI LENS sigue en el backend del panel**: el proyecto de Vercel de www.rubilens.com lleva `BACKEND_TARGET_OVERRIDE=staging` (Production **y** Preview). `backend-target.mjs` lo respeta para RUBI LENS y El Rancho y lo **rechaza** para una óptica nueva, que siempre usa su `/medusa-t-<slug>`. La variable nunca va en el código ni en una ficha (`check-vercel-config.mjs` lo impide).
- **La marca de `develop` sigue siendo RUBI LENS**: sin `TENANT_FILE`, `develop` y `main` compilan con `tenants/rubi-lens/tenant.json`.
- Las fichas de ópticas nuevas y sus reescrituras `/medusa-t-*` viajan también a `develop`: son configuración que la web de RUBI LENS no usa.
- El backend de `develop` no se despliega (Coolify despliega `main` y `develop_optical_storepos`), así que el código de backend que llega a `develop` no cambia nada en vivo.

Antes de fusionar el PR a `develop`, abrir su vista previa de Vercel y comprobar `/medusa-staging/version` (el commit del backend del panel), el catálogo con los precios de la tienda online, el carrito hasta Stripe (sin pagar) y que la marca y el pie son los de RUBI LENS.

## Alta de una óptica, en resumen

```bash
git switch tenant-deploy
pnpm tenant new <slug> --name "…" --domain <dominio> --owner <correo> --timezone America/New_York
# completar tenants/<slug>/tenant.json y el logo
pnpm tenant validate <slug>
pnpm tenant vercel                     # reescritura /medusa-t-<slug>
git add tenants/<slug> apps/capri-storefront/vercel.json && git commit && git push
pnpm tenant checklist <slug>           # el resto, paso a paso, con los valores de esta óptica
pnpm tenant env <slug> --target backend --with-secrets   # pegar en Coolify
pnpm tenant env <slug> --target storefront               # pegar en Vercel
```

Detalle completo: [MULTI-TENANT.md](MULTI-TENANT.md) y [MULTI-TENANT-TECNICO.md](MULTI-TENANT-TECNICO.md) §11.
