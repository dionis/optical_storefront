# Generación de medios por SKU (4 vistas · video · GLB)

Plan de implementación · **revisión 2** (decisiones tomadas incorporadas).
Estado: **propuesta, sin código escrito**.

Objetivo: que el dueño pueda, desde `/admin`, generar y almacenar para cada montura
(a) cuatro packshots (frente / izquierda / derecha / detrás), (b) —en otro momento—
un video promocional, y (c) —en otro momento— un `.glb` para el probador 3D.

Tres requisitos que gobiernan todo el diseño y vienen de la nota del dueño:

1. **Los medios se almacenan como se almacenan las imágenes hoy** — mismas claves R2,
   mismo formato, mismas cabeceras de caché, mismo camino de resolución en el storefront.
2. **El servicio que actualiza versiones nuevas debe poder crearlos según configuración** —
   es decir, el scraper, en su corrida periódica, sin intervención manual.
3. **Hay que saber dónde se quedó el proceso y no reprocesar lo ya hecho.**

El motor de (a) y (b) ya existe y está probado: `gemini_media.py`
(`3d_framework_glass_try-on/services/inference/`, 553 líneas, única dependencia
`requests`). Este plan **no lo reescribe**: lo copia tal cual y construye alrededor
lo que le falta — persistencia, cola reanudable, presupuesto escalonado, panel y
almacenamiento.

---

## 0. Decisiones tomadas

| # | Decisión | Consecuencia en el plan |
|---|---|---|
| 1 | Vistas **por colorway**, no por color primario | 5.760 imágenes. La unidad de trabajo es la **variante**, no el producto |
| 2 | Video en **dos modos**: lista de SKU y "todos", siempre configurable | `video_scope` = `list` \| `all`, editable en el panel; ambos drenan bajo el mismo techo |
| 3 | Vistas generadas **internas por defecto** | `published` es columna aparte de `status`, default `false` |
| 4 | Techo de gasto **gradual según las condiciones** | Escalera de 4 niveles con condiciones objetivas de ascenso (§6) |
| 5 | Los medios llegan al **catálogo almacenado** y se ven si existen | Metadata en Medusa + `medusaCatalog.js` + galería del PDP; render condicional (§8) |

La decisión 2 y la 4 encajan mejor de lo que parece: **`all` + techo escalonado no es un
gasto masivo, es un goteo**. "Todos" siembra la cola; el techo decide a qué ritmo se
drena. El dueño no elige entre "40 SKU" y "$440": elige el destino y el caudal por separado.

---

## 1. Lo que el módulo ya resuelve y lo que no

Ya resuelto (y por eso se copia en vez de reescribir las llamadas):

- Veo rechaza `inlineData` según el modelo → prueba `bytesBase64Encoded` primero y cae
  a `inlineData` (`VIDEO_IMAGE_SHAPES`). Un 403/404 **no** se reintenta, para que una
  clave mala salga como clave mala.
- La URI de descarga del video también exige `x-goog-api-key`.
- `negativePrompt` es de Vertex AI: se ofrece y se retira si el endpoint lo rechaza.
- El audio de Veo 3.x no se puede apagar por parámetro; la única palanca es el prompt
  (`NO_VOICEOVER_GUARD`).
- Una petición **por vista**, no una para las cuatro: es lo que hace que un ángulo malo
  se pueda reintentar y reportar por separado (`IDENTITY_GUARD` en cada prompt).
- Gemini autentica con `x-goog-api-key`, no con `Bearer`.
- `cost.json` por corrida, con modelo, tarifas, tokens y fecha.

Lo que **no** trae y hay que construir:

| Falta | Por qué importa aquí |
|---|---|
| Estado persistente y reanudable | 5.760 vistas no caben en memoria ni sobreviven un reinicio (req. 3) |
| Cola con reintentos | El módulo devuelve el fallo, no lo reintenta |
| Techo de gasto | 550 videos = $440; el presupuesto de infra completo es <$75/mes |
| Almacenamiento con la convención de la tienda | Escribe PNG a disco local; hoy la tienda guarda WebP en R2 (req. 1) |
| Idempotencia | Nada impide pagar dos veces por la misma vista (req. 3) |
| Enganche con el scraper | El módulo no sabe que existe un catálogo (req. 2) |
| GLB | No lo genera: eso es el pipeline GPU fuera de este repo |

---

## 2. Volumen y costo

Catálogo real (`apps/capri-storefront/public/catalog.json`): **550 monturas,
1.440 colorways**. Four You 379, Di Caprio 324, Peachtree 151, Millennial 113,
Flexure 70, Trendy 65, Eyeleos 56, Simplylite 45, Ago 42, The Candy Shoppe 40,
Versailles Palace 37, Grande 38, Artistik Eyewear 26, Artistik Galerie 24,
Slimfold 19, ProRx 11.

| Trabajo | Unidades | Costo estimado¹ |
|---|---|---|
| **4 vistas × colorway** (decidido) | 5.760 imágenes | ~**$223** |
| Video, modo `list` (p. ej. 40 SKU) | 40 videos | ~**$32** |
| Video, modo `all` × montura | 550 videos | ~**$440** |
| Video, modo `all` × colorway | 1.440 videos | ~**$1.152** |
| GLB | — | $0 de API; horas de GPU fuera de este repo |

¹ Ancla documentada: 1.290 tokens de salida por imagen ≤1024px a $30/1M = **$0,0387**.
**El módulo pide `imageSize: "2K"`** (`IMAGE_SIZE`), que factura más tokens por un
múltiplo que no está fijado aquí. Video: `veo-3.1-fast` @720p = $0,10/s × 8s = **$0,80**.
La Fase 0 reemplaza esta columna por números medidos.

**El almacenamiento no es el problema.** 5.760 WebP a 1600px ≈ 1,0–1,4 GB; 550 mp4 de
8s ≈ 5–8 GB. En R2 eso son **centavos al mes** y el egreso es gratis. Toda la
conversación de presupuesto es sobre la API, no sobre el disco.

**El video sigue sin poder ser un botón de "generar todo" que se ejecute de golpe** —
pero con la decisión 2 + 4 ya no hace falta que lo sea: `all` es un destino, el techo
es el caudal.

---

## 3. Cómo se almacena (requisito 1)

Hoy, `apps/scraper/scraper/images.py` hace: descargar → `thumbnail(1600px, LANCZOS)` →
WebP calidad 85 → `put_object` con
`CacheControl: public, max-age=31536000, immutable`, bajo
`products/{handle}/{handle}_{idx:02d}.webp`. Los try-on van a
`tryon/{handle}_{color}.png`. El storefront resuelve **toda** imagen por
`resolveImage()` (`src/data/imageUrl.js`), que convierte una clave R2 desnuda en URL
usando `VITE_R2_PUBLIC_URL` — el comentario de ese archivo ya advierte que *cualquier
superficie nueva que muestre imágenes debe pasar por ahí*.

Los medios generados siguen exactamente ese camino:

| Medio | Clave R2 | Formato |
|---|---|---|
| Vista | `products/{handle}/views/{handle}_{color}_{slot}.webp` | WebP q85, ≤1600px, `immutable` |
| Video | `products/{handle}/video/{handle}_{color}.mp4` | mp4 tal cual de Veo |
| Póster del video | `products/{handle}/video/{handle}_{color}.webp` | primer fotograma, WebP |
| Modelo 3D | `models/{handle}/{handle}_{color}.glb` + `.json` | glTF binario + ficha |

`{color}` se normaliza con la **misma** regla que ya usa el try-on:
`color.lower().replace(' ', '_')`. La conversión a WebP reutiliza `_optimize_image()`;
no se escribe un segundo optimizador.

### 3.1 La trampa de la alineación por índice

`medusa_push.py` asigna la imagen de cada variante así:

```python
"image": product.r2_image_keys[idx] if idx < len(product.r2_image_keys) else None
```

Es decir, **`r2_image_keys` está alineado por posición con `colors`**. Si las vistas
generadas se anexan a esa lista, cada variante pasa a apuntar a una foto ajena y el
catálogo entero se desordena en silencio — sin error, sin log, solo colores equivocados.

Por eso las vistas viven en un campo **propio**:

```python
# ScrapedProduct
r2_view_keys: dict[str, dict[str, str]]   # {color: {slot: key}}
r2_video_keys: dict[str, str]             # {color: key}
r2_model_keys: dict[str, str]             # {color: key}
```

`r2_image_keys` no se toca nunca. Esto también hace que un test de regresión sea trivial:
`len(r2_image_keys) == len(colors)` sigue siendo invariante después de generar medios.

### 3.2 Sin R2 no hay medios

`process_product_images` tiene un respaldo: si R2 no está configurado, hotlinkea las URLs
del proveedor. **Las vistas generadas no tienen a qué caer** — no existen en ningún sitio
salvo donde las subamos. Sin R2, la función de medios queda apagada y lo dice en el log;
no se genera nada que luego no se pueda guardar. Pagar por una imagen que se descarta es
el peor fallo posible de este subsistema.

---

## 4. Arquitectura

```
  Panel /admin (React)                    Servidor remoto (ssh / consola Coolify)
        │                                       │
        │ decide QUÉ: encola, publica,          │ decide CUÁNDO:
        │ revisa, muestra gasto                 │ python -m scraper media generate …
        ▼                                       ▼
  ┌───────────────────────────┐        ┌──────────────────────────────────────┐
  │ Medusa  ── ESTADO Y DINERO│◄──────►│ CLI de medios (Python)  ── EJECUTOR  │
  │  frame-media (Postgres)   │  admin │   gemini_media.py (copia literal)    │
  │  /admin/frame-media/*     │  API   │   images._optimize_image → WebP      │
  │  product.updated ─┐       │        │   boto3 → R2                         │
  └───────────────────┼───────┘        └──────────────────┬───────────────────┘
                      ▼                                   │ HTTPS
              Meilisearch (subscriber ya existente)        ▼
                                          generativelanguage.googleapis.com
```

**El panel decide qué; el script decide cuándo.** Es la separación que pidió el dueño:
la generación no arranca sola — se ejecuta a mano, en el servidor, cuando él lo decide.

### 4.1 El ejecutor es un script de Python, no un cron de Medusa

La revisión 2 de este plan ponía el motor detrás de rutas HTTP en `vision-measure` y lo
drenaba desde un `jobs/frame-media-drain.ts`. **Esa arquitectura existía entera para
sortear una limitación que ahora no aplica**: un cron dentro de Medusa no puede bloquearse
15 minutos esperando a Veo, ni sostener 27 MB de base64 en memoria.

Un script en primer plano sí puede. Al mover el ejecutor a Python desaparecen, sin perder
nada:

| Se elimina | Por qué ya no hace falta |
|---|---|
| 4 rutas `/api/frame-media/*` en `vision_api.py` | El CLI importa `gemini_media` directamente |
| `gemini_media_async.py` (submit/poll/fetch) | `generate_video()` puede bloquear: es un script que alguien está mirando |
| Import de ayudantes privados (`_submit_video`…) | **El módulo se usa tal como su autor lo diseñó**, sin acoplamiento a nombres con guion bajo |
| `bodyParser: 25mb` y `VISION_INTERNAL_SECRET` | No hay imágenes viajando por HTTP interno |
| `jobs/frame-media-drain.ts` | El drenaje es `media generate` |
| Trocear en "una vista por petición" | Sin hop HTTP, los 27 MB nunca existen |

Lo que **no** cambia: Medusa sigue siendo el dueño del estado y del dinero (§5), y el
panel sigue siendo donde se decide y se revisa (§A.9).

### 4.2 Por qué vive dentro de `apps/scraper`

Como subcomando: `python -m scraper media <acción>`. No es una app nueva, y la razón es
que **el scraper ya resolvió todo lo que este trabajo necesita**:

- `images._optimize_image()` — WebP 1600px q85. El requisito 1 ("guardarlos como se
  guardan las imágenes hoy") deja de ser una promesa y pasa a ser la misma función.
- `images._get_s3_client()` — boto3 con `addressing_style: path` y reintentos `standard`,
  ya peleado contra R2/Supabase.
- `medusa_push._admin_client()` — y con él la trampa que cuesta media tarde descubrir:
  **Medusa v2 autentica la clave admin por HTTP Basic (token como usuario, contraseña
  vacía), no con `Bearer`**.
- `cli.py` — `click`, carga de `.env` resuelta desde `__file__` (no desde el cwd, para que
  un cron o un contenedor encuentren el mismo archivo) y el `reconfigure(encoding="utf-8")`
  que evita que un `> media.log` mate la corrida en el primer `✓`. Ese detalle importa
  justo aquí: estas corridas duran horas y **siempre** se redirigen a un archivo.
- `uv`, un `.env`, un despliegue. Ya corre en ese servidor.

Escribir esto como app aparte significaría reimplementar esas cinco cosas y equivocarse
en al menos una.

### 4.3 Y así el requisito 2 se cumple solo

"El servicio que actualiza las nuevas versiones puede crear estos medios según
configuración" deja de necesitar un mecanismo propio: **el servicio que actualiza las
versiones es el scraper, y el generador es un subcomando suyo.** Misma configuración,
mismo estado, mismo código:

```bash
python -m scraper media generate --pilot --kind views   # manual, cuando el dueño decide
python -m scraper sync --with-media                     # dentro de la actualización periódica
```

`--with-media` está apagado por defecto. Encender la generación automática es un acto
deliberado, y sigue sujeto a `--max-cost` y al techo del §6.

Lo que **no** se hace, y hay que decirlo porque es la tentación obvia: meter la llamada a
Gemini dentro de `process_product_images`. Convertiría `sync --full` en un evento de gasto
de $223 ejecutado por un cron sin nadie mirando, y el bucle de `sync()` aborta a los 10
fallos consecutivos — abortaría dejando medios pagados a medio subir. `--with-media`
encola y **llama al mismo ejecutor acotado**, no a Gemini en crudo.

### 4.4 Por qué el estado sigue en Postgres y no en el `state.db` del scraper

Es la pregunta natural una vez que el ejecutor es el scraper. La respuesta no cambia:
`state.db` es SQLite local, per-producto y efímero en contenedor. Sostener sobre él la
contabilidad de $223 en activos —y la reanudación entre corridas, y lo que el panel
muestra— no funcionaría. El CLI **lee y escribe el estado por la API admin de Medusa**,
así que el script y el panel ven exactamente lo mismo, y dos corridas simultáneas no se
pisan (§5, nivel 2).

Consecuencia operativa: **el CLI necesita alcanzar Medusa**. En el mismo servidor eso es
`http://127.0.0.1:9000`; desde fuera, la URL pública con `MEDUSA_ADMIN_API_KEY`. Sin
Medusa el script no arranca — y es correcto que no arranque, porque sin estado no puede
saber qué ya se pagó.

### 4.5 El video ya no necesita trocearse

`generate_video()` hace submit + sondeo + descarga en una llamada de hasta 15 minutos, y
eso está bien en un script. Se conserva una sola propiedad del diseño anterior: **el
`operation` de Veo se escribe en Medusa en cuanto Veo lo devuelve, antes de empezar a
sondear.** Si alguien corta la corrida con Ctrl-C a los 3 minutos, la siguiente retoma esa
operación en vez de pagar otro video. Es la diferencia entre perder $0,80 y no perderlo.

---

## 5. Estado, reanudación e idempotencia (requisito 3)

Esta es la sección que más cambió respecto de la revisión 1, porque el dueño la pidió
explícitamente. Hay **tres niveles** y cada uno responde una pregunta distinta.

### Nivel 1 — Por activo: qué está hecho (autoritativo)

Tabla `frame_media_asset`, **una fila por `(variant_sku, kind, slot)`** con índice único.
Es el registro de verdad: 5.760 filas de vistas, más una por video, más una por modelo 3D.
Un `POST /enqueue` que llega dos veces no crea nada nuevo — `ON CONFLICT DO NOTHING`.

| Campo | Notas |
|---|---|
| `id` | pk |
| `product_handle`, `variant_sku`, `colorway` | identidad del SKU |
| `kind` | `view` \| `video` \| `model3d` |
| `slot` | `front`/`left`/`right`/`back`; null para video y GLB |
| `status` | `pending` `running` `done` `failed` `stale` `awaiting_external` `skipped` `blocked_budget` |
| `source_image_url` | la foto del proveedor usada como entrada |
| `source_fingerprint` | sha256(bytes de la foto) + versión de prompt + model_id |
| `output_key`, `output_bytes`, `output_mime` | clave R2 del resultado |
| `provider_model` | `gemini-2.5-flash-image`, `veo-3.1-fast-…` |
| `operation` | nombre de operación de Veo; null en imágenes |
| `tokens_prompt`, `tokens_output`, `cost_usd`, `billing_unit` | del recibo, nunca inventados |
| `receipt` | el `cost.json` del módulo, tal cual |
| `attempts`, `last_error_reason`, `last_error_note` | **reason = código**, note = inglés para logs |
| `lease_until` | ver "Nivel 2" |
| `published` | bool, default **false** (decisión 3) |
| `requested_by` | `actor_id` del admin, o `"scraper"` |
| `created_at`, `started_at`, `finished_at` | |

Índices: único `(variant_sku, kind, slot)`; `(status, kind)` para el drenaje;
`(product_handle, kind)` para el panel.

**No reprocesar** es entonces una consulta, no una heurística: el drenaje solo reclama
`status IN ('pending','failed')` con `attempts < 3`. Un `done` es intocable salvo que
alguien pulse "regenerar", y ese clic muestra el costo antes de confirmar.

### Nivel 2 — Por corrida: dónde se quedó ahora mismo

Ahora el ejecutor **sí** es un proceso largo (una corrida de las 608 vistas del piloto
tarda horas), así que la pregunta "¿dónde se quedó?" es literal: alguien cerró la sesión
ssh, o le dio Ctrl-C, o se cayó la red.

El CLI **no mantiene progreso propio en memoria**. Antes de cada activo pide el lote a
Medusa, y Medusa lo entrega con un *lease*:

```sql
-- POST /admin/frame-media/claim  {run_id, limit, kind, handles[]}
UPDATE frame_media_asset
   SET status = 'running', lease_until = now() + interval '20 minutes',
       started_at = now(), claimed_by = :run_id
 WHERE id IN (SELECT id FROM frame_media_asset
               WHERE (status IN ('pending','failed') AND attempts < 3)
                  OR (status = 'running' AND lease_until < now())   -- lease vencido
               ORDER BY kind, product_handle, slot
               LIMIT :limit FOR UPDATE SKIP LOCKED)
RETURNING *;
```

Tres cosas que esto compra, y las tres importan cuando el ejecutor es un script remoto:

- **Un Ctrl-C no pierde nada.** Lo ya subido está en `done`; lo que estaba en vuelo queda
  en `running` con lease, y a los 20 minutos vuelve a ser reclamable. Relanzar el script
  con los mismos argumentos continúa donde se quedó: eso **es** `--resume`, y no necesita
  ningún archivo local.
- **Dos corridas simultáneas no se pisan.** `FOR UPDATE SKIP LOCKED` más `claimed_by` = el
  `run_id` de cada invocación. Si el dueño abre dos terminales y lanza el mismo comando
  —cosa que pasa— la segunda toma trabajo distinto en vez de pagar dos veces por lo mismo.
- **El lease es de 20 minutos, no de 10**, porque un solo activo de video puede tardar 15.
  Un lease más corto que la operación más lenta hace que otra corrida reclame un activo
  que todavía se está generando: pagado dos veces, y ninguna de las dos lo sabe.

El orden (`kind, product_handle, slot`) es estable a propósito: el progreso avanza marca
por marca y montura por montura, no salteado, así que "va por Di Caprio" es una frase con
sentido — y `media status` puede decirlo (Apéndice C).

### Nivel 3 — Frescura: qué dejó de ser válido

`source_fingerprint` = sha256 de los bytes de la foto de entrada + versión del prompt +
id del modelo. Ata el resultado a **la entrada exacta que se pagó**.

- Fingerprint igual y `status=done` → **skip**. No se vuelve a pagar. Nunca.
- El scraper detecta un `content_hash` distinto y la foto cambió → el `enqueue` trae un
  fingerprint nuevo → la fila pasa a `stale`. **No se borra ni se regenera sola:** el
  archivo viejo sigue sirviéndose (una vista desactualizada es mejor que un hueco) y el
  panel la marca como "desactualizada". Regenerar es un clic con el costo a la vista.
- Cambiar `VIEW_PROMPTS` o el modelo de imagen es un cambio de versión de prompt, así que
  invalida por diseño. Se versiona a mano (`PROMPT_VERSION = 1`) para que ese barrido
  masivo sea siempre deliberado.

### Reconciliación con el `state.db` del scraper

El scraper ya tiene su propio checkpoint: SQLite, `product_state(handle, content_hash)`,
con `has_changed()` / `mark_seen()`. **No se toca y no se le añade nada de medios.** Es
per-producto, es local y es efímero en contenedor; sostener sobre él la contabilidad de
$223 en activos sería un error. Su papel se queda en lo que ya hace bien: decidir si un
producto cambió. Ese "cambió" es justo la señal que dispara el `enqueue`, y a partir de
ahí el estado vive en Postgres, que es donde está el dinero.

### Visibilidad

`GET /admin/frame-media/progress` devuelve el corte que responde "¿dónde va esto?":

```json
{ "by_kind": { "view": { "done": 3120, "pending": 2510, "running": 8,
                         "failed": 14, "stale": 108, "blocked_budget": 0 } },
  "spend": { "month_to_date_usd": 118.40, "ceiling_usd": 150, "tier": 2 },
  "eta": { "views_remaining": 2510, "at_current_ceiling_days": 9 },
  "last_tick_at": "2026-09-05T11:20:00Z" }
```

---

## 6. Presupuesto gradual (decisión 4)

Tres frenos independientes, porque fallan de formas distintas:

- **Tope por corrida** (`max_batch_per_tick`, arranca en 8): acota el daño de un bucle mal.
- **Tope diario** (`daily_ceiling_usd`): acota el daño de un cron mal.
- **Tope mensual** (`monthly_ceiling_usd`, por familia): acota el daño de una decisión mala.

Sobre ellos, la **escalera**. El nivel no sube solo: cada ascenso es un acto explícito de
un admin, registrado con `updated_by`, y solo se ofrece cuando su condición se cumple.

| Nivel | Techo mensual | Alcance permitido | Condición para ascender |
|---|---|---|---|
| 0 · Calibración | $5 | ≤ 2 monturas (`SL107` y `DC 50`, ver Apéndice B) | Los dos `cost.json` leídos; costo real por imagen y por video escrito en §2 |
| 1 · Piloto A | $15 | Las 20 Simplylite del lote piloto (30 colorways, 120 vistas ≈ $4,6) | Revisión visual de las 120 vistas; ≥90% aceptadas sin reintento manual |
| 2 · Piloto completo | $40 | **El lote piloto entero: 70 monturas, 152 colorways, 608 vistas ≈ $23,5** | Desvío del costo real vs. estimado <10%; 0 identidades cambiadas sin detectar; ≥90% en los 14 controles |
| 3 · Catálogo | configurable | todo, a ritmo de techo | — |

Las condiciones son objetivas a propósito: "≥90% aceptadas" y "desvío <10%" se leen de
la propia tabla, no de una impresión. El panel muestra la condición pendiente junto al
botón de ascenso deshabilitado, para que se vea *qué falta*, no solo que no se puede.

Los niveles 1 y 2 son **el lote piloto** del Apéndice B: una cohorte fija de 70 monturas
elegida para que los fallos aparezcan en $23 y no en $223.

Además, un **cortacircuitos** calcado del scraper: 10 fallos consecutivos
(`_MAX_CONSECUTIVE_FAILURES = 10` en `sync.py`) detienen el drenaje y marcan el resto
`blocked_budget`, en vez de moler el catálogo contra una API que no responde.

Al agotarse un techo, las filas **no fallan**: pasan a `blocked_budget` y vuelven a
`pending` el primer día del mes siguiente. Con el modo `all` de video, esto es
precisamente el goteo de §0: se siembran 550 y se drenan al ritmo que el techo permita.

Env de respaldo (`resolveFrameMediaSettings`, patrón de `resolveOcrSettings`):
`FRAME_MEDIA_TIER`, `FRAME_MEDIA_MONTHLY_USD_VIEWS`, `FRAME_MEDIA_MONTHLY_USD_VIDEO`,
`FRAME_MEDIA_DAILY_USD`, `FRAME_MEDIA_BATCH`, `FRAME_MEDIA_CONCURRENCY`.

---

## 7. Alcance del video (decisión 2)

`frame_media_budget.video_scope`:

- **`list`** — `video_sku_list`, lista de handles editable en el panel (chips con
  autocompletado sobre el catálogo). Es el modo por defecto.
- **`all`** — siembra todo el catálogo. Segunda opción `video_unit`: `product`
  (un video por montura, 550) o `colorway` (1.440). Recomendado `product`: el video es
  una pieza de marketing de la montura, y el `IDENTITY_GUARD` importa menos en 8 segundos
  de movimiento que en un packshot estático.

Ambos modos comparten techo, escalera y cortacircuitos. Cambiar de `list` a `all` siembra
filas `pending`; **no gasta nada en el momento** y el panel dice cuántas filas y cuánto
representarían al ritmo actual.

`video_prompt` también es configurable (hoy `DEFAULT_VIDEO_PROMPT` está cableado en
español dentro del módulo). Se mueve al ajuste, redactado en inglés como el resto del
código; `NO_VOICEOVER_GUARD` se sigue anexando en el módulo y no es editable.

---

## 8. Llegada al catálogo y visualización (decisión 5)

### 8.1 Medusa (fuente de verdad)

`ingest-frame-media-result` escribe, tras subir a R2:

```jsonc
// variant.metadata
{ "color": "Black", "image": "products/dc407/dc407_00.webp",   // ← intacto
  "views": { "front": "products/dc407/views/dc407_black_front.webp",
             "left":  "…", "right": "…", "back": "…" },
  "video": "products/dc407/video/dc407_black.mp4",
  "video_poster": "products/dc407/video/dc407_black.webp",
  "model3d": "models/dc407/dc407_black.glb",
  "media_generated": true }        // marca de origen: esto lo hizo un modelo
```

Solo se escriben las claves de activos con `published = true`. `images[]` del producto y
`variant.metadata.image` **no se tocan** (§3.1).

### 8.2 Storefront

- `medusaCatalog.js` mapea `variant.metadata.views/video/model3d` a la forma que ya
  consumen los componentes: `color.views`, `color.video`, `color.model3d`.
- **Todo pasa por `resolveImage()`**, tal como exige el comentario de `imageUrl.js`.
  El mp4 usa el mismo funnel (una clave R2 es una clave R2); se añade un alias
  `resolveMedia = resolveImage` solo para que el nombre no mienta en la llamada.
- **Render condicional, sin huecos**: la galería del PDP añade las miniaturas de vista
  solo si existen; el botón de video aparece solo si hay `video`. Un colorway sin medios
  se ve exactamente como hoy. Esto es lo que hace que el goteo del §6 sea aceptable:
  el catálogo nunca está "a medias", solo mejor en unas fichas que en otras.
- `media_generated: true` viaja hasta el componente para que, si el dueño lo decide más
  adelante, la ficha pueda etiquetar esas imágenes. No se pinta nada por ahora.

### 8.3 El `catalog.json` estático

`apps/capri-storefront/public/catalog.json` es un **snapshot commiteado** (2 de agosto);
no hay nada en el repo que lo regenere. Si los medios solo llegan por Medusa, la ruta
estática se queda atrás y la diferencia entre las dos crece.

Se añade `scripts/export-catalog.mjs`: lee la Store API de Medusa y escribe
`catalog.json` con la misma forma que hoy, más `colors[].views/video/model3d`. Se corre a
mano o desde el build. Es media jornada y resuelve una deriva que ya existía antes de
este trabajo.

---

## 9. Archivos a crear / tocar

### `apps/scraper/` (Python) — **el ejecutor**

Especificado a nivel de argumentos en el **Apéndice C**.

```
scraper/media/__init__.py      NUEVO
scraper/media/gemini_media.py  NUEVO  copia LITERAL del módulo + sha256 de origen
scraper/media/cli.py           NUEVO  subcomandos plan/generate/status/publish/retry
scraper/media/runner.py        NUEVO  claim → generar → optimizar → R2 → report
scraper/media/client.py        NUEVO  cliente de /admin/frame-media/* (reusa _admin_client)
scraper/media/cost.py          NUEVO  estimación local, espejo de frame-media-cost.ts
scraper/cli.py                 TOCAR  cli.add_command(media_group, name="media")
scraper/config.py              TOCAR  GEMINI_API_KEY, FRAME_MEDIA_* (§C.6)
scraper/models.py              TOCAR  r2_view_keys / r2_video_keys / r2_model_keys (§3.1)
scraper/sync.py                TOCAR  --with-media: encola tras upsert_product()
scraper/medusa_push.py         TOCAR  publicar medios ya generados en metadata
pyproject.toml                 TOCAR  `requests` (gemini_media) si no está ya
```

`images._optimize_image` y `images._get_s3_client` se **importan**, no se copian: es lo
que hace literal el requisito 1.

### `apps/backend/` (Medusa) — estado, dinero y panel

```
src/modules/frame-media/{index,service}.ts, models/index.ts,
  migrations/CreateFrameMediaAsset1.ts             NUEVO
src/lib/frame-media.ts            NUEVO  máquina de estados, fingerprint, lease, elegibilidad
src/lib/frame-media-settings.ts   NUEVO  escalera + techos (patrón resolveOcrSettings)
src/lib/frame-media-cost.ts       NUEVO  espejo de tarifas + estimaciones (patrón ocr-models.ts)
src/lib/frame-media-pilot.ts      NUEVO  PILOT_HANDLES (Apéndice B.4)
src/api/admin/frame-media/route.ts, middlewares.ts, progress/route.ts,
  enqueue/route.ts, claim/route.ts, report/route.ts,
  [id]/{route,retry,model}.ts, budget/route.ts, tier/route.ts,
  work-order/route.ts                              NUEVO
src/api/store/frame-models/route.ts NUEVO  manifiesto público de GLBs para vto-web
src/api/middlewares.ts            TOCAR  bodyParser 25mb solo en [id]/model (subida de .glb)
```

`claim` y `report` son las dos rutas que usa el CLI; el resto las usa el panel. **No hay
`jobs/frame-media-drain.ts`**: el drenaje es `python -m scraper media generate`.

### `apps/vision-measure/` — **sin cambios**

La revisión 2 le añadía cuatro rutas. Ya no: el CLI importa `gemini_media` directamente
(§4.1). Este directorio queda exactamente como está.

### `apps/capri-storefront/`

> Todo lo de esta tabla está especificado a nivel de código en el **Apéndice A**,
> escrito para que otro agente lo implemente sin leer el resto del plan.

```
src/admin/adminMedia.js        NUEVO  llamadas + reason→clave. Devuelve CLAVES, no prosa
src/admin/MediaTab.jsx         NUEVO  (AdminDashboard.jsx ya pasa de 1.000 líneas)
src/admin/AdminDashboard.jsx   TOCAR  TABS += "media"
src/data/medusaCatalog.js      TOCAR  mapear views/video/model3d
src/data/imageUrl.js           TOCAR  alias resolveMedia
src/components/ProductGallery  TOCAR  miniaturas de vista + botón de video, condicionales
src/i18n/translations.js       TOCAR  ~85 claves adm.media.* + pdp.media.* en es Y en en
scripts/export-catalog.mjs     NUEVO  (§8.3)
```

### Lote piloto — **ya hecho**

```
scripts/build-pilot-set.mjs        HECHO  generador determinista de la cohorte
apps/backend/src/lib/frame-media-pilot.json   HECHO  70 monturas / 152 colorways / 608 vistas
apps/backend/src/lib/frame-media-pilot.ts  NUEVO  expone PILOT_HANDLES (Apéndice B.4)
```

### `apps/vto-web/`

```
index.html / src   TOCAR  leer el manifiesto de /store/frame-models al arrancar
```

---

## 10. Fases

| Fase | Contenido | Días | Puerta de salida |
|---|---|---|---|
| **0** | **Calibración.** `media generate --handle sl107-simply-lite --handle dc-50-di-caprio --kind all`, leer los `cost.json`. Decidir `2K` vs `1K` | 0,5 | La columna "estimado" de §2 pasa a "medido". Nadie autoriza un lote antes |
| **1** | Módulo, migración, lease, fingerprint, escalera, rutas admin (`claim`/`report`/`enqueue`/`progress`), siembra del piloto. **Sin generar nada** | 2 | `media plan --pilot` imprime 608 vistas y su costo sin gastar un centavo |
| **2** | El CLI: `plan`/`generate`/`status`, `gemini_media` vendorizado, WebP + R2, reintentos (403/404 no), `--max-cost` | 2,5 | Las 20 Simplylite de punta a punta; `cost_usd` cuadrando con la consola de Google; Ctrl-C y relanzar continúa sin repetir |
| **3** | Pestaña Medios: matriz, filtros, costo antes de confirmar, panel de escalera y gasto | 2 | `pnpm check:i18n` en verde; `money()`/`shortDate()` siguen el idioma |
| **4** | Catálogo y ficha: metadata, `medusaCatalog.js`, galería condicional, `export-catalog.mjs` | 1,5 | Un colorway con vistas las muestra; uno sin ellas se ve como hoy. El doc de Meilisearch **no** cambia (§C.5) |
| **5** | `sync --with-media`: campos nuevos, encolado, publicación en `medusa_push` | 1 | `sync --full --dry-run --with-media` no gasta nada y encola bien. `len(r2_image_keys) == len(colors)` sigue siendo cierto |
| **6** | Video en el CLI: `--kind video`, `operation` persistido antes de sondear, modos `list`/`all` | 1 | Ctrl-C a los 3 min de un Veo y relanzar retoma la operación en vez de pagar otra |
| **7** | GLB: orden de trabajo, subida validada, manifiesto público, `vto-web` | 2 | Un `.glb` sube, valida y carga en el probador (con CORS de R2 verificado) |
| **8** | Publicación: revisión visual y `media publish` | 1 | §11 |
| | **Total** | **~13,5** | |

Las fases 0–4 entregan la pregunta original (las 4 vistas, guardadas como las imágenes de
hoy, visibles en la ficha). La 5 automatiza. La 6 y la 7 son independientes entre sí.

El total no baja pese a eliminarse `vision-measure` y el drenaje (§4.1): ese trabajo se
convierte en el CLI, que a cambio necesita argumentos, confirmación de gasto y un modo de
corrida larga reanudable. Se cambia complejidad de arquitectura por complejidad de
interfaz de línea de comandos — mejor trato, porque la segunda la ve y la controla el dueño.

### Detalle de la Fase 7 (GLB)

El CX22 no genera 3D y este backend no opera ese pipeline. El flujo es de **orden de
trabajo**, no de generación:

1. "Solicitar 3D" → fila `awaiting_external`.
2. `GET /admin/frame-media/work-order?handles=…` → zip con las fotos del proveedor, las
   4 vistas ya generadas y un manifiesto con las convenciones de `3d-samples/index.json`
   (mm, up=Y, forward=−Z, origen en el puente). Es la entrada que quiere Hunyuan3D/TRELLIS.
3. El dueño corre el pipeline GPU aparte, a mano.
4. `POST /admin/frame-media/:id/model` sube el `.glb` + su ficha. Se validan magic bytes
   glTF, versión, tamaño máximo y los campos contra `frame_spec_loader`. Un `.glb` corrupto
   en el probador es una pantalla negra sin error.
5. `GET /store/frame-models` publica el manifiesto; `vto-web` lo lee al arrancar en vez de
   las tarjetas cableadas en `index.html`.

**Verificar temprano:** `GLTFLoader` hace un fetch cross-origin al `.glb` en R2. El bucket
necesita regla CORS para el origen del storefront, o el probador falla en producción y
funciona en local.

---

## 11. La advertencia que el propio módulo escribe en mayúsculas

El docstring de `gemini_media.py`, sobre las vistas generadas:

> READ THIS BEFORE FEEDING THE VIEWS INTO 3D RECONSTRUCTION. These views are INVENTED,
> not observed.

**a) Publicarlas en la ficha es decisión del dueño, no del código.** Una "vista trasera"
inventada de una montura que la tienda vende de verdad puede diferir del producto físico.
Por eso `published` es columna aparte de `status`, en `false` por defecto (decisión 3):
**generar y publicar son dos actos distintos**. Las vistas nacen internas — ya útiles como
entrada del pipeline 3D — y el paso a la ficha es un clic explícito, con
`media_generated: true` viajando hasta el componente por si más adelante se quiere marcar.

**b) Como entrada de reconstrucción 3D es una apuesta, no una mejora garantizada.** Una
vista consistente regulariza la reconstrucción; una invención confiada la fija en un error.
El módulo dice que es una pregunta empírica **por montura**. En la Fase 7 hay que comparar
un GLB hecho solo con fotos reales contra uno hecho con fotos + vistas generadas, sobre las
7 monturas de `3d-samples/` que ya están preparadas justo para eso.

---

## 12. Reglas del proyecto que este trabajo debe respetar

- **i18n**: `adminMedia.js` no puede llamar a `useLang()`, así que **no devuelve prosa**:
  devuelve claves (`"adm.media.err.budgetExceeded"`). El backend manda `reason` (código) +
  `message` (nota inglesa para logs); el panel traduce a `adm.media.err.<reason>`, igual que
  `stageErrorText()` en `adminOrders.js`. Moneda con `money(v, currency, lang)`, fechas con
  `shortDate(v, lang)`.
- **Nunca confiar en totales del cliente**: el costo que pinta el panel es informativo; el
  techo se aplica **en el servidor**, al reclamar la fila.
- **Auditoría**: cada acción de gasto emite
  `console.info(JSON.stringify({event: "frame_media.enqueued", kind, count, estimated_usd, admin_user_id, timestamp}))`,
  copiando el patrón de `ocr-settings/route.ts`. Un cargo sin nombre detrás no se investiga.
- **Secretos**: `GEMINI_API_KEY` vive **solo** en el `.env` de `apps/scraper`, en el
  servidor. No llega al navegador, ni al backend, ni al panel — que nunca ve una clave ni
  elige un modelo: el modelo es una decisión de gasto, misma regla que en OCR.
- **Todo en inglés en el código**; `video_prompt` se redacta en inglés al moverlo al ajuste.
- **`generate_filler` sigue siendo lo que es**: nada de este pipeline toca precios.
- **Tests** (lo que CLAUDE.md exige probar — validación y precios): aritmética de costos y
  techos, transiciones de la máquina de estados, recuperación de lease vencido, y el
  invariante `len(r2_image_keys) == len(colors)` tras generar medios.

---

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| Anexar vistas a `r2_image_keys` desordena las variantes en silencio | Campos separados (§3.1) + test del invariante |
| Gasto descontrolado | Escalera + tres techos + cortacircuitos; costo visible antes de confirmar |
| `sync` se convierte en un evento de gasto | `--with-media` apagado por defecto, y encola hacia el ejecutor acotado en vez de llamar a Gemini (§4.3) |
| Un `--all` mal tecleado vacía el presupuesto | `--max-cost` **obligatorio** en `generate`; sin selección explícita el comando falla (§C.3) |
| La corrida larga muere al cerrar la sesión ssh | El estado se recupera solo al vencer el lease; `nohup`/`tmux` documentado (§C.7) |
| Filas zombis en `running` tras un reinicio | `lease_until` + `SKIP LOCKED` (§5, nivel 2) |
| Pagar dos veces por la misma vista | Único `(variant_sku, kind, slot)` + fingerprint; `done` no se reclama |
| 429 de Gemini | `--concurrency` (default 2), backoff exponencial; el módulo no reintenta, el CLI sí |
| Ctrl-C durante un Veo | El `operation` se escribe en Medusa antes de sondear; la siguiente corrida lo retoma (§4.5) |
| Identidad cambiada en la vista trasera | Fallo conocido (`IDENTITY_GUARD`); revisión visual antes de `published`, reintento por vista |
| `2K` multiplica la factura sin aportar | La Fase 0 lo mide contra el hecho de que R2 guarda a 1600px |
| Generar sin R2 configurado = pagar y tirar | La función se apaga si `r2_configured` es falso (§3.2) |
| CORS de R2 rompe el probador solo en producción | Verificar la carga cross-origin del `.glb` en la Fase 7 |
| `catalog.json` se queda atrás | `scripts/export-catalog.mjs` (§8.3) |
| Tarifas de Google desactualizadas | Overridables por env; cada recibo lleva su tarifa y su fecha de lectura |

---
---

# Apéndice A — Guía de interfaz gráfica

**Destinatario: otro agente que implemente la parte visual sin haber leído el resto
del plan.** Todo lo necesario está aquí. Los números de línea son del estado del repo
al escribir esto (septiembre 2026): **verifícalos antes de editar**, no confíes en ellos.

## A.0 Contrato de trabajo

1. **Lee el archivo antes de tocarlo.** Las formas de datos de abajo son reales, copiadas
   del código, pero el repo cambia.
2. **Ningún string visible se escribe en el componente.** Va al diccionario
   `src/i18n/translations.js`, en **`es` y en `en`**, y se pinta con `t("clave")`.
   Incluye `aria-label`, `title` y `alt`. `pnpm check:i18n` falla si una clave existe en
   un idioma y no en el otro (§A.7).
3. **Toda imagen o medio pasa por `resolveImage()`** (`src/data/imageUrl.js`). El
   comentario de cabecera de ese archivo ya lo advierte: una clave R2 desnuda renderizada
   directa da una ruta relativa que 404 en un cuadro gris, sin fallar en voz alta.
4. **Comentarios y nombres en inglés** (CLAUDE.md). Verás comentarios en español
   heredados en `ProductDetail.jsx`; no los imites en código nuevo.
5. **Todo es opcional.** Un colorway sin medios generados debe verse **exactamente igual
   que hoy**. Ninguna pantalla puede mostrar un hueco, un cuadro roto ni un botón muerto.
   Esto no es cosmético: los medios se generan a goteo (§6), así que durante semanas la
   mayoría de las fichas no los tendrá.

## A.1 La forma de los datos

Hoy, un producto del catálogo llega a los componentes así (`toFrame`/`colorsOf` en
`src/data/medusaCatalog.js:46-53`):

```js
{
  sku, name, slug, brand, brand_slug, price,
  attributes: { shape, material, gender, ... },
  colors: [
    { name: "Black", image: "https://cdn…/dc407_00.webp", hex: "#111", variantId: "variant_01…" },
  ],
}
```

Después de este trabajo, `colors[]` gana **tres campos opcionales**. Nada más cambia:

```js
colors: [
  {
    name: "Black", image: "…", hex: "#111", variantId: "…",

    // NUEVOS — cualquiera puede faltar, y lo normal al principio es que falten
    views:   { front: "…", left: "…", right: "…", back: "…" },  // parcial: puede traer solo 2
    video:   { src: "…", poster: "…" },
    model3d: "…",                       // clave del .glb; la consume el probador, no la ficha
    mediaGenerated: true,               // marca de origen: esto lo produjo un modelo
  },
]
```

El mapeo lo hace `colorsOf()` en `medusaCatalog.js`. Extiéndelo así (una sola función):

```js
function mediaOf(v) {
  const m = v.metadata || {};
  const views = Object.fromEntries(
    Object.entries(m.views || {})
      .filter(([, key]) => key)
      .map(([slot, key]) => [slot, resolveImage(key)])
  );
  return {
    views: Object.keys(views).length ? views : undefined,
    video: m.video ? { src: resolveImage(m.video), poster: resolveImage(m.video_poster) } : undefined,
    model3d: m.model3d ? resolveImage(m.model3d) : undefined,
    mediaGenerated: Boolean(m.media_generated) || undefined,
  };
}
```

y en `colorsOf`: `return { name, image: resolveImage(raw), hex: hexFor(name), variantId: v.id, ...mediaOf(v) };`

`undefined` en vez de `{}` o `null` es deliberado: permite que los componentes usen
`color.views?.front` y que `{color.video && …}` sea falso sin comprobaciones anidadas.

**El camino estático** (`public/catalog.json`, sin Medusa) usa la misma forma; el
exportador de §8.3 la escribe igual. Los componentes no distinguen las dos fuentes, y
no deben intentarlo.

## A.2 El problema de los dos ejes (léelo antes de tocar la galería)

Esto es lo único de esta guía que se puede hacer mal de forma no obvia.

La tira de miniaturas del PDP **no es un carrusel de imágenes: es el selector de color.**
En `ProductDetail.jsx:100-106`:

```jsx
<div className="pdp-thumbs">
  {product.colors.map((c, i) => (
    <button className={`pdp-thumb ${i === active ? "sel" : ""}`} onClick={() => setActive(i)}>
      <img src={c.image} alt={c.name} />
    </button>
  ))}
</div>
```

`active` es **el índice del color**, y de él salen el precio, el `variantId` que se añade
al carrito y el enlace al flujo de receta. Si metes las 4 vistas dentro de ese `map`, o
mezclas vistas y colores en el mismo array, `active` deja de significar "color" y **el
cliente compra la variante equivocada**. Es un fallo de checkout, no de maquetación.

La regla: **dos ejes, dos controles.**

```
  ANTES                             DESPUÉS
  ┌───────────────┐                 ┌───────────────┐
  │               │                 │               │
  │  imagen del   │                 │  imagen de    │
  │  color activo │                 │  color+vista  │
  │               │                 │               │
  └───────────────┘                 └───────────────┘
  [■][□][□]  ← color                [◀frente][izq][der][detrás][▶video]  ← vista (NUEVO)
                                    [■][□][□]                            ← color (IGUAL)
```

- `active` (color) → **no se toca**. Sigue gobernando precio, carrito y receta.
- `view` (estado nuevo, local a la galería) → solo decide qué se pinta en `.pdp-main`.
- Cambiar de color **resetea `view`** al original. Las vistas son por colorway: la
  "izquierda" del Black no existe para el Light Pink hasta que se genere.

## A.3 PDP — `src/pages/ProductDetail.jsx`

### Estado nuevo

```jsx
// Which media the main frame shows for the active colour. "photo" is the supplier
// original and the only one guaranteed to exist; the rest appear as they are generated.
const [view, setView] = useState("photo");
// Colours are generated independently, so a slot available for one may be missing on the
// next. Resetting on colour change avoids showing a blank frame for a view that has no file.
useEffect(() => { setView("photo"); }, [active]);
```

### Qué se pinta en `.pdp-main`

```jsx
const media = color.views || {};
const shown = view === "photo" ? color.image : media[view];
const isVideo = view === "video" && color.video;
```

Sustituye el `<img>` de `ProductDetail.jsx:94-95` por:

```jsx
{isVideo ? (
  <video
    key={color.video.src}
    className="fade-in pdp-video"
    src={color.video.src}
    poster={color.video.poster || color.image}
    controls
    playsInline
    preload="none"          /* an 8 s clip is several MB: never download it unasked */
    onClick={(e) => e.stopPropagation()}   /* the frame toggles zoom; the player must not */
  />
) : (
  <img key={shown} src={shown} alt={`${product.name} ${color.name}`} className="fade-in"
       onError={(e) => { e.currentTarget.style.opacity = 0.3; }} />
)}
```

Cuatro detalles que parecen menores y no lo son:

- **`key={shown}`** (hoy es `key={color.image}`). El `key` es lo que remonta el `<img>` y
  vuelve a disparar la animación `fade-in`. Si lo dejas atado a `color.image`, al cambiar
  de vista la imagen se sustituye sin transición y el cambio se ve como un salto.
- **`preload="none"`** en el vídeo. Sin eso, cada visita al PDP descarga megabytes que
  casi nadie va a reproducir. Es la diferencia entre una función y un impuesto de ancho
  de banda en cada carga de ficha.
- **`e.stopPropagation()`** en el vídeo. `.pdp-main` tiene `onClick` para el zoom
  (`ProductDetail.jsx:89`): sin frenar la propagación, darle a "play" hace zoom.
- **El corazón de favoritos guarda `color.image`, nunca `shown`** (`ProductDetail.jsx:92`).
  Un favorito debe recordar la foto real del producto, no el ángulo que el cliente estaba
  mirando — y menos uno generado. **No toques esa línea.**

### El selector de vista (nuevo, encima de `.pdp-thumbs`)

Se renderiza **solo si hay algo que ofrecer**:

```jsx
const SLOTS = ["front", "left", "right", "back"];
const available = SLOTS.filter((s) => media[s]);

{(available.length > 0 || color.video) && (
  <div className="pdp-views" role="group" aria-label={t("pdp.media.group")}>
    <button className={`pdp-view ${view === "photo" ? "sel" : ""}`}
            aria-pressed={view === "photo"} onClick={() => setView("photo")}>
      {t("pdp.media.photo")}
    </button>
    {available.map((slot) => (
      <button key={slot} className={`pdp-view ${view === slot ? "sel" : ""}`}
              aria-pressed={view === slot} onClick={() => setView(slot)}>
        {t(`pdp.media.view.${slot}`)}
      </button>
    ))}
    {color.video && (
      <button className={`pdp-view ${view === "video" ? "sel" : ""}`}
              aria-pressed={view === "video"} onClick={() => setView("video")}>
        ▶ {t("pdp.media.video")}
      </button>
    )}
  </div>
)}
```

`available` filtra por existencia: si solo se generaron `front` y `left`, aparecen dos
botones, no cuatro grises. Un botón deshabilitado le dice al cliente que le falta algo;
un botón ausente no le dice nada, que es lo correcto aquí.

`t(\`pdp.media.view.${slot}\`)` es una clave dinámica → hay que registrar el prefijo en
el linter (§A.7) o `pnpm check:i18n` no cubrirá esa familia.

### Lo que NO se toca en este archivo

`active`, `setActive`, `toggleFav`, el botón de receta (`ProductDetail.jsx:147`), el de
carrito (`:150-151`) y `<TryOn …colorIdx={active}>` (`:212`). Ninguno sabe que existen
las vistas y ninguno debe enterarse.

## A.4 Tarjeta de catálogo — `src/components/ProductCard.jsx`

**No añadas vistas ni vídeo a la tarjeta.** Razones, en orden de peso:

1. `ProductCard` se renderiza hasta 550 veces en `/catalogo`. Un `<video>` por tarjeta
   —aunque sea `preload="none"`— es un elemento multimedia por producto, y el hover ya
   cambia el color activo (`onMouseEnter` en `:98`). Se convierte en una rejilla que
   reproduce cosas sola.
2. Los `swatches` (`:97-101`) tienen el mismo doble eje que el PDP y el mismo riesgo:
   `active` gobierna `color.variantId`, que es lo que se añade al carrito en `:41`.

Único cambio admisible, y solo si el dueño lo pide después: un distintivo estático
(`◈`) sobre la tarjeta cuando `color.model3d` existe, para indicar que esa montura tiene
probador 3D real. Nada que reproduzca, nada que cambie al pasar el ratón.

## A.5 Probador 3D — `src/components/TryOn3D.jsx`

El lanzador ya manda `?sku=`, `?color=` y `?glassesImageUrl=` al iframe (`:44-49`), y su
comentario dice que hoy solo `sample-frame` tiene `.glb` real. Cuando existan modelos por
SKU, **el cambio no va aquí**: `vto-web` resuelve el modelo leyendo el manifiesto de
`GET /store/frame-models` (Fase 7). Este componente ya pasa el `sku`; con eso basta.

Lo único que sí conviene añadir aquí es aprovechar una vista frontal generada como
`glassesImageUrl` cuando exista, porque es un packshot limpio sobre blanco y el panel de
IA del probador trabaja mejor con eso que con la foto de proveedor en tres cuartos:

```jsx
const frameShot = color?.views?.front || color?.image;
if (frameShot) params.set("glassesImageUrl", frameShot);
```

## A.6 Resolución de URLs — `src/data/imageUrl.js`

Añade el alias y nada más:

```js
/** Same key→URL resolution as images; named apart so a video call does not read as a lie. */
export const resolveMedia = resolveImage;
```

No escribas una segunda función. Una clave R2 es una clave R2, y duplicar la lógica es
cómo se termina con dos comportamientos distintos ante `VITE_R2_PUBLIC_URL` vacío.

## A.7 Diccionario — `src/i18n/translations.js`

Estructura: `export const T = { es: {…}, en: {…} }`. Añade **el mismo juego de claves en
los dos bloques**. Sitúalas junto a las demás `pdp.*`.

| Clave | es | en |
|---|---|---|
| `pdp.media.group` | Vistas del producto | Product views |
| `pdp.media.photo` | Foto | Photo |
| `pdp.media.view.front` | Frente | Front |
| `pdp.media.view.left` | Izquierda | Left |
| `pdp.media.view.right` | Derecha | Right |
| `pdp.media.view.back` | Detrás | Back |
| `pdp.media.video` | Vídeo | Video |

**Paso que se olvida siempre:** `t(\`pdp.media.view.${slot}\`)` se arma en tiempo de
render, así que el linter no puede resolverlo estáticamente. Añade el prefijo a
`DYNAMIC_PREFIXES` en `scripts/check-i18n.mjs:30`:

```js
const DYNAMIC_PREFIXES = ["adm.range.", "adm.tab.", "adm.lens.cat.", "adm.err.stage.",
                          "adm.dow.", "pdp.media.view.", "adm.media.status.", "adm.media.err."];
```

Sin esto el check pasa igual — pero deja de vigilar esas familias, que es peor que fallar.

## A.8 CSS — `src/styles/index.css`

Junto a las reglas `.pdp-*` existentes (líneas ~165-175). Usa las variables ya definidas
(`--radius`, etc.); no introduzcas una paleta nueva.

```css
.pdp-views { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.pdp-view  { padding: 6px 12px; border-radius: 999px; border: 1px solid #dfe5f0;
             background: #fff; font-size: .82rem; cursor: pointer; transition: all .15s; }
.pdp-view:hover { border-color: #b9c6de; }
.pdp-view.sel   { background: #0f285a; border-color: #0f285a; color: #fff; }
.pdp-video { max-height: 340px; width: 100%; object-fit: contain; border-radius: var(--radius); }
```

`.pdp-main.zoom img { transform: scale(1.6) }` ya existe y sigue aplicando a las vistas
(son `<img>`). El vídeo queda fuera del zoom a propósito: tiene sus propios controles.

## A.9 Panel del dueño — pestaña «Medios»

Archivos: `src/admin/MediaTab.jsx` (nuevo), `src/admin/adminMedia.js` (nuevo),
`src/admin/AdminDashboard.jsx` (una línea), `src/admin/admin.css`.

### Enganche

`AdminDashboard.jsx:986` — `const TABS = ["overview","sales","orders","products","prices"]`
pasa a incluir `"media"`, y junto a `{tab === "prices" && <Prices/>}` (`:1010`) se añade
`{tab === "media" && <MediaTab />}`. El rótulo sale solo: la barra pinta
`t(\`adm.tab.${k}\`)`, así que basta con añadir `adm.tab.media` al diccionario.

### `adminMedia.js` — la regla que rompe todo el mundo

Este módulo **no es un componente**, así que no puede llamar a `useLang()` y por tanto
**no puede devolver una sola frase**. Devuelve **claves**; traduce quien pinta. Es la
misma regla que ya sigue `adminOrders.js` con `stageErrorText()`, y existe porque un
módulo que no puede saber el idioma tampoco puede elegir la redacción.

```js
import { adminFetch } from "./adminApi.js";

export const MEDIA_STATUSES = ["pending","running","done","failed","stale",
                               "awaiting_external","blocked_budget","skipped"];

/** Backend `reason` code → dictionary KEY. Never a sentence. */
export function mediaErrorText(err) {
  const reason = err && err.reason;
  return reason ? `adm.media.err.${reason}` : "adm.err.generic";
}

export const getBoard    = (params) => adminFetch(`/admin/frame-media?${new URLSearchParams(params)}`);
export const getProgress = ()       => adminFetch(`/admin/frame-media/progress`);
export const enqueue     = (body)   => adminFetch(`/admin/frame-media/enqueue`, { method: "POST", body });
```

En el componente: `toast({ tone: "error", message: t(mediaErrorText(err)) })`.

### Composición de la pestaña

```
┌─ Progreso ────────────────────────────────────────────────┐
│  Vistas   ███████████░░░░░░░  3.120 / 5.760               │
│  hechas 3.120 · en curso 8 · fallidas 14 · caducadas 108  │
│  Gasto del mes  $118,40 / $150   ·   Nivel 2 (Una marca)  │
│  [Subir a nivel 3]  ← deshabilitado + motivo si no procede│
└───────────────────────────────────────────────────────────┘
[buscar]  [marca ▾] [estado ▾] [☐ solo faltantes] [☐ solo fallidas]

SKU        Color        F  I  D  T   Vídeo  3D    Acciones
DC407      Black        ●  ●  ●  ○   ○      —     [Generar] [Publicar]
DC407      Light Blue   ●  ○  ○  ○   —      —     [Generar]
```

- Los chips por vista (`● hecho · ◐ en curso · ○ pendiente · ✕ fallido · ⟳ caducado`)
  reutilizan el mismo vocabulario de estados del backend. Traduce con
  `t(\`adm.media.status.${estado}\`)` y da a cada chip `title` y `aria-label`.
- **Nunca pintes un color como único portador de significado.** El chip lleva símbolo
  además de color: es la diferencia entre una tabla legible y una ilegible para daltónicos.
- **El costo se muestra antes de confirmar, siempre.** Es el patrón que ya usa
  `/admin/ocr-settings`: una decisión de gasto se toma viendo el gasto. El diálogo dice
  cuántos activos, cuánto costarían al ritmo actual y cuánto queda de techo. Por encima de
  50 activos, exige escribir la cantidad para confirmar.
- **El panel nunca elige el modelo de IA.** Es una decisión de gasto y vive en el
  servidor, igual que en OCR. Si ves un desplegable de modelos en un diseño, está mal.
- `truncated` en la respuesta se muestra: nada de paginar en silencio sobre una respuesta
  parcial (misma regla que el tablero de pedidos).
- Moneda con `money(v, currency, lang)` y fechas con `shortDate(v, lang)`. Un panel que
  se queda en formato español tras cambiar a inglés está traducido a medias.

### Claves `adm.media.*`

Mínimo: `adm.tab.media`, `adm.media.progress`, `adm.media.spend`, `adm.media.tier`,
`adm.media.tierUp`, `adm.media.tierBlocked`, `adm.media.generate`, `adm.media.publish`,
`adm.media.retry`, `adm.media.request3d`, `adm.media.confirmTitle`, `adm.media.confirmCost`,
`adm.media.confirmType`, `adm.media.truncated`, `adm.media.onlyMissing`, `adm.media.onlyFailed`,
`adm.media.status.<8 estados>`, `adm.media.err.<reason>` (uno por código que emita el
backend: `budget_exceeded`, `tier_locked`, `already_done`, `no_source_image`,
`provider_rejected`, `r2_unconfigured`, …). En `es` **y** en `en`.

## A.10 Cómo probarlo sin backend

El storefront arranca con el catálogo semilla (`catalogStore.js` pinta `SEED_PRODUCTS`
antes de que resuelva la carga live), así que se puede desarrollar la galería sin generar
un solo medio: añade a mano `views` y `video` a un producto de `src/data/products.js`
apuntando a cualquier imagen pública, y verifica los cuatro casos:

| Caso | Resultado esperado |
|---|---|
| Colorway sin `views` ni `video` | La ficha se ve **exactamente como hoy**. Sin fila de botones |
| Colorway con 2 de 4 vistas | Dos botones + «Foto». Ninguno gris |
| Cambio de color a uno sin vistas | Vuelve a la foto original; la fila desaparece |
| Vídeo presente | No se descarga hasta pulsar; «play» no dispara el zoom |

Y siempre, antes de dar por terminado: `pnpm check:i18n` en verde y la ficha revisada en
los dos idiomas.

## A.11 Lista de comprobación final

- [ ] `active` sigue siendo el índice de **color** y sigue gobernando `variantId`.
- [ ] Añadir al carrito y «Comprar con receta» dan la misma variante que antes del cambio.
- [ ] El favorito guarda `color.image`, no la vista activa.
- [ ] `key={shown}` en el `<img>` principal.
- [ ] `preload="none"` y `stopPropagation` en el `<video>`.
- [ ] Ninguna vista inexistente produce un botón.
- [ ] Cero strings literales en JSX; `aria-label`/`title`/`alt` incluidos.
- [ ] Prefijos dinámicos registrados en `check-i18n.mjs`.
- [ ] `adminMedia.js` no devuelve ni una frase, solo claves.
- [ ] El diálogo de generación muestra el costo antes de confirmar.
- [ ] Toda URL pasa por `resolveImage`/`resolveMedia`.

---
---

# Apéndice B — Lote piloto

**Ya construido y commiteado.** Generador: `scripts/build-pilot-set.mjs`.
Manifiesto: `apps/backend/src/lib/frame-media-pilot.json`. Regenerable con
`node scripts/build-pilot-set.mjs`.

## B.1 Qué es y por qué existe

Una cohorte **fija** de 70 monturas sobre la que se afina el pipeline antes de apuntarlo
a las 1.440. Sin ella, cada ajuste de prompt, cada cambio de `imageSize` y cada duda
sobre el modelo se paga sobre el catálogo entero: prueba y error a $223 la vuelta.

| | Monturas | Colorways | Vistas | Costo¹ |
|---|---|---|---|---|
| Di Caprio | 50 | 122 | 488 | ~$18,9 |
| Simplylite | 20 | 30 | 120 | ~$4,6 |
| **Total** | **70** | **152** | **608** | **~$23,5** |

¹ Al ancla de $0,0387/imagen. La Fase 0 lo sustituye por el número medido — y ese
reemplazo es precisamente para lo que sirve el lote.

**Un 10,6% del costo del catálogo completo compra el 100% de las respuestas de diseño.**

## B.2 Por qué Di Caprio y Simplylite

**Di Caprio** es la marca de la casa de Capri: 129 monturas, 324 colorways, la más
grande después de Four You y la que el dueño reconoce de un vistazo — importa para la
revisión visual, porque juzgar si una vista trasera generada "es esta montura" exige
conocer la montura. Además es la más heterogénea: 10 formas, 7 materiales, tres géneros,
y colorways que van del `Black` liso al `Burgundy Blue Red White`.

**Simplylite no se eligió por tamaño, sino por dificultad.** Son 29 monturas, **100%
metal y titanio**, y **13 de ellas `3-Piece Rimless`** más 5 `Semi Rimless`. Una montura
al aire de titanio es el peor caso imaginable para un modelo al que se le pide "esta
misma montura, vista desde detrás":

- **no hay aro** que ancle la forma — lo que define la montura es el corte de la lente y
  dos alambres;
- **las lentes son transparentes** sobre el fondo blanco puro que piden los prompts, así
  que buena parte del objeto es literalmente del color del fondo;
- **las varillas son alambre**, y un modelo generativo las engorda con entusiasmo.

Si el pipeline sobrevive a Simplylite, sobrevive a todo lo demás. Y sale barato: 30
colorways en total, porque estas monturas vienen en dos acabados, no en seis.

## B.3 Cómo se eligieron las 70 (y por qué no al azar)

Una muestra aleatoria de 50 sería representativa del catálogo e **inútil como prueba**.
El trabajo de un piloto es encontrar los modos de fallo baratos, así que
`build-pilot-set.mjs` **sobre-muestrea a propósito** los casos donde la preservación de
identidad se rompe, puntuando cada montura:

| Rasgo | Puntos | Por qué |
|---|---|---|
| `3-Piece Rimless` / `Semi Rimless` | +5 | No hay aro que cargue con la identidad |
| Colorway `Clear` / `Crystal` | +4 | El objeto es del color del fondo |
| Metal / acero / titanio / memoria | +2 | Alambre fino que el modelo engorda |
| Colorway pálido (`Light…`, `Champagne`, `Beige`, `Silver`…) | +2 | Bajo contraste sobre blanco |
| Multitono (`Fade`, `Marble`, `Tortoise`, 3+ palabras) | +2 | El color **está colocado**: es fácil equivocarse de forma plausible |
| Forma inusual (geométrico, navegador, aviador, redondo) | +1 | Menos frecuente en el entrenamiento |

La selección va en tres pasadas, y la tercera es la que importa:

1. **Cobertura** — al menos una montura por cada forma, material, estilo, género y edad,
   para que ningún tipo quede sin representar (18 monturas).
2. **Controles (20% reservado)** — las monturas **más fáciles** del lote: acetato opaco,
   full frame, `Black`/`Brown`/`Grey` (14 monturas).
3. **Dificultad** — el resto, por puntuación descendente (38 monturas).

**La cuota de controles no es opcional, y la primera versión del script lo demostró:**
ordenar por dificultad y tomar las 50 primeras produjo 70 monturas con **cero controles**
—puras al aire y transparentes— que habrían encontrado los fallos duros y dejado pasar
una regresión en las corrientes, que son el 90% del catálogo y el 90% de la factura.
Por eso la cuota se reserva antes de repartir, no se espera que salga sola.

Cobertura resultante por rasgo:

```
thin-metal 46 · metallic 42 · pale 17 · transparent 15 · rimless-3piece 10
rimless 9 · multitone 9 · unusual-shape 12 · controles 14
```

Cada entrada del manifiesto lleva **por qué entró**, así que un piloto decepcionante se
lee (`"sub-muestreamos multitono"`) en vez de discutirse:

```json
{ "sku": "SL107", "handle": "sl107-simply-lite", "seed_slug": "sl107",
  "brand": "Simplylite", "colorways": ["Gunmetal", "Silver"],
  "style": "Semi Rimless", "material": ["Metal", "Titanio"],
  "difficulty": 9, "tags": ["pale", "rimless", "thin-metal"],
  "selected_because": "difficulty:pale+rimless+thin-metal" }
```

### Los dos slugs (trampa al encolar)

El catálogo no trae el identificador de Medusa, así que el generador lo reconstruye con
**la regla del scraper** (`parser.py:193`): `slug(name) + "-" + brand_slug`, donde cada
racha de caracteres no alfanuméricos se convierte en **un** guion.

El storefront usa una regla **distinta** para su catálogo semilla
(`products.js:110`): borra el separador en vez de sustituirlo. Con SKUs que llevan
espacio, las dos divergen:

| SKU | `handle` (Medusa — el que encola) | `seed_slug` (storefront local) |
|---|---|---|
| `DC 50` | `dc-50-di-caprio` | `dc50` |
| `DC400 CLIP` | `dc400-clip-di-caprio` | `dc400clip` |
| `SL107` | `sl107-simply-lite` | `sl107` |

`catalogStore.matchProduct()` reconcilia ambos al pintar, pero **el `enqueue` habla con
Medusa**: usa `handle`, siempre. `seed_slug` se emite solo para que un humano encuentre
la montura en el storefront local. Cuatro de las 70 tienen espacio en el SKU, así que
esto no es teórico: usar el slug equivocado deja el 6% del piloto sin encolar, en
silencio.

## B.4 Cómo se usa

**Fase 0 (calibración, 2 monturas · ~$0,9 + 1 video):** `SL107` —la más difícil del lote,
d=9— y `DC 50` —control corriente, acetato opaco negro—. Si la vista trasera de `SL107`
sale reconocible, el resto del catálogo es cuesta abajo; si `DC 50` falla, el problema no
son las monturas.

**Fase 1 (nivel 1, 20 monturas · ~$4,6):** solo Simplylite. Primero lo difícil: si hay
que reescribir prompts, mejor descubrirlo con 120 vistas que con 608.

**Fase 2 (nivel 2, las 70 · ~$23,5):** el lote completo, incluidos los 14 controles. Es
la corrida que autoriza —o no— el paso al catálogo.

En el backend:

```ts
// apps/backend/src/lib/frame-media-pilot.ts
import pilot from "./frame-media-pilot.json";
/** Handles of the fixed pilot cohort. See docs/frame-media-generation.md, Appendix B. */
export const PILOT_HANDLES: string[] = pilot.frames.map((f) => f.handle);
```

`resolveJsonModule` ya está activo en `tsconfig.base.json:11`, así que el import compila.
**Verificar en la Fase 1** que el `.json` acaba también en `.medusa/server/src/lib/` tras
`pnpm build`: si el build de Medusa no copia el JSON, `PILOT_HANDLES` explota en
producción y no en desarrollo, que es la peor combinación. Si no lo copia, el manifiesto
se emite como `.ts` en vez de `.json` (una línea del generador).

En el panel, la pestaña Medios lleva un botón **«Sembrar lote piloto»** que encola solo
esos handles, con su costo estimado a la vista como cualquier otra acción de gasto (§A.9).
No es un modo aparte: es el mismo `enqueue` con una lista fija.

## B.5 Criterios de aceptación del piloto

Se revisan las 608 vistas a ojo, en el panel, y se anota por vista aceptada/rechazada.
El lote **pasa** si:

| Criterio | Umbral | Por qué ese umbral |
|---|---|---|
| Vistas aceptadas, global | ≥ 90% | Por debajo, la revisión manual cuesta más que las imágenes |
| Vistas aceptadas, **en los 14 controles** | ≥ 90% | Si falla lo fácil, el problema es el pipeline, no el catálogo |
| Identidades cambiadas **no detectadas** | 0 | Una montura distinta publicada como si fuera la real es el peor fallo del sistema |
| Desvío costo real vs. estimado | < 10% | Un modelo de costos que no predice no sirve para autorizar $223 |
| Vistas `back` aceptadas | ≥ 75% | Es el ángulo que más inventa; se mide aparte para no esconderlo en el promedio global |

Si el lote **no** pasa, lo barato es cambiar prompts o bajar `IMAGE_SIZE` y repetir: cada
vuelta cuesta ~$23, no ~$223. Ese es el propósito entero de este apéndice.

## B.6 Mantenimiento

El manifiesto se regenera cuando el catálogo cambia de forma relevante:

```bash
node scripts/build-pilot-set.mjs             # → apps/backend/src/lib/frame-media-pilot.json
node scripts/build-pilot-set.mjs --out /tmp/x.json   # para comparar sin sobrescribir
```

Es determinista: sin RNG, empates resueltos por SKU, así que dos corridas sobre el mismo
catálogo dan bytes idénticos y un `git diff` del manifiesto muestra exactamente qué
monturas entraron o salieron. **Regenerarlo a mitad de un piloto invalida la comparación**
— si el catálogo cambia durante la evaluación, se termina el lote en curso y se regenera
después.

---
---

# Apéndice C — El CLI de medios

Ejecutor del sistema. Corre **en el servidor remoto, a mano, cuando el dueño decide**.
Subcomando del scraper: misma app, mismo `.env`, mismo `uv`.

```
python -m scraper media <acción> [opciones]
```

## C.1 Por qué un CLI y no un botón

El panel puede encolar y puede publicar, pero **no dispara la generación**. La razón es
que una corrida real dura horas y cuesta dinero: quien la lanza tiene que poder verla,
acotarla y cortarla. Un botón en un navegador no da nada de eso — da una petición HTTP
que muere con la pestaña.

El reparto queda: **el panel decide qué, el CLI decide cuándo.** Un `pending` en el panel
es trabajo autorizado que espera a que alguien lo ejecute, no trabajo perdido; `media
status` lo dice desde el servidor y la pestaña Medios lo dice desde el navegador, leyendo
la misma tabla.

## C.2 Acciones

| Acción | Gasta | Qué hace |
|---|---|---|
| `plan` | **no** | Resuelve la selección, imprime cuántos activos y cuánto costarían. El ensayo obligatorio |
| `generate` | **sí** | Reclama, genera, optimiza, sube a R2 y reporta. La única que llama a Gemini |
| `status` | no | Progreso desde Medusa: por tipo, por marca, gasto del mes, techo, qué corrida tiene leases vivos |
| `publish` | no | Pasa activos aceptados a `published = true` (decisión 3) |
| `retry` | no | Devuelve `failed` a `pending` y pone `attempts` a 0 |
| `verify` | no | Comprueba que cada `done` tiene su objeto en R2 y su clave en la metadata de la variante |

`plan` y `generate` aceptan **exactamente los mismos** argumentos de selección. Es
deliberado: se ensaya y se ejecuta cambiando una palabra, sin reescribir el comando —
que es donde se cuelan los errores caros.

## C.3 Argumentos

### Selección — qué monturas (excluyentes entre sí, salvo `--kind`)

| Argumento | Ejemplo | Notas |
|---|---|---|
| `--pilot` | `--pilot` | Las 70 del Apéndice B. Lee `frame-media-pilot.json` |
| `--pilot-brand` | `--pilot-brand simplylite` | Solo esa marca **dentro** del piloto (nivel 1 de la escalera) |
| `--brand` | `--brand di-caprio` | Marca completa del catálogo |
| `--handle` | `--handle sl107-simply-lite` | Repetible. **Handle de Medusa**, no `seed_slug` (§B.3) |
| `--from-file` | `--from-file lote.txt` | Un handle por línea; `#` comenta |
| `--all` | `--all` | Todo el catálogo. Exige `--yes` y `--max-cost` |
| `--pending` | `--pending` | Lo que ya está encolado desde el panel, sin volver a seleccionar |

Sin ninguno, el comando falla pidiendo uno. **No hay selección por defecto**: un default
en el argumento que decide cuánto se gasta es una trampa esperando a que alguien pulse
Enter de más.

### Alcance — qué medios

| Argumento | Valores | Default |
|---|---|---|
| `--kind` | `views` · `video` · `model3d` · `all` | `views` |
| `--slot` | `front,left,right,back` (lista) | las cuatro |
| `--colorway` | nombre exacto, repetible | todos |

`--slot back` sirve para lo que más falla: reintentar solo la vista trasera de un lote,
que es donde el modelo inventa monturas distintas (§11).

### Frenos — lo que impide un accidente

| Argumento | Default | Notas |
|---|---|---|
| `--max-cost USD` | — | **Obligatorio en `generate`.** Corta al llegar, deja el resto en `pending` |
| `--limit N` | — | Máximo de activos de esta corrida |
| `--dry-run` | off | Recorre todo sin llamar a Gemini ni subir nada. Igual que en `sync` |
| `--yes` | off | Salta la confirmación interactiva. Necesario en cron, peligroso a mano |
| `--force` | off | Regenera activos en `done`. Pide confirmación aunque haya `--yes` |
| `--concurrency N` | 2 | Peticiones simultáneas a Gemini. Subir con cuidado: 429 |
| `--stop-after-failures N` | 10 | Cortacircuitos, mismo valor que `_MAX_CONSECUTIVE_FAILURES` en `sync.py` |

`--max-cost` obligatorio es la decisión de diseño más importante de este apéndice. El
módulo no tiene techo propio, el CLI corre fuera del panel y el catálogo entero son $223:
un comando sin tope es un comando que puede vaciar el presupuesto por un `--all` mal
tecleado. Que el tope sea explícito **en cada invocación** lo convierte en una decisión
consciente, no en una configuración que alguien puso hace tres meses.

### Salida

| Argumento | Notas |
|---|---|
| `--report PATH` | Informe JSON de la corrida: activos, costos, fallos, tiempos |
| `--quiet` | Solo el resumen final |
| `--json` | Salida legible por máquina, para encadenar |

## C.4 Ejemplos, en el orden en que se usan de verdad

```bash
# 0 · Calibración: las dos monturas del nivel 0. Se mira el resultado a ojo.
python -m scraper media generate \
    --handle sl107-simply-lite --handle dc-50-di-caprio \
    --kind all --max-cost 2

# 1 · Ensayo del piloto. NO gasta: imprime 608 vistas y el costo.
python -m scraper media plan --pilot --kind views

# 2 · Nivel 1 de la escalera: solo Simplylite, lo más difícil primero.
python -m scraper media generate --pilot-brand simplylite --kind views --max-cost 6

# 3 · Nivel 2: el piloto completo. Horas: se lanza desatendido y se redirige a un log.
nohup python -m scraper media generate --pilot --kind views \
      --max-cost 30 --yes --report piloto.json > media.log 2>&1 &

# 4 · Desde otra terminal, o al día siguiente:
python -m scraper media status --pilot

# 5 · Solo la vista trasera de las que fallaron:
python -m scraper media retry --pilot --slot back
python -m scraper media generate --pending --slot back --max-cost 5

# 6 · Tras revisar en el panel, publicar lo aceptado:
python -m scraper media publish --pilot --kind views
```

`nohup … &` con redirección es el modo normal de la corrida larga, y es exactamente el
caso que el `reconfigure(encoding="utf-8")` de `cli.py` ya protege: sin él, el primer `✓`
mata la corrida con `UnicodeEncodeError` en cuanto la salida deja de ser una terminal.

## C.5 Indexación

Al terminar cada montura, el CLI hace `POST /admin/frame-media/report`, y Medusa escribe
las claves R2 en la metadata de la variante. Ese `update` del producto **emite
`product.updated`**, y el subscriber `product-meilisearch.ts` (que ya escucha
`product.created` y `product.updated`) reindexa solo.

**La indexación no es un paso que haya que acordarse de correr.** Es consecuencia de
escribir por Medusa, y por eso el CLI nunca habla con Meilisearch ni con R2 para el
índice.

Dos precisiones que evitan una expectativa equivocada:

- **El documento de búsqueda no cambia.** `product-to-document.ts:37` toma
  `thumbnail ?? images[0].url` y una lista de campos fija; ni las vistas ni el video
  entran. Generar medios **no altera la relevancia de búsqueda ni los filtros**. Lo único
  que podría cambiarla es publicar una vista generada como `thumbnail`, y eso no lo hace
  ningún comando de este apéndice.
- **`media verify --reindex`** existe para el caso en que el subscriber no corrió (backend
  caído durante la corrida, o Meilisearch sin credenciales): compara los `done` contra el
  índice y reporta. El barrido completo sigue siendo `pnpm reindex`, que ya existe.

## C.6 Configuración

`.env` de `apps/scraper` — el mismo archivo que ya carga `cli.py` resolviéndolo desde
`__file__`, para que un cron o un contenedor encuentren la misma configuración que un
shell interactivo.

```
GEMINI_API_KEY=...                  # obligatoria para `generate`
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image      # lo lee el propio módulo
GEMINI_VIDEO_MODEL=veo-3.1-fast-generate-preview
GEMINI_IMAGE_USD_PER_1M_OUTPUT=30.0            # tarifas, overridables (§2)

MEDUSA_BACKEND_URL=http://127.0.0.1:9000       # en el mismo servidor
MEDUSA_ADMIN_API_KEY=...                       # HTTP Basic, token como usuario (§4.2)

R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET   # ya existen
```

`config.validate()` gana una comprobación: `generate` sin `GEMINI_API_KEY`, sin R2
configurado o sin poder alcanzar Medusa **falla antes de la primera llamada**, no a los
40 activos. Es el mismo criterio con el que `Config.validate()` ya rechaza un
`R2_ENDPOINT` sin credenciales, y la razón es la misma: aquí un fallo tardío significa
haber pagado por imágenes que no se pueden guardar.

## C.7 Ejecución remota — terminal del servidor

**Decisión del dueño (septiembre 2026): esto NO se dispara desde GitHub Actions.**
Solo a mano, en el servidor, por CLI, hasta que se determine otra cosa.

Conviene registrar el camino descartado y por qué se descartó, porque era tentador: el
scraper **no está desplegado en el CX22** —no tiene Dockerfile propio ni app de Coolify—
y su sync diario corre en **GitHub Actions** (`scraper-sync.yml`), donde ya viven los
secretos `R2_*` y `MEDUSA_*`. Un `workflow_dispatch` con `inputs` habría dado la interfaz
de argumentos gratis. Se descarta igualmente: la generación gasta dinero por petición, y
mientras no se decida lo contrario tiene que haber una persona delante, en el servidor.
Nada en el repositorio la dispara — no hay workflow, ni cron, ni tarea programada.

### Cómo llega el CLI al servidor

Va **dentro de la imagen del backend**, como herramienta bajo demanda, no como proceso:
`docker-entrypoint.sh` no lo menciona y no consume memoria en reposo. Es la misma
decisión de "un contenedor, varias herramientas" que CLAUDE.md ya toma para
`vision-measure`, y por la misma razón: una caja de €4/mes no gana una segunda app de
Coolify para algo que está parado.

```
apps/backend/Dockerfile
  ├── uv + python3           (ya estaban, para vision-measure)
  ├── /app/vision-measure/   proceso, arranca con el contenedor
  └── /app/scraper/          HERRAMIENTA, no arranca nada
```

Dos detalles del build que costaron un fallo cada uno:

- **`.dockerignore` excluía `apps/scraper` entero.** El `COPY` habría reventado el build,
  y solo en el deploy: CI no construye esta imagen. Ahora se excluyen las partes
  concretas (`.venv` son 524 MB, más `tests`, `scripts`, `state.db`).
- **`state.db` se excluye explícitamente.** Hornear el caché incremental de una máquina
  en la imagen haría que el contenedor creyera ya actualizados productos que no ha visto.

### Correrlo

```bash
# Coolify → la app del backend → Terminal   (o `docker exec -it <contenedor> sh`)
cd /app/scraper

uv run python -m scraper media status                       # no gasta nada
uv run python -m scraper media plan --pilot --kind views    # tampoco

uv run python -m scraper media generate     --handle sl107-simply-lite --handle dc-50-di-caprio     --kind views --max-cost 2
```

Notas de operación:

- **Corridas largas: `nohup`, `tmux` o `screen`.** Cerrar la terminal mata el proceso y,
  aunque el estado se recupera solo (§5, nivel 2), se pierden los 20 minutos del lease.
  ```bash
  nohup uv run python -m scraper media generate --pilot --kind views         --max-cost 30 --yes --report piloto.json > media.log 2>&1 &
  ```
- **Una corrida a la vez, por costumbre.** Dos son *seguras* —el `claim` reparte trabajo
  distinto— pero comparten techo y cuota de Gemini, y duplican el riesgo de 429.
- **El CX22 no sufre**: esto es I/O contra HTTPS. Lo único con CPU real es
  `_optimize_image` a WebP, milisegundos por imagen.
- **La variable de entorno la da Coolify**: `GEMINI_API_KEY` se añade a la app del
  backend, junto a las `R2_*` que ese contenedor ya tiene.
- **`--max-cost` sigue siendo obligatorio**, y ahora es la única barrera además del techo
  del servidor: no hay un formulario que valide nada antes.

### Si algún día se automatiza

El diseño no lo impide: `--yes` existe para una terminal sin humano y `--max-cost` seguiría
siendo obligatorio, así que ni un cron mal configurado podría gastar sin tope. Pero es una
decisión de producto pendiente, y hasta que se tome **no hay nada que lo dispare**.

## C.8 Lo que el CLI **no** hace

- **No decide qué generar por su cuenta.** Sin argumento de selección, falla.
- **No genera GLB.** Eso es el pipeline GPU fuera de este repo (Fase 7); el CLI solo
  gestiona la orden de trabajo.
- **No publica en la ficha.** `generate` deja `published = false`; publicar es una acción
  aparte, tras revisión visual (decisión 3, §11).
- **No toca precios, ni `catalog.json`, ni `r2_image_keys`** (§3.1).
- **No guarda estado local.** No hay un `media.db` junto a `state.db`: la verdad está en
  Medusa, y por eso dos servidores distintos pueden correr el mismo comando sin repetir
  trabajo ya pagado.

---
---

# Apéndice D — Puesta en marcha

Estado al escribir esto: **Fases 1 y 2 implementadas**; 3–8 pendientes. Lo de abajo es
lo que hace falta para que el proceso corra de punta a punta en remoto.

## D.1 Las tablas se crean solas al desplegar

`apps/backend/docker-entrypoint.sh:26` ya corre `medusa db:migrate` en **cada** arranque
del contenedor, de forma no bloqueante. La migración `CreateFrameMedia1` viaja con el
backend, así que **no hay ningún paso manual de base de datos**: se aplica cuando Coolify
redespliega.

No se debe correr `medusa db:migrate` desde una máquina de desarrollo contra la base de
producción. No por la migración —es aditiva y toda con `IF NOT EXISTS`— sino porque ese
comando aplica **todas** las migraciones pendientes del árbol de trabajo local, y un
árbol atrasado respecto de `origin` tiene un radio de daño mucho mayor que las dos tablas
que este cambio necesita.

El SQL se ensayó contra la base real (PostgreSQL 17.6, Supabase) dentro de una
transacción con `ROLLBACK`: las seis sentencias son válidas y no dejaron rastro.

## D.2 Variables de entorno

**En Coolify, sobre la app del backend** (la misma que sirve la API). Ese contenedor ya
tiene las `R2_*` y las de Medusa; falta una sola:

| Variable | Para qué |
|---|---|
| `GEMINI_API_KEY` | **Nueva.** Solo la necesita `generate`. https://aistudio.google.com/apikey |

Opcionales: `GEMINI_IMAGE_MODEL`, `GEMINI_VIDEO_MODEL`, y las tarifas
`GEMINI_IMAGE_USD_PER_1M_*` si Google cambia precios.

**No se añade nada a GitHub Actions**: el workflow de medios se descartó (§C.7).

**Para correrlo desde una máquina de desarrollo** hace falta además que
`apps/scraper/.env` tenga las `R2_*`. Hoy no las tiene —`GEMINI_API_KEY` sí— y sin R2 el
comando se niega a arrancar, a propósito: una vista generada no tiene URL de proveedor a
la que caer, así que una corrida sin almacenamiento pagaría imágenes para tirarlas.
Ver `.env.example`.

## D.3 Orden de puesta en marcha

1. **Merge `develop` → `main`.** El backend despliega desde `main`. En ese deploy pasan
   tres cosas de golpe: la imagen incorpora el CLI (§C.7), el entrypoint corre
   `db:migrate` y crea las tablas, y aparecen las rutas `/admin/frame-media/*`.
2. **Añadir `GEMINI_API_KEY`** a la app del backend en Coolify y reiniciar.
3. **Comprobar**, desde la terminal de Coolify sobre ese contenedor:
   ```bash
   cd /app/scraper && uv run python -m scraper media status
   ```
   Mientras las rutas no estén desplegadas el CLI lo dice con esas palabras: un 404 aquí
   significa "falta el deploy", no "está roto".
4. **Ensayo sin gasto:**
   ```bash
   uv run python -m scraper media plan --pilot --kind views
   ```
   Debe imprimir 608 vistas y su costo estimado.
5. **Calibración (Fase 0, ~$1).**
   ```bash
   uv run python -m scraper media generate        --handle sl107-simply-lite --handle dc-50-di-caprio        --kind views --max-cost 2
   ```
   Revisar las 8 imágenes a ojo y leer el `cost.json` del recibo: ahí sale el costo
   **medido** por imagen, que es lo que desbloquea el resto y decide `2K` frente a `1K`.
6. **Nivel 1 (~$5):** `--pilot-brand simply-lite --kind views --max-cost 6`.
7. **Nivel 2 (~$24):** `--pilot --kind views --max-cost 30 --yes` bajo `nohup`.

Entre el 6 y el 7 hay que subir de nivel, y solo se deja si las condiciones medidas se
cumplen (§6, `frame-media-tier.ts`). Sin la pestaña del panel (Fase 3) eso es una llamada
a `POST /admin/frame-media/tier`.

### Lo que no se pudo verificar aquí

- **La imagen no se construyó.** El demonio de Docker no estaba disponible, y CI tampoco
  construye esta imagen (solo lint, tests y el disparo de Coolify). Lo que sí se comprobó:
  que todas las fuentes de cada `COPY` sobreviven al `.dockerignore` — que es justo el
  fallo que había. **El primer deploy es la primera construcción real.**
- **La migración no se aplicó.** Se ensayó contra la base real (PostgreSQL 17.6, Supabase)
  dentro de una transacción con `ROLLBACK`: las seis sentencias son válidas y no dejaron
  rastro. Aplicarla desde una máquina de desarrollo se descartó — ver D.1.

## D.4 Lo que todavía no existe

| Fase | Falta | Impacto si se lanza igual |
|---|---|---|
| 3 | Pestaña Medios | Sin `/tier` desde el navegador; se sube de nivel por API |
| 4 | Galería del PDP | Las vistas se generan y guardan, pero **no se ven** en la tienda |
| 5 | `sync --with-media` | Los medios no se encolan solos al detectar cambios |
| 6 | Vídeo probado | El código está; falta la corrida real y el Ctrl-C/reanudación |
| 7 | GLB | Sin órdenes de trabajo ni subida de `.glb` |
| 8 | Publicación | `published` sigue en `false`: nada llega a la ficha |

Las fases 1 y 2 son suficientes para **generar y almacenar** medios de forma remota y
reanudable. Para que un cliente los vea hace falta la 4 y la 8.
