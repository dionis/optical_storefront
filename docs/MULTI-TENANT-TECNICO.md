# Módulo Multi-Tenant — especificación técnica

_Versión 27/10/2026. Para el equipo de desarrollo. Parte de lo ya decidido en
[MULTI-TENANT.md](MULTI-TENANT.md) (un despliegue por óptica) y define todo lo que
falta para que dar de alta una óptica sea **rellenar una ficha y ejecutar un
comando**, y que después el dueño controle su tienda desde el panel sin tocar
código ni variables. La visión de producto está en [GUIA-GENERAL.md](GUIA-GENERAL.md)._

---

## 1. Objetivo y criterio de "terminado"

**Objetivo.** Un módulo "kit de inquilino" con tres partes:

1. **Ficha** (`tenants/<slug>/tenant.json` + recursos de marca) validada por esquema.
2. **Herramienta de alta** (`pnpm tenant …`) que genera la configuración de cada app
   a partir de la ficha y guía el aprovisionamiento.
3. **Perfil editable y traspaso de propiedad** en el backend: lo que el dueño
   cambia después de la entrega vive en base de datos y se edita en el panel.

**Terminado cuando:**

- Se puede levantar una segunda óptica (`demo-optica`) **sin editar ningún archivo
  de `apps/`**: solo `tenants/demo-optica/` + variables en Coolify/Vercel.
- `pnpm check:tenant` (dentro de `pnpm test`) falla si aparece "RUBI LENS",
  `rubilens` o `caprioptics` fuera de los valores por defecto permitidos.
- El dueño entra con un enlace de activación, queda como `owner` y puede
  transferir la propiedad; el usuario técnico que montó la tienda no es dueño.
- La pestaña **Seguridad** incluye un bloque "Configuración de la óptica" en verde.

## 2. Decisión de arquitectura (se mantiene)

**Silo por inquilino**: cada óptica tiene su backend Medusa + Postgres + Redis
(Coolify), su storefront (proyecto Vercel), su Stripe, su hoja, sus buckets y su
dominio de correo. El código es uno solo (`main`).

Se descarta otra vez el multi-tenant en una sola base (`tenant_id` en cada tabla):

| Criterio | Silo (elegido) | Base compartida |
|---|---|---|
| Recetas (PHI) | aisladas por base y bucket | mezcladas; un filtro olvidado = fuga |
| Medusa v2 | sin cambios | no modela inquilinos: habría que tocar cada ruta, workflow, job y subscriber |
| Coste por óptica | ~€4–10/mes | menor a partir de decenas de ópticas |
| Despliegue | N apps a actualizar | una |
| Riesgo de migración | por óptica | todas a la vez |

**Revisar la decisión** si se superan ~20 ópticas: el coste operativo de N
despliegues pasa a dominar y conviene un plano de control que hable con la API de
Coolify (fase 5), no una base compartida.

**No confundir** con las **sucursales** (`establishment`, ya implementadas): son
tiendas físicas _dentro_ de una misma óptica y comparten base, catálogo y Stripe.

## 3. Capas de configuración

Toda dato de inquilino pertenece a **una** de tres capas. La regla para decidir:
_¿quién lo cambia después de la entrega, y necesita redespliegue?_

| Capa | Dónde | Quién la cambia | Requiere redespliegue | Ejemplos |
|---|---|---|---|---|
| **A. Compilación** | `VITE_*` en Vercel, generado desde la ficha | nosotros | sí (storefront) | nombre en `<title>`/OG, logo, favicon, paleta, URL del API |
| **B. Despliegue** | variables de Coolify, generadas desde la ficha | nosotros | sí (backend) | secretos, claves de Stripe/Resend/Twilio/R2, dominio, zona horaria, moneda, país |
| **C. Ejecución** | tablas del backend, editadas en el panel | **el dueño** | no | correo/teléfono de soporte, dirección de recogida y horario, redes, avisos, envíos, precios, impuestos, proveedor de pago activo |

Precedencia de lectura en el backend: **C → B → valor por defecto**. Ya es el patrón
de `store-settings` y `ocr-config`; `tenant()` debe adoptarlo.

## 4. Estado actual

### 4.1 Ya parametrizado

| Pieza | Archivo | Variables |
|---|---|---|
| Identidad backend | [apps/backend/src/lib/tenant.ts](../apps/backend/src/lib/tenant.ts) | `STORE_NAME`, `TENANT_LEGAL_NAME`, `STOREFRONT_URL`, `STORE_SUPPORT_EMAIL`, `GSHEET_TIMEZONE`, `STORE_NOTIFICATION_LOCALE`, `TENANT_CURRENCY`, `TENANT_COUNTRY`, `TENANT_SMS_PREFIX` |
| Identidad storefront | [apps/capri-storefront/src/config/tenant.js](../apps/capri-storefront/src/config/tenant.js) | `VITE_TENANT_NAME`, `_TAGLINE`, `_LOGO`, `_LOGO_MARK`, `_IMAGE_CREDIT` |
| Ajustes del dueño (capa C) | `store-settings` (`store_setting`) | avisos, soporte, proveedor de pago, impuesto de montura |
| OCR (capa C) | `ocr-config` | modelo, escalado, tamaño |
| POS (capa C) | `pos` → `pos_setting` | límites de descuento, umbrales ópticos |
| Precios por sucursal (capa C) | `store-pricing` → `store_price_rule` | reglas con vigencia |
| Costos (capa C) | `costing`, `store-cost` | reglas y costos fijos |
| Proveedores opcionales | [apps/backend/medusa-config.ts](../apps/backend/medusa-config.ts) | Resend/Twilio/R2 se registran solo con credenciales; el backend arranca siempre |
| Comprobación | `GET /admin/security-status` | semáforo sin valores |

### 4.2 Lo que todavía es de RUBI LENS o de Capri (inventario)

Búsqueda: `RUBI ?LENS|rubilens|caprioptics` (≈130 apariciones en 45 archivos,
la mitad en documentación). Las de código:

| # | Dónde | Qué | Capa destino | Arreglo |
|---|---|---|---|---|
| 1 | `apps/capri-storefront/index.html` | `<title>`, description, OG/Twitter, `preconnect` a `api.rubilens.com` | A | plugin de Vite `tenantHtml()` que sustituye `%TENANT_*%` |
| 2 | `public/site.webmanifest`, `public/favicon.svg`, `public/logo-oficial*.png` | nombre e iconos | A | `pnpm tenant brand` copia `tenants/<slug>/assets/` a `public/` en el build |
| 3 | `src/i18n/translations.js` (`home.collage.title`, `vm.ad1`, `vm.shareText`, `footer.about`, `footer.rights`, `adm.sec.h.urls.storefront_https`, ×2 idiomas) | marca en el copy | A | placeholder `{store}` / `{domain}` interpolado por `t()` con `TENANT` |
| 4 | `src/pages/Home.jsx:120,157,246,257` | marca literal en el hero y el SEO | A | `TENANT.name`, `TENANT.tagline` |
| 5 | `src/pages/Home.jsx:12`, `src/data/brandMedia.js` | imágenes del hero enlazadas a caprioptics.com | A | `TENANT.heroMedia` (lista de URLs en la ficha) |
| 6 | `src/pages/LensProcess.jsx:1239`, `src/components/TryOnStudio.jsx:1078,1191,1793` | logo y nombre en el pie de las capturas | A | `TENANT.logo` / `TENANT.name` |
| 7 | `src/styles/index.css` (`--navy`, `--primary-blue…`, etapa 106), `src/admin/admin.css` | paleta | A | tokens `--brand-primary/-accent/-ink` generados en `tenant.css` |
| 8 | `src/admin/priceStore.js` (`DEFAULT_SHIPPING.pickup`, `origin`, `zones`) | dirección "Fry Rd, Katy", zonas, transportistas — **guardado en `localStorage`** | **C** | mover a backend (`tenant_profile.pickup`, `shipping_setting`) y leer por `GET /store/tenant`; el servidor ya cobra con `SHIPPING_*` |
| 9 | `apps/capri-storefront/vercel.json` | rewrite `/medusa/*` a un host fijo | A | `vercel.ts` con `process.env.TENANT_API_ORIGIN` (y mantener el de la raíz en paralelo) |
| 10 | `apps/backend/src/lib/email/order-confirmation.ts:106-114` | `NAVY`, `GOLD`… | B | `tenant().brand` (`TENANT_BRAND_PRIMARY`, `TENANT_BRAND_ACCENT`) |
| 11 | `apps/backend/src/lib/email/order-images.ts:68` | `@rubilens` en el Content-ID | B | dominio de `STOREFRONT_URL` |
| 12 | `apps/backend/src/api/vision-measure/notify/route.ts:75` | asunto por defecto "RUBILENS" | B | `tenantName()` |
| 13 | `apps/vto-web/index.html`, `report.html`, `src/i18n.ts` | "TRY ON RUBILENS" | A | `VITE_TENANT_NAME` en el build de `vto-web` (ya se compila dentro del storefront) |
| 14 | `apps/vto-web/src/*` claves `rubilens.*` de `localStorage` | prefijo | — | **no tocar**: son por origen (cada óptica tiene dominio propio); renombrarlas borra preferencias |
| 15 | `apps/vision-measure/services/api/vision_api.py:65,152,481`, `config.py:198` | título, lista de hosts permitidos, texto del correo, `X-Title` | B | `TENANT_NAME`, `SUPPLIER_IMAGE_HOSTS` |
| 16 | `apps/vision-measure/services/vision_measure/capri_prompt.py` | prompt atado a fichas de caprioptics | B | parte del adaptador de proveedor (§8) |
| 17 | `apps/scraper/scraper/config.py:125` (`base_url`), `parser.py` (WooCommerce) | proveedor | B | `SUPPLIER_BASE_URL` + adaptador |
| 18 | `apps/capri-storefront/.github/workflows/catalog-sync.yml` | `CATALOG_SOURCE` fijo | B | variable del repositorio/entorno por inquilino |
| 19 | `apps/capri-storefront/src/data/products.js`, `cases.js`, `public/cases.json` | catálogo estático de Capri | A | `VITE_CATALOG_URL` por inquilino (ya existe en `catalogStore.js`) |
| 20 | `publicar-optica.bat`, `publicar-backend.bat` | títulos | — | cosmético; leer `tenants/<slug>/tenant.json` o dejar genérico |

### 4.3 Brecha funcional crítica: el traspaso de propiedad

Hoy **dueño = usuario admin más antiguo**
([staff-scope.ts:42](../apps/backend/src/lib/staff-scope.ts#L42),
[team/route.ts](../apps/backend/src/api/admin/team/route.ts)). Si nosotros creamos el
primer usuario al montar la tienda, **nosotros quedamos como dueño para siempre** y
el dueño real no puede nombrar superadmins. Es el bloqueo principal para "dar el
control al dueño" y se resuelve en §7.

## 5. Componentes del módulo

```
tenants/
  _schema/tenant.schema.json      # esquema (generado desde packages/shared)
  rubi-lens/                      # el inquilino actual, como referencia
    tenant.json
    assets/  logo.png  logo-mark.png  favicon.svg  og.jpg
  demo-optica/                    # inquilino de prueba para CI
packages/shared/src/tenant.ts     # tipo TenantManifest + validador (zod) + defaults
scripts/tenant/                   # CLI `pnpm tenant`
apps/backend/src/modules/tenant-profile/   # capa C de identidad
apps/backend/src/api/admin/tenant/         # GET/POST perfil, POST transfer-owner
apps/backend/src/api/store/tenant/         # GET perfil público
apps/backend/src/scripts/tenant-bootstrap.ts
apps/capri-storefront/vite-plugin-tenant.js
apps/capri-storefront/vercel.ts
```

Nada secreto entra en `tenants/`. Los secretos se generan en la máquina del
operador y se pegan en Coolify/Vercel; `tenants/*/.secrets*` va en `.gitignore`.

## 6. Ficha del inquilino (`tenant.json`)

Única fuente para las capas A y B y semilla inicial de la C.

```jsonc
{
  "$schema": "../_schema/tenant.schema.json",
  "slug": "rubi-lens",                       // [a-z0-9-], nombre de buckets y apps
  "identity": {
    "name": "RUBI LENS",
    "legalName": "RUBI LENS LLC",
    "tagline": { "es": "Óptica y Salud Visual", "en": "Optics & Vision Care" },
    "description": { "es": "…", "en": "…" }  // SEO
  },
  "domains": {
    "storefront": "https://www.rubilens.com",
    "api": "https://api.rubilens.com",
    "emailFrom": "pedidos@rubilens.com"
  },
  "locale": { "default": "es", "timezone": "America/Chicago", "currency": "usd", "country": "us" },
  "brand": {
    "primary": "#0b2f66", "accent": "#b8921e", "info": "#0e5ad0", "danger": "#d6123e",
    "fonts": { "display": "Fraunces", "body": "Inter" },
    "logo": "assets/logo.png", "logoMark": "assets/logo-mark.png",
    "favicon": "assets/favicon.svg", "ogImage": "assets/og.jpg",
    "heroMedia": ["https://…/hero-1.jpg"]
  },
  "contact": {                                // semilla capa C
    "supportEmail": "soporte@rubilens.com",
    "ownerNotificationEmail": "…", "ownerNotificationSms": "+1…",
    "adminNotificationEmails": ["…"],
    "social": { "instagram": "…", "facebook": "…", "whatsapp": "+1…" }
  },
  "pickup": {                                 // semilla capa C
    "enabled": true, "name": "RUBI LENS", "address": "Fry Rd, Katy, TX 77449",
    "hours": { "es": "Lun–Sáb 9:00–19:00", "en": "Mon–Sat 9am–7pm" }
  },
  "commerce": {
    "paymentProvider": "stripe",               // stripe | paypal | square | manual
    "frameTaxRate": 0.0825,
    "shipping": { "flatRate": 28, "etaDays": 4, "freeThreshold": 59 },
    "labBusinessDays": 10
  },
  "supplier": {
    "adapter": "woocommerce",                  // §8
    "baseUrl": "https://caprioptics.com",
    "imageHosts": ["caprioptics.com"],
    "imageCredit": "caprioptics.com"
  },
  "features": { "tryOn": false, "discounts": false, "mediaReview": false, "sms": true, "whatsapp": false },
  "owner": { "email": "dueno@rubilens.com", "name": "…" }
}
```

Reglas del validador (`packages/shared/src/tenant.ts`, con tests):

- URLs `https://` (salvo `localhost`), `slug` único, colores `#rrggbb` con
  contraste AA del texto sobre `primary` (si no, error con el ratio).
- `currency`/`country` ISO; `timezone` IANA válida (`Intl.supportedValuesOf`).
- `tagline`/`description`/`hours` con `es` y `en` (misma regla que `check:i18n`).
- Recursos referenciados existen y pesan < 300 KB.
- `labBusinessDays` debe coincidir con el texto del correo (`lib/email/copy.ts`)
  → mientras ese texto sea fijo, el validador avisa si es ≠ 10.

## 7. Backend

### 7.1 Módulo `tenant-profile` (capa C)

Mismo patrón que `store-settings`: una fila, `id = "default"`.

```ts
export const TenantProfile = model.define("tenant_profile", {
  id: model.id().primaryKey(),
  display_name: model.text().nullable(),
  support_email: model.text().nullable(),     // migrar desde store_setting.support_email
  support_phone: model.text().nullable(),
  whatsapp: model.text().nullable(),
  social: model.json().nullable(),
  pickup: model.json().nullable(),            // { enabled, name, address, hours:{es,en}, maps_url }
  shipping_origin: model.json().nullable(),
  shipping_zones: model.json().nullable(),    // hoy en priceStore.js / localStorage
  legal: model.json().nullable(),             // textos de privacidad/devoluciones por idioma
  owner_user_id: model.text().nullable(),     // §7.2
  setup_completed_at: model.dateTime().nullable(),
  updated_by: model.text().nullable(),
});
```

- `src/lib/tenant.ts` pasa a `async resolveTenant(container)` con caché de 60 s
  (como `resolveStoreSettings`), precedencia C → B → defecto. `tenant()` síncrono
  se conserva para quien no tiene contenedor (solo B + defecto).
- Rutas:
  - `GET /store/tenant` — subconjunto público (nombre, soporte, redes, recogida,
    zonas de envío **solo para mostrar**). Cabecera `Cache-Control: public, max-age=300`.
  - `GET/POST /admin/tenant` — solo `owner`/`superadmin` (`staff-guard`). Errores con
    `reason` (`adm.err.tenant.<reason>`).
- El cobro de envío **sigue** saliendo del servidor (`shipping-rates.ts`): si las
  zonas pasan a cobrarse, `shipping-rates.ts` lee `shipping_zones`, nunca el
  navegador (regla "never trust client-side totals").

### 7.2 Propiedad explícita y traspaso

1. `owner_user_id` en `tenant_profile`. `staff-scope.ts` resuelve dueño =
   `owner_user_id ?? usuario más antiguo` (compatibilidad: RUBI LENS sigue igual
   sin migrar datos).
2. **Arranque** (`src/scripts/tenant-bootstrap.ts`, `medusa exec`, idempotente):
   - crea región/moneda/país, canal de venta y publishable key desde la ficha;
   - siembra `tenant_profile`, `store_setting`, `pos_setting`, reglas de costo;
   - crea el usuario técnico `soporte+<slug>@…` con rol `superadmin`;
   - crea el usuario del dueño con contraseña temporal y `must_change_password`
     (mismo mecanismo que `POST /admin/team`) **o** una invitación con
     `createInvitesWorkflow` de `@medusajs/core-flows` 2.17 (existe
     `dist/invite/workflows/create-invites` y `accept-invite`; revisar sus tipos
     antes de usarlos). Recomendado: invitación — el operador nunca conoce la
     contraseña del dueño;
   - fija `owner_user_id` al aceptar.
3. **Transferencia**: `POST /admin/tenant/transfer-owner { user_id }` — solo el
   dueño actual; exige reautenticación (contraseña) y deja al anterior como
   `superadmin`. Registro en `audit`. Correo a ambos.
4. Regla nueva en `staff-roles.ts`: el dueño puede retirar al usuario técnico
   (`superadmin`) — así "dar el control" incluye poder echarnos.

### 7.3 Asistente "Primeros pasos"

Pestaña del panel visible para el dueño mientras `setup_completed_at` sea nulo:

1. Datos de contacto y redes → `tenant_profile`.
2. Avisos (correos, SMS) → `store_setting`.
3. Recogida en tienda y zonas de envío.
4. Precios: confirmar o importar (`PriceImport.jsx` ya existe).
5. Sucursales y equipo (ya existen).
6. Revisión: el semáforo de `security-status` + "Configuración de la óptica"
   (perfil completo, dueño ≠ usuario técnico, compra de prueba registrada).

Todo el copy con claves `adm.setup.*` en `es` y `en`.

### 7.4 Otros cambios de backend

- `security.ts`: añadir comprobaciones `tenant_profile_complete`,
  `owner_is_not_operator`, `storefront_matches_cors` (dominio de
  `STOREFRONT_URL` presente en `STORE_CORS`).
- Correos: paleta y logo desde `tenant()`; quitar `@rubilens` (§4.2 #10–12).
- `gsheet-sync.ts`: ya usa `tenant()`; añadir el nombre de la óptica al título del
  documento al crearlo.
- `infra/scripts/backup.sh`: parametrizar por `TENANT_SLUG` (prefijo del objeto).
- Meilisearch: índice `frames` fijo. Con una instancia por óptica no cambia; si se
  comparte instancia, `FRAMES_INDEX_NAME` = `${TENANT_SLUG}_frames` y una clave
  restringida a ese índice por óptica.

## 8. Catálogo y proveedor

El catálogo es lo menos genérico: el scraper y el prompt de medición asumen
WooCommerce de caprioptics.com.

- Interfaz `SupplierAdapter` en `apps/scraper/scraper/adapters/` con
  `list_products()`, `fetch_product(slug)`, `image_urls()`. `woocommerce` =
  el código actual (`parser.py`, `http_client.py`) con `base_url` desde
  `SUPPLIER_BASE_URL`.
- Adaptador `csv` para ópticas sin web de proveedor (plantilla de columnas = la de
  `price-import.ts`).
- Si dos ópticas usan el mismo proveedor, el catálogo puede generarse una vez y
  publicarse en un JSON compartido (`VITE_CATALOG_URL`); los **precios nunca** se
  comparten (cada óptica, sus reglas).
- `vision-measure`: `SUPPLIER_IMAGE_HOSTS` y `SUPPLIER_PRODUCT_URL_TEMPLATE`
  sustituyen las constantes de `capri_prompt.py`.

## 9. Storefront y apps web

- `vite-plugin-tenant.js`: lee `TENANT_FILE` (ruta a `tenant.json`, por defecto
  `tenants/rubi-lens/tenant.json`), expone `import.meta.env.VITE_TENANT_*`,
  sustituye `%TENANT_*%` en `index.html`, genera `site.webmanifest` y
  `src/styles/tenant.css` (tokens `--brand-*`) y copia `assets/` a `dist/`.
- `config/tenant.js` gana `brand`, `heroMedia`, `domain`, `social` y una función
  `loadRuntimeTenant()` que pide `GET /medusa/store/tenant` y mezcla la capa C
  (recogida, soporte) sin bloquear el render.
- `t(key, vars)`: interpolación `{store}` por defecto con `TENANT.name`; añadir a
  `check:i18n` que una clave con `{store}` en un idioma lo tenga en el otro.
- `priceStore.js`: `load()/save()` pasan al API (`/admin/tenant` para recogida y
  zonas; `store-pricing` para precios). El propio archivo ya lo anticipa ("this
  module is the single seam").
- `vercel.ts` en `apps/capri-storefront` (y copia en la raíz):
  `routes.rewrite('/medusa/(.*)', \`${process.env.TENANT_API_ORIGIN}/$1\`)` y la
  CSP/cabeceras actuales. `TENANT_API_ORIGIN` y `TENANT_FILE` se fijan por proyecto
  Vercel.
- `vto-web`: `VITE_TENANT_NAME` en `index.html`/`report.html`/`i18n.ts` dentro de
  `scripts/vercel-build.sh`.

## 10. Herramienta `pnpm tenant`

| Comando | Hace |
|---|---|
| `tenant new <slug>` | copia `tenants/_template/`, pregunta lo mínimo (nombre, dominio, correo del dueño) |
| `tenant validate <slug>` | esquema + recursos + contraste; código ≠ 0 si falla (CI) |
| `tenant env <slug> --target backend\|storefront` | imprime el bloque de variables para Coolify/Vercel; genera `JWT_SECRET`, `COOKIE_SECRET`, `ORDER_ACCESS_SECRET`, `SELLER_LINK_SECRET`, `VISION_INTERNAL_SECRET` (32 bytes aleatorios) solo si se pide `--with-secrets`; nunca los escribe en el repo |
| `tenant checklist <slug>` | imprime el alta paso a paso (§11) con los valores ya sustituidos (URL del webhook de Stripe, buckets, registros DNS) |
| `tenant bootstrap <slug>` | instrucciones para `medusa exec src/scripts/tenant-bootstrap.ts` en la terminal de Coolify |
| `tenant list` | inquilinos, dominios y commit desplegado (lee `SOURCE_COMMIT` del health) |

Fase 5 (opcional): `tenant provision` y `tenant deploy-all` con las APIs de Coolify,
Cloudflare (R2, DNS), Vercel, Stripe (`webhook_endpoints.create`) y Resend
(dominios). Solo cuando el número de ópticas lo justifique.

## 11. Alta de una óptica (flujo completo)

1. `pnpm tenant new <slug>` → completar `tenant.json` y `assets/`; `pnpm tenant validate`.
2. Cuentas del dueño: Stripe (modo live), dominio, Google (hoja), Twilio opcional.
3. Infra: app Coolify desde `main` + Postgres + Redis; `pnpm tenant env --target backend --with-secrets` → Coolify; dominio `api.<dominio>`.
4. R2: buckets `<slug>-assets` (público) y `<slug>-rx` (privado); Resend: dominio verificado.
5. Stripe: webhook a `https://api.<dominio>/hooks/payment/stripe_stripe` → `STRIPE_WEBHOOK_SECRET`.
6. Hoja: crear y compartir con la cuenta de servicio → `GSHEET_*`.
7. `medusa exec src/scripts/tenant-bootstrap.ts` (región, canal, publishable key, semillas, invitación al dueño).
8. Vercel: proyecto con Root Directory `apps/capri-storefront`, `TENANT_FILE`, `TENANT_API_ORIGIN`, `VITE_MEDUSA_PUBLISHABLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`; dominio `www.<dominio>`.
9. Catálogo: `python -m scraper sync --full` con el adaptador del proveedor; `pnpm reindex`.
10. Verificación: Seguridad en verde, compra real + reembolso, correo y SMS recibidos, fila en la hoja, cambio de estado desde la hoja.
11. Traspaso: el dueño acepta la invitación → asistente "Primeros pasos" → `setup_completed_at`.

## 12. Versiones y despliegues

- Un solo `main`; nunca ramas por cliente. Diferencias = ficha + capa C.
- Las migraciones corren al arrancar cada backend; un cambio de esquema debe ser
  compatible hacia atrás durante el despliegue escalonado (añadir columnas
  nulables, no renombrar).
- Orden de despliegue recomendado: `demo-optica` → RUBI LENS → resto.
- CI: matriz `tenant validate` sobre todos los `tenants/*`, y build del storefront
  con `TENANT_FILE=tenants/demo-optica/tenant.json` para detectar marca fija.

## 13. Pruebas

| Prueba | Tipo |
|---|---|
| Esquema y validador de la ficha (casos válidos e inválidos, contraste) | unidad, `packages/shared` |
| Precedencia C → B → defecto de `resolveTenant` | unidad, backend |
| Dueño explícito vs. más antiguo; transferencia; el dueño puede retirar al técnico | unidad (`staff-roles`) + integración |
| `tenant-bootstrap` idempotente (dos ejecuciones = mismo estado) | integración |
| `check:tenant`: sin literales de marca fuera de defaults | script en `pnpm test` |
| `{store}` en ambos idiomas | `check:i18n` |
| Build de `demo-optica`: `dist/index.html` sin "RUBI LENS" | CI |

## 14. Seguridad y cumplimiento

- Recetas: bucket privado por óptica, URLs prefirmadas (sin cambios).
- Secretos únicos por óptica; rotar `ORDER_ACCESS_SECRET` o `SELLER_LINK_SECRET` de
  una óptica no afecta a otra.
- Acuerdo de tratamiento de datos con cada dueño: él es responsable de los datos
  de sus pacientes; nosotros, encargados. El usuario técnico debe poder ser
  retirado por el dueño (§7.2).
- Las claves de IA (Anthropic/OpenAI/Gemini) pueden ser nuestras o del dueño;
  decidir por contrato. Si son nuestras, límites por óptica (`OCR_RATE_LIMIT_PER_HOUR`,
  `VISION_PROXY_*`, `FRAME_MEDIA_*_USD`) y facturación del consumo.

## 15. Plan por fases

| Fase | Entregable | Esfuerzo aprox. |
|---|---|---|
| **1. Ficha y marca** | `TenantManifest` + validador, `tenants/rubi-lens`, `vite-plugin-tenant`, `{store}` en traducciones, inventario §4.2 #1–7, 10–13, `check:tenant` | 3–4 días |
| **2. Propiedad y perfil** | módulo `tenant-profile`, `resolveTenant`, `owner_user_id`, transferencia, rutas `/admin/tenant` y `/store/tenant`, migración de `support_email` | 3 días |
| **3. Alta guiada** | `pnpm tenant new/validate/env/checklist`, `tenant-bootstrap.ts`, `vercel.ts`, asistente "Primeros pasos", comprobaciones nuevas en Seguridad | 4–5 días |
| **4. Proveedor** | `SupplierAdapter` (woocommerce + csv), variables de `vision-measure`, `priceStore` al backend | 3–4 días |
| **5. Automatización (opcional)** | `tenant provision`/`deploy-all` con APIs de Coolify, Cloudflare, Vercel, Stripe, Resend | 5+ días |

Criterio de salida de cada fase: RUBI LENS se despliega idéntica (sin cambios
visibles) y `demo-optica` compila y arranca.

## 16. Preguntas abiertas para el negocio

1. ¿Quién paga la infra y la IA de cada óptica: cuota fija, por uso o claves propias del dueño?
2. ¿Se permite que dos ópticas compartan proveedor y catálogo base?
3. ¿El dueño puede cambiar su paleta y logo desde el panel (implica pasar marca a capa C y servirla en tiempo de ejecución) o basta con pedírnoslo?
4. ¿Idiomas adicionales (el catálogo ya traduce a `fr`)?
5. ¿Plan de salida: exportación de datos y entrega de la base si una óptica se va?
