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
import re
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional, Tuple
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
    sideImage: Optional[str] = Field(None, description="Foto lateral/perfil del paciente (data URL)")
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


# ── Trabajos asíncronos para el render largo (NUNCA cortar el flujo) ────────
# El render por IA (paciente con la montura puesta) puede tardar 1-4 min, pero el
# proxy de borde (Vercel) delante de este servicio corta CUALQUIER petición HTTP a
# los ~120 s. Solución: el navegador ARRANCA un trabajo aquí, este proceso genera en
# segundo plano el tiempo que Gemini necesite, y el navegador pregunta el estado con
# consultas baratas (< 1 s). Así el flujo de generación no se corta jamás.
_JOBS: Dict[str, Dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()
_JOBS_MAX = 60  # cada resultado guarda 1-2 imágenes grandes: acotado para no comer RAM
_JOB_POOL = ThreadPoolExecutor(max_workers=4)


def _validate_measure(request: "MeasureRequest") -> Optional[Dict[str, Any]]:
    """422 si falta alguna de las dos imágenes obligatorias; None si todo bien."""
    if not (request.faceImage or "").strip():
        return {"ok": False, "error": "Falta la foto frontal del paciente."}
    if not (request.glassesImage or "").strip():
        return {"ok": False, "error": "Falta la imagen de la montura."}
    return None


def _build_measure_payload(
    request: "MeasureRequest",
    on_retry: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """
    Ejecuta medición (+ render opcional) y devuelve el sobre completo. Núcleo compartido
    por la ruta síncrona /api/vision-measure y la ruta de trabajos asíncronos.

    `on_retry`, cuando se pasa, recibe cada espera de reintento transitorio (ver
    `providers.RetryCallback`); el runner del trabajo asíncrono lo usa para publicar el
    progreso que consulta el panel mientras espera.
    """
    strategy = (request.strategy or "B").strip().upper()

    # One id per run, shared by every proposal inside it and stamped on every log line.
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
        results: List[Dict[str, Any]] = run_comparison(
            **common, strategies=["A", "B"], on_retry=on_retry
        )
    else:
        results = [
            run_measurement(
                strategy=strategy, include_raw=request.includeRaw, on_retry=on_retry, **common
            )
        ]

    payload: Dict[str, Any] = {
        "ok": any(r.get("ok") for r in results),
        "requestId": request_id,
        "results": results,
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

        # Cada vista usa SU foto real: la frontal para el frente y la LATERAL para el
        # perfil (antes el perfil se inventaba a partir de la frontal — de ahí que se
        # perdiera el entorno y a veces no saliera la montura). El montaje solo AÑADE la
        # montura sobre la foto; no regenera la escena (ver prompts en compositor.py).
        glasses = request.glassesImage
        side_src = request.sideImage or request.faceImage
        front_prepared = prepare_render_images(request.faceImage, glasses)
        side_prepared = (
            prepare_render_images(side_src, glasses) if request.renderProfile else None
        )
        base_render = {
            "engine": request.imageEngine,
            "glasses_image": glasses,
            "context": request.context,
            "model": request.imageModel,
            "api_key": request.imageApiKey or request.apiKey,
            "frame_total_width_mm": measured_width,
        }

        def _render_view(view: str) -> Dict[str, Any]:
            return run_try_on(
                **base_render,
                face_image=(request.faceImage if view == "front" else side_src),
                prepared=(front_prepared if view == "front" else side_prepared),
                view=view,
            )

        views = ["front"] + (["profile"] if request.renderProfile else [])
        with ThreadPoolExecutor(max_workers=len(views)) as pool:
            rendered = list(pool.map(_render_view, views))

        payload["tryOn"] = rendered[0]
        if request.renderProfile:
            payload["tryOnProfile"] = rendered[1]

    return payload


@app.post("/api/vision-measure")
def measure(request: MeasureRequest) -> JSONResponse:
    """
    Runs the requested strategy (or both) and returns the results in request order.

    A provider-side failure is reported inside the envelope with HTTP 200: in an A/B
    run one side failing must not hide the side that worked.
    """
    err = _validate_measure(request)
    if err is not None:
        return JSONResponse(status_code=422, content=err)
    return JSONResponse(status_code=200, content=_build_measure_payload(request))


def _job_progress_sink(job_id: str) -> Callable[[Dict[str, Any]], None]:
    """Closure that publishes retry progress into the job store, under its lock."""

    def sink(info: Dict[str, Any]) -> None:
        with _JOBS_LOCK:
            job = _JOBS.get(job_id)
            if job is not None:
                job["progress"] = {**info, "updatedAt": time.time()}

    return sink


def _run_job(job_id: str, request: MeasureRequest) -> None:
    """Corre la medición+render en segundo plano y guarda el resultado en el store."""
    try:
        payload = _build_measure_payload(request, on_retry=_job_progress_sink(job_id))
        with _JOBS_LOCK:
            job = _JOBS.get(job_id)
            if job is not None:
                job["status"] = "done"
                job["result"] = payload
                job["progress"] = None
                job["finishedAt"] = time.time()
    except Exception as exc:  # noqa: BLE001 - reportamos cualquier fallo al cliente
        with _JOBS_LOCK:
            job = _JOBS.get(job_id)
            if job is not None:
                job["status"] = "error"
                job["error"] = f"{type(exc).__name__}: {exc}"
                job["progress"] = None
                job["finishedAt"] = time.time()

    # Si el operador armó un aviso mientras esperaba, este es el momento de entregarlo —
    # tanto si el trabajo terminó bien como si agotó los reintentos.
    _maybe_deliver_notification(job_id)


# ── Aviso por correo/WhatsApp cuando la espera se alarga ────────────────────────
# Este proceso no envía nada él mismo (es "sin estado" a propósito, ver CLAUDE.md):
# compone el texto y se lo pasa al backend de Medusa, que ya tiene Resend y Twilio
# configurados para las notificaciones de pedidos. El contacto que el operador teclea
# aquí vive solo en memoria, junto al trabajo (se pierde si el proceso se reinicia,
# igual que el resto de `_JOBS`) — no es un dato de cliente persistido.
_MEDUSA_BACKEND_URL = os.environ.get("MEDUSA_BACKEND_URL", "http://127.0.0.1:9000").rstrip("/")
_VISION_INTERNAL_SECRET = os.environ.get("VISION_INTERNAL_SECRET", "")


def _looks_like_email(value: str) -> bool:
    return "@" in value and "." in value.split("@")[-1]


def _looks_like_phone(value: str) -> bool:
    return len(re.sub(r"[^\d]", "", value)) >= 8


def _summarize_for_notification(
    status: Optional[str], result: Optional[Dict[str, Any]], error: Optional[str], lang: str
) -> Tuple[str, str]:
    """Construye {asunto, texto} a partir del sobre de medición, en es o en."""
    is_es = (lang or "es").strip().lower() != "en"

    def failure() -> Tuple[str, str]:
        detail = error or "desconocido" if is_es else error or "unknown"
        subject = "No se pudo completar tu medición" if is_es else "Your measurement could not be completed"
        text = (
            f"Lo sentimos, la medición no pudo completarse. Detalle: {detail}"
            if is_es
            else f"Sorry, the measurement could not be completed. Detail: {detail}"
        )
        return subject, text

    if status != "done" or not result:
        return failure()

    results = result.get("results") or []
    ok_result = next((r for r in results if r.get("ok")), None)
    if not ok_result:
        error = (results[0].get("error") if results else None) or error
        return failure()

    measurements = ok_result.get("measurements") or {}
    facial = measurements.get("facial") or {}
    frame = measurements.get("frame") or {}

    lines: List[str] = []

    def add(label_es: str, label_en: str, value: Any, unit: str = "") -> None:
        if value is None:
            return
        lines.append(f"{label_es if is_es else label_en}: {value}{unit}")

    add("DIP total", "Total PD", facial.get("pdTotalMM"), " mm")
    add("Ancho frontal total", "Total front width", frame.get("totalFrontWidthMM"), " mm")
    add("Puente (DBL)", "Bridge (DBL)", frame.get("bridgeMM"), " mm")
    add("Longitud de varilla", "Temple length", frame.get("templeLengthMM"), " mm")

    provider_line = (
        f"Proveedor: {ok_result.get('providerLabel')} / {ok_result.get('model')}"
        if is_es
        else f"Provider: {ok_result.get('providerLabel')} / {ok_result.get('model')}"
    )
    subject = "Tu medición ya está lista" if is_es else "Your measurement is ready"
    body = "\n".join(
        [
            "Tu medición de RUBILENS ya está lista:" if is_es else "Your RUBILENS measurement is ready:",
            "",
            *(lines or (["(sin valores numéricos en esta propuesta)"] if is_es else ["(no numeric values in this proposal)"])),
            "",
            provider_line,
        ]
    )
    return subject, body


def _send_notification(
    email: Optional[str], whatsapp: Optional[str], subject: str, text: str, job_id: str
) -> bool:
    """
    Pide al backend de Medusa que entregue el aviso. Nunca lanza: una entrega fallida
    queda en el log, no tumba el trabajo que ya terminó.
    """
    if not email and not whatsapp:
        return False

    headers = {"Content-Type": "application/json"}
    if _VISION_INTERNAL_SECRET:
        headers["x-vision-internal-key"] = _VISION_INTERNAL_SECRET

    try:
        resp = requests.post(
            f"{_MEDUSA_BACKEND_URL}/vision-measure/notify",
            json={
                "email": email or None,
                "whatsapp": whatsapp or None,
                "subject": subject,
                "text": text,
                "requestId": job_id,
            },
            headers=headers,
            timeout=20,
        )
        if resp.status_code >= 400:
            print(f"[VISION] aviso {job_id}: el backend respondió {resp.status_code}: {resp.text[:300]}")
            return False
        return True
    except requests.RequestException as exc:
        print(f"[VISION] aviso {job_id}: no se pudo contactar al backend de Medusa ({exc})")
        return False


def _maybe_deliver_notification(job_id: str) -> None:
    """Entrega el aviso armado para este trabajo, si lo hay y aún no se envió."""
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return
        notify = job.get("notify")
        status = job.get("status")
        if not notify or job.get("notifySent") or status not in ("done", "error"):
            return
        result = job.get("result")
        error = job.get("error")

    subject, text = _summarize_for_notification(status, result, error, notify.get("lang") or "es")
    delivered = _send_notification(notify.get("email"), notify.get("whatsapp"), subject, text, job_id)

    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is not None:
            job["notifySent"] = True
            job["notifyDelivered"] = delivered


@app.post("/api/vision-measure/job")
def start_measure_job(request: MeasureRequest) -> JSONResponse:
    """
    Arranca un trabajo de medición+render y responde AL INSTANTE con su id. El cliente
    consulta el estado en GET /api/vision-measure/job/{id}. Pensado para el render por
    IA, que puede exceder el límite de tiempo del proxy de borde: nunca se corta.
    """
    err = _validate_measure(request)
    if err is not None:
        return JSONResponse(status_code=422, content=err)

    job_id = uuid.uuid4().hex[:16]
    with _JOBS_LOCK:
        # Poda: si el store crece demasiado, descarta los más viejos (memoria acotada).
        if len(_JOBS) >= _JOBS_MAX:
            for key, _ in sorted(_JOBS.items(), key=lambda kv: kv[1].get("createdAt", 0))[
                : len(_JOBS) - _JOBS_MAX + 1
            ]:
                _JOBS.pop(key, None)
        _JOBS[job_id] = {
            "status": "pending",
            "createdAt": time.time(),
            "progress": None,
            "notify": None,
            "notifySent": None,
        }

    _JOB_POOL.submit(_run_job, job_id, request)
    return JSONResponse(
        status_code=200, content={"ok": True, "jobId": job_id, "status": "pending"}
    )


class JobNotifyRequest(BaseModel):
    """Contacto donde avisar cuando un trabajo lento por fin termine."""

    email: Optional[str] = Field(None, description="Correo del destinatario")
    whatsapp: Optional[str] = Field(None, description="Número de WhatsApp, con o sin '+'")
    lang: str = Field("es", description="Idioma del mensaje de aviso: 'es' o 'en'")


@app.post("/api/vision-measure/job/{job_id}/notify")
def set_job_notify(job_id: str, request: JobNotifyRequest) -> JSONResponse:
    """
    Arma el aviso por correo/WhatsApp para un trabajo que se está alargando.

    Pensado para el momento (desde el segundo intento fallido, ver
    `providers.SLOW_NOTICE_AFTER_ATTEMPT`) en que el panel ofrece guardar un contacto en
    vez de seguir esperando en pantalla. Si el trabajo YA terminó cuando llega esta
    petición — el operador tardó en escribir el correo — entrega de inmediato en vez de
    esperar un 'terminado' que ya pasó.
    """
    email = (request.email or "").strip()
    whatsapp = (request.whatsapp or "").strip()

    if email and not _looks_like_email(email):
        return JSONResponse(status_code=422, content={"ok": False, "error": "Correo no válido."})
    if whatsapp and not _looks_like_phone(whatsapp):
        return JSONResponse(
            status_code=422, content={"ok": False, "error": "Número de WhatsApp no válido."}
        )
    if not email and not whatsapp:
        return JSONResponse(
            status_code=422,
            content={"ok": False, "error": "Indica un correo o un número de WhatsApp."},
        )

    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "error": "Trabajo no encontrado o expirado."},
            )
        job["notify"] = {
            "email": email or None,
            "whatsapp": whatsapp or None,
            "lang": (request.lang or "es").strip().lower(),
        }
        job["notifySent"] = False
        already_finished = job.get("status") in ("done", "error")

    # El trabajo puede haber terminado MIENTRAS el operador escribía el contacto: entregar
    # ya mismo en vez de esperar una transición de estado que no va a volver a ocurrir.
    if already_finished:
        _JOB_POOL.submit(_maybe_deliver_notification, job_id)

    return JSONResponse(status_code=200, content={"ok": True})


@app.get("/api/vision-measure/job/{job_id}")
def get_measure_job(job_id: str) -> JSONResponse:
    """Estado de un trabajo. Cuando termina, trae el sobre completo en `result`."""
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return JSONResponse(
                status_code=404,
                content={
                    "ok": False,
                    "status": "unknown",
                    "error": "Trabajo no encontrado o expirado.",
                },
            )
        status = job.get("status")
        notify_common = {
            "notifyArmed": bool(job.get("notify")),
            "notifyDelivered": job.get("notifyDelivered"),
        }
        if status == "done":
            return JSONResponse(
                status_code=200,
                content={"ok": True, "status": "done", "result": job.get("result"), **notify_common},
            )
        if status == "error":
            return JSONResponse(
                status_code=200,
                content={"ok": False, "status": "error", "error": job.get("error"), **notify_common},
            )
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "status": status or "pending",
                "progress": job.get("progress"),
                **notify_common,
            },
        )



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
