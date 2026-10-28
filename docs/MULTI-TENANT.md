# Multi-tenant: cómo se replica esta tienda para otro cliente

_Estado: preparación (22/10/2026). Hoy hay un solo inquilino (RUBI LENS)._

> Especificación completa del módulo (ficha `tenant.json`, traspaso de propiedad,
> `pnpm tenant`, plan por fases): [MULTI-TENANT-TECNICO.md](MULTI-TENANT-TECNICO.md).
> Visión de producto para dueños: [GUIA-GENERAL.md](GUIA-GENERAL.md).

## Modelo elegido: un despliegue por inquilino

Cada óptica recibe **su propia pila** construida desde este mismo repositorio:

| Pieza | Por inquilino | Por qué no se comparte |
|---|---|---|
| Backend Medusa (Coolify app) + Postgres + Redis | sí | aislamiento total de pedidos y **datos de salud** (recetas); un fallo o una migración no toca a otro cliente |
| Storefront (proyecto Vercel) + dominio | sí | marca, dominio y claves públicas distintas |
| Stripe | cuenta propia del cliente | el dinero entra en la cuenta del dueño, nunca pasa por D3E |
| Google Sheet + cuenta de servicio | sí | el dueño es el propietario de su hoja |
| Resend (dominio de correo) / Twilio | sí | reputación de envío separada; remitente con su dominio |
| R2 (imágenes públicas y bucket privado de recetas) | buckets propios | PHI separada por cliente |
| Código (este repo) | **compartido** | una sola base; las diferencias son configuración |

Se descartó el multi-tenant "en la misma base de datos" (una tabla `tenant` y un `tenant_id` en todo): Medusa v2 no lo modela, obligaría a tocar cada ruta, job y subscriber, y mezclaría recetas de clientes distintos en una tabla — con el volumen previsto (pocas ópticas) el coste y el riesgo no compensan. El aislamiento por despliegue cuesta ~€4–10/mes por cliente en Hetzner y cero cambios de código.

## Dónde vive la identidad del inquilino (ya hecho)

- **Backend:** `apps/backend/src/lib/tenant.ts` — `tenant()` devuelve nombre, razón social, URL pública, correo de soporte, zona horaria, idioma, moneda, país y prefijo de SMS. Ya lo usan los correos (`storeName()`), los SMS de etapa, y la hoja de Google (título del Resumen y etiqueta de las protecciones). Variables: `STORE_NAME`, `TENANT_LEGAL_NAME`, `STOREFRONT_URL`, `STORE_SUPPORT_EMAIL`, `GSHEET_TIMEZONE`, `STORE_NOTIFICATION_LOCALE`, `TENANT_CURRENCY`, `TENANT_COUNTRY`, `TENANT_SMS_PREFIX`. Todas con el valor actual de RUBI LENS por defecto.
- **Storefront:** `apps/capri-storefront/src/config/tenant.js` — `TENANT` (nombre, lema, logo, logo compacto, crédito de imágenes) y `pageTitle()`. Ya lo usan la cabecera, el pie, el login del panel y los títulos de catálogo y ficha. Variables `VITE_TENANT_NAME`, `VITE_TENANT_TAGLINE`, `VITE_TENANT_LOGO`, `VITE_TENANT_LOGO_MARK`, `VITE_TENANT_IMAGE_CREDIT`.
- **Comprobación:** `GET /admin/security-status` (pestaña **Seguridad** del panel) dice si la configuración del inquilino está completa (secretos, https, Stripe en vivo, webhook, correo, SMS, hoja, OCR).

## Lo que aún nombra a RUBI LENS (pendiente, por orden)

1. `apps/capri-storefront/index.html`: título, descripción y metadatos OG/Twitter (se parametriza con un `tenant.json` leído por el build, o inyectando `VITE_TENANT_*` en el HTML con el plugin de Vite).
2. Diccionario `translations.js`: ~10 cadenas con "RUBI LENS" (pie, probador, guía de lentes). Sustituir por `{store}` e interpolar `TENANT.name`.
3. Paleta (navy/dorado) en CSS: pasar a variables `--brand-*` alimentadas por `VITE_TENANT_*`.
4. Correos: los iconos y el logo se piden a `STOREFRONT_URL` — ya es por inquilino; los colores están en `order-confirmation.ts` (`NAVY`, `GOLD`…) → moverlos a `tenant()`.
5. Catálogo: el scraper apunta a caprioptics.com; otro cliente con otro proveedor necesita su propio `apps/scraper` config (`SUPPLIER_*`).
6. Panel: textos de ayuda de Seguridad mencionan `www.rubilens.com` como ejemplo (solo copy).

## Alta de un inquilino nuevo (checklist operativo)

1. Infra: app de Coolify desde `main` (Dockerfile de `apps/backend`), Postgres y Redis propios, dominio `api.<cliente>.com`. Variables: copiar `apps/backend/.env.example` y rellenar **todas** las `STORE_*`, `TENANT_*`, secretos aleatorios (`JWT_SECRET`, `COOKIE_SECRET`, `ORDER_ACCESS_SECRET`, `VISION_INTERNAL_SECRET`), `SECURITY_STRICT=1`.
2. Stripe: cuenta del cliente → `sk_live`, webhook a `https://api.<cliente>.com/hooks/payment/stripe_stripe`, `whsec_`.
3. Correo/SMS: dominio verificado en Resend (`RESEND_FROM_EMAIL`), Twilio opcional.
4. Hoja: nueva hoja de Google del cliente, compartida con la cuenta de servicio; `GSHEET_*`. Las pestañas se crean solas en la primera sincronización.
5. R2: buckets `<cliente>-assets` (público) y `<cliente>-rx` (privado).
6. Storefront: proyecto Vercel con Root Directory `apps/capri-storefront`, rama `develop` (o una rama por cliente), `VITE_*` (publishable key de Medusa, `pk_live`, `VITE_TENANT_*`), rewrite `/medusa` al API del cliente, dominio `www.<cliente>.com`.
7. Catálogo: scraping/carga inicial de productos y precios del cliente.
8. Admin: `npx medusa user -e <correo> -p <contraseña>` en la terminal de Coolify; luego el resto del equipo desde la pestaña Equipo.
9. Verificar: pestaña Seguridad en verde, compra de prueba con tarjeta real + reembolso, correos, hoja.

## Ramas y versiones

Un solo `main` para todos. Un cambio de código llega a todos los inquilinos al redesplegar cada app (Deploy manual en cada Coolify, o webhook de GitHub por app). Las diferencias de negocio (precios, envíos, impuestos) ya son variables (`SHIPPING_*`, `STORE_FRAME_TAX_RATE`, `FREE_SHIPPING_THRESHOLD`, `priceStore` del panel) — nunca ramas por cliente con código distinto.
