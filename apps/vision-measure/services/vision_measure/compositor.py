"""
Produces the picture of the patient wearing the frame.

The measurement models are text-output only: they read the two photographs and answer
with JSON, never with an image. Rendering the try-on is therefore a separate step with
its own engines, and two very different kinds of them:

    "local"   Deterministic 2D composite done here with Pillow. The frame is cut out,
              scaled with the SAME millimetre scale the measurement used, rotated to the
              pupil axis and pasted on the pupil line. No key, no network, no invention:
              what it shows is exactly the geometry the report claims. It is a fitting
              diagram, not a photograph — it does not relight the frame or occlude it
              behind the nose.

    "ai"      A real image model edits the two photographs into one. Photorealistic, and
              free to move things: it can quietly change the frame's proportions, which
              is precisely what must not happen to a measurement. Use it to show the
              patient, use the local one to check the fit.

Only some vendors can return an image at all. Anthropic, Mistral and xAI have no image
output on this surface, so choosing them for the render falls back to "local".
"""

import base64
import io
import math
import time
from typing import Any, Dict, Optional, Tuple

import requests

from services.vision_measure.config import (
    MissingApiKeyError,
    ProviderSpec,
    get_provider,
    resolve_api_key,
)

# Vendors whose image models accept two input images and return an edited one.
#
# Both defaults were a generation or two behind what the vendors' own chat products use,
# which is most of why a patient rendered here did not look like the same patient
# rendered in ChatGPT. gpt-image-2 preserves reference detail natively; the Gemini 3 Pro
# image model is the one that will honour an explicit output resolution.
IMAGE_CAPABLE = {
    "gemini": "gemini-3-pro-image-preview",
    "openai": "gpt-image-2",
    "openrouter": "google/gemini-3-pro-image-preview",
}

# Preview model ids get retired without notice and there is no operator sitting on the
# render call to retype one. Falls back once, loudly, rather than losing the picture.
IMAGE_FALLBACK = {
    "gemini": "gemini-2.5-flash-image",
    "openai": "gpt-image-1",
    "openrouter": "google/gemini-2.5-flash-image",
}

# gpt-image-1 needs to be TOLD to preserve faces; without input_fidelity="high" it
# re-invents the patient, which is the single most visible defect in the generated
# try-on. gpt-image-2 already processes reference images at high fidelity and rejects
# the parameter, so it must not be sent there.
INPUT_FIDELITY_MODELS = ("gpt-image-1", "gpt-image-1.5")

# A portrait, not a square: "auto" was free to come back 1024x1024 and crop the face.
OPENAI_IMAGE_SIZE = "1024x1536"
GEMINI_IMAGE_ASPECT = "2:3"
# 1K en vez de 2K: 1/4 de píxeles ⇒ el render tarda mucho menos. Para un montaje de
# gafas que se ve en móvil/reporte es más que suficiente; las MEDIDAS ya no dependen de
# esta imagen (se calculan aparte con MediaPipe), así que aquí prima la velocidad.
GEMINI_IMAGE_SIZE = "1K"

RENDER_TIMEOUT_S = 240

# The image path used to post with a bare requests.post: no retry, no backoff, nothing.
# The measurement path beside it has retried transient failures for a while, so a capacity
# dip that the numbers rode out killed the picture instantly -- and both views, because
# they fire at the same moment. One policy, defined once in `providers`, now applies to
# both.
from services.vision_measure.providers import (  # noqa: E402
    MAX_RETRIES,
    RETRYABLE_STATUSES,
    _retry_delay,
)


def _looks_congested(status: int, body: str) -> bool:
    """
    Whether this failure is the vendor being busy rather than the account being wrong.

    Worth separating precisely because the two look alike in a red box and need opposite
    actions. 503/UNAVAILABLE and "high demand" are capacity: waiting or asking a
    lighter model fixes them. 429/RESOURCE_EXHAUSTED is the account's own quota, and no
    amount of retrying will help.
    """
    lowered = (body or "").lower()
    return status in (500, 502, 503, 504) or "unavailable" in lowered or (
        "high demand" in lowered or "overloaded" in lowered
    )


def _post_image(session_post, label: str, **kwargs):
    """
    Posts a render request, riding out the capacity dips.

    Returns the response, or raises RuntimeError with a message that says WHICH kind of
    failure it was. Two renders run concurrently, so the jitter in `_retry_delay` matters
    more here than anywhere else: without it both would back off by the same amount and
    collide again on every attempt.
    """
    last = None
    for attempt in range(MAX_RETRIES + 1):
        resp = session_post(**kwargs)
        if resp.status_code < 400:
            return resp

        last = resp
        retryable = resp.status_code in RETRYABLE_STATUSES
        if not retryable or attempt >= MAX_RETRIES:
            break

        delay = _retry_delay(attempt, resp)
        print(
            f"[VISION] {label}: imagen, {resp.status_code} transitorio, "
            f"reintento {attempt + 1}/{MAX_RETRIES} en {delay:.1f}s"
        )
        time.sleep(delay)

    body = last.text[:600] if last is not None else ""
    status = last.status_code if last is not None else 0

    if _looks_congested(status, body):
        raise RuntimeError(
            f"{label} respondió {status}: el modelo de imagen está saturado ahora mismo. "
            f"No es un problema de tu clave ni de saldo — si lo fuera, la medición de esta "
            f"misma petición también habría fallado. Ya se reintentó {MAX_RETRIES} veces. "
            f"Los modelos 'preview' y los tope de gama son los primeros en congestionarse: "
            f"elige un motor de imagen más ligero, o repite en unos minutos. "
            f"Detalle del proveedor: {body}"
        )

    if status == 429:
        raise RuntimeError(
            f"{label} respondió 429: has alcanzado la cuota o el límite de peticiones de "
            f"tu cuenta. ESTO SÍ es un problema de plan o de saldo, no de saturación: "
            f"revisa la facturación y los límites del proyecto. Detalle: {body}"
        )

    raise RuntimeError(f"{label} respondió {status}: {body}")



# Alpha left on the lens aperture once it is punched out. Not zero: a real lens is
# visible, and a fully transparent hole makes the composite look like a cut-out mask.
LENS_ALPHA = 46

# Lazily built once: loading u2net on every request would dominate the response time.
_REMBG_SESSION = None

# On identity: a generative model REWRITES the picture, it does not paste onto it, so no
# wording here can guarantee the face comes back untouched. This asks for it as plainly as
# it can be asked — and the panel says, next to the engine selector, that the only option
# which cannot alter the patient is the deterministic local composite.
TRY_ON_PROMPT = (
    "IMAGE 1 is a photograph of a person. IMAGE 2 is a photograph of an eyewear frame. "
    "Produce ONE photorealistic image of the SAME person from IMAGE 1 wearing the EXACT "
    "frame from IMAGE 2.\n"
    "THE MOST IMPORTANT CONSTRAINT: this is a medical fitting record, not a portrait. "
    "The person must remain recognisably, verifiably the SAME individual. Treat IMAGE 1 "
    "as the ground truth and change NOTHING about it except adding the frame. If you "
    "cannot add the frame without altering the face, return the face unaltered and place "
    "the frame imperfectly — a slightly misplaced frame is correctable, a changed face "
    "makes the whole record useless.\n"
    "Hard constraints:\n"
    "- Do NOT alter: facial proportions, the shape or spacing of the eyes, the nose, the "
    "mouth, the jaw, skin texture, wrinkles, blemishes, age, hair, expression, head pose "
    "or the background. No beautifying, no smoothing, no slimming, no straightening, no "
    "makeup, no lighting cleanup.\n"
    "- Keep the person's face, identity, expression, skin, hair, pose and background "
    "unchanged. Do not retouch or beautify them.\n"
    "- Keep the frame's shape, colour, material and proportions exactly as in IMAGE 2. "
    "Do not restyle it.\n"
    "- Seat the frame as it would really sit: bridge on the nasal saddle, rims level with "
    "the pupil line, temples running to the ears.\n"
    "- Match the lighting and perspective of IMAGE 1, with a plausible shadow on the face.\n"
    "- Keep the EXACT same framing, crop and camera distance as IMAGE 1. Do not zoom in, "
    "do not re-compose the shot, do not change the background.\n"
    "Return only the image."
)


PROFILE_PROMPT = (
    "IMAGE 1 is a SIDE (profile) photograph of a real person. IMAGE 2 is a photograph of "
    "an eyewear frame. Produce ONE photorealistic image that is IMAGE 1 UNCHANGED with "
    "the EXACT frame from IMAGE 2 added onto the person's face, worn from the side.\n"
    "THE MOST IMPORTANT CONSTRAINT: this is a medical fitting record, not a portrait. "
    "Treat IMAGE 1 as the ground truth and change NOTHING about it except adding the "
    "frame. Keep the SAME person, the SAME background and room, the SAME lighting, the "
    "SAME head pose and the SAME framing/crop. If you cannot add the frame without "
    "altering the person or the scene, add it imperfectly rather than change them.\n"
    "Hard constraints:\n"
    "- Do NOT alter: the person's identity, face, skin, wrinkles, hair, ear, expression, "
    "head pose, OR the background. No beautifying, smoothing, slimming or rejuvenating. "
    "Do NOT turn the head to another angle and do NOT re-frame or zoom the shot.\n"
    "- Keep the frame's shape, colour, material and proportions exactly as in IMAGE 2.\n"
    "- This view shows the FIT AT THE SIDE, so it must read clearly: the temple running "
    "from the hinge back over the ear, the pantoscopic tilt of the front, and the gap "
    "between the rim and the cheek.\n"
    "- Match the lighting and perspective of IMAGE 1.\n"
    "Return only the image."
)



# A generated portrait arrives as PNG from some vendors — megabytes of losslessly encoded
# skin tones. It travels to the browser, gets embedded in the report, and is stored in
# localStorage, so its size is felt three times over. JPEG at this quality is visually
# indistinguishable for this purpose and roughly a tenth of the bytes.
GENERATED_IMAGE_MAX_EDGE = 2048
GENERATED_IMAGE_QUALITY = 94


def _recompress(image_b64: str, media_type: str) -> Tuple[str, str]:
    """
    Re-encodes a generated image to a reasonably sized JPEG.

    Returns the original pair untouched if anything goes wrong: a slightly large picture
    is a far better outcome than losing it.
    """
    try:
        from PIL import Image

        raw = base64.b64decode(image_b64)
        original_kb = len(raw) // 1024

        image = Image.open(io.BytesIO(raw))
        image.load()
        if image.mode != "RGB":
            image = image.convert("RGB")

        longest = max(image.size)
        if longest > GENERATED_IMAGE_MAX_EDGE:
            ratio = GENERATED_IMAGE_MAX_EDGE / float(longest)
            image = image.resize(
                (max(1, int(image.width * ratio)), max(1, int(image.height * ratio))),
                Image.LANCZOS,
            )

        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=GENERATED_IMAGE_QUALITY, optimize=True)
        encoded = buffer.getvalue()
        print(
            f"[VISION] Imagen generada: {original_kb} KB {media_type} -> "
            f"{len(encoded) // 1024} KB JPEG {image.width}x{image.height}"
        )
        return base64.b64encode(encoded).decode("ascii"), "image/jpeg"
    except Exception as exc:
        print(f"[VISION] No se pudo recomprimir la imagen generada ({exc}); se envía tal cual.")
        return image_b64, media_type

def describe_image_engines() -> list:
    """Catalogue for the render selector in the panel."""
    engines = [
        {
            "id": "local",
            "label": "Composición local (determinista, sin clave)",
            "requiresKey": False,
            "requiresContext": True,
            "defaultModel": None,
        }
    ]
    for provider_id, model in IMAGE_CAPABLE.items():
        spec = get_provider(provider_id)
        engines.append(
            {
                "id": provider_id,
                "label": f"{spec.label} · imagen generada",
                "requiresKey": True,
                "requiresContext": False,
                "defaultModel": model,
            }
        )
    return engines


# --------------------------------------------------------------------- local


def _cutout_frame(raw: bytes):
    """
    Returns the frame as RGBA cropped to its own silhouette.

    Product photos come on white; pasting one unmasked would drop a white rectangle over
    the patient's face. rembg is already a project dependency and does this properly; the
    luminance fallback keeps the feature working if the model weights are unavailable.
    """
    from PIL import Image

    image = Image.open(io.BytesIO(raw))
    image.load()

    if image.mode == "RGBA" and image.getchannel("A").getextrema()[0] < 250:
        cut = image  # already carries a real alpha channel
    else:
        cut = _remove_background(image)

    bbox = cut.getchannel("A").getbbox()
    return cut.crop(bbox) if bbox else cut


def _punch_lens_apertures(frame) -> int:
    """
    Makes the lens apertures see-through.

    Background removal keeps the white inside the rims, because to a segmentation model
    it is part of the object. Pasted like that, the composite hides the patient's eyes —
    which is the one thing an optician needs to see. The apertures are found as the
    light, desaturated regions that are ENCLOSED by the frame: a flood fill from a
    border of light pixels reaches the outside of the frame but cannot get inside a
    closed rim.

    Runs on the already-resized frame (a few tens of thousands of pixels), and returns
    how many pixels it opened. A white or rimless frame yields nothing enclosed, so it
    degrades to leaving the cut-out untouched.
    """
    from PIL import Image, ImageDraw

    width, height = frame.size
    rgba = frame.load()

    # 1px border of "light" so every edge-connected light region is reachable from (0,0)
    mask = Image.new("L", (width + 2, height + 2), 255)
    mp = mask.load()
    for y in range(height):
        for x in range(width):
            r, g, b, _ = rgba[x, y]
            lo, hi = min(r, g, b), max(r, g, b)
            mp[x + 1, y + 1] = 255 if (lo > 205 and hi - lo < 26) else 0

    # Everything light and reachable from the border is outside the frame
    ImageDraw.floodfill(mask, (0, 0), 128, thresh=0)

    opened = 0
    for y in range(height):
        for x in range(width):
            if mp[x + 1, y + 1] != 255:
                continue
            r, g, b, a = rgba[x, y]
            if a > LENS_ALPHA:
                rgba[x, y] = (r, g, b, LENS_ALPHA)
                opened += 1

    return opened


def _remove_background(image):
    from PIL import Image

    global _REMBG_SESSION
    try:
        from rembg import new_session, remove

        if _REMBG_SESSION is None:
            _REMBG_SESSION = new_session("u2net")
        return remove(image.convert("RGB"), session=_REMBG_SESSION).convert("RGBA")
    except Exception as exc:
        print(f"[VISION] rembg no disponible ({exc}); se recorta por luminancia.")

    # Fallback: treat near-white as background. Good enough for a catalogue shot.
    rgb = image.convert("RGB")
    alpha = Image.new("L", rgb.size, 255)
    px_rgb = rgb.load()
    px_a = alpha.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            r, g, b = px_rgb[x, y]
            if r > 238 and g > 238 and b > 238:
                px_a[x, y] = 0
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def render_local_overlay(
    face_media: str,
    face_b64: str,
    glasses_b64: str,
    context: Dict[str, Any],
    frame_total_width_mm: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Pastes the frame onto the captured face using the measured geometry.

    Everything that positions the frame comes from figures already in the report: the
    millimetres-per-normalized-unit scale, the two pupil landmarks, and the frame's total
    front width. That is the point — if the composite looks wrong, the measurement is
    wrong, and the operator can see it.
    """
    from PIL import Image

    started = time.time()

    lm = (context or {}).get("landmarksNormalized") or {}
    scale_block = (context or {}).get("scale") or {}
    right = lm.get("rightPupil")
    left = lm.get("leftPupil")
    mm_per_norm = scale_block.get("millimetresPerNormalizedXUnit")

    if not right or not left or not mm_per_norm:
        raise ValueError(
            "La composición local necesita una captura con rostro detectado "
            "(posiciones de pupilas y escala medida). Usa un motor de imagen por IA, "
            "o vuelve a capturar con la cámara."
        )

    face = Image.open(io.BytesIO(base64.b64decode(face_b64))).convert("RGBA")
    width, height = face.size

    rx, ry = right["x"] * width, right["y"] * height
    lx, ly = left["x"] * width, left["y"] * height
    pupil_span_px = math.hypot(lx - rx, ly - ry)
    if pupil_span_px < 5:
        raise ValueError("Las pupilas detectadas están demasiado juntas para componer la imagen.")

    px_per_mm = width / float(mm_per_norm)

    # Width of the frame front, in this order of trust: what the model measured from the
    # frame photo, the catalogue frame on screen, and finally a proportion of the
    # measured PD.
    total_mm = frame_total_width_mm
    if not total_mm:
        catalog = (context or {}).get("catalogFrameOnScreen") or {}
        total_mm = catalog.get("totalFrontWidthMM")
    source = "medida por el modelo" if frame_total_width_mm else "catálogo en pantalla"
    if not total_mm:
        pd = ((context or {}).get("measuredFacial") or {}).get("pdTotalMM")
        total_mm = (pd * 2.2) if pd else 138.0
        source = "estimada a partir de la DIP"

    target_px = float(total_mm) * px_per_mm
    frame = _cutout_frame(base64.b64decode(glasses_b64))
    ratio = target_px / frame.width
    frame = frame.resize(
        (max(1, round(frame.width * ratio)), max(1, round(frame.height * ratio))),
        Image.LANCZOS,
    )

    # Open the lens apertures, or the composite hides the eyes it is meant to show
    opened_px = _punch_lens_apertures(frame)

    # Roll of the head, read from the pupil axis
    angle_deg = math.degrees(math.atan2(ly - ry, lx - rx))
    frame = frame.rotate(-angle_deg, expand=True, resample=Image.BICUBIC)

    # The pupil sits above the vertical centre of the lens, so the frame's own centre
    # goes slightly below the pupil line.
    cx = (rx + lx) / 2.0
    cy = (ry + ly) / 2.0 + 0.035 * target_px

    composite = face.copy()
    composite.alpha_composite(
        frame, (int(round(cx - frame.width / 2)), int(round(cy - frame.height / 2)))
    )

    buffer = io.BytesIO()
    composite.convert("RGB").save(buffer, format="JPEG", quality=92, optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")

    return {
        "ok": True,
        "method": "local-overlay",
        "view": "front",
        "provider": "local",
        "model": None,
        "imageDataUrl": f"data:image/jpeg;base64,{encoded}",
        "latencyMs": int((time.time() - started) * 1000),
        "geometry": {
            "frameTotalWidthMM": round(float(total_mm), 1),
            "frameWidthSource": source,
            "pixelsPerMM": round(px_per_mm, 3),
            "rollAngleDeg": round(angle_deg, 2),
            "lensAperturePx": opened_px,
        },
        "note": (
            "Composición geométrica local: la montura se escala con la misma escala en "
            "mm que sostiene el informe y se alinea al eje pupilar. Es un esquema de "
            "adaptación, no una fotografía: no reilumina la montura ni la oculta tras "
            "la nariz."
        ),
    }


# ------------------------------------------------------------------------ AI


def render_ai_tryon(
    provider_id: str,
    face: Tuple[str, str],
    glasses: Tuple[str, str],
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    view: str = "front",
) -> Dict[str, Any]:
    """
    Asks an image model to edit the two photographs into one worn shot.

    `view` is "front" or "profile". The profile view is a genuine extrapolation — there
    is no side photograph of the patient anywhere in this flow — so it is useful for
    showing temple and pantoscopic fit to the patient, and useless as evidence. The note
    it comes back with says so.
    """
    spec = get_provider(provider_id)
    if spec.id not in IMAGE_CAPABLE:
        raise ValueError(
            f"{spec.label} no devuelve imágenes en esta API. Motores con salida de "
            f"imagen: {', '.join(IMAGE_CAPABLE)} (o la composición local)."
        )

    chosen = (model or "").strip() or IMAGE_CAPABLE[spec.id]
    key = resolve_api_key(spec, api_key)
    started = time.time()
    prompt = PROFILE_PROMPT if view == "profile" else TRY_ON_PROMPT

    renderer = {
        "gemini": _render_gemini,
        "openai": _render_openai,
    }.get(spec.id, _render_openrouter)

    try:
        image_b64, media = renderer(spec, chosen, key, face, glasses, prompt)
    except RuntimeError as exc:
        # The defaults above are preview ids, and a retired one comes back as a 404 in
        # the middle of a fitting with nobody to retype it. Retry once on the previous
        # generation, and say so — a silently substituted engine is how you end up
        # comparing two renders that were never made by the same model.
        spare = IMAGE_FALLBACK.get(spec.id)
        # Two reasons to reach for the spare, not one. A retired preview id was always
        # handled; sustained congestion was not, and it is the commoner of the two: the
        # spare is a generally-available model with far more capacity than the top-tier
        # preview that just turned us away four times running.
        retired = _looks_like_missing_model(str(exc))
        congested = "saturado" in str(exc)
        if not spare or spare == chosen or not (retired or congested):
            raise
        reason = "no disponible" if retired else "saturado"
        print(f"[VISION] {spec.label}: '{chosen}' {reason}; se reintenta con '{spare}'.")
        image_b64, media = renderer(spec, spare, key, face, glasses, prompt)
        chosen = spare

    image_b64, media = _recompress(image_b64, media)

    note = (
        "Imagen generada por IA. Sirve para enseñar el resultado al paciente, no "
        "para verificar medidas: un modelo generativo puede alterar las "
        "proporciones de la montura sin avisar."
    )
    if view == "profile":
        note = (
            "Vista de perfil INVENTADA por la IA a partir de una foto frontal: no existe "
            "ninguna fotografía lateral del paciente. Muestra cómo se leería el apoyo de "
            "la varilla y la inclinación pantoscópica, pero no es una medida ni una "
            "prueba de nada."
        )

    return {
        "ok": True,
        "method": "ai-generated",
        "view": view,
        "provider": spec.id,
        "model": chosen,
        "imageDataUrl": f"data:{media};base64,{image_b64}",
        "latencyMs": int((time.time() - started) * 1000),
        "note": note,
    }


def _looks_like_missing_model(message: str) -> bool:
    """True when a render failed because the model id is gone, not because of the input."""
    low = message.lower()
    return any(
        needle in low
        for needle in (
            "not_found", "not found", "no longer available", "does not exist",
            "unknown model", "invalid model", "model_not_found", "unsupported model",
        )
    )


def _render_gemini(spec: ProviderSpec, model: str, key: str, face, glasses, prompt: str):
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": face[0], "data": face[1]}},
                    {"inlineData": {"mimeType": glasses[0], "data": glasses[1]}},
                ],
            }
        ],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            # Portrait at 2K. Left unset, the model answers 1:1 at 1K and the patient's
            # face arrives cropped and soft — the same shape of loss as OpenAI's
            # size:"auto". The 2.5 family ignores imageConfig rather than rejecting it.
            "imageConfig": {
                "aspectRatio": GEMINI_IMAGE_ASPECT,
                "imageSize": GEMINI_IMAGE_SIZE,
            },
        },
    }
    resp = _post_image(
        requests.post,
        spec.label,
        url=f"{spec.base_url}/models/{model}:generateContent",
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        json=payload,
        timeout=RENDER_TIMEOUT_S,
    )

    data = resp.json()
    for candidate in data.get("candidates") or []:
        for part in (candidate.get("content") or {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return inline["data"], inline.get("mimeType") or inline.get("mime_type") or "image/png"

    raise RuntimeError(f"{spec.label} no devolvió ninguna imagen: {str(data)[:400]}")


def _render_openai(spec: ProviderSpec, model: str, key: str, face, glasses, prompt: str):
    # The edits endpoint takes the reference images as multipart files, not as JSON.
    files = [
        ("image[]", ("face.jpg", base64.b64decode(face[1]), face[0])),
        ("image[]", ("frame.jpg", base64.b64decode(glasses[1]), glasses[0])),
    ]
    data = {
        "model": model,
        "prompt": prompt,
        "n": "1",
        "size": OPENAI_IMAGE_SIZE,
        "quality": "high",
    }
    # This endpoint is posted as multipart and has no 400-repair ladder behind it, so an
    # unsupported field is a dead run. Only the models documented to take it get it.
    if any(model.startswith(name) for name in INPUT_FIDELITY_MODELS):
        data["input_fidelity"] = "high"

    resp = _post_image(
        requests.post,
        spec.label,
        url=f"{spec.base_url}/images/edits",
        headers={"Authorization": f"Bearer {key}"},
        data=data,
        files=files,
        timeout=RENDER_TIMEOUT_S,
    )

    payload = resp.json()
    entries = payload.get("data") or []
    if entries and entries[0].get("b64_json"):
        return entries[0]["b64_json"], "image/png"
    if entries and entries[0].get("url"):
        fetched = requests.get(entries[0]["url"], timeout=60)
        return base64.b64encode(fetched.content).decode("ascii"), "image/png"

    raise RuntimeError(f"{spec.label} no devolvió ninguna imagen: {str(payload)[:400]}")


def _render_openrouter(spec: ProviderSpec, model: str, key: str, face, glasses, prompt: str):
    payload = {
        "model": model,
        "modalities": ["image", "text"],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{face[0]};base64,{face[1]}"}},
                    {"type": "image_url", "image_url": {"url": f"data:{glasses[0]};base64,{glasses[1]}"}},
                ],
            }
        ],
    }
    resp = _post_image(
        requests.post,
        spec.label,
        url=f"{spec.base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            **spec.extra_headers,
        },
        json=payload,
        timeout=RENDER_TIMEOUT_S,
    )

    data = resp.json()
    for choice in data.get("choices") or []:
        for entry in (choice.get("message") or {}).get("images") or []:
            url = (entry.get("image_url") or {}).get("url", "")
            if url.startswith("data:") and ";base64," in url:
                head, encoded = url.split(";base64,", 1)
                return encoded, head.replace("data:", "") or "image/png"

    raise RuntimeError(f"{spec.label} no devolvió ninguna imagen: {str(data)[:400]}")
