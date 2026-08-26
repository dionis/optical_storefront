"""
Multimodal chat adapters.

Three wire protocols cover every vendor in the registry:

    "openai"     OpenAI, Qwen (DashScope compatible mode), Mistral, xAI, OpenRouter
    "anthropic"  Claude Messages API
    "gemini"     Google generativeLanguage generateContent

Each adapter takes the same arguments and returns the same tuple, so `measure.py` never
branches on the vendor. Uses `requests` like `cloud_providers.py` does, rather than
introducing a second HTTP client into the project.
"""

import copy
import json
import os
import random
import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import requests

from services.vision_measure.config import ProviderSpec

# A frame photo plus a face photo is a small request; a slow reasoning model is not.
def _env_seconds(name: str, default: int) -> int:
    """A timeout worth changing in production without editing code."""
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return value if 10 <= value <= 900 else default


# Two budgets, because the two shapes of request are not the same job. An ordinary
# measurement is one round trip: if it has not answered in three minutes it is not going
# to, and a shorter fuse gets the operator to a retry sooner. A run that has to open the
# supplier page adds a search, one or more page fetches and the reading of them BEFORE
# the model starts reasoning, so the same fuse cuts off work that was progressing
# normally -- and cuts it off after billing for all of it.
REQUEST_TIMEOUT_S = _env_seconds("VISION_REQUEST_TIMEOUT_S", 180)
BROWSING_TIMEOUT_S = _env_seconds("VISION_BROWSING_TIMEOUT_S", 300)
MAX_OUTPUT_TOKENS = 3000
# Budget used once a vendor asks for `max_completion_tokens`: see the note in
# _post_with_param_fallbacks. Reasoning tokens come out of this same allowance.
REASONING_OUTPUT_TOKENS = 26000

# How hard a reasoning model is allowed to think before answering.
#
# This used to be pinned to "low", bundled into the same correction that renames
# max_tokens -> max_completion_tokens, and then MEMOISED — so every GPT-5.x call after
# the first one shipped low effort without even trying. Reading a "53-17-140" engraving
# off a temple and deriving a fitting height from it is exactly the task that collapses
# at low effort, and it is why the report came back full of nulls next to a ChatGPT
# session that answered the same question well. The two corrections are unrelated: a
# vendor asking for max_completion_tokens says nothing about how much thinking the task
# deserves.
REASONING_EFFORT = "high"

# Gemini 2.5+ and 3.x think before answering, and those thinking tokens are billed
# against maxOutputTokens. With a chat-sized cap the model spends the allowance on
# thinking and the JSON comes back CUT OFF mid-object — which reads as "the model does
# not speak JSON" rather than "it ran out of room". Room for both halves.
GEMINI_OUTPUT_TOKENS = 32000

# Gemini 3 replaced the legacy `thinkingBudget` with `thinkingLevel`, and the two are
# mutually exclusive in one request. That mattered more than it looks: gemini-3.1-pro
# already defaults to HIGH, so sending the old 4096-token budget was not "a lid on the
# thinking half", it was a demotion — the exact same mistake as reasoning_effort=low on
# the OpenAI side, arriving through a different door. `_call_gemini` now asks for the
# level and falls back to the budget only for the 2.5 family, which does not know the
# newer field.
GEMINI_THINKING_LEVEL = "high"
GEMINI_THINKING_BUDGET = 12288

# How many tokens the vision stack may spend looking at each image. The default is
# already HIGH for images, but declaring it keeps the frame's printed size code legible
# if that default ever moves, and makes the intent reviewable. ULTRA_HIGH exists but is
# per-Part and Gemini-3-only, so it is not reachable from this one global switch.
GEMINI_MEDIA_RESOLUTION = "MEDIA_RESOLUTION_HIGH"

# Claude's cap covers the answer only, but the report object is long enough that the
# chat-sized default was cutting it off.
ANTHROPIC_OUTPUT_TOKENS = 8000

# Statuses that mean "not now" rather than "not ever". A capacity spike on the vendor's
# side lasts seconds; failing the whole fitting over it is a waste of a good capture.
# 429 is in here too: it is usually a per-minute rate limit, which clears by waiting.
RETRYABLE_STATUSES = {408, 425, 429, 500, 502, 503, 504}
MAX_RETRIES = 3
RETRY_BASE_DELAY_S = 3.0

# Overload hits preview and top-end models hardest — they have the least spare capacity.
# Suggested when a call keeps failing, and only SUGGESTED: silently swapping the model
# would change which engine produced a clinical measurement without telling anyone.
STABLE_ALTERNATIVE = {
    "openai": "gpt-5.6-luna",
    "anthropic": "claude-sonnet-5",
    "gemini": "gemini-3-flash-preview",
    "qwen": "qwen-vl-plus",
    "mistral": "mistral-medium-latest",
    "xai": "grok-2-vision-1212",
    "openrouter": "google/gemini-3-flash-preview",
}


class ProviderError(RuntimeError):
    """
    A provider refused the request, or gave an answer that cannot be used.

    Carries the token usage when the call actually reached the model. A truncated answer
    is the most expensive failure there is — it burns the whole output budget — so
    dropping it from the accounting would hide exactly the spend worth knowing about.
    """

    def __init__(
        self,
        message: str,
        status: Optional[int] = None,
        body: str = "",
        usage: Optional[Dict[str, Any]] = None,
        code: str = "",
    ):
        super().__init__(message)
        self.status = status
        self.body = body
        self.usage = usage
        # Machine-readable reason, so the panel can localise the remedy rather than
        # printing a Spanish sentence assembled in the backend.
        self.code = code


# Image payloads travel as (media_type, base64_data) pairs in presentation order.
ImagePayload = Tuple[str, str]


# Who can actually open a page. Gemini does it with `url_context` on its ordinary
# endpoint; OpenAI needs the Responses API and its `web_search` tool -- a different
# endpoint with a different request and response shape, which is why it is keyed by
# provider id and not by adapter. The four other vendors sharing the "openai" adapter
# (Qwen, Mistral, xAI, OpenRouter) speak /chat/completions only and do not implement
# /responses, and Anthropic is in the same position. Saying so out loud beats letting the
# report imply the model looked and found nothing.
_BROWSING_ADAPTERS = frozenset({"gemini"})
_BROWSING_PROVIDERS = frozenset({"openai"})


def supports_browsing(spec: ProviderSpec) -> bool:
    """Whether this provider can be asked to open a URL as part of the measurement."""
    return spec.adapter in _BROWSING_ADAPTERS or spec.id in _BROWSING_PROVIDERS


def call_multimodal(
    spec: ProviderSpec,
    model: str,
    api_key: str,
    system: str,
    user: str,
    images: Sequence[ImagePayload],
    browse_urls: Sequence[str] = (),
) -> Dict[str, Any]:
    """
    Sends one multimodal turn and returns
    {"text": str, "usage": dict, "latencyMs": int, "model": str, "urlRetrieval": list}.

    `browse_urls` are pages the prompt asks the model to open. Gemini reads them with
    `url_context` on its ordinary endpoint; OpenAI is diverted to /responses with web
    search on. Every other provider ignores them and `urlRetrieval` comes back empty,
    which is the honest answer for a model that never had the option.
    """
    started = time.time()
    retrieval: List[Dict[str, Any]] = []

    if spec.adapter == "openai":
        # Browsing needs the other endpoint. If it will not serve us -- an account
        # without the tool, a model that rejects it, an outright 404 -- fall back to the
        # ordinary path rather than failing the run: a measurement without the supplier
        # dimensions still beats no measurement, and the report says the page went unread.
        if browse_urls and supports_browsing(spec):
            try:
                text, usage, retrieval = _call_openai_responses(
                    spec, model, api_key, system, user, images, browse_urls
                )
                return {
                    "text": text,
                    "usage": usage,
                    "urlRetrieval": retrieval,
                    "latencyMs": int((time.time() - started) * 1000),
                    "model": model,
                }
            except ProviderError as exc:
                print(
                    f"[VISION] {spec.label}: /responses no disponible "
                    f"({exc.status or '?'}: {_vendor_message(exc.body)}); "
                    f"se mide sin búsqueda web"
                )

        text, usage = _call_openai_compatible(spec, model, api_key, system, user, images)
    elif spec.adapter == "anthropic":
        text, usage = _call_anthropic(spec, model, api_key, system, user, images)
    elif spec.adapter == "gemini":
        text, usage, retrieval = _call_gemini(
            spec, model, api_key, system, user, images, browse_urls
        )
    else:  # unreachable through the registry, kept so a bad edit fails loudly
        raise ProviderError(f"Adaptador desconocido: {spec.adapter}")

    return {
        "text": text,
        "usage": usage,
        "urlRetrieval": retrieval,
        "latencyMs": int((time.time() - started) * 1000),
        "model": model,
    }


def _retry_delay(attempt: int, response) -> float:
    """
    How long to wait before the next attempt.

    The vendor's own Retry-After is obeyed when present — it knows better than any
    formula here. Otherwise exponential backoff with jitter, because a fleet of clients
    retrying in lockstep is what turns a capacity dip into an outage.
    """
    if response is not None:
        header = response.headers.get("Retry-After") if response.headers else None
        if header:
            try:
                return max(0.5, min(30.0, float(header)))
            except (TypeError, ValueError):
                pass
    return RETRY_BASE_DELAY_S * (2 ** attempt) * (0.7 + random.random() * 0.6)


def _post_json(
    url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    label: str,
    timeout_s: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Posts, retrying the failures that are worth retrying.

    A vendor answering "currently experiencing high demand" is not a defect in this code
    and not something the operator can fix: it is a few seconds of congestion. Without
    this loop that momentary dip discarded the capture, the prompt and the images.

    A timeout is NOT retried: the request already spent the full window, and a second one
    would double a wait the operator is watching.
    """
    last: Optional[ProviderError] = None
    budget = timeout_s or REQUEST_TIMEOUT_S

    for attempt in range(MAX_RETRIES + 1):
        response = None
        try:
            response = requests.post(
                url, headers=headers, json=payload, timeout=budget
            )
        except requests.Timeout as exc:
            # Coded so the panel can offer the remedy in the operator's own language
            # instead of showing a wall-clock number they can do nothing with.
            raise ProviderError(
                f"{label}: la petición superó los {budget}s sin respuesta. "
                f"Suele ser un modelo de razonamiento pesado sobre dos fotografías "
                f"grandes; prueba con un modelo rápido (por ejemplo la variante Flash "
                f"o Mini), o sube VISION_REQUEST_TIMEOUT_S / VISION_BROWSING_TIMEOUT_S.",
                code="timeout",
            ) from exc
        except requests.RequestException as exc:
            # DNS failures, refused/reset connections, TLS errors — none of it is
            # something a retry a few seconds later cannot fix, and none of it is
            # something the customer looking at the panel could ever act on. Coded so
            # the panel shows the same "try again, or tell the site owner" message it
            # already shows for a vendor outage, instead of this exception's own text
            # (which, for a DNS failure, is a full NameResolutionError repr).
            last = ProviderError(f"{label}: fallo de red ({exc}).", code="network-error")
            if attempt >= MAX_RETRIES:
                raise last from exc
        else:
            if response.status_code < 400:
                try:
                    return response.json()
                except ValueError as exc:
                    raise ProviderError(
                        f"{label} devolvió una respuesta no JSON: {response.text[:400]}"
                    ) from exc

            last = ProviderError(
                f"{label} respondió {response.status_code}: {response.text[:800]}",
                status=response.status_code,
                body=response.text,
            )
            if response.status_code not in RETRYABLE_STATUSES or attempt >= MAX_RETRIES:
                raise last

        delay = _retry_delay(attempt, response)
        status = response.status_code if response is not None else "sin respuesta"
        print(
            f"[VISION] {label}: {status} transitorio, reintento "
            f"{attempt + 1}/{MAX_RETRIES} en {delay:.1f}s"
        )
        time.sleep(delay)

    raise last if last else ProviderError(f"{label}: petición rechazada.")




# Every vendor has its own word for "I ran out of room", and every one of them used to be
# ignored as long as SOME text came back. A cut-off JSON then failed downstream as
# "not interpretable", blaming the parser for a budget problem. One check, three adapters.
TRUNCATION_REASONS = {"length", "max_tokens", "maxtokens", "max_output_tokens", "model_length"}


def _reject_if_truncated(
    label: str,
    reason: str,
    text: str,
    usage: Dict[str, Any],
    remedy: str,
) -> None:
    """Raises when the vendor says the answer was cut short. No-op otherwise."""
    normalized = str(reason or "").strip().lower().replace("-", "_")
    if normalized not in TRUNCATION_REASONS:
        return

    thinking = usage.get("thinkingTokens")
    raise ProviderError(
        f"{label} se quedó sin espacio y devolvió la respuesta cortada "
        f"(motivo={reason}"
        + (f", {thinking} tokens gastados en razonar" if thinking else "")
        + f", {len(text)} caracteres útiles). {remedy}",
        usage=usage,
    )

def _vendor_message(body: str) -> str:
    """
    Digs the human-readable complaint out of an error body.

    Vendors nest it differently ({"error":{"message":…}} for most, {"detail":…} for some),
    and the raw body is mostly boilerplate. Falls back to a truncated body so nothing is
    ever swallowed.
    """
    try:
        parsed = json.loads(body or "")
    except (ValueError, TypeError):
        return (body or "")[:200] or "(sin cuerpo)"

    if isinstance(parsed, dict):
        error = parsed.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("code")
            if message:
                param = error.get("param")
                return f"{message}" + (f" [param={param}]" if param else "")
        for key in ("message", "detail", "msg"):
            if parsed.get(key):
                return str(parsed[key])[:200]

    return str(parsed)[:200]

def _rejected_param(body: str) -> Optional[str]:
    """
    The parameter the vendor objected to, when it bothers to say.

    OpenAI-compatible errors carry it in `error.param`, sometimes as a dotted path
    (`response_format.type`), and always repeat it in the message. Reading it is the
    difference between fixing the request and guessing at it.
    """
    try:
        parsed = json.loads(body or "")
        error = parsed.get("error") if isinstance(parsed, dict) else None
        if isinstance(error, dict) and error.get("param"):
            return str(error["param"]).split(".")[0].strip()
    except (ValueError, TypeError):
        pass

    match = re.search(r"[Uu]nsupported (?:parameter|value):\s*'?([A-Za-z_.]+)'?", body or "")
    return match.group(1).split(".")[0] if match else None


def _fix_param(attempt: Dict[str, Any], name: str) -> Optional[str]:
    """
    Applies the correction for one rejected parameter, in place.

    Returns a description of what it did, or None when there is nothing to correct —
    which is how the caller knows to stop rather than loop.
    """
    if name == "max_tokens" and "max_tokens" in attempt:
        # A vendor asking for max_completion_tokens is a reasoning model. Those bill
        # their private reasoning against the same budget, so the cap that suits a plain
        # chat model gets consumed before a single character of the answer is written.
        # REASONING_OUTPUT_TOKENS is sized for both halves; the effort level is a
        # separate decision and lives in its own constant.
        attempt.pop("max_tokens")
        attempt["max_completion_tokens"] = REASONING_OUTPUT_TOKENS
        attempt["reasoning_effort"] = REASONING_EFFORT
        return (
            f"max_tokens -> max_completion_tokens + "
            f"reasoning_effort={REASONING_EFFORT}"
        )

    if name in attempt:
        attempt.pop(name)
        return f"sin {name}"

    # Two of the Responses API's knobs are NESTED, so the plain `name in attempt` test
    # above never sees them and the ladder would skip straight past the thing the vendor
    # just named. Reached only when those keys are actually present, so this is inert on
    # the /chat/completions path.
    # `response_format` is what /chat/completions calls JSON mode; /responses calls the
    # same thing `text`. The vendor answers with the name IT knows, so a complaint about
    # one has to be able to fix the other -- otherwise the directed repair finds nothing,
    # falls through to the blind ladder, and sheds unrelated parameters one round trip at
    # a time while the operator waits.
    if name in ("response_format", "text") and "text" in attempt:
        attempt.pop("text")
        return "sin modo JSON (incompatible con la búsqueda web)"

    if name == "external_web_access":
        touched = False
        for tool in attempt.get("tools") or []:
            if isinstance(tool, dict) and tool.pop("external_web_access", None) is not None:
                touched = True
        if touched:
            return "sin external_web_access (búsqueda sobre copia cacheada)"

    if name == "detail":
        touched = False
        for message in attempt.get("input") or []:
            if not isinstance(message, dict):
                continue
            for part in message.get("content") or []:
                if isinstance(part, dict) and part.pop("detail", None) is not None:
                    touched = True
        if touched:
            return "sin detail en las imágenes"

    return None



# Which parameters a given model has already refused, so the next call does not have to
# find out again. gpt-5 rejects both `max_tokens` and `temperature`, and discovering that
# costs two round trips EVERY time.
#
# On the isolation guarantee: this holds parameter NAMES and nothing else — no images, no
# context, no prompt, no answer, nothing about any patient. It shapes the request
# envelope, never its content. Two runs still produce byte-identical bodies.
_PARAM_MEMO: Dict[str, set] = {}


def _memo_key(spec_id: str, model: str) -> str:
    return f"{spec_id}:{model}"


def _remember_rejection(spec_id: str, model: str, param: str) -> None:
    _PARAM_MEMO.setdefault(_memo_key(spec_id, model), set()).add(param)


def _apply_known_rejections(attempt: Dict[str, Any], spec_id: str, model: str) -> list:
    """Pre-applies what this model has already refused. Returns what it corrected."""
    known = _PARAM_MEMO.get(_memo_key(spec_id, model))
    if not known:
        return []

    applied = []
    for param in sorted(known):
        action = _fix_param(attempt, param)
        if action:
            applied.append(action)
    return applied

def _post_with_param_fallbacks(
    url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    label: str,
    optional_params: Sequence[str],
    spec_id: str = "",
    model: str = "",
    timeout_s: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Posts, correcting the parameter the vendor actually complained about.

    The OpenAI-compatible surface is not uniform — reasoning models reject `temperature`,
    some gateways reject `response_format`, some want `max_completion_tokens` — so the
    request has to adapt. It used to adapt BLINDLY, dropping one optional parameter per
    round in a fixed order.

    That was worse than slow, it was harmful. Faced with gpt-5 the vendor named
    `max_tokens` on the very first 400; the ladder removed `response_format` and then
    `temperature` before getting to it, so the call that finally succeeded ran with NO
    JSON mode and at the default temperature. The measurements came back full of nulls
    and the cause looked like the model, not like the request.

    So: read `error.param`, fix that, keep everything else. The blind order remains only
    as a fallback for vendors that refuse without saying why.
    """
    attempt = copy.deepcopy(payload)
    last: Optional[ProviderError] = None
    remaining = list(optional_params)
    handled: set = set()

    # Skip straight past what this model refused last time
    for action in _apply_known_rejections(attempt, spec_id, model):
        print(f"[VISION] {label}: aplicando lo ya aprendido de {model} -> {action}")
    handled.update(_PARAM_MEMO.get(_memo_key(spec_id, model), set()))

    # One round per optional parameter, plus the initial full attempt and a safety margin
    for _ in range(len(optional_params) + 2):
        try:
            return _post_json(url, headers, attempt, label, timeout_s)
        except ProviderError as exc:
            if exc.status != 400:
                raise
            last = exc

            named = _rejected_param(exc.body)
            action = None

            if named and named not in handled:
                action = _fix_param(attempt, named)
                if action:
                    handled.add(named)
                    _remember_rejection(spec_id, model, named)
                    if named in remaining:
                        remaining.remove(named)

            # The vendor said nothing usable: fall back to dropping the next optional one
            while action is None and remaining:
                candidate = remaining.pop(0)
                if candidate in handled:
                    continue
                action = _fix_param(attempt, candidate)
                if action:
                    handled.add(candidate)

            if action is None:
                raise last

            print(
                f"[VISION] {label}: 400 -> {_vendor_message(exc.body)} "
                f"| corrigiendo: {action}"
            )

    raise last if last else ProviderError(f"{label}: petición rechazada.")




# Every vendor has its own word for "I ran out of room", and every one of them used to be
# ignored as long as SOME text came back. A cut-off JSON then failed downstream as
# "not interpretable", blaming the parser for a budget problem. One check, three adapters.

def _call_openai_compatible(
    spec: ProviderSpec,
    model: str,
    api_key: str,
    system: str,
    user: str,
    images: Sequence[ImagePayload],
) -> Tuple[str, Dict[str, Any]]:
    content: List[Dict[str, Any]] = [{"type": "text", "text": user}]
    for media_type, b64 in images:
        image_url: Dict[str, Any] = {"url": f"data:{media_type};base64,{b64}"}
        # Ask for the full-detail read rather than whatever `auto` decides. The size code
        # stamped inside a temple is a few pixels tall; a downsampled pass simply cannot
        # see it. Only the two vendors known to accept the field get it — a gateway that
        # chokes on an unknown key inside image_url would fail the whole run, and the
        # 400-ladder below only repairs top-level parameters.
        if spec.id in ("openai", "openrouter"):
            image_url["detail"] = "high"
        content.append({"type": "image_url", "image_url": image_url})

    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
        "temperature": 0.1,
        # Claude bills only the answer against this, but the schema plus its notes is a
        # long object; the old 3000 left it landing on the edge of the cap.
        "max_tokens": ANTHROPIC_OUTPUT_TOKENS,
    }
    if spec.supports_json_mode:
        payload["response_format"] = {"type": "json_object"}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        **spec.extra_headers,
    }

    data = _post_with_param_fallbacks(
        f"{spec.base_url}/chat/completions",
        headers,
        payload,
        spec.label,
        # Plain names now: _fix_param knows that max_tokens means "rename it", and the
        # order only matters for vendors that reject without naming a parameter.
        optional_params=("max_tokens", "response_format", "temperature", "reasoning_effort"),
        spec_id=spec.id,
        model=model,
    )

    choices = data.get("choices") or []
    if not choices:
        raise ProviderError(f"{spec.label} no devolvió ninguna respuesta: {json.dumps(data)[:400]}")

    message = choices[0].get("message") or {}
    text = message.get("content")

    # Some gateways return the content already split into parts.
    if isinstance(text, list):
        text = "".join(part.get("text", "") for part in text if isinstance(part, dict))
    if not text:
        text = choices[0].get("text") or ""

    if not str(text).strip():
        finish = choices[0].get("finish_reason", "?")
        usage = _normalize_usage(data.get("usage"))

        # A reasoning model bills its private reasoning against the same allowance as the
        # answer, so it can hit the cap before writing a single character. That comes back
        # as finish_reason=length with empty content — nothing to do with vision, and the
        # old wording ("no acepta imágenes") sent the operator after the wrong problem.
        if str(finish) == "length":
            raise ProviderError(
                f"{spec.label} agotó el presupuesto de tokens antes de escribir la "
                f"respuesta (finish_reason=length, {usage.get('outputTokens') or '?'} "
                f"tokens de salida). Es lo típico de un modelo de razonamiento: sube "
                f"REASONING_OUTPUT_TOKENS en services/vision_measure/providers.py, o "
                f"elige un modelo sin razonamiento extendido.",
                usage=usage,
            )

        raise ProviderError(
            f"{spec.label} devolvió contenido vacío (finish_reason={finish}). "
            "Suele indicar que el modelo elegido no acepta imágenes."
        )

    usage = _normalize_usage(data.get("usage"))
    _reject_if_truncated(
        spec.label,
        choices[0].get("finish_reason", ""),
        str(text),
        usage,
        "Sube MAX_OUTPUT_TOKENS (o REASONING_OUTPUT_TOKENS, si el modelo razona) en "
        "services/vision_measure/providers.py, o elige un modelo sin razonamiento "
        "extendido.",
    )
    return str(text), usage


# The Responses API is a second, incompatible way of talking to OpenAI. It is used ONLY
# when the run needs a page opened, so an ordinary measurement keeps taking the well-worn
# /chat/completions path and is unaffected by anything here.
RESPONSES_OUTPUT_TOKENS = 32000


def _call_openai_responses(
    spec: ProviderSpec,
    model: str,
    api_key: str,
    system: str,
    user: str,
    images: Sequence[ImagePayload],
    browse_urls: Sequence[str] = (),
) -> Tuple[str, Dict[str, Any], List[Dict[str, Any]]]:
    """
    Calls POST /responses with web search on, so the model can read the supplier page.

    The budget is deliberately generous: the model spends tokens searching, reading and
    reasoning before it writes a character, all against the same allowance, and running
    out mid-answer is the most expensive failure there is -- it bills in full and returns
    nothing usable.
    """
    # Said twice, at the two ends of the prompt, because without JSON mode nothing but
    # the wording keeps the answer parseable, and a model that has just read a web page
    # is strongly inclined to summarise it in a sentence first. The last instruction a
    # model reads is the one it follows best, so the closing copy is the load-bearing one.
    json_only = (
        "\n\nOUTPUT FORMAT — ABSOLUTE. Reply with ONE raw JSON object and NOTHING else: "
        "no preface, no explanation, no markdown fence, no citation list, no closing "
        "remark. The first character you write must be '{' and the last must be '}'. "
        "Anything outside that object makes the answer unusable."
    )

    content: List[Dict[str, Any]] = [{"type": "input_text", "text": user}]
    for media_type, b64 in images:
        content.append(
            {
                "type": "input_image",
                "image_url": f"data:{media_type};base64,{b64}",
                "detail": "high",
            }
        )
    # Same reasoning as Gemini: the tool reads the request, not the instructions block.
    if browse_urls:
        content.append({"type": "input_text", "text": _browse_request(browse_urls)})
    content.append({"type": "input_text", "text": json_only})

    payload: Dict[str, Any] = {
        "model": model,
        "instructions": system + json_only,
        "input": [{"role": "user", "content": content}],
        # `external_web_access` asks for the live page rather than a cached snapshot.
        # A supplier's technical table is exactly the kind of page a stale copy gets
        # wrong, and reading a stale A or B is worse than reading none.
        "tools": [{"type": "web_search", "external_web_access": True}],
        "tool_choice": "auto",
        "max_output_tokens": RESPONSES_OUTPUT_TOKENS,
    }

    # NO JSON mode here, deliberately. OpenAI rejects the combination outright -- "Web
    # Search cannot be used with JSON mode" -- so asking for it costs a 400 and, worse,
    # sends the repair ladder hunting: the vendor names `response_format`, a parameter
    # this endpoint does not even have, so the ladder shed three unrelated knobs one
    # round trip at a time before stumbling onto the real one. Three wasted calls on a
    # request that already takes a minute.
    #
    # The answer therefore arrives as prose that contains the object. `extract_json_object`
    # reads that, but only if the model was told plainly to write nothing else -- which is
    # what the reinforced instruction below is for. Guessing is not an option at this
    # point in the request: the images are already uploaded.

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        **spec.extra_headers,
    }

    data = _post_with_param_fallbacks(
        f"{spec.base_url}/responses",
        headers,
        payload,
        spec.label,
        # Named so the directed 400-repair can shed exactly what the vendor rejects.
        # `tools` is last: losing it costs the lookup this whole path exists for.
        optional_params=("external_web_access", "detail", "tool_choice", "tools"),
        spec_id=spec.id,
        model=model,
        timeout_s=BROWSING_TIMEOUT_S,
    )

    text, retrieval = _read_responses_output(data, spec.label)
    usage = _normalize_usage(data.get("usage"))

    # `status: incomplete` is this API's way of saying the answer was cut short.
    if str(data.get("status") or "").lower() == "incomplete":
        reason = str((data.get("incomplete_details") or {}).get("reason") or "length")
        _reject_if_truncated(
            spec.label,
            reason,
            text,
            usage,
            "Sube RESPONSES_OUTPUT_TOKENS en services/vision_measure/providers.py, o "
            "elige un modelo que razone menos antes de responder.",
        )

    if not text.strip():
        raise ProviderError(
            f"{spec.label} devolvió contenido vacío por /responses "
            f"(status={data.get('status')}).",
            usage=usage,
        )

    if browse_urls:
        summary = ", ".join(f"{i['url']} -> {i['status']}" for i in retrieval) or (
            "el modelo no consultó ninguna página"
        )
        print(f"[VISION] {spec.label}: web_search: {summary}")

    return text, usage, retrieval


def _read_responses_output(
    data: Dict[str, Any], label: str
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Pulls the assistant text and the pages consulted out of a /responses body.

    The `output` array interleaves reasoning items, tool calls and messages, and only the
    message items carry text. Citations are the honest evidence of a page having been
    read -- a `web_search_call` alone says the model searched, not that anything it found
    reached the answer -- so the two are reported with different statuses.
    """
    chunks: List[str] = []
    cited: Dict[str, str] = {}
    opened: List[str] = []
    searched: List[str] = []

    for item in data.get("output") or []:
        if not isinstance(item, dict):
            continue

        kind = item.get("type")
        if kind == "web_search_call":
            action = item.get("action") or {}
            # An action carrying a URL means the model actually fetched that page. A
            # query-only action means it searched and may never have opened anything.
            url = action.get("url")
            if url:
                opened.append(str(url))
            elif action.get("query"):
                searched.append(str(action["query"]))
            continue

        if kind != "message":
            continue

        for part in item.get("content") or []:
            if not isinstance(part, dict) or part.get("type") != "output_text":
                continue
            chunks.append(str(part.get("text") or ""))
            for note in part.get("annotations") or []:
                if isinstance(note, dict) and note.get("type") == "url_citation":
                    url = note.get("url")
                    if url:
                        cited[str(url)] = "SUCCESS"

    retrieval = [{"url": url, "status": status} for url, status in cited.items()]

    # A page the model opened but did not cite is still a page it read. Asking for a bare
    # JSON object means there are NO citations to find -- a prose answer is where those
    # live -- so treating citation as the only evidence would report every successful
    # lookup as a failure.
    for url in opened:
        if url not in cited:
            retrieval.append({"url": url, "status": "OPENED"})

    # A query with nothing opened says the model looked and came back empty-handed. Worth
    # showing: it is the difference between not trying and not finding.
    for query in searched:
        retrieval.append({"url": query, "status": "SEARCHED_NOT_OPENED"})

    return "".join(chunks), retrieval


def _call_anthropic(
    spec: ProviderSpec,
    model: str,
    api_key: str,
    system: str,
    user: str,
    images: Sequence[ImagePayload],
) -> Tuple[str, Dict[str, Any]]:
    content: List[Dict[str, Any]] = [{"type": "text", "text": user}]
    for media_type, b64 in images:
        content.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            }
        )

    payload = {
        "model": model,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "temperature": 0.1,
        "system": system,
        "messages": [{"role": "user", "content": content}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        **spec.extra_headers,
    }

    data = _post_json(f"{spec.base_url}/messages", headers, payload, spec.label)

    blocks = data.get("content") or []
    text = "".join(
        block.get("text", "")
        for block in blocks
        if isinstance(block, dict) and block.get("type") == "text"
    )
    if not text.strip():
        raise ProviderError(
            f"{spec.label} devolvió contenido vacío "
            f"(stop_reason={data.get('stop_reason')}): {json.dumps(data)[:400]}"
        )

    usage = _normalize_usage(data.get("usage"))
    _reject_if_truncated(
        spec.label,
        data.get("stop_reason", ""),
        text,
        usage,
        "Sube MAX_OUTPUT_TOKENS en services/vision_measure/providers.py.",
    )
    return text, usage


def _post_gemini_with_fallbacks(
    url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    label: str,
    timeout_s: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Posts to generateContent, giving up the newer knobs one at a time.

    Google's catalogue spans two generations at once and they do not accept the same
    generationConfig: `thinkingLevel` and `mediaResolution` are Gemini 3 fields, and the
    2.5 family answers a 400 for either. The old code handled that by throwing away
    thinkingConfig ENTIRELY on the first complaint, which silently dropped the model to
    whatever it does by default. Degrade one field at a time instead, downgrading
    thinkingLevel to the legacy budget before abandoning thinking altogether, so a 2.5
    model still thinks as hard as it can rather than as little as it likes.
    """
    steps = (
        # (probe found in the vendor's complaint, what to do about it, what to log)
        (
            "thinkinglevel",
            lambda pl: pl["generationConfig"].__setitem__(
                "thinkingConfig", {"thinkingBudget": GEMINI_THINKING_BUDGET}
            ),
            f"thinkingLevel no soportado -> thinkingBudget={GEMINI_THINKING_BUDGET}",
        ),
        (
            "mediaresolution",
            lambda pl: pl["generationConfig"].pop("mediaResolution", None),
            "mediaResolution no soportado -> se omite",
        ),
        (
            "thinking",
            lambda pl: pl["generationConfig"].pop("thinkingConfig", None),
            "thinkingConfig no soportado -> se omite",
        ),
        # Deliberately LAST. Combining tools with responseMimeType application/json is a
        # Gemini 3 capability; the 2.5 family answers 400. Dropping browsing costs the
        # supplier lookup, so it is the last knob shed when the vendor complains without
        # naming a field — better to lose extended thinking than the only route to the
        # published dimensions.
        (
            "tool",
            lambda pl: pl.pop("tools", None),
            "tools no soportado en este modelo -> se omite url_context "
            "(el modelo ya no puede abrir la ficha del proveedor)",
        ),
    )

    remaining = list(steps)

    for _ in range(len(steps) + 1):
        try:
            return _post_json(url, headers, payload, label, timeout_s)
        except ProviderError as exc:
            if exc.status != 400:
                raise
            body = (exc.body or "").lower().replace("_", "")

            applied = None
            for index, (probe, fix, note) in enumerate(remaining):
                if probe in body:
                    fix(payload)
                    applied = (index, note)
                    break

            # The vendor complained without naming a field: shed the next optional one.
            if applied is None and remaining:
                index, fix, note = 0, remaining[0][1], remaining[0][2]
                fix(payload)
                applied = (index, note)

            if applied is None:
                raise

            remaining.pop(applied[0])
            print(f"[VISION] {label}: 400 -> {_vendor_message(exc.body)} | {applied[1]}")

    raise ProviderError(f"{label}: petición rechazada.")


def _browse_request(browse_urls: Sequence[str]) -> str:
    """
    The "open these pages" turn, phrased for the tool that has to act on it.

    This belongs in the USER turn and not in the system instruction. Google's own words
    for url_context are "by providing URLs in a request", and every example they publish
    puts the address in the prompt input -- the tool reads the conversation contents
    looking for something to fetch. A URL that appears only in `systemInstruction` gives
    it nothing to work with: the tool is enabled, the call succeeds, no 400 is raised,
    and the model simply answers without ever having opened anything. That failure is
    invisible except in the retrieval metadata, which is exactly how it went unnoticed.
    """
    listed = "\n".join(browse_urls)
    return (
        "\n\nOPEN THESE PAGES NOW, BEFORE ANSWERING. They are the supplier's product "
        "pages for the frame identified above:\n"
        f"{listed}\n"
        "Read the technical table on the page you reach and take A, B, ED, Circ, DBL and "
        "the temple length from it. If a page does not load, or does not correspond to "
        "this model, say so in \"notes\" and report those values as NOT DETECTED — never "
        "as a guess."
    )


def _call_gemini(
    spec: ProviderSpec,
    model: str,
    api_key: str,
    system: str,
    user: str,
    images: Sequence[ImagePayload],
    browse_urls: Sequence[str] = (),
) -> Tuple[str, Dict[str, Any], List[Dict[str, Any]]]:
    parts: List[Dict[str, Any]] = [{"text": user}]
    for media_type, b64 in images:
        parts.append({"inlineData": {"mimeType": media_type, "data": b64}})

    # Last part, so it is the final thing the model reads before answering, and in the
    # user turn, which is where url_context looks for addresses to fetch.
    if browse_urls:
        parts.append({"text": _browse_request(browse_urls)})

    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": GEMINI_OUTPUT_TOKENS,
            "responseMimeType": "application/json",
            "mediaResolution": GEMINI_MEDIA_RESOLUTION,
            "thinkingConfig": {"thinkingLevel": GEMINI_THINKING_LEVEL},
        },
    }

    # url_context lets the model open the pages named in the prompt. Without it the Capri
    # protocol asks for a lookup the model has no way of performing, so every supplier
    # dimension comes back NOT DETECTED — correct by the protocol's own rule, and useless.
    # Enabled only when there is a page worth opening: an unused tool is dead weight, and
    # on the older models it is the thing that makes the request 400.
    if browse_urls:
        payload["tools"] = [{"url_context": {}}]
    # The key goes in a header rather than the query string so it never lands in a
    # proxy or server access log.
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
        **spec.extra_headers,
    }

    url = f"{spec.base_url}/models/{model}:generateContent"
    data = _post_gemini_with_fallbacks(
        url, headers, payload, spec.label,
        timeout_s=BROWSING_TIMEOUT_S if browse_urls else None,
    )

    candidates = data.get("candidates") or []
    if not candidates:
        feedback = data.get("promptFeedback") or {}
        raise ProviderError(
            f"{spec.label} no devolvió candidatos "
            f"(promptFeedback={json.dumps(feedback)[:300]})."
        )

    text = "".join(
        part.get("text", "")
        for part in (candidates[0].get("content") or {}).get("parts", [])
        if isinstance(part, dict)
    )
    reason = str(candidates[0].get("finishReason") or "?")
    usage = _normalize_usage(data.get("usageMetadata"))

    if not text.strip():
        raise ProviderError(
            f"{spec.label} devolvió contenido vacío (finishReason={reason})."
        )

    _reject_if_truncated(
        spec.label,
        reason,
        text,
        usage,
        "Sube GEMINI_OUTPUT_TOKENS o baja GEMINI_THINKING_BUDGET en "
        "services/vision_measure/providers.py, o elige un modelo sin razonamiento "
        "extendido.",
    )

    # Whether the page was actually read is not something to infer from the prose. Gemini
    # says so per URL, and the optician needs it: "A = 53.8, source not retrieved" is a
    # different claim from "A = 53.8, read off the supplier's page".
    retrieval = _url_retrieval(candidates[0])
    if browse_urls:
        summary = ", ".join(
            f"{item['url']} -> {item['status']}" for item in retrieval
        ) or "el modelo no abrió ninguna URL"
        print(f"[VISION] {spec.label}: url_context: {summary}")

    return text, usage, retrieval


def _url_retrieval(candidate: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Normalizes Gemini's url_context metadata to [{"url": ..., "status": ...}].

    Tolerant of both spellings the API has used (camelCase and snake_case) and of the
    field being absent entirely, which is what a model without the tool returns.
    """
    meta = candidate.get("urlContextMetadata") or candidate.get("url_context_metadata")
    if not isinstance(meta, dict):
        return []

    entries = meta.get("urlMetadata") or meta.get("url_metadata") or []
    out: List[Dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        url = entry.get("retrievedUrl") or entry.get("retrieved_url")
        status = entry.get("urlRetrievalStatus") or entry.get("url_retrieval_status")
        if url:
            out.append({"url": str(url), "status": str(status or "?")})
    return out


def _normalize_usage(usage: Any) -> Dict[str, Any]:
    """Flattens the three different token-count shapes into one."""
    if not isinstance(usage, dict):
        return {}
    return {
        # Both Gemini and Claude report what they spent thinking; it explains a truncated
        # answer at a glance, so it is worth carrying through to the report.
        "thinkingTokens": usage.get("thoughtsTokenCount")
        or usage.get("thinking_tokens")
        or usage.get("reasoning_tokens")
        or (usage.get("completion_tokens_details") or {}).get("reasoning_tokens")
        or (usage.get("output_tokens_details") or {}).get("reasoning_tokens"),
        "inputTokens": usage.get("prompt_tokens")
        or usage.get("input_tokens")
        or usage.get("promptTokenCount"),
        "outputTokens": usage.get("completion_tokens")
        or usage.get("output_tokens")
        or usage.get("candidatesTokenCount"),
        "totalTokens": usage.get("total_tokens")
        or usage.get("totalTokenCount")
        or (
            (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0)
            if usage.get("input_tokens") is not None
            else None
        ),
    }


# --------------------------------------------------------------- model listing


def list_models(spec: ProviderSpec, api_key: str) -> List[Dict[str, Any]]:
    """
    Asks the vendor which models this key can actually call.

    Hardcoded defaults go stale — Gemini retired `gemini-2.5-pro` for new keys and the
    only symptom was a 404 in the middle of a fitting. Every vendor here publishes a
    listing endpoint, so the panel can offer what exists today instead of what existed
    when this file was written.

    Returns [{"id", "label", "note"}] sorted by id. Never raises for an empty catalogue;
    it does raise ProviderError when the key or the host is the problem, because that is
    something the operator has to fix.
    """
    if spec.adapter == "gemini":
        url = f"{spec.base_url}/models"
        headers = {"x-goog-api-key": api_key}
        raw = _get_json(url, headers, spec.label).get("models") or []
        out = []
        for item in raw:
            methods = item.get("supportedGenerationMethods") or item.get("supportedActions") or []
            # Only what can answer a prompt; embedding models would just be noise here.
            if methods and "generateContent" not in methods:
                continue
            name = str(item.get("name", "")).replace("models/", "", 1)
            if not name:
                continue
            out.append(
                {
                    "id": name,
                    "label": item.get("displayName") or name,
                    "note": ", ".join(methods),
                }
            )
        return sorted(out, key=lambda m: m["id"])

    if spec.adapter == "anthropic":
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
        raw = _get_json(f"{spec.base_url}/models", headers, spec.label).get("data") or []
        return sorted(
            (
                {
                    "id": item.get("id", ""),
                    "label": item.get("display_name") or item.get("id", ""),
                    "note": item.get("created_at", "") or "",
                }
                for item in raw
                if item.get("id")
            ),
            key=lambda m: m["id"],
        )

    # Every OpenAI-compatible vendor: OpenAI, Qwen, Mistral, xAI, OpenRouter
    headers = {"Authorization": f"Bearer {api_key}", **spec.extra_headers}
    raw = _get_json(f"{spec.base_url}/models", headers, spec.label).get("data") or []
    return sorted(
        (
            {
                "id": item.get("id", ""),
                "label": item.get("name") or item.get("id", ""),
                "note": str(item.get("description", ""))[:120],
            }
            for item in raw
            if item.get("id")
        ),
        key=lambda m: m["id"],
    )


def _get_json(url: str, headers: Dict[str, str], label: str) -> Dict[str, Any]:
    try:
        resp = requests.get(url, headers=headers, timeout=30)
    except requests.RequestException as exc:
        raise ProviderError(f"{label}: no se pudo listar modelos ({exc}).") from exc

    if resp.status_code >= 400:
        raise ProviderError(
            f"{label} respondió {resp.status_code} al listar modelos: {resp.text[:400]}",
            status=resp.status_code,
            body=resp.text,
        )
    try:
        return resp.json()
    except ValueError as exc:
        raise ProviderError(f"{label}: listado de modelos ilegible.") from exc
