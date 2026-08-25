# vision-measure

Servicio FastAPI que da soporte a la "Opción 2" del try-on (medición óptica con IA):
combina la foto frontal del paciente y la foto de la montura elegida y le pide a un
modelo multimodal (OpenAI, Anthropic, Gemini, Qwen, Mistral, xAI o vía OpenRouter) que
proponga DIP, alturas de montaje y, opcionalmente, una imagen del paciente con la
montura puesta.

Portado desde `3d_framework_glass_try-on/services/{api,vision_measure}` — es la única
parte de aquel proyecto que corre en vivo por cada medición; el pipeline de generación
3D (Hunyuan3D/SF3D/TRELLIS, GPU, `services/inference`) se queda deliberadamente fuera:
no cabe en el presupuesto de infra de este proyecto (Hetzner CX22, ver `CLAUDE.md`) y no
es algo que este backend necesite operar en producción — es una herramienta de autoría
que el equipo corre aparte, a mano, cuando toca generar un `.glb` nuevo.

No tiene estado ni base de datos propia. No requiere GPU.

## Dónde vive cada cosa

```
apps/vision-measure/
├── services/
│   ├── api/vision_api.py         # rutas FastAPI (lo que arranca el proceso)
│   └── vision_measure/           # lógica: proveedores, prompts, compositor, precios
├── pyproject.toml                # fastapi, uvicorn, pydantic, requests, pillow, dotenv
├── uv.lock                       # mismo gestor que apps/scraper — no usar pip a mano
├── .env.example                  # copiar a .env EN ESTA CARPETA (no en la raíz del repo)
└── Dockerfile                    # build self-contenido con uv, sin depender del workspace pnpm
```

`services/vision_measure/config.py` calcula su propia raíz (`parents[2]` desde su
archivo) y busca `.env`/`.env.local` ahí — es decir, en `apps/vision-measure/`, nunca en
la raíz del monorepo ni en `apps/backend/.env`. Cada clave es opcional: si no está en el
entorno, el panel del try-on deja que el operador la escriba a mano por esa sesión (y lo
escrito en el panel siempre gana sobre el `.env`).

## Cómo correrlo

```bash
cd apps/vision-measure
cp .env.example .env      # y rellena las claves de los proveedores que vayas a usar
uv run python services/api/vision_api.py
# → http://localhost:8008/api/health
```

`uv run` resuelve e instala en un `.venv` propio de esta carpeta a partir de
`pyproject.toml`/`uv.lock` la primera vez (después arranca al instante); no hace falta
activar nada a mano. Para el compuesto local con rembg: `uv sync --extra tryon` una vez,
luego `uv run python services/api/vision_api.py` igual que arriba.

`pnpm dev:backend` en la raíz del monorepo ya invoca esto (junto al backend de Medusa)
con `uv run` — ver la sección "Try-on" de `CLAUDE.md`.

**Nota Windows**: si la caché de `uv` (`%LOCALAPPDATA%\uv\cache`) y este repo están en
discos distintos, la primera instalación cae a copiar archivo por archivo en vez de
enlazarlos (más lenta, pero solo la primera vez). `export UV_LINK_MODE=copy` silencia el
aviso; no hay nada que arreglar.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/health` | Estado + huella de build + qué proveedores tienen clave de servidor |
| GET | `/api/vision-measure/providers` | Catálogo de proveedores/estrategias/motores de imagen, para poblar el panel |
| POST | `/api/vision-measure` | Corre la medición (y opcionalmente el try-on compuesto) |
| POST | `/api/vision-measure/models` | Pregunta al proveedor qué modelos acepta la clave dada |

Contrato completo de request/response en `apps/vto-web/src/vision_measure_client.ts`
(el cliente TypeScript que ya existía y que consume exactamente estas rutas).

## Cómo lo alcanza el resto del proyecto

- **Desarrollo**: `apps/vto-web` (Vite) proxyea `/api/*` a `http://127.0.0.1:8008` — ver
  `VISION_API_URL` en `apps/vto-web/vite.config.ts`. El navegador solo habla con su
  propio origen; ninguna clave de API cruza a un tercer origen.
- **Producción**: se despliega como contenedor aparte junto al backend de Medusa en el
  mismo host de Coolify (ver el servicio `vision-measure` en
  `infra/docker-compose.prod.yml`). El storefront (Vercel) y `apps/vto-web` le pegan a
  su URL pública vía un rewrite; el CORS del servicio es intencionalmente abierto
  (`allow_origins=["*"]`) porque no maneja cookies ni sesión — el único secreto que ve
  llega en el cuerpo de la petición, nunca en query string ni en la URL.

## Variables de entorno

Ver `.env.example`. Ninguna es obligatoria para que el proceso arranque; sin ninguna
configurada, el panel simplemente pide la clave al operador en cada sesión.

## Nota de coste

A diferencia del resto de la infra (Postgres, Redis, Meilisearch — todo fijo), este
servicio genera coste variable por petición: cada medición y cada imagen compuesta es
una llamada de pago al proveedor de IA elegido. `services/vision_measure/pricing.py` ya
calcula el coste estimado por llamada y lo devuelve en la respuesta (`cost`); vale la
pena vigilarlo contra el presupuesto de <$75/mes del proyecto antes de dejar la opción
de IA abierta a clientes anónimos sin límite.
