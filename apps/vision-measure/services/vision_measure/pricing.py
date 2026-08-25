"""
Token cost estimation for a measurement run.

Every figure here is a PUBLISHED LIST PRICE COPIED BY HAND, in US dollars per million
tokens. Vendors change them, and nothing in this repository can notice when they do — so
the table carries the date it was last checked, the endpoint reports that date, and the
panel labels every figure as an estimate. A model absent from the table produces "sin
tarifa" rather than a number: an invented price on an invoice-shaped screen is worse than
no price at all.

To correct a rate, edit the table. To add a model, add an entry. Prefixes are matched
longest-first, so "gpt-5-mini" wins over "gpt-5".
"""

from typing import Any, Dict, List, Optional, Tuple

# Update this whenever the numbers below are checked against the vendors' pricing pages.
RATES_CHECKED_ON = "2026-08-21"

RATE_SOURCES: Dict[str, str] = {
    "openai": "https://openai.com/api/pricing/",
    "anthropic": "https://www.anthropic.com/pricing#api",
    "gemini": "https://ai.google.dev/pricing",
    "qwen": "https://www.alibabacloud.com/help/en/model-studio/models",
    "mistral": "https://mistral.ai/pricing",
    "xai": "https://x.ai/api",
    "openrouter": "https://openrouter.ai/models",
}

# provider -> ((model prefix, USD per 1M input, USD per 1M output), ...)
# Kept as prefixes because vendors append dated suffixes (…-20251001) to the same model.
RATES: Dict[str, Tuple[Tuple[str, float, float], ...]] = {
    "openai": (
        # Short-context tier. The long-context tier costs roughly double, and this
        # endpoint sends two photographs and one schema — nowhere near the threshold.
        ("gpt-5.6-sol", 4.00, 20.00),
        ("gpt-5.6-terra", 2.00, 12.00),
        ("gpt-5.6-luna", 0.20, 1.20),
        ("gpt-5-mini", 0.25, 2.00),
        ("gpt-5", 1.25, 10.00),
        ("gpt-4.1-mini", 0.40, 1.60),
        ("gpt-4.1", 2.00, 8.00),
        ("gpt-4o-mini", 0.15, 0.60),
        ("gpt-4o", 2.50, 10.00),
    ),
    "anthropic": (
        ("claude-opus", 15.00, 75.00),
        ("claude-sonnet", 3.00, 15.00),
        ("claude-haiku", 1.00, 5.00),
    ),
    "gemini": (
        ("gemini-3.1-pro", 2.00, 12.00),
        ("gemini-3-flash", 0.30, 2.50),
        ("gemini-2.5-pro", 1.25, 10.00),
        ("gemini-2.5-flash", 0.30, 2.50),
        ("gemini-2.0-flash", 0.10, 0.40),
    ),
    "qwen": (
        ("qwen-vl-max", 0.80, 3.20),
        ("qwen-vl-plus", 0.21, 0.63),
        ("qwen2.5-vl", 0.70, 2.80),
    ),
    "mistral": (
        ("pixtral-large", 2.00, 6.00),
        ("mistral-medium", 0.40, 2.00),
        ("pixtral-12b", 0.15, 0.15),
    ),
    "xai": (
        ("grok-4", 3.00, 15.00),
        ("grok-2-vision", 2.00, 10.00),
    ),
    # A gateway: the rate depends on the model it routes to, and OpenRouter itself
    # reports the real cost per request. Left empty on purpose.
    "openrouter": (),
}


def find_rate(provider: str, model: str) -> Optional[Tuple[float, float]]:
    """USD per million (input, output) for this model, or None if not in the table."""
    candidates = RATES.get((provider or "").strip().lower(), ())
    name = (model or "").strip().lower()
    best: Optional[Tuple[str, float, float]] = None
    for entry in candidates:
        if name.startswith(entry[0]) and (best is None or len(entry[0]) > len(best[0])):
            best = entry
    return (best[1], best[2]) if best else None


def estimate_cost(
    provider: str, model: str, usage: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Cost breakdown for one call.

    Thinking tokens are NOT added on top: every vendor here already counts them inside
    the output total, so charging them again would double-bill the most expensive half.
    They are reported separately because they are usually the reason a bill is large.
    """
    usage = usage or {}
    rate = find_rate(provider, model)

    def as_int(value: Any) -> Optional[int]:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    input_tokens = as_int(usage.get("inputTokens"))
    output_tokens = as_int(usage.get("outputTokens"))
    thinking_tokens = as_int(usage.get("thinkingTokens"))
    total_tokens = as_int(usage.get("totalTokens"))

    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens

    breakdown: Dict[str, Any] = {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "thinkingTokens": thinking_tokens,
        "totalTokens": total_tokens,
        "currency": "USD",
        "ratesCheckedOn": RATES_CHECKED_ON,
        "rateSource": RATE_SOURCES.get((provider or "").lower()),
        "inputRatePerMTok": rate[0] if rate else None,
        "outputRatePerMTok": rate[1] if rate else None,
        "inputCost": None,
        "outputCost": None,
        "totalCost": None,
        "note": None,
    }

    if rate is None:
        breakdown["note"] = (
            "Sin tarifa registrada para este modelo: el coste no se estima. "
            "Añádela en services/vision_measure/pricing.py."
        )
        return breakdown

    if input_tokens is None and output_tokens is None:
        breakdown["note"] = "El proveedor no informó del consumo de tokens."
        return breakdown

    input_cost = (input_tokens or 0) / 1_000_000 * rate[0]
    output_cost = (output_tokens or 0) / 1_000_000 * rate[1]

    breakdown["inputCost"] = round(input_cost, 6)
    breakdown["outputCost"] = round(output_cost, 6)
    breakdown["totalCost"] = round(input_cost + output_cost, 6)

    if input_tokens is None or output_tokens is None:
        breakdown["note"] = (
            "Consumo parcial: el proveedor no separó entrada y salida, "
            "así que el coste es un mínimo, no el total."
        )
    return breakdown


def describe_rates() -> Dict[str, Any]:
    """The whole table, for the panel to show and for the operator to sanity-check."""
    return {
        "currency": "USD",
        "checkedOn": RATES_CHECKED_ON,
        "unit": "USD por millón de tokens",
        "disclaimer": (
            "Tarifas de lista copiadas a mano y no verificadas automáticamente. "
            "Sirven para estimar, no para facturar."
        ),
        "providers": {
            provider: {
                "source": RATE_SOURCES.get(provider),
                "models": [
                    {"prefix": prefix, "inputPerMTok": inp, "outputPerMTok": out}
                    for prefix, inp, out in entries
                ],
            }
            for provider, entries in RATES.items()
        },
    }


def summarize(costs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Adds up several calls, keeping track of what could not be priced."""
    total = 0.0
    priced = 0
    unpriced = 0
    tokens = 0

    for cost in costs:
        if cost.get("totalCost") is not None:
            total += float(cost["totalCost"])
            priced += 1
        else:
            unpriced += 1
        tokens += int(cost.get("totalTokens") or 0)

    return {
        "currency": "USD",
        "totalCost": round(total, 6),
        "totalTokens": tokens,
        "pricedCalls": priced,
        "unpricedCalls": unpriced,
    }
