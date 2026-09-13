# RUBI LENS — Estado: marca única y catálogo con vistas 3D

_Actualizado: 2026-09-13 · Rama `develop` · Producción en Vercel_

Tienda en vivo: <https://optical-storefront-capri-storefront-to-production.vercel.app>

---

## 1. Marca unificada a RUBI LENS

Se eliminó por completo **“Óptica El Rancho”** y el wordmark antiguo **“RUBI_LENS”**
(con guion bajo) de toda la interfaz. La marca ahora es **RUBI LENS · Óptica y Salud
Visual**, con el logo oficial.

Cambios aplicados (archivos):

| Zona | Archivo | Antes → Ahora |
|---|---|---|
| Título / SEO | `index.html` | “Óptica El Rancho — …” → “RUBI LENS — …” |
| Eyebrow del hero | `pages/Home.jsx` | “Óptica El Rancho · RUBI_LENS” → “RUBI LENS · Óptica y Salud Visual” |
| Kickers laterales | `pages/Home.jsx` | “RUBI_LENS” → “RUBI LENS” |
| Pie de página (es/en) | `i18n/translations.js` | “Óptica El Rancho …” → “RUBI LENS …” |
| Anuncios del medidor | `i18n/translations.js` | “… en Óptica El Rancho” → “… en RUBI LENS” |
| Tarjeta de medición (imagen descargable) | `components/TryOnStudio.jsx` | “Óptica El Rancho” → “RUBI LENS” |
| Panel admin | `pages/AdminPage.jsx` | alt “RUBI_LENS” → “RUBI LENS” |
| Datos de tienda / recogida | `admin/priceStore.js` | nombre y mapa → RUBI LENS (dirección física intacta) |

El logo (header, footer, favicons, PWA, Open Graph) ya estaba montado en la entrega
anterior.

---

## 2. Catálogo: monturas con vistas 3D generadas ya publicadas

Se habilitó la marca **Simplylite** (`brand_slug: simply-lite`) en
`data/medusaCatalog.js` → `ALLOWED_BRAND_SLUGS`. Con eso, las **21 monturas piloto**
que ya tienen las 4 vistas generadas (frente / lateral izq. / lateral der. / trasera)
muestran su **galería de 4 ángulos** en la ficha, tomando las imágenes reales desde
Supabase Storage. Todas tienen **precio real** en Medusa.

- **Di Caprio** ya estaba habilitada → DC 50 mostraba galería desde antes.
- **Simplylite** estaba filtrada (sin precio mayorista); ahora habilitada porque sus
  pilotos sí tienen precio (~$18) e imágenes verificadas (HTTP 200).

Cómo funciona el enganche: la galería une la ficha con las vistas por **SKU**
(`viewsBySku`, título del producto en Medusa) y por **nombre de color exacto**
(título de la variante). Si un color no tiene vista, cae con gracia a la foto única
del proveedor — nunca aparece un recuadro roto.

---

## 3. Monturas montadas con galería de 4 vistas (21 · 33 colorways · 132 vistas)

**Di Caprio (1)**

| SKU | Handle | Colores con vistas |
|---|---|---|
| DC 50 | dc-50-di-caprio | Grey, Black, Brown |

**Simplylite (20)**

| SKU | Handle | Colores con vistas |
|---|---|---|
| SL103 | sl103-simply-lite | Burgundy, Pink |
| SL105 | sl105-simply-lite | Silver, Blue |
| SL106 | sl106-simply-lite | Brown, Black |
| SL107 | sl107-simply-lite | Gunmetal, Silver |
| SL108 | sl108-simply-lite | Silver, Gunmetal |
| SL110 | sl110-simply-lite | Navy, Black |
| SL113 | sl113-simply-lite | Gunmetal, Black |
| SL114 | sl114-simply-lite | Black, Gunmetal |
| SL115 | sl115-simply-lite | Black, Rose Gold |
| SL116 | sl116-simply-lite | Gold, Black |
| SL701 | sl701-simply-lite | Silver |
| SL702 | sl702-simply-lite | Gold |
| SL705 | sl705-simply-lite | Gunmetal |
| SL901 | sl901-simply-lite | Gold |
| SL902 | sl902-simply-lite | Silver Blue |
| SL903 | sl903-simply-lite | Gunmetal |
| SL904 | sl904-simply-lite | Gold Brown |
| SL905 | sl905-simply-lite | Gunmetal Black |
| SL906 | sl906-simply-lite | Gold Black |
| SL907 | sl907-simply-lite | Gold Gunmetal |

> Efecto secundario: al habilitar Simplylite también aparecen ~25 monturas Simplylite
> adicionales que **no** tienen vistas generadas. Son productos válidos (precio +
> foto de proveedor); simplemente muestran una sola imagen, sin galería de 4 ángulos.

Enlaces para revisar (SPA):
`/recetas/dc-50-di-caprio` · `/recetas/sl116-simply-lite` · `/recetas/sl103-simply-lite`

---

## 4. Generar el resto del catálogo (pendiente, no bloquea lo de arriba)

El resto de las vistas (catálogo completo ≈ 5.760 imágenes ≈ $223 de API Gemini) se
generan con el CLI ya construido y desplegado:

```
cd apps/scraper
uv run python -m scraper media status              # estado (gratis)
uv run python -m scraper media plan --all --kind views   # costo (gratis)
uv run python -m scraper media generate --all --kind views --max-cost N --yes
```

**Único requisito**: completar los secretos de producción en `apps/scraper/.env`
(ya git-ignored): `MEDUSA_ADMIN_API_KEY`, `GEMINI_API_KEY`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_REGION` — cópialos desde Coolify. El
backend desplegado ya tiene las rutas `/admin/frame-media/*` (verificado: HTTP 401,
no 404) y las tablas en Postgres. El pipeline es reanudable, idempotente y con tope
de gasto por niveles en el servidor.

---

## 5. Verificación (hecha en producción)

- ✅ Título de pestaña y hero muestran **RUBI LENS · Óptica y Salud Visual**.
- ✅ `/recetas/sl116-simply-lite` renderiza las **4 miniaturas reales** + vista central,
  marca Simplylite, precio $18.
- ✅ `/recetas/dc-50-di-caprio` (Di Caprio) sigue con su galería, $32.
- ✅ Imágenes de las 21 monturas verificadas en Supabase (HTTP 200), incluyendo
  colores de dos palabras (Rose Gold, Silver Blue).
- ✅ Build de producción en verde; desplegado en Vercel desde `develop`.
