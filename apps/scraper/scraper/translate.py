"""
AI-assisted translation of product title/description into es/fr.

Mirrors the JSON-only-output pattern used by the backend's prescription OCR
route (apps/backend/src/api/store/prescriptions/ocr/route.ts): a strict system
prompt demanding bare JSON, parsed defensively. Never raises — a missing API
key, rate limit, or malformed response all fall back to `None`, so a sync run
must never fail because translation failed.
"""

import json

from scraper.config import Config

TRANSLATE_SYSTEM_PROMPT = """You are a product-catalog translation assistant for an \
eyewear store. Translate the given English eyeglasses product title and description \
into Spanish (es) and French (fr), keeping brand/model names untranslated.
Return ONLY valid JSON matching this schema — no prose, no markdown, no code fences:
{
  "es": { "title": string, "description": string },
  "fr": { "title": string, "description": string }
}"""


def translate_product(
    model_name: str, description_en: str, config: Config
) -> dict[str, dict[str, str]] | None:
    """Returns {"es": {...}, "fr": {...}} on success, None on any failure (never raises)."""
    if not config.anthropic_api_key:
        return None

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=config.anthropic_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-5",
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
        print(f"[scraper] Translation skipped for '{model_name}': {err}")
        return None
