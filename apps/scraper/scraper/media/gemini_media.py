"""
Gemini-generated product views and promotional video for a single frame photograph.

TWO DIFFERENT APIS, both on generativelanguage.googleapis.com and both keyed by
GEMINI_API_KEY, but with nothing else in common:

  * IMAGES  - `:generateContent`, synchronous, returns base64 inline data. The request
    shape is the one services/vision_measure/compositor.py already proved in production;
    it is mirrored here rather than imported because that module is about compositing a
    frame onto a patient, and its prompts and aspect ratio are wrong for a packshot.
  * VIDEO   - `:predictLongRunning`, asynchronous. Returns an operation name that has to
    be polled, and the finished file lives behind a URI that itself needs the API key.

READ THIS BEFORE FEEDING THE VIEWS INTO 3D RECONSTRUCTION. These views are INVENTED, not
observed. Multi-view reconstruction is worth doing because extra angles let the model
SEE the far temple and the hidden rim instead of inferring them; a generated side view
observes nothing - it is one model's plausible guess handed to another model as if it
were evidence. It can help, because a consistent guess still regularises the
reconstruction, and it can equally well lock in a confident invention. That is an
empirical question per frame, not a settled win, and the panel says so.
"""

import base64
import mimetypes
import os
import time
from datetime import datetime
from typing import Callable, Dict, List, Optional, Tuple

import requests

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

IMAGE_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
VIDEO_MODEL = os.environ.get("GEMINI_VIDEO_MODEL", "veo-3.1-fast-generate-preview")

#: Square, because these are packshots. compositor.py asks for 2:3 portrait, which is
#: right for a face wearing the frame and wrong for the frame on its own.
IMAGE_ASPECT = "1:1"
IMAGE_SIZE = "2K"

REQUEST_TIMEOUT_S = 180
VIDEO_POLL_TIMEOUT_S = 900

#: Slot -> the camera move asked for. The wording carries the weight here: every prompt
#: repeats that the frame's identity must not drift, because the failure mode of an
#: image model asked for "the same object from behind" is a DIFFERENT, plausible frame.
VIEW_PROMPTS: Dict[str, str] = {
    "front": (
        "Studio packshot of THIS EXACT eyewear frame, viewed straight from the front, "
        "temples folded back and symmetric, centred, on a plain pure white background."
    ),
    "left": (
        "Studio packshot of THIS EXACT eyewear frame, rotated to a full LEFT side profile "
        "(90 degrees), temple arm extended and pointing away from the camera, on a plain "
        "pure white background."
    ),
    "right": (
        "Studio packshot of THIS EXACT eyewear frame, rotated to a full RIGHT side profile "
        "(90 degrees), temple arm extended and pointing away from the camera, on a plain "
        "pure white background."
    ),
    "back": (
        "Studio packshot of THIS EXACT eyewear frame seen from BEHIND (the side that "
        "faces the wearer), temples opened toward the camera, on a plain pure white "
        "background."
    ),
}

#: Appended to every view prompt. Identity preservation is the whole job.
IDENTITY_GUARD = (
    " Preserve the frame's exact shape, proportions, colour, material finish and every "
    "detail of the original photograph. Do not restyle, redesign or embellish it. Do not "
    "add a face, a model, hands, props, text or reflections. Even, neutral studio "
    "lighting, no harsh shadows. Keep the frame at the same scale in every image."
)

DEFAULT_VIDEO_PROMPT = (
    "Generame un video promocional de estos espejuelos en 3d con mivimiento y que sea "
    "comercial"
)

#: Appended to every video prompt: no spoken voice, everything else audible kept.
#:
#: THE PROMPT IS THE ONLY LEVER HERE. Veo 3.x generates synchronised audio in the same
#: pass and, on the Gemini API endpoint, that cannot be switched off: `generateAudio` is
#: reported as unsupported there, and `negativePrompt` is a Vertex AI field this endpoint
#: does not document. Google's own guidance is to steer audio through the prompt. So this
#: asks for silence of the VOICE specifically - music, ambience and sound effects stay,
#: which is what a promotional cut wants anyway.
NO_VOICEOVER_GUARD = (
    " Audio: instrumental music and subtle sound design only. NO voiceover, NO narration, "
    "NO spoken words, NO dialogue, NO singing and no human voice of any kind. Do not add "
    "on-screen text, captions, subtitles or logos."
)

#: Sent as a Veo parameter when the endpoint accepts it, and dropped when it does not.
#: Belt and braces to the prompt guard above: documented for Vertex AI, undocumented for
#: this endpoint, so it is offered rather than assumed.
NO_VOICEOVER_NEGATIVE = "voiceover, narration, speech, dialogue, singing, human voice, subtitles, text overlay"


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------
# TOKENS ARE NOT A COST, and the two halves of this module are not even billed in the
# same unit, so a single "tokens used" number answers nothing:
#
#   * IMAGES are billed per TOKEN. An image up to 1024x1024 costs 1290 output tokens.
#   * VIDEO is billed per SECOND of output. Veo returns no token count at all, and
#     reporting a zero there was true but useless - it read as "this was free".
#
# Prices below are Google's published paid-tier figures (ai.google.dev/gemini-api/docs/
# pricing, read 2026-09-05). They are the one thing here that goes stale on someone
# else's schedule, so every one is overridable by environment variable and every estimate
# carries the rate it used - a number whose rate is unknown cannot be checked.
USD_PER_1M_OUTPUT_TOKENS = float(os.environ.get("GEMINI_IMAGE_USD_PER_1M_OUTPUT", "30.0"))
USD_PER_1M_INPUT_TOKENS = float(os.environ.get("GEMINI_IMAGE_USD_PER_1M_INPUT", "0.30"))

#: USD per second of video, by model family and resolution. Audio is included in the
#: rate; Veo does not bill it separately.
VIDEO_USD_PER_SECOND = {
    ("fast", "720p"): 0.10,
    ("fast", "1080p"): 0.12,
    ("fast", "4k"): 0.30,
    ("standard", "720p"): 0.40,
    ("standard", "1080p"): 0.40,
    ("standard", "4k"): 0.60,
}

#: Veo's own default when durationSeconds is not sent. Stated explicitly because the
#: whole video cost is duration x rate, so an assumed duration is an assumed bill.
DEFAULT_VIDEO_SECONDS = int(os.environ.get("GEMINI_VIDEO_SECONDS", "8"))

PRICES_READ_ON = "2026-09-05"


def image_cost_usd(usage: Dict[str, int]) -> float:
    """USD for a token count, at the configured rates."""
    return (usage.get("output", 0) / 1_000_000.0 * USD_PER_1M_OUTPUT_TOKENS
            + usage.get("prompt", 0) / 1_000_000.0 * USD_PER_1M_INPUT_TOKENS)


def video_rate_usd(model: str, resolution: str) -> Optional[float]:
    """USD per second for a Veo model/resolution, or None when the pair is unknown."""
    family = "fast" if "fast" in (model or "").lower() else "standard"
    return VIDEO_USD_PER_SECOND.get((family, (resolution or "").lower()))


def _usage_from(body: dict) -> Dict[str, int]:
    """
    Token counts as the API reports them, or zeros.

    Only `:generateContent` returns `usageMetadata`. Veo bills per second of video, not
    per token, so a video call reports nothing here - and a fabricated number would be
    worse than an honest zero.
    """
    usage = (body or {}).get("usageMetadata") or {}
    return {
        "prompt": int(usage.get("promptTokenCount") or 0),
        "output": int(usage.get("candidatesTokenCount") or 0),
        "total": int(usage.get("totalTokenCount") or 0),
    }


def _write_receipt(out_dir: str, receipt: dict) -> str:
    """
    Writes cost.json beside the generated files.

    This is the "how do I identify what I was charged for" half. A number printed to a
    console scrollback cannot be reconciled against a bill three weeks later; a file
    stamped with the model, the rates used, the token counts and the timestamp can.
    """
    import json as _json
    path = os.path.join(out_dir, "cost.json")
    with open(path, "w", encoding="utf-8") as handle:
        _json.dump(receipt, handle, indent=2, ensure_ascii=False)
    return path


def _read_image(path: str) -> Tuple[str, str]:
    """Returns (mime_type, base64) for a local image."""
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as handle:
        return mime, base64.b64encode(handle.read()).decode("ascii")


def _run_dir(root: str, kind: str) -> str:
    """One timestamped directory per run, so successive attempts never overwrite."""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(root, kind, stamp)
    os.makedirs(path, exist_ok=True)
    return path


def generate_views(
    image_path: str,
    api_key: str,
    output_root: str,
    slots: Optional[List[str]] = None,
    model: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, object]:
    """
    Generates one packshot per requested view from a single frame photograph.

    Each view is its own request. One call asking for four images gives no way to retry
    a single bad angle and no way to report which one failed, and the failures here are
    per-view: a model will happily nail the profile and invent a different frame for the
    rear.
    """
    if not api_key:
        raise ValueError("GEMINI_API_KEY no proporcionada.")
    if not os.path.exists(image_path):
        raise FileNotFoundError(image_path)

    slots = slots or list(VIEW_PROMPTS.keys())
    model = model or IMAGE_MODEL
    mime, source_b64 = _read_image(image_path)
    out_dir = _run_dir(output_root, "gemini_views")

    produced: Dict[str, str] = {}
    failures: Dict[str, str] = {}
    # Per-view token cost, plus the running total. Reported because a run is four billed
    # requests, not one, and without the breakdown a surprising bill has no attribution.
    usage_by_view: Dict[str, Dict[str, int]] = {}
    usage_total = {"prompt": 0, "output": 0, "total": 0}

    for index, slot in enumerate(slots):
        if slot not in VIEW_PROMPTS:
            continue
        if progress_callback:
            progress_callback(0.1 + 0.8 * index / max(len(slots), 1), f"Gemini: vista {slot}...")
        print(f"[GEMINI-VIEWS] Generando vista '{slot}' con {model}...", flush=True)

        payload = {
            "contents": [{
                "role": "user",
                "parts": [
                    {"text": VIEW_PROMPTS[slot] + IDENTITY_GUARD},
                    {"inlineData": {"mimeType": mime, "data": source_b64}},
                ],
            }],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {"aspectRatio": IMAGE_ASPECT, "imageSize": IMAGE_SIZE},
            },
        }

        try:
            resp = requests.post(
                f"{BASE_URL}/models/{model}:generateContent",
                headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
                json=payload,
                timeout=REQUEST_TIMEOUT_S,
            )
            if resp.status_code != 200:
                failures[slot] = f"HTTP {resp.status_code}: {resp.text[:200]}"
                print(f"[GEMINI-VIEWS] '{slot}' fallo -> {failures[slot]}", flush=True)
                continue

            body = resp.json()
            used = _usage_from(body)
            usage_by_view[slot] = used
            for key in usage_total:
                usage_total[key] += used[key]

            data = _first_inline_image(body)
            if data is None:
                failures[slot] = "la respuesta no traia ninguna imagen"
                continue

            raw, out_mime = data
            ext = ".png" if "png" in out_mime else ".jpg"
            dest = os.path.join(out_dir, f"{slot}{ext}")
            with open(dest, "wb") as handle:
                handle.write(base64.b64decode(raw))
            produced[slot] = dest
            print(f"[GEMINI-VIEWS] '{slot}' -> {dest} "
                  f"| tokens: {used['total']} (entrada {used['prompt']}, salida {used['output']})",
                  flush=True)
        except Exception as err:  # noqa: BLE001 - one bad view must not lose the others
            failures[slot] = str(err)
            print(f"[GEMINI-VIEWS] '{slot}' fallo -> {err}", flush=True)

    cost_total = image_cost_usd(usage_total)
    cost_by_view = {slot: image_cost_usd(u) for slot, u in usage_by_view.items()}

    print(f"[GEMINI-VIEWS] TOTAL: {usage_total['total']} tokens = ${cost_total:.4f} USD "
          f"({len(produced)} imagen(es); salida ${USD_PER_1M_OUTPUT_TOKENS}/1M, "
          f"entrada ${USD_PER_1M_INPUT_TOKENS}/1M)", flush=True)

    receipt = {
        "kind": "images",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model,
        "billing_unit": "tokens",
        "views": list(produced),
        "usage_by_view": usage_by_view,
        "usage_total": usage_total,
        "cost_by_view_usd": {k: round(v, 6) for k, v in cost_by_view.items()},
        "cost_total_usd": round(cost_total, 6),
        "rates": {
            "usd_per_1m_output_tokens": USD_PER_1M_OUTPUT_TOKENS,
            "usd_per_1m_input_tokens": USD_PER_1M_INPUT_TOKENS,
            "published_prices_read_on": PRICES_READ_ON,
            "source": "https://ai.google.dev/gemini-api/docs/pricing",
        },
        "note": "Estimacion. Verifica contra la consola de facturacion de Google.",
    }
    receipt_path = _write_receipt(out_dir, receipt)

    return {
        "dir": out_dir, "views": produced, "failures": failures, "model": model,
        "usage_by_view": usage_by_view, "usage_total": usage_total,
        "cost_by_view_usd": cost_by_view, "cost_total_usd": cost_total,
        "receipt": receipt_path,
    }


#: How the starting image is attached to a Veo request, in the order they are tried.
#:
#: THE DOCS AND THE LIVE API DISAGREE, so this asks rather than assumes. Google's own
#: image-to-video REST example shows `image.inlineData.{mimeType,data}`, and sending
#: exactly that comes back as:
#:
#:     400 INVALID_ARGUMENT - "`inlineData` isn't supported by this model."
#:
#: Note "by this model": the accepted shape depends on which Veo variant is in play, and
#: `image.bytesBase64Encoded` is the predict-style form the other variants take. Rather
#: than pick one and be wrong for half the models, the first is tried and a 400 that
#: NAMES the field falls through to the second. Whichever works is printed, so the log
#: says what this account's model actually wanted.
VIDEO_IMAGE_SHAPES = ("bytesBase64Encoded", "inlineData")


def _video_image_field(shape: str, mime: str, data_b64: str) -> dict:
    if shape == "inlineData":
        return {"inlineData": {"mimeType": mime, "data": data_b64}}
    return {"bytesBase64Encoded": data_b64, "mimeType": mime}


def _submit_video(model, api_key, prompt, mime, source_b64, aspect_ratio, resolution,
                  negative_prompt: Optional[str] = None,
                  duration_seconds: int = DEFAULT_VIDEO_SECONDS):
    """
    Submits the generation, trying each documented image shape until one is not rejected.

    Only a 400 whose message names the field is treated as "wrong shape, try the other".
    Any other failure - bad key, no quota, unknown model - is returned as-is, because
    retrying it with a different field name would only bury the real reason.
    """
    last = None
    # negativePrompt is documented for Vertex AI and NOT for this endpoint, so it is
    # offered and withdrawn rather than assumed. Dropping it costs nothing: the prompt
    # guard is what actually carries the no-voice instruction.
    send_negative = bool(negative_prompt)
    for index, shape in enumerate(VIDEO_IMAGE_SHAPES):
        parameters = {"aspectRatio": aspect_ratio, "resolution": resolution,
                      "durationSeconds": duration_seconds}
        if send_negative:
            parameters["negativePrompt"] = negative_prompt
        payload = {
            "instances": [{
                "prompt": prompt,
                "image": _video_image_field(shape, mime, source_b64),
            }],
            "parameters": parameters,
        }
        resp = requests.post(
            f"{BASE_URL}/models/{model}:predictLongRunning",
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            json=payload,
            timeout=REQUEST_TIMEOUT_S,
        )
        if resp.status_code == 200:
            if index > 0:
                print(f"[GEMINI-VIDEO] La forma '{VIDEO_IMAGE_SHAPES[0]}' fue rechazada; "
                      f"'{shape}' aceptada por {model}.", flush=True)
            return resp

        last = resp
        # An unknown-field 400 about negativePrompt means this endpoint does not take it:
        # drop it and retry the SAME image shape before moving on.
        if (resp.status_code == 400 and send_negative
                and "negativePrompt" in resp.text):
            print("[GEMINI-VIDEO] negativePrompt no aceptado por este endpoint; "
                  "se retira (el prompt ya lleva la instruccion).", flush=True)
            send_negative = False
            parameters.pop("negativePrompt", None)
            resp = requests.post(
                f"{BASE_URL}/models/{model}:predictLongRunning",
                headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
                json=payload,
                timeout=REQUEST_TIMEOUT_S,
            )
            if resp.status_code == 200:
                return resp
            last = resp

        rejects_shape = (
            resp.status_code == 400
            and any(name in resp.text for name in VIDEO_IMAGE_SHAPES)
        )
        if not rejects_shape:
            return resp
        print(f"[GEMINI-VIDEO] '{shape}' rechazada por {model}; probando la alternativa...",
              flush=True)

    return last


def _first_inline_image(data: dict) -> Optional[Tuple[str, str]]:
    """Pulls the first inline image out of a generateContent response."""
    for candidate in data.get("candidates") or []:
        for part in (candidate.get("content") or {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                return inline["data"], mime
    return None


def generate_video(
    image_path: str,
    api_key: str,
    output_root: str,
    prompt: Optional[str] = None,
    model: Optional[str] = None,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    no_voiceover: bool = True,
    duration_seconds: int = DEFAULT_VIDEO_SECONDS,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, object]:
    """
    Generates a promotional video from the frame photograph, via Veo.

    Long-running by design: the submit returns an operation name, the operation is polled
    until `done`, and the finished file sits behind a URI that ALSO needs the API key -
    a plain fetch of that URI without the header comes back empty.
    """
    if not api_key:
        raise ValueError("GEMINI_API_KEY no proporcionada.")
    if not os.path.exists(image_path):
        raise FileNotFoundError(image_path)

    model = model or VIDEO_MODEL
    prompt = (prompt or DEFAULT_VIDEO_PROMPT).strip()
    if no_voiceover:
        prompt = prompt + NO_VOICEOVER_GUARD
    mime, source_b64 = _read_image(image_path)
    out_dir = _run_dir(output_root, "gemini_video")

    print(f"[GEMINI-VIDEO] Enviando tarea a {model} ({aspect_ratio}, {resolution})...", flush=True)
    resp = _submit_video(
        model, api_key, prompt, mime, source_b64, aspect_ratio, resolution,
        negative_prompt=NO_VOICEOVER_NEGATIVE if no_voiceover else None,
        duration_seconds=duration_seconds,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Error al crear la tarea de video ({resp.status_code}): {resp.text[:400]}")

    operation = (resp.json() or {}).get("name")
    if not operation:
        raise RuntimeError(f"Veo no devolvio un nombre de operacion: {resp.text[:300]}")
    print(f"[GEMINI-VIDEO] Operacion {operation}. Sondeando...", flush=True)

    started = time.time()
    result = None
    while time.time() - started < VIDEO_POLL_TIMEOUT_S:
        poll = requests.get(
            f"{BASE_URL}/{operation}",
            headers={"x-goog-api-key": api_key},
            timeout=60,
        )
        if poll.status_code == 200:
            body = poll.json()
            if body.get("done"):
                if body.get("error"):
                    raise RuntimeError(f"Veo devolvio un error: {body['error']}")
                result = body
                break
            elapsed = int(time.time() - started)
            print(f"[GEMINI-VIDEO] En curso ({elapsed}s)...", flush=True)
            if progress_callback:
                progress_callback(0.5, f"Veo: generando ({elapsed}s)...")
        else:
            print(f"[GEMINI-VIDEO] Sondeo devolvio {poll.status_code}: {poll.text[:200]}", flush=True)
        time.sleep(10)

    if result is None:
        raise TimeoutError(f"Tiempo de espera agotado ({VIDEO_POLL_TIMEOUT_S}s) esperando el video de Veo.")

    samples = (((result.get("response") or {}).get("generateVideoResponse") or {})
               .get("generatedSamples") or [])
    uri = (samples[0].get("video") or {}).get("uri") if samples else None
    if not uri:
        raise RuntimeError(f"Veo no devolvio ninguna URI de video: {str(result)[:400]}")

    print(f"[GEMINI-VIDEO] Descargando...", flush=True)
    # The header is required on the download too; without it the URI answers with an error
    # page rather than the file.
    video = requests.get(uri, headers={"x-goog-api-key": api_key}, timeout=600)
    video.raise_for_status()

    dest = os.path.join(out_dir, "promocional.mp4")
    with open(dest, "wb") as handle:
        handle.write(video.content)
    print(f"[GEMINI-VIDEO] -> {dest} ({len(video.content)} bytes)", flush=True)

    # Veo bills per SECOND of video, not per token, so `usage` is honestly empty here
    # rather than filled with a plausible-looking number. Whatever the operation does
    # report is passed through untouched.
    usage = _usage_from(result)
    rate = video_rate_usd(model, resolution)
    cost = rate * duration_seconds if rate is not None else None

    if cost is not None:
        print(f"[GEMINI-VIDEO] -> {dest} | {duration_seconds}s x ${rate}/s = "
              f"${cost:.4f} USD (facturado por duracion, no por tokens)", flush=True)
    else:
        print(f"[GEMINI-VIDEO] -> {dest} | sin tarifa conocida para "
              f"{model} @ {resolution}; consulta la consola.", flush=True)

    receipt = {
        "kind": "video",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "model": model,
        "operation": operation,          # reconciles this run against the console
        "billing_unit": "seconds",   # machine-readable, like "tokens" above
        "resolution": resolution,
        "aspect_ratio": aspect_ratio,
        "duration_seconds": duration_seconds,
        "usd_per_second": rate,
        "cost_total_usd": round(cost, 6) if cost is not None else None,
        "tokens_reported": usage,        # Veo reports none; kept so the zero is explicit
        "rates": {
            "published_prices_read_on": PRICES_READ_ON,
            "source": "https://ai.google.dev/gemini-api/docs/pricing",
        },
        "no_voiceover": no_voiceover,
        "note": "Estimacion. Verifica contra la consola de facturacion de Google.",
    }
    receipt_path = _write_receipt(out_dir, receipt)

    return {
        "dir": out_dir, "path": dest, "model": model, "prompt": prompt,
        "usage_total": usage, "billed_by": "duracion del video (segundos), no tokens",
        "no_voiceover": no_voiceover, "duration_seconds": duration_seconds,
        "usd_per_second": rate, "cost_total_usd": cost, "receipt": receipt_path,
        "operation": operation,
    }
