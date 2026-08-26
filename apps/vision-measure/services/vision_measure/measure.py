"""
Orchestrator for one measurement run.

Takes the two images and the operator's choices, calls the provider, and returns a
normalized result. Everything that can go wrong on the way back from a language model
(fenced JSON, prose around the object, a truncated answer) is handled here so the panel
only ever sees the contract in `schema.py`.
"""

import base64
import binascii
import uuid
from concurrent.futures import ThreadPoolExecutor
import io
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from services.vision_measure.compositor import render_ai_tryon, render_local_overlay
from services.vision_measure.config import (
    MissingApiKeyError,
    ProviderSpec,
    get_provider,
    resolve_api_key,
)
from services.vision_measure.pricing import estimate_cost
from services.vision_measure.prompts import build_prompt
from services.vision_measure.providers import (
    MAX_RETRIES,
    STABLE_ALTERNATIVE,
    ProviderError,
    call_multimodal,
    supports_browsing,
)
from services.vision_measure.schema import normalize_result

# Image limits are per-vendor, and treating them as one number cost real accuracy.
#
# 1568px and ~5 MB are ANTHROPIC's ceilings; they were being applied to everybody. The
# frame's printed size code ("53-17-140" inside a temple) is a few pixels tall, so a
# 1568px pass re-encoded at JPEG 88 is precisely where it stops being readable — while
# ChatGPT was reading the operator's photograph at full resolution. OpenAI accepts a
# 512 MB payload and Gemini scales to its own token budget, so neither has any business
# being clipped to Anthropic's ceiling.
MAX_IMAGE_EDGE_PX = 2048
MAX_IMAGE_BYTES = 8_000_000
JPEG_QUALITY = 95

# Anthropic downsamples above this and rejects images past its byte cap outright.
ANTHROPIC_MAX_IMAGE_EDGE_PX = 1568
ANTHROPIC_MAX_IMAGE_BYTES = 4_500_000

# What the image EDITORS get. Nothing is gained by shrinking a portrait before handing
# it to a model whose whole job is to preserve that face, and gpt-image / Gemini both
# take far larger inputs than this.
RENDER_MAX_IMAGE_EDGE_PX = 2048
RENDER_MAX_IMAGE_BYTES = 12_000_000
RENDER_JPEG_QUALITY = 96


def limits_for(adapter: str) -> Tuple[int, int]:
    """(long-edge cap, byte cap) for one wire protocol."""
    if adapter == "anthropic":
        return ANTHROPIC_MAX_IMAGE_EDGE_PX, ANTHROPIC_MAX_IMAGE_BYTES
    return MAX_IMAGE_EDGE_PX, MAX_IMAGE_BYTES

_DATA_URL_RE = re.compile(r"^data:(?P<mime>[\w.+/-]+);base64,(?P<data>.*)$", re.DOTALL)


class MeasurementError(RuntimeError):
    """A run failed for a reason the operator can act on."""


def prepare_image(
    data_url: str,
    label: str,
    max_edge: int = MAX_IMAGE_EDGE_PX,
    max_bytes: int = MAX_IMAGE_BYTES,
    quality: int = JPEG_QUALITY,
) -> Tuple[str, str]:
    """
    Decodes a data URL and re-encodes it to a provider-friendly JPEG.

    Returns (media_type, base64_data). Re-encoding is not optional: a phone photo is
    routinely 4000px and 8 MB, which several providers reject outright and the rest
    silently downsample anyway. The limits are arguments rather than constants because
    they differ by an order of magnitude between the vendors — see `limits_for`.
    """
    if not data_url or not isinstance(data_url, str):
        raise MeasurementError(f"Falta la imagen: {label}.")

    match = _DATA_URL_RE.match(data_url.strip())
    if match:
        mime = match.group("mime")
        raw_b64 = match.group("data")
    else:
        # A bare base64 payload is accepted too, so the endpoint is usable from curl.
        mime = "image/jpeg"
        raw_b64 = data_url.strip()

    try:
        raw = base64.b64decode(raw_b64, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise MeasurementError(f"La imagen '{label}' no es base64 válido.") from exc

    if not raw:
        raise MeasurementError(f"La imagen '{label}' llegó vacía.")

    try:
        from PIL import Image
    except ImportError:
        # Pillow is a declared dependency; if it is missing, pass the bytes through
        # rather than failing the whole run.
        if len(raw) > max_bytes:
            raise MeasurementError(
                f"La imagen '{label}' pesa {len(raw) // 1024} KB y Pillow no está "
                "disponible para reducirla."
            )
        return mime, base64.b64encode(raw).decode("ascii")

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise MeasurementError(f"No se pudo decodificar la imagen '{label}': {exc}") from exc

    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    longest = max(image.size)
    if longest > max_edge:
        ratio = max_edge / float(longest)
        image = image.resize(
            (max(1, int(image.width * ratio)), max(1, int(image.height * ratio))),
            Image.LANCZOS,
        )

    while True:
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality, optimize=True)
        encoded = buffer.getvalue()
        if len(encoded) <= max_bytes or quality <= 45:
            break
        quality -= 12

    print(f"[VISION] Imagen '{label}': {image.width}x{image.height}px, {len(encoded) // 1024} KB")
    return "image/jpeg", base64.b64encode(encoded).decode("ascii")


def extract_json_object(text: str) -> Dict[str, Any]:
    """
    Pulls the JSON object out of a model answer.

    Tries, in order: the whole string, the contents of a fenced block, and finally the
    first balanced {...} span. Brace counting is string-aware, so a brace inside a note
    does not truncate the object.
    """
    candidates: List[str] = []
    stripped = (text or "").strip()
    if not stripped:
        raise MeasurementError("El modelo devolvió una respuesta vacía.")

    candidates.append(stripped)

    fenced = re.findall(r"```(?:json)?\s*(.*?)```", stripped, re.DOTALL)
    candidates.extend(block.strip() for block in fenced)

    span = _first_balanced_object(stripped)
    if span:
        candidates.append(span)

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict):
            return parsed

    # An object that opens and never closes is a cut-off answer, not malformed output.
    # Saying so points at the token budget instead of at the model's JSON skills, and
    # the tail is the part that shows where it stopped.
    if stripped.startswith("{") and stripped.count("{") > stripped.count("}"):
        raise MeasurementError(
            "La respuesta del modelo llegó CORTADA: abre "
            f"{stripped.count('{')} llaves y cierra {stripped.count('}')}, "
            f"{len(stripped)} caracteres en total. Suele ser el presupuesto de tokens "
            "agotado (a menudo por el razonamiento del modelo). "
            f"Final de lo recibido: …{stripped[-200:]}"
        )

    raise MeasurementError(
        "El modelo no devolvió un objeto JSON interpretable "
        f"({len(stripped)} caracteres). Comienzo: {stripped[:200]} "
        f"| Final: …{stripped[-200:]}"
    )


def _first_balanced_object(text: str) -> Optional[str]:
    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escaped = False

    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None



def _annotate_provider_error(exc: ProviderError, spec: ProviderSpec, model: str) -> str:
    """
    Adds the fix to a "that model does not exist" failure.

    Vendors retire model names without warning — Gemini dropped `gemini-2.5-pro` for new
    keys — and the raw 404 leaves the operator staring at a wall of JSON in the middle of
    a fitting. When the message looks like a model-name problem, say which field to
    change and how to find a valid name.
    """
    message = str(exc)

    # Congestion and quota both come back as a wall of vendor JSON, but they need
    # opposite actions from the operator: one is "wait or pick another model", the other
    # is "your account is capped". Saying which saves an afternoon of guessing.
    if exc.status in (500, 502, 503, 504):
        alternative = STABLE_ALTERNATIVE.get(spec.id)
        return (
            f"{message}\n\n"
            f"→ {spec.label} está saturado ahora mismo, no es un fallo de esta aplicación. "
            f"Ya se reintentó {MAX_RETRIES} veces con esperas crecientes. "
            "Los modelos preview y los tope de gama son los que primero se congestionan"
            + (f"; prueba con '{alternative}', que suele tener más capacidad." if alternative else ".")
        )

    if exc.status == 429:
        return (
            f"{message}\n\n"
            f"→ Has alcanzado el límite de peticiones de tu clave de {spec.label} "
            "(no es saturación del proveedor). Espera, o revisa el plan y la cuota de "
            "facturación de tu cuenta."
        )

    looks_like_bad_model = exc.status in (404, 400) and any(
        needle in message.lower()
        for needle in ("not_found", "not found", "no longer available", "does not exist",
                       "unknown model", "invalid model", "model_not_found")
    )
    if not looks_like_bad_model:
        return message

    return (
        f"{message}\n\n"
        f"→ El modelo '{model}' no está disponible para esta clave de {spec.label}. "
        "Escribe otro en el campo «Modelo» del panel; el botón ↻ que hay al lado lista "
        "los que tu clave puede usar ahora mismo."
    )

def _provider_error_code(exc: ProviderError) -> Optional[str]:
    """
    Machine-readable reason for a provider-side failure.

    The panel uses this to show a generic, translated, non-technical message instead of
    relaying vendor text a customer cannot act on either way — "your account hit its
    rate limit" and "the vendor is overloaded" are both just "try again later, or tell
    the site owner" from where a shopper is standing. Falls back to whatever code the
    exception already carries (e.g. "timeout", set where the request never got a
    response at all).
    """
    if exc.code:
        return exc.code
    if exc.status == 429:
        return "quota-exceeded"
    if exc.status in (500, 502, 503, 504):
        return "provider-unavailable"
    return None


def new_request_id() -> str:
    """
    Short id tying one HTTP request to every line it produces.

    Nothing in this service carries conversation state between calls — each provider
    request is built from scratch as a single user turn — but "it does not happen" is a
    claim, and a claim an optician cannot check is worth little. With an id on every log
    line and in every envelope, mixing would be visible instead of arguable.
    """
    return uuid.uuid4().hex[:8]


def run_measurement(
    provider_id: str,
    strategy: str,
    face_image: str,
    glasses_image: str,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
    lang: str = "es",
    include_raw: bool = True,
    request_id: Optional[str] = None,
    extra_instructions: Optional[str] = None,
    frame_id: Optional[str] = None,
    prepared: Optional[Tuple[Tuple[str, str], Tuple[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Runs one strategy against one provider and returns a result envelope.

    `prepared` is the (face, glasses) pair already decoded and re-encoded. Passing it in
    is how an A/B comparison avoids doing that work twice over the same two photographs:
    decoding, resizing and re-encoding a phone photo is not free, and both strategies run
    at once, so the duplicate lands on the same CPU at the same moment.

    Never raises for a provider-side failure: a failed run is returned as
    {"ok": False, "error": ...} so an A/B comparison where one side fails still shows
    the side that worked.
    """
    spec: ProviderSpec = get_provider(provider_id)
    chosen_model = (model or "").strip() or spec.default_model
    strategy = (strategy or "A").strip().upper()

    request_id = request_id or new_request_id()

    envelope: Dict[str, Any] = {
        "ok": False,
        "requestId": request_id,
        "strategy": strategy,
        "provider": spec.id,
        "providerLabel": spec.label,
        "model": chosen_model,
    }

    def fail(message: str, code: Optional[str] = None) -> Dict[str, Any]:
        """Records the failure in the envelope AND in the log.

        A run that fails used to return quietly, so the service log ended at the retry
        ladder and the reason lived only in the browser. Anyone reading the terminal to
        find out what happened found nothing.
        """
        envelope["error"] = message
        if code:
            # A machine-readable code so the panel can say this in the operator's own
            # language instead of echoing a Spanish sentence from the server.
            envelope["errorCode"] = code
        # Collapsed rather than cut at the first newline: the previous version logged
        # "...Comienzo de la respuesta: {" and stopped, throwing away the evidence.
        flat = " ".join(message.split())
        print(
            f"[VISION] [{request_id}] FALLO {spec.label} / {chosen_model} / "
            f"propuesta {strategy}: {flat[:600]}"
        )
        return envelope

    try:
        key = resolve_api_key(spec, api_key)
        prompt = build_prompt(
            strategy,
            lang=lang,
            context=context,
            extra_instructions=extra_instructions,
            frame_id=frame_id,
        )
        if prepared is not None:
            face, glasses = prepared
        else:
            edge, byte_cap = limits_for(spec.adapter)
            face = prepare_image(face_image, "rostro", edge, byte_cap)
            glasses = prepare_image(glasses_image, "montura", edge, byte_cap)
    except MissingApiKeyError as exc:
        envelope["envKeys"] = exc.env_keys
        envelope["docsUrl"] = exc.docs_url
        return fail(str(exc), code=exc.code)
    except (ValueError, MeasurementError) as exc:
        return fail(str(exc))

    try:
        response = call_multimodal(
            spec,
            chosen_model,
            key,
            prompt["system"],
            prompt["user"],
            images=[face, glasses],
            browse_urls=prompt.get("browseUrls") or (),
        )
    except ProviderError as exc:
        # The call reached the model and spent tokens even though it produced nothing
        # usable. Bill it: a truncated answer is the most expensive kind of failure.
        if getattr(exc, "usage", None):
            envelope["usage"] = exc.usage
            envelope["cost"] = estimate_cost(spec.id, chosen_model, exc.usage)
        return fail(
            _annotate_provider_error(exc, spec, chosen_model),
            code=_provider_error_code(exc),
        )
    except Exception as exc:  # a vendor SDK-less HTTP path can still surprise us
        return fail(f"Fallo inesperado llamando a {spec.label}: {exc}")

    envelope["latencyMs"] = response["latencyMs"]
    envelope["usage"] = response["usage"]
    # Which supplier pages the model actually opened, and whether each one came back.
    # Carried whenever the protocol asked for a lookup -- an EMPTY list after asking is
    # itself the finding, and the report has to be able to say so.
    if prompt.get("browseUrls"):
        envelope["browseUrls"] = list(prompt["browseUrls"])
        envelope["urlRetrieval"] = response.get("urlRetrieval") or []
        envelope["browsingSupported"] = supports_browsing(spec)
    # Attached even when the parse fails below: the call was made and the tokens were
    # spent, so the cost belongs in the envelope whatever happens next.
    envelope["cost"] = estimate_cost(spec.id, chosen_model, response["usage"])

    try:
        parsed = extract_json_object(response["text"])
    except MeasurementError as exc:
        if include_raw:
            envelope["rawText"] = response["text"]
        return fail(str(exc))

    envelope["ok"] = True
    envelope["measurements"] = normalize_result(parsed)
    if include_raw:
        envelope["rawText"] = response["text"]

    print(
        f"[VISION] [{request_id}] {spec.label} / {chosen_model} / propuesta {strategy}: "
        f"{response['latencyMs']} ms, "
        f"{len(envelope['measurements']['warnings'])} aviso(s)"
    )
    return envelope


def run_comparison(
    provider_id: str,
    face_image: str,
    glasses_image: str,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
    lang: str = "es",
    strategies: Optional[List[str]] = None,
    request_id: Optional[str] = None,
    extra_instructions: Optional[str] = None,
    frame_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Runs several strategies over the same capture so their numbers can be compared.

    Each strategy is an INDEPENDENT provider call built from scratch: proposal B never
    sees what proposal A answered. They share only the two photographs and the measured
    context, which is the whole point of comparing them. The request id is shared so the
    log shows they belong to one request.
    """
    request_id = request_id or new_request_id()
    chosen = strategies or ["A", "B"]

    # Prepared ONCE for every strategy. Both calls go to the same provider over the same
    # two photographs, so the limits are identical and the bytes would be identical too.
    # A failure here is not fatal: fall back to letting each call prepare its own, which
    # is what used to happen, so a surprise in the image path costs speed and not the run.
    prepared = None
    try:
        spec = get_provider(provider_id)
        edge, byte_cap = limits_for(spec.adapter)
        prepared = (
            prepare_image(face_image, "rostro", edge, byte_cap),
            prepare_image(glasses_image, "montura", edge, byte_cap),
        )
    except (ValueError, MeasurementError) as exc:
        print(f"[VISION] [{request_id}] preparación compartida no disponible: {exc}")

    # Concurrently, because they are independent calls to the same vendor over the same
    # two photographs. Run in sequence they simply added up: two 50-second reasoning
    # calls made the operator wait 100 seconds for an answer that was ready at 50.
    # `requests` is blocking, so threads are the right tool — this is all I/O wait.
    with ThreadPoolExecutor(max_workers=len(chosen)) as pool:
        futures = [
            pool.submit(
                run_measurement,
                provider_id=provider_id,
                strategy=strategy,
                face_image=face_image,
                glasses_image=glasses_image,
                model=model,
                api_key=api_key,
                context=context,
                lang=lang,
                request_id=request_id,
                extra_instructions=extra_instructions,
                frame_id=frame_id,
                prepared=prepared,
            )
            for strategy in chosen
        ]
        # Results come back in the order asked for, not the order they finished: an A/B
        # comparison that swapped columns depending on which model answered first would
        # be unreadable.
        return [f.result() for f in futures]


def prepare_render_images(
    face_image: str, glasses_image: str
) -> Optional[Tuple[Tuple[str, str], Tuple[str, str]]]:
    """
    Prepares the render-sized copies once, for however many views are wanted.

    Front and profile are the same two photographs at the same limits, so preparing them
    per view meant decoding and re-encoding a 2048px pair twice, concurrently. Returns
    None when it cannot, which sends each view back to preparing its own -- slower, but
    never a lost render.
    """
    try:
        return (
            prepare_image(
                face_image, "rostro",
                RENDER_MAX_IMAGE_EDGE_PX, RENDER_MAX_IMAGE_BYTES, RENDER_JPEG_QUALITY,
            ),
            prepare_image(
                glasses_image, "montura",
                RENDER_MAX_IMAGE_EDGE_PX, RENDER_MAX_IMAGE_BYTES, RENDER_JPEG_QUALITY,
            ),
        )
    except (ValueError, MeasurementError) as exc:
        print(f"[VISION] preparación compartida del render no disponible: {exc}")
        return None


def run_try_on(
    engine: str,
    face_image: str,
    glasses_image: str,
    context: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    frame_total_width_mm: Optional[float] = None,
    view: str = "front",
    prepared: Optional[Tuple[Tuple[str, str], Tuple[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Renders the patient wearing the frame.

    `engine` is "local" for the deterministic composite or a provider id for a real image
    model. Like `run_measurement`, a failure comes back inside the envelope: the numbers
    are the deliverable, and losing the picture must not lose them too.
    """
    engine = (engine or "local").strip().lower()

    try:
        if prepared is not None:
            face, glasses = prepared
        else:
            face = prepare_image(
                face_image, "rostro",
                RENDER_MAX_IMAGE_EDGE_PX, RENDER_MAX_IMAGE_BYTES, RENDER_JPEG_QUALITY,
            )
            glasses = prepare_image(
                glasses_image, "montura",
                RENDER_MAX_IMAGE_EDGE_PX, RENDER_MAX_IMAGE_BYTES, RENDER_JPEG_QUALITY,
            )
    except MeasurementError as exc:
        return {"ok": False, "method": engine, "error": str(exc)}

    try:
        if engine == "local":
            if view == "profile":
                # There is no side photograph of the patient anywhere in this flow, and
                # the deterministic compositor only ever pastes what it was given. Making
                # one up is precisely what this engine exists NOT to do.
                return {
                    "ok": False,
                    "method": "local-overlay",
                    "view": view,
                    "provider": "local",
                    "error": (
                        "La composición local no puede producir una vista de perfil: no "
                        "hay ninguna fotografía lateral del paciente y este motor no "
                        "inventa nada. Usa un motor de imagen por IA para el perfil."
                    ),
                }
            return render_local_overlay(
                face[0], face[1], glasses[1], context or {}, frame_total_width_mm
            )
        return render_ai_tryon(
            engine, face, glasses, model=model, api_key=api_key, view=view
        )
    except MissingApiKeyError as exc:
        return {
            "ok": False,
            "method": engine,
            "view": view,
            "provider": engine,
            "error": str(exc),
            "errorCode": exc.code,
            "envKeys": exc.env_keys,
        }
    except ProviderError as exc:
        # ProviderError is itself a RuntimeError; caught first so its status (quota,
        # congestion, timeout) turns into the same machine-readable codes run_measurement
        # produces, instead of falling into the generic branch below with none at all.
        return {
            "ok": False,
            "method": engine,
            "view": view,
            "provider": engine,
            "error": str(exc),
            "errorCode": _provider_error_code(exc),
        }
    except (ValueError, RuntimeError) as exc:
        return {"ok": False, "method": engine, "provider": engine, "error": str(exc)}
    except Exception as exc:
        return {
            "ok": False,
            "method": engine,
            "provider": engine,
            "error": f"Fallo inesperado generando la imagen: {exc}",
        }
