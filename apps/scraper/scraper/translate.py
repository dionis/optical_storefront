"""
AI-assisted translation of product title/description into es/fr.

Mirrors the JSON-only-output pattern used by the backend's prescription OCR
route (apps/backend/src/api/store/prescriptions/ocr/route.ts): a strict system
prompt demanding bare JSON, parsed defensively. Never raises — a missing API
key, rate limit, or malformed response all fall back to `None`, so a sync run
must never fail because translation failed.
"""

import json
import re
from collections.abc import Callable
from typing import Any

from scraper.config import Config

#: The model the translation runs on. Reported with every call so the backend's
#: «Consumo IA» tab can price it (apps/backend/src/lib/ai-usage.ts).
TRANSLATE_MODEL = "claude-sonnet-4-5"

#: Anthropic's "out of money" errors ("Your credit balance is too low…").
_NO_CREDIT = re.compile(r"credit balance|billing|insufficient", re.IGNORECASE)

UsageSink = Callable[[dict[str, Any]], None]


def _report(on_usage: UsageSink | None, event: dict[str, Any]) -> None:
    """Hand one usage event to the caller. Never raises: tracking must not stop a sync."""
    if on_usage is None:
        return
    try:
        on_usage({"provider": "anthropic", "model": TRANSLATE_MODEL, "activity": "translation", **event})
    except Exception:  # noqa: BLE001 — best-effort by design
        pass

TRANSLATE_SYSTEM_PROMPT = """You are a product-catalog translation assistant for an \
eyewear store. Translate the given English eyeglasses product title and description \
into Spanish (es) and French (fr), keeping brand/model names untranslated.
Return ONLY valid JSON matching this schema — no prose, no markdown, no code fences:
{
  "es": { "title": string, "description": string },
  "fr": { "title": string, "description": string }
}"""


def translate_product(
    model_name: str,
    description_en: str,
    config: Config,
    on_usage: UsageSink | None = None,
) -> dict[str, dict[str, str]] | None:
    """Returns {"es": {...}, "fr": {...}} on success, None on any failure (never raises).

    `on_usage` receives the call's token counts (billed even when the answer is
    unusable), or a `status: "no_credit"` event when Anthropic refuses the call
    for lack of balance.
    """
    if not config.anthropic_api_key:
        return None

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=config.anthropic_api_key)
        message = client.messages.create(
            model=TRANSLATE_MODEL,
            max_tokens=1024,
            system=TRANSLATE_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Title: {model_name}\n"
                        f"Description: {description_en or '(none provided)'}"
                    ),
                }
            ],
        )
        usage = getattr(message, "usage", None)
        if usage is not None:
            _report(
                on_usage,
                {
                    "input_tokens": getattr(usage, "input_tokens", None),
                    "output_tokens": getattr(usage, "output_tokens", None),
                },
            )
        block = message.content[0]
        raw_json = block.text if block.type == "text" else ""
        parsed = json.loads(raw_json.strip())

        result: dict[str, dict[str, str]] = {}
        for locale in ("es", "fr"):
            entry = parsed.get(locale)
            if isinstance(entry, dict) and entry.get("title"):
                result[locale] = {
                    "title": str(entry["title"]),
                    "description": str(entry.get("description", "")),
                }
        return result or None
    except Exception as err:
        if _NO_CREDIT.search(str(err)):
            _report(on_usage, {"status": "no_credit"})
        print(f"[scraper] Translation skipped for '{model_name}': {err}")
        return None
