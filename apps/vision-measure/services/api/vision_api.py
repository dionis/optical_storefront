"""
HTTP endpoint for the second try-on option: AI measurement from two photographs.

Run it next to the Vite dev server:

    uv run python services/api/vision_api.py            # http://localhost:8008

The frontend reaches it through the Vite proxy at /api, so the browser only ever talks
to its own origin and the API keys never cross a third origin.

Routes
    GET  /api/health
    GET  /api/vision-measure/providers
    POST /api/vision-measure          -> medidas + imagen del paciente con la montura
    POST /api/vision-measure/models   -> catalogo de modelos vivo del proveedor
    GET  /api/vision-measure/image-proxy -> descarga server-side una foto del proveedor
"""

import base64
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests  # noqa: E402

# Same sys.path convention the rest of the repository uses for direct script execution.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from services.vision_measure.config import (  # noqa: E402
    MissingApiKeyError,
    describe_providers,
    get_provider,
    load_env_files,
    resolve_api_key,
)
from services.vision_measure.compositor import describe_image_engines  # noqa: E402
from services.vision_measure.measure import (  # noqa: E402
    new_request_id,
    run_comparison,
    run_measurement,
    run_try_on,
    prepare_render_images,
)
from services.vision_measure.pricing import describe_rates, summarize  # noqa: E402
from services.vision_measure.prompts import describe_strategies  # noqa: E402
from services.vision_measure.providers import ProviderError, list_models  # noqa: E402
from services.vision_measure.version import banner, describe_build  # noqa: E402

load_env_files()

app = FastAPI(
    title="RUBILENS · Medición óptica multimodal",
    version="1.0.0",
    description=(
        "Combina una foto frontal del paciente con la foto de una montura y devuelve "
        "las medidas ópticas propuestas por un modelo multimodal."
    ),
)

# The frontend is served from a different port in development, and from a
# *.cloudspaces.litng.ai host in the Lightning deployment. This service holds no
# session state and no cookies; the only secret it handles arrives in the request body.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class MeasureRequest(BaseModel):
    """One measurement run. Images arrive as data URLs from the browser canvas."""

    faceImage: str = Field(..., description="Foto frontal del paciente (data URL)")
    glassesImage: str = Field(..., description="Foto de la montura (data URL)")
    provider: str = Field("openai", description="Identificador del proveedor multimodal")
    model: Optional[str] = Field(None, description="Modelo concreto; vacío usa el de por defecto")
    apiKey: Optional[str] = Field(None, description="Clave introducida en la UI; vacío usa el entorno")
    strategy: str = Field("B", description="'A', 'B' o 'AB' para ejecutar ambas")
    context: Optional[Dict[str, Any]] = Field(None, description="Contexto medido localmente (propuesta B)")
    lang: str = Field("es", description="Idioma de los textos libres devueltos")
    includeRaw: bool = Field(True, description="Incluir la respuesta en bruto del modelo")
    renderTryOn: bool = Field(True, description="Devolver también la imagen del paciente con la montura puesta")
    imageEngine: str = Field("local", description="'local' o un proveedor con salida de imagen")
    imageModel: Optional[str] = Field(None, description="Modelo de imagen concreto")
    imageApiKey: Optional[str] = Field(None, description="Clave del motor de imagen; vacío usa la del proveedor de medida")
    renderProfile: bool = Field(False, description="Añadir una vista de perfil del paciente con la montura")
    extraInstructions: Optional[str] = Field(None, description="Notas del óptico añadidas al system prompt")
    frameId: Optional[str] = Field(None, description="Identificador Capri de la montura; activa el protocolo Capri")


class ModelsRequest(BaseModel):
    """
    Asks a vendor which models the key can call.

    The key travels in the body, never in the query string: a query string lands in
    proxy and server access logs.
    """

    provider: str = Field(..., description="Identificador del proveedor")
    apiKey: Optional[str] = Field(None, description="Clave; vacío usa la del entorno")


@app.get("/api/health")
def health() -> Dict[str, Any]:
    providers = describe_providers()
    return {
        "ok": True,
        "service": "vision-measure",
        "build": describe_build(),
        "providers": len(providers),
        "providersWithServerKey": [p["id"] for p in providers if p["hasServerKey"]],
    }


# Hosts this process will fetch on the caller's behalf. Allowlisted on purpose: an
# unrestricted "fetch whatever URL I give you" endpoint is an SSRF vector, a way to make
# this server reach addresses it otherwise could not.
def _default_image_proxy_hosts() -> str:
    """
    Baseline allowlist: the supplier's own raw photo host (caprioptics.com — still what
    some local/dev catalog data hotlinks directly), plus whatever host R2_PUBLIC_URL /
    R2_ENDPOINT already point at. That is the same bucket the rest of the project
    already trusts for product images (Supabase Storage today) — running in the same
    container as the backend (see apps/backend/docker-entrypoint.sh), this process
    inherits those env vars for free, so the allowlist tracks wherever the images
    actually live instead of a hostname guessed and hardcoded here.
    """
    hosts = ["caprioptics.com"]
    for env_key in ("R2_PUBLIC_URL", "R2_ENDPOINT"):
        host = urlparse(os.environ.get(env_key, "")).hostname
        if host:
            hosts.append(host)
    return ",".join(hosts)


_IMAGE_PROXY_ALLOWED_HOSTS = {
    h.strip().lower()
    for h in os.environ.get(
        "VISION_IMAGE_PROXY_ALLOWED_HOSTS", _default_image_proxy_hosts()
    ).split(",")
    if h.strip()
}
_IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024


@app.get("/api/vision-measure/image-proxy")
def image_proxy(url: str) -> JSONResponse:
    """
    Downloads a product photo server-side and hands it back as a data URL.

    Exists so the try-on's AI panel can pre-fill "Imagen del espejuelo" from the
    storefront's own catalogue photo instead of asking the customer to find and upload
    one themselves: the supplier's image host sends no CORS headers, so the browser has
    no way to read those bytes itself to build the data URL the measurement request
    needs. A server has no such restriction — but see the allowlist above for why it is
    not simply "fetch anything".
    """
    parsed = urlparse(url)
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in _IMAGE_PROXY_ALLOWED_HOSTS:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Host no permitido."})

    try:
        upstream = requests.get(url, timeout=10)
    except requests.RequestException as exc:
        return JSONResponse(
            status_code=502,
            content={"ok": False, "error": f"No se pudo descargar la imagen: {exc}"},
        )

    if upstream.status_code != 200:
        return JSONResponse(
            status_code=502,
            content={"ok": False, "error": f"El proveedor respondió {upstream.status_code}."},
        )

    content_type = upstream.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        return JSONResponse(status_code=415, content={"ok": False, "error": "La URL no es una imagen."})

    if len(upstream.content) > _IMAGE_PROXY_MAX_BYTES:
        return JSONResponse(status_code=413, content={"ok": False, "error": "Imagen demasiado grande."})

    data_url = f"data:{content_type};base64,{base64.b64encode(upstream.content).decode()}"
    return JSONResponse(status_code=200, content={"ok": True, "dataUrl": data_url})


@app.get("/api/vision-measure/providers")
def providers(lang: str = "es") -> Dict[str, Any]:
    """Catalogue for the panel: vendors, default models, and which keys are configured."""
    return {
        "providers": describe_providers(),
        "strategies": describe_strategies(lang),
        "imageEngines": describe_image_engines(),
        # Lets the panel notice it is talking to a service older than itself
        "build": describe_build(),
        "pricing": describe_rates(),
    }


@app.post("/api/vision-measure")
def measure(request: MeasureRequest) -> JSONResponse:
    """
    Runs the requested strategy (or both) and returns the results in request order.

    A provider-side failure is reported inside the envelope with HTTP 200: in an A/B
    run one side failing must not hide the side that worked.
    """
    strategy = (request.strategy or "B").strip().upper()

    if not (request.faceImage or "").strip():
        return JSONResponse(
            status_code=422,
            content={"ok": False, "error": "Falta la foto frontal del paciente."},
        )
    if not (request.glassesImage or "").strip():
        return JSONResponse(
            status_code=422,
            content={"ok": False, "error": "Falta la imagen de la montura."},
        )

    # One id per HTTP request, shared by every proposal inside it and stamped on every
    # log line. Nothing is carried over from the previous request — this makes that
    # checkable in the log rather than something the operator has to take on trust.
    request_id = new_request_id()

    common = {
        "request_id": request_id,
        "provider_id": request.provider,
        "face_image": request.faceImage,
        "glasses_image": request.glassesImage,
        "model": request.model,
        "api_key": request.apiKey,
        "context": request.context,
        "lang": request.lang,
        "extra_instructions": request.extraInstructions,
        "frame_id": request.frameId,
    }

    if strategy in ("AB", "BOTH", "COMPARE"):
        results: List[Dict[str, Any]] = run_comparison(**common, strategies=["A", "B"])
    else:
        results = [run_measurement(strategy=strategy, include_raw=request.includeRaw, **common)]

    payload: Dict[str, Any] = {
        "ok": any(r.get("ok") for r in results),
        "requestId": request_id,
        "results": results,
        # What this request cost, across every proposal it ran. A failed proposal still
        # burned tokens, so it counts here too.
        "cost": summarize([r["cost"] for r in results if r.get("cost")]),
    }

    if request.renderTryOn:
        # The frame width the model just measured is what scales the composite, so the
        # picture and the numbers can never disagree. Falls back inside run_try_on.
        measured_width = None
        for result in results:
            width = ((result.get("measurements") or {}).get("frame") or {}).get("totalFrontWidthMM")
            if width:
                measured_width = width
                break

        common_render = {
            "engine": request.imageEngine,
            "face_image": request.faceImage,
            "glasses_image": request.glassesImage,
            "context": request.context,
            "model": request.imageModel,
            "api_key": request.imageApiKey or request.apiKey,
            "frame_total_width_mm": measured_width,
        }
        # The frontal composite and the side view are independent calls, so they wait
        # together rather than one after the other. With two image models at ~20 s each
        # that is the difference between 20 and 40 seconds of the operator's time.
        views = ["front"] + (["profile"] if request.renderProfile else [])
        # Both views read the same two photographs at the same limits, so they are
        # decoded and re-encoded once for the pair rather than once per view.
        common_render["prepared"] = prepare_render_images(
            request.faceImage, request.glassesImage
        )
        with ThreadPoolExecutor(max_workers=len(views)) as pool:
            rendered = list(
                pool.map(lambda v: run_try_on(**common_render, view=v), views)
            )

        payload["tryOn"] = rendered[0]
        if request.renderProfile:
            payload["tryOnProfile"] = rendered[1]

    return JSONResponse(status_code=200, content=payload)



@app.post("/api/vision-measure/models")
def models(request: ModelsRequest) -> JSONResponse:
    """
    Live model catalogue for one provider.

    The defaults in the registry are a starting point that vendors invalidate without
    warning — Gemini retired `gemini-2.5-pro` for new keys — so the panel offers what the
    key can call today rather than what was current when the registry was written.
    """
    try:
        spec = get_provider(request.provider)
        key = resolve_api_key(spec, request.apiKey)
    except MissingApiKeyError as exc:
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "error": str(exc),
                "errorCode": exc.code,
                "envKeys": exc.env_keys,
            },
        )
    except ValueError as exc:
        return JSONResponse(status_code=200, content={"ok": False, "error": str(exc)})

    try:
        found = list_models(spec, key)
    except ProviderError as exc:
        return JSONResponse(status_code=200, content={"ok": False, "error": str(exc)})
    except Exception as exc:
        return JSONResponse(
            status_code=200,
            content={"ok": False, "error": f"Fallo inesperado listando modelos: {exc}"},
        )

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "provider": spec.id,
            "providerLabel": spec.label,
            "defaultModel": spec.default_model,
            "models": found,
        },
    )


def main() -> None:
    import uvicorn

    port = int(os.environ.get("VISION_API_PORT", "8008"))
    host = os.environ.get("VISION_API_HOST", "0.0.0.0")
    # flush=True so the build line lands at the TOP of the log, before uvicorn's own
    # banner. That line is what settles "am I running the code I just edited?", so it is
    # no use buried under stdout buffering.
    print(banner(), flush=True)
    print(
        f"[VISION] Servicio de medición multimodal en http://{host}:{port}/api/health",
        flush=True,
    )
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
