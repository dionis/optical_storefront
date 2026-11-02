# Sincronización del catálogo — scraper mensual y a demanda

Cómo corre el scraper de caprioptics.com en producción, cómo lo maneja el dueño
desde `/admin` y cómo se despliega en Coolify.

## Qué hace una corrida

1. **Scraping** (`scraper sync`): lee las colecciones del proveedor, crea los modelos
   nuevos en Medusa, actualiza los que cambiaron (precio, stock, fotos, medidas,
   traducción) y salta los que no cambiaron (caché `state.db`). En una **revisión
   completa** reprocesa todo y pasa a borrador lo que el proveedor ya no tiene.
2. **Las 4 vistas** (frente, perfil izquierdo, perfil derecho, trasera) **de los
   modelos nuevos** de esa corrida: se ponen en la cola de `frame-media` (gratis) y, si
   el tope de la corrida es mayor que 0 y hay `GEMINI_API_KEY` + R2, se generan hasta
   ese tope y se publican (variantes en Medusa + manifiesto del storefront, sin
   desplegar). Los estuches (`case`) nunca. El techo mensual de Medios sigue mandando en
   el servidor, así que un tope mal puesto no puede pasarse del mes.
3. **Resumen** a Medusa: encontrados, **nuevos** (con miniatura), actualizados, sin
   cambios, fallidos, retirados, vistas generadas y su costo, errores y las últimas
   400 líneas del registro.

## Quién decide cuándo

Medusa, no el scraper. El worker es tonto a propósito: pregunta cada minuto si hay
algo en cola y lo ejecuta.

| Disparo | Quién lo pone en cola |
|---|---|
| **Mensual** | El job `catalog-sync-schedule` del backend (cada 15 min comprueba si llegó el día/hora del dueño; por defecto el 1, 06:00 UTC). Una sola corrida por mes (índice único `schedule_slot`). Si el backend estuvo caído a esa hora, la encola hasta 48 h después; activar la programación a mitad de mes no dispara una corrida sorpresa. |
| **A demanda** | Botón «Ejecutar ahora» en `/admin` → Catálogo → Sincronización. Opciones: una colección, revisión completa, tope de las vistas. |

Una corrida a la vez: con otra en cola o en curso el botón responde 409 `run_active`.
«Detener» cancela al momento una corrida en cola, y una en curso para antes del
siguiente modelo (lo ya actualizado se queda; no se retira nada).

Si el worker deja de latir 20 min, el job marca la corrida `failed / worker_lost`.
El panel muestra «Worker sin conexión» si no ha preguntado en 3 min.

### Por qué no las «Scheduled Tasks» de Coolify

Coolify puede ejecutar un comando con cron dentro de un contenedor, y habría servido
para el «una vez al mes». Pero no da un botón al dueño, ni progreso, ni el resultado
de la última corrida, y la programación quedaría en Coolify en vez de en el panel.
Con el worker que sondea, todo eso vive en Medusa y el contenedor no expone ningún
puerto.

## Marca «Nuevo»

Al **crear** un producto, el scraper escribe `product.metadata.first_seen_at` (y
`first_seen_run`, la corrida). Los productos anteriores a esta función no la tienen,
así que no salen como nuevos. En `/admin` → Productos: etiqueta dorada «Nuevo»
durante 30 días (`NEW_MODEL_DAYS` en `src/admin/catalogSync.js`), primero en la
lista, y el filtro «Solo nuevos (N)». En el resultado de cada corrida, la rejilla de
modelos nuevos con su foto.

Para que la etiqueta sobreviva a las siguientes corridas, el scraper ahora **mezcla**
`metadata` en los updates: Medusa 2.17 la reemplaza entera, y antes cada re-sync
borraba las claves ajenas (también las `views` que `media sync` copia en las variantes).

## Desplegar el worker en Coolify

Una app nueva, aparte del backend (decisión: el scraper no va en la imagen del backend,
ver `docs/frame-media-generation.md` §C.7).

> **Por ahora solo en staging** (decisión del dueño, noviembre 2026): el worker y el
> backend con estas rutas se despliegan desde `develop_optical_storepos`, no desde
> `main`. El worker apunta al backend de staging
> (`https://api-staging.161-153-9-98.sslip.io`) y la vista de control es el `/admin`
> de la **vista previa de Vercel de esa rama**, que habla con staging por
> `/medusa-staging` (`backend-target.mjs`). Producción (`www.rubilens.com`, rama
> `develop`) no tiene esta pestaña hasta que se lleve allí.

1. **Backend primero.** Las tablas `catalog_sync_run` / `catalog_sync_setting` las crea
   `db:migrate` al arrancar el backend; las rutas llegan con el despliegue del backend de
   staging (rama `develop_optical_storepos`).
2. **Clave admin secreta** en Medusa (Settings → Secret API Keys). Es la misma clase de
   clave que usa el CLI (`MEDUSA_ADMIN_API_KEY`); las rutas del worker rechazan una
   sesión de usuario (`worker_only`).
3. **Coolify → New Resource → Application** desde el mismo repo, rama
   `develop_optical_storepos` (la del backend de staging), en el mismo proyecto/entorno
   que ese backend.
   - Build Pack: **Dockerfile**
   - Base Directory: `/`
   - Dockerfile Location: `/apps/scraper/Dockerfile`
   - **Sin dominio** y sin health check HTTP (no escucha en ningún puerto).
   - Nombre sugerido: `scraper-worker`.
4. **Persistent Storage**: un volumen montado en **`/data`** (ahí vive `state.db`). Sin
   él, cada redeploy empieza de cero: la siguiente corrida reprocesa todo el catálogo y
   vuelve a pagar la traducción.
5. **Variables de entorno** (mismos nombres que `apps/scraper/.env.example`):

   | Variable | |
   |---|---|
   | `MEDUSA_BACKEND_URL` | URL pública del backend (https); en staging `https://api-staging.161-153-9-98.sslip.io` |
   | `MEDUSA_ADMIN_API_KEY` | la clave del paso 2 |
   | `MEDUSA_SALES_CHANNEL_ID` | el canal de la tienda |
   | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_REGION`, `R2_PUBLIC_URL` | fotos y vistas. **En staging, un bucket distinto del de producción**: el paso de vistas reescribe `media/frame-media.json`, que la tienda de producción lee si comparten bucket |
   | `ANTHROPIC_API_KEY` | traducción es/fr (opcional) |
   | `GEMINI_API_KEY` | las 4 vistas (sin ella, solo se encolan) |
   | `SCRAPER_RATE_LIMIT`, `SCRAPER_USER_AGENT` | opcionales |
   | `SCRAPER_WORKER_ID` | opcional, nombre que se ve en el panel |

6. **Límite de memoria** recomendado: 768 MB (Resource Limits). El CX22 comparte RAM con
   Medusa, Postgres y Meilisearch. La imagen va **sin** el extra `tryon` (rembg); con
   `INSTALL_TRYON=1` como build arg se generan también los PNG del probador, a costa de
   ~500 MB más de imagen y de RAM durante la corrida.
7. **Sembrar la caché** (una vez, recomendado): copiar el `state.db` actual para que la
   primera corrida no lo reprocese todo:
   ```bash
   docker cp apps/scraper/state.db <contenedor-scraper-worker>:/data/state.db
   ```
8. Desplegar. En `/admin?tab=catalogsync` (Catálogo → Sincronización) de la vista
   previa de Vercel de la rama debe aparecer «Worker conectado»
   en menos de un minuto. Probar con «Ejecutar ahora» sobre una colección pequeña y tope
   de vistas 0.

El workflow de GitHub `scraper-sync.yml` ya no tiene cron (antes era diario): queda solo
como disparo manual de respaldo.

## Probar en local

```bash
# backend (aplica la migración del módulo catalog-sync)
pnpm dev:backend

# en otra terminal, el worker contra el backend local (apps/scraper/.env)
cd apps/scraper
uv run python -m scraper worker --once     # una sola consulta y sale
uv run python -m scraper worker            # bucle, como en Coolify
```

## Referencia rápida

| | |
|---|---|
| Rutas del panel | `GET /admin/catalog-sync` · `POST /admin/catalog-sync/runs` · `GET …/runs/:id` · `POST …/runs/:id/cancel` · `POST /admin/catalog-sync/settings` |
| Rutas del worker (clave secreta) | `POST /admin/catalog-sync/worker/claim` · `…/worker/runs/:id/progress` · `…/worker/runs/:id/finish` |
| Reglas (puras, con tests) | `apps/backend/src/lib/catalog-sync.ts` |
| Cola (SQL, `SKIP LOCKED`) | `apps/backend/src/lib/catalog-sync-data.ts` |
| Job | `apps/backend/src/jobs/catalog-sync-schedule.ts` |
| Worker | `apps/scraper/scraper/worker.py`, informe en `scraper/report.py` |
| Panel | `apps/capri-storefront/src/admin/CatalogSync.jsx` |
| Permisos | dueño y superadmin (ningún rol restringido tiene la ruta en su lista) |
