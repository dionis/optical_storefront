# Notas del frontend (Óptica El Rancho / RUBI_LENS) — rama `frontend`

> Autor: trabajo del storefront (`apps/capri-storefront`) y del servicio de catálogo.
> **No se tocó el backend de Dionis ni el despliegue.** Lo de abajo son *observaciones*
> para que Dionis decida; no se aplicó ningún cambio en `apps/backend` ni en infra.

## Alcance de lo trabajado (solo frontend + servicio de catálogo)
- Storefront React/Vite en `apps/capri-storefront` (puerto **5198**).
- Servicio de catálogo `apps/capri-storefront/scripts/sync-catalog.mjs` (Node, sin deps)
  + `.github/workflows/catalog-sync.yml` + `scripts/Dockerfile` (cloud-ready, SaaS).
- La tienda lee `public/catalog.json` / `cases.json` en runtime (`src/data/catalogStore.js`).

## Errores / incongruencias encontradas

### Datos de origen (caprioptics.com)
1. **Precios no disponibles (B2B).** La Store API devuelve `is_purchasable:false`,
   `prices.price:"0"` y `regular_price:"100"` para las monturas. Por eso el storefront usa
   **precios/rating demo deterministas por SKU**. Para producción hace falta una fuente real
   de precios (pricing del backend Medusa o un feed autorizado por Capri).
2. **Imágenes por color.** La Store API entrega **solo la imagen destacada** por producto;
   las imágenes por color viven en las *variaciones*/galería. El servicio las resuelve por
   coincidencia de nombre + caché del catálogo previo y solo baja la galería HTML de modelos
   nuevos. Si Capri cambia el patrón de nombres de archivo, algún color podría caer a la
   imagen destacada.
3. **Atributos faltantes en origen.** Algunos modelos no traen `Shape` (p. ej. MARSHA, ISAAC);
   se omite el campo con elegancia (no rompe filtros). Otros traen `Age` compuesto
   ("Adult, High-School-To-College") → se normaliza a "Adulto".
4. **Nomenclatura inconsistente de SKU.** Candy Shoppe aparece en la API como `39061` pero en
   capturas previas como `YC39061` (con prefijo `YC`). El servicio usa como fuente de verdad la
   API; por eso el catálogo del día puede mostrar el nombre "39061". Conviene confirmar con Capri
   cuál es el código oficial.
5. **Imágenes del CDN bloqueadas desde entornos cloud.** El CDN de caprioptics puede no cargar
   desde sandboxes/hosts sin allowlist (salen en blanco). En la máquina local cargan bien. Para
   el SaaS conviene **rehospedar/cachear las imágenes** (bucket/CDN propio) en vez de hotlink.

### Backend / infra (SOLO observado durante el arranque inicial — NO modificado por mí)
> Estas notas son de cuando se levantó el monorepo al inicio de la sesión; las dejo por si le
> sirven a Dionis. **No cambié ningún archivo del backend en este trabajo.**
- **Node:** Medusa v2 requiere **Node 22**; el sistema tiene Node 24. El storefront y el
  servicio de catálogo funcionan en 24, pero el backend necesitó Node 22 portable.
- **Medusa CLI:** faltaban `ts-node`/`tsconfig-paths`; el type-check de ts-node fallaba
  → se usó `TS_NODE_TRANSPILE_ONLY=true` + `experimentalResolver`.
- **pnpm:** el `node-linker` aislado rompía la resolución de módulos de Medusa
  → hizo falta `node-linker=hoisted` en `.npmrc`.
- **tsconfig del backend:** un override a CommonJS rompía los *subpath exports* de
  `@medusajs/framework` → hubo que heredar NodeNext del base.
- **Pagos (PayPal/Square):** hay *drift* de API contra Medusa 2.17; para compilar se envolvieron
  con `ModuleProvider` + `@ts-nocheck`. **Pendiente portarlos correctamente** (responsabilidad
  del backend).
- **Docker Desktop:** al iniciar dio "unable to get 'ProgramData'"; se resolvió relanzando con
  las variables `ProgramData`/`ALLUSERSPROFILE` seteadas.

## Limpieza aplicada (frontend)
- Se quitaron del repo archivos *scratch* del scraping que se habían colado en
  `apps/capri-storefront/` (`page1-3.html`, `prod/*.html`, `result.json`) y se añadieron al
  `.gitignore` para que no vuelvan a subir. **No se tocó** `index.html`, `package*.json`
  ni `public/*.json`.

## Pendientes sugeridos (para coordinar, no ejecutados)
- Conectar el storefront al backend Medusa (catálogo/carrito/precios reales) — lo lleva Dionis.
- Hospedar la SPA en CDN y publicar `catalog.json` en un bucket público
  (apuntar `VITE_CATALOG_URL`); parametrizar `CATALOG_SOURCE` por tenant para el SaaS.
- Rehospedar imágenes de producto en CDN propio (ver punto 5).
