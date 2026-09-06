# Generación de vistas y vídeo — guía de operación

Cómo generar los 4 packshots y el vídeo promocional de una montura, y cómo probar
todo el proceso en una máquina remota.

Esto es la guía **operativa**. El diseño, el porqué de cada decisión y el estado del
proyecto están en [`docs/frame-media-generation.md`](../../../../docs/frame-media-generation.md);
el mapa de qué mirar allí está al final de este archivo.

---

## Lo primero: qué funciona hoy y qué no

| | Estado |
|---|---|
| Generar 4 vistas y guardarlas en R2 | ✅ funciona |
| Generar vídeo y guardarlo en R2 | ✅ funciona |
| Reanudar una corrida cortada | ✅ funciona |
| Techo de gasto y escalera de niveles | ✅ funciona |
| **Que un cliente vea las vistas en la ficha** | ❌ **no** — falta la Fase 4 |
| Pestaña «Medios» en `/admin` | ❌ falta la Fase 3 |
| Modelos 3D (`.glb`) | ❌ falta la Fase 7 |

Es decir: hoy puedes **producir y almacenar** medios, revisarlos, y saber lo que
costaron. Lo que todavía no puedes es publicarlos en la tienda. `media publish` marca
la decisión de revisión, pero el storefront aún no lee esa marca.

---

## 1. Preparar la máquina remota

Sirve cualquier máquina con salida a internet. No hace falta que sea el servidor de
Coolify: el CLI habla con Medusa y con R2 por HTTPS, así que puede correr desde donde
quieras.

**Requisitos:** `git`, Python **3.12 o superior**, y [`uv`](https://docs.astral.sh/uv/).

```bash
# uv (Linux/macOS)
curl -LsSf https://astral.sh/uv/install.sh | sh

git clone https://github.com/dionis/optical_storefront.git
cd optical_storefront/apps/scraper
uv sync --frozen --no-dev
```

Comprobación de que quedó instalado:

```bash
uv run python -m scraper media --help
```

Debe listar `generate · plan · publish · retry · status`.

## 2. Configurar `apps/scraper/.env`

Copia `.env.example` y rellena. Lo que hace falta, y para qué:

| Variable | Necesaria para | Si falta |
|---|---|---|
| `MEDUSA_BACKEND_URL` | **todo** | El CLI no arranca |
| `MEDUSA_ADMIN_API_KEY` | **todo** | 401 al primer comando |
| `GEMINI_API_KEY` | solo `generate` | `plan`/`status` siguen funcionando |
| `R2_ENDPOINT` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | solo `generate` | `generate` se niega a arrancar |
| `R2_BUCKET` | opcional | por defecto `eyewear-assets` |
| `R2_REGION` | opcional | por defecto `auto` (Cloudflare R2) |
| `R2_PUBLIC_URL` | para que el storefront resuelva las URLs | la generación funciona igual |

`MEDUSA_ADMIN_API_KEY` tiene que ser una **clave admin secreta**, no una publishable.
Medusa v2 la autentica por HTTP Basic, no con `Bearer`.

Que `generate` exija R2 no es capricho: una vista generada no tiene URL de proveedor a
la que caer, así que una corrida sin almacenamiento pagaría imágenes para tirarlas.

## 3. Comprobar la conexión (sin gastar nada)

```bash
uv run python -m scraper media status
```

| Lo que ves | Qué significa |
|---|---|
| Un recuento por tipo y estado | Todo bien |
| `The backend has no frame-media routes yet` | Falta desplegar el backend. Las tablas ya existen; lo que falta es que Coolify construya |
| `Cannot reach Medusa at …` | `MEDUSA_BACKEND_URL` mal, o sin red |
| `Medusa refused the admin key (401)` | La clave no es una admin secreta |

## 4. Ensayo: cuánto costaría (sigue sin gastar)

```bash
uv run python -m scraper media plan --pilot --kind views
```

Imprime cuántos activos hay en cola y su costo estimado. El lote piloto son 70 monturas
/ 152 colorways / **608 vistas ≈ $23,5**.

`plan` y `generate` aceptan **exactamente los mismos** argumentos de selección: ensayas y
ejecutas cambiando una palabra, sin reescribir el comando. Es a propósito — reescribirlo
es donde se cuelan los errores caros.

## 5. Primera generación real: dos monturas (~$1)

```bash
uv run python -m scraper media generate \
    --handle sl107-simply-lite \
    --handle dc-50-di-caprio \
    --kind views --max-cost 2
```

Pedirá confirmación mostrando el tope. Las dos monturas están elegidas a propósito:

- **`sl107-simply-lite`** es la más difícil del catálogo — titanio al aire, sin marco que
  ancle la forma, lentes transparentes sobre el fondo blanco que piden los prompts.
- **`dc-50-di-caprio`** es un control corriente: acetato opaco negro. **Si esta falla, el
  problema es el pipeline, no las monturas.**

Al terminar tendrás 8 imágenes en R2 y, en cada recibo, el **costo medido por imagen**.
Ese número es el que decide si conviene bajar `GEMINI_IMAGE_SIZE` de `2K` a `1K` — R2
guarda a 1600px de todos modos.

### Dónde quedan los archivos

```
products/{handle}/views/{handle}_{color}_{front|left|right|back}.webp
products/{handle}/video/{handle}_{color}.mp4
```

Mismo formato y mismas cabeceras que las fotos de proveedor: WebP calidad 85, máximo
1600px, `Cache-Control: immutable`. Pasan por la misma función (`_optimize_image`), no
por una copia.

## 6. Probar el vídeo (~$0,80 por vídeo)

```bash
uv run python -m scraper media generate \
    --handle dc-50-di-caprio --kind video --max-cost 1
```

Qué esperar, porque no se parece a las imágenes:

- **Tarda hasta 15 minutos** por vídeo. Es normal: Veo es asíncrono y el CLI sondea.
- **Se factura por segundo**, no por tokens: 8 s × $0,10 = **$0,80**. Los recibos de
  vídeo no traen conteo de tokens, y eso es honesto, no un fallo.
- **Lleva audio.** Veo 3.x lo genera en la misma pasada y en este endpoint no se puede
  apagar por parámetro; el prompt pide silencio de **voz**, conservando música y efectos.
- **Si cortas con Ctrl-C a mitad, no pierdes el dinero**: el identificador de la
  operación se guarda antes de empezar a sondear, y la siguiente corrida la retoma.

Con el techo de nivel 0 cabe **un** vídeo. Para más, hay que subir de nivel.

## 7. El lote completo

```bash
# Nivel 1: solo Simplylite, lo difícil primero (~$5)
uv run python -m scraper media generate --pilot-brand simply-lite --kind views --max-cost 6

# Nivel 2: el piloto entero (~$24). Horas: lánzalo desatendido.
nohup uv run python -m scraper media generate --pilot --kind views \
      --max-cost 30 --yes --report piloto.json > media.log 2>&1 &

# Desde otra terminal, o al día siguiente:
uv run python -m scraper media status --pilot
```

Entre el nivel 1 y el 2 hay que **subir de nivel**, y el servidor solo lo permite si se
cumplen condiciones medidas (≥90% de vistas aceptadas, desvío de costo <10%…). Sin la
pestaña del panel todavía, eso es:

```bash
curl -u "$MEDUSA_ADMIN_API_KEY:" -X POST \
  "$MEDUSA_BACKEND_URL/admin/frame-media/tier" \
  -H 'Content-Type: application/json' -d '{"tier":2}'
```

Si te lo rechaza, la respuesta dice **qué condición falta**, no solo que no se puede.

## 8. Corridas largas y reanudación

**Cerrar la terminal mata el proceso**, así que usa `nohup`, `tmux` o `screen`.

Cortar una corrida no pierde trabajo: lo ya subido queda `done`, y lo que estaba en vuelo
queda leaseado 20 minutos y vuelve a estar disponible solo. **Relanzar el mismo comando
continúa donde se quedó** — eso *es* el `--resume`, y no necesita ningún archivo local.

Dos terminales a la vez es seguro (cada una reclama activos distintos), pero comparten
techo y cuota de Gemini. Mejor una.

## 9. Cuando algo falla

```bash
# Ver qué falló
uv run python -m scraper media status --pilot

# Devolver los fallidos a la cola (no gasta)
uv run python -m scraper media retry --pilot

# Reintentar solo la vista trasera, que es la que más se inventa
uv run python -m scraper media retry --pilot --slot back
uv run python -m scraper media generate --pending --slot back --max-cost 5
```

Códigos de fallo que **no** se reintentan solos, porque reintentarlos choca tres veces
contra la misma pared: `auth_failed` (clave mala), `model_not_found`, `no_source_image`,
`r2_unconfigured`. Arregla la causa y usa la opción `force`.

Diez fallos seguidos detienen la corrida: eso es una caída, no un tropiezo, y seguir solo
gasta dinero contra una API que no responde.

## 10. Los frenos, para que no te sorprendan

- **`--max-cost` es obligatorio** en `generate`. Un tope que vive en una configuración que
  alguien puso hace tres meses no es un tope.
- **No hay selección por defecto.** Sin `--pilot`/`--handle`/… el comando falla.
- **El techo se aplica en el servidor**, en cada lote. Lo que muestra el CLI es
  informativo.
- **Nunca se paga dos veces por lo mismo**: un activo `done` no se vuelve a reclamar. Si
  cambia la foto de origen, pasa a `stale` y se sigue sirviendo el archivo viejo hasta que
  alguien decida regenerarlo.

---

## Dónde está el resto de la documentación

Todo en [`docs/frame-media-generation.md`](../../../../docs/frame-media-generation.md):

| Si buscas… | Ve a |
|---|---|
| Referencia completa de argumentos del CLI | **Apéndice C.3** |
| Ejemplos en el orden real de uso | **Apéndice C.4** |
| Qué variables de entorno y por qué | **Apéndice C.6** |
| Cómo y dónde se ejecuta (y qué se descartó) | **Apéndice C.7** |
| Lote piloto: qué monturas y por qué esas | **Apéndice B** |
| Criterios para dar el piloto por bueno | **Apéndice B.5** |
| Puesta en marcha paso a paso | **Apéndice D.3** |
| Qué falta por construir | **Apéndice D.4** |
| Costos y volumen del catálogo | **§2** |
| Escalera de presupuesto | **§6** |
| Cómo se almacena y por qué así | **§3** |
| Reanudación e idempotencia | **§5** |
| Implementar la galería en la ficha (Fase 4) | **Apéndice A** |

Y [`VENDORED.md`](VENDORED.md), aquí al lado: por qué `gemini_media.py` es una copia
literal, qué trampas de la API trae ya resueltas, y cómo verificar que nadie la editó.

---

## Una advertencia que conviene leer antes de publicar nada

El propio módulo lo dice en mayúsculas: **estas vistas son inventadas, no observadas.**
Una "vista trasera" generada de una montura que la tienda vende de verdad puede diferir
del producto físico. Por eso generar y publicar son dos actos distintos y `published`
arranca en `false`: alguien las mira antes de que las vea un cliente.
