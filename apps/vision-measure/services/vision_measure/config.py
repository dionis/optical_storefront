"""
Provider registry and credential resolution for the multimodal measurement endpoint.

Two ways to supply a key, both supported at the same time and in this order:

    1. the request (typed into the VTO panel by the operator)
    2. the process environment, seeded from a .env file at the repository root

The .env half is the one the rest of the project promised but never implemented, so
`load_env_files()` lives here and is safe to call from anywhere.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Repository root: services/vision_measure/config.py -> vision_measure -> services -> root
REPO_ROOT = Path(__file__).resolve().parents[2]

_ENV_LOADED = False


def load_env_files(explicit_path: Optional[str] = None) -> List[str]:
    """
    Loads .env / .env.local from the repository root into os.environ.

    Existing environment variables always win: an exported shell variable must not be
    overwritten by a stale file. Uses python-dotenv when present and falls back to a
    minimal parser so a missing optional dependency never breaks the endpoint.
    """
    global _ENV_LOADED
    if _ENV_LOADED and explicit_path is None:
        return []

    candidates = (
        [Path(explicit_path)]
        if explicit_path
        else [REPO_ROOT / ".env", REPO_ROOT / ".env.local"]
    )
    loaded: List[str] = []

    for path in candidates:
        if not path.is_file():
            continue
        try:
            from dotenv import load_dotenv  # type: ignore

            load_dotenv(dotenv_path=str(path), override=False)
        except Exception:
            _load_env_fallback(path)
        loaded.append(str(path))

    _ENV_LOADED = True
    if loaded:
        print(f"[VISION] Variables de entorno cargadas desde: {', '.join(loaded)}")
    return loaded


def _load_env_fallback(path: Path) -> None:
    """Minimal KEY=VALUE reader used when python-dotenv is not installed."""
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key.startswith("export "):
                key = key[len("export "):].strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception as exc:  # defensive: a malformed .env must not kill the service
        print(f"[VISION] No se pudo leer {path}: {exc}")


@dataclass(frozen=True)
class ProviderSpec:
    """One multimodal vendor: how to reach it and what to call by default."""

    id: str
    label: str
    # Wire protocol. Three shapes cover every vendor listed here.
    adapter: str  # "openai" | "anthropic" | "gemini"
    base_url: str
    default_model: str
    suggested_models: Tuple[str, ...]
    # Checked in order; the first non-empty one is used.
    env_keys: Tuple[str, ...]
    docs_url: str
    supports_json_mode: bool = True
    extra_headers: Dict[str, str] = field(default_factory=dict)


# Order matters: it is the order the panel lists them in.
PROVIDERS: Tuple[ProviderSpec, ...] = (
    ProviderSpec(
        id="openai",
        label="OpenAI",
        adapter="openai",
        base_url="https://api.openai.com/v1",
        # gpt-5 was two generations behind the model ChatGPT runs, which is most of why
        # the same photographs measured worse here than in a browser tab. Terra is the
        # balanced tier; Sol is the one to type in the panel when a fitting is difficult.
        default_model="gpt-5.6-terra",
        suggested_models=(
            "gpt-5.6-terra",
            "gpt-5.6-sol",
            "gpt-5.6-luna",
            "gpt-5.1",
            "gpt-4.1",
        ),
        env_keys=("OPENAI_API_KEY",),
        docs_url="https://platform.openai.com/api-keys",
    ),
    ProviderSpec(
        id="anthropic",
        label="Anthropic (Claude)",
        adapter="anthropic",
        base_url="https://api.anthropic.com/v1",
        default_model="claude-opus-5",
        suggested_models=(
            "claude-opus-5",
            "claude-sonnet-5",
            "claude-haiku-4-5-20251001",
        ),
        env_keys=("ANTHROPIC_API_KEY", "CLAUDE_API_KEY"),
        docs_url="https://console.anthropic.com/settings/keys",
    ),
    ProviderSpec(
        id="gemini",
        label="Google Gemini",
        adapter="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        # gemini-2.5-pro was retired for new API keys ("no longer available to new
        # users"); Google's own 404 points at the 3.1 preview. Vendor catalogues move
        # faster than this file, so treat these as a starting point and use the live
        # listing (POST /api/vision-measure/models) as the authority.
        default_model="gemini-3.1-pro-preview",
        suggested_models=(
            "gemini-3.1-pro-preview",
            "gemini-3-flash-preview",
            "gemini-2.5-flash",
        ),
        env_keys=("GEMINI_API_KEY", "GOOGLE_API_KEY"),
        docs_url="https://aistudio.google.com/app/apikey",
    ),
    ProviderSpec(
        id="qwen",
        label="Qwen (Alibaba DashScope)",
        adapter="openai",
        base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        default_model="qwen-vl-max",
        suggested_models=("qwen-vl-max", "qwen-vl-plus", "qwen2.5-vl-72b-instruct"),
        env_keys=("QWEN_API_KEY", "DASHSCOPE_API_KEY"),
        docs_url="https://bailian.console.alibabacloud.com/",
    ),
    ProviderSpec(
        id="mistral",
        label="Mistral (Pixtral)",
        adapter="openai",
        base_url="https://api.mistral.ai/v1",
        default_model="pixtral-large-latest",
        suggested_models=(
            "pixtral-large-latest",
            "mistral-medium-latest",
            "pixtral-12b-2409",
        ),
        env_keys=("MISTRAL_API_KEY",),
        docs_url="https://console.mistral.ai/api-keys/",
    ),
    ProviderSpec(
        id="xai",
        label="xAI (Grok Vision)",
        adapter="openai",
        base_url="https://api.x.ai/v1",
        default_model="grok-4",
        suggested_models=("grok-4", "grok-2-vision-1212"),
        env_keys=("XAI_API_KEY", "GROK_API_KEY"),
        docs_url="https://console.x.ai/",
    ),
    ProviderSpec(
        id="openrouter",
        label="OpenRouter (pasarela multi-modelo)",
        adapter="openai",
        base_url="https://openrouter.ai/api/v1",
        default_model="google/gemini-3.1-pro-preview",
        suggested_models=(
            "google/gemini-3.1-pro-preview",
            "openai/gpt-5.6-terra",
            "anthropic/claude-opus-5",
            "qwen/qwen2.5-vl-72b-instruct",
            "meta-llama/llama-4-maverick",
        ),
        env_keys=("OPENROUTER_API_KEY",),
        docs_url="https://openrouter.ai/keys",
        extra_headers={"X-Title": "RUBILENS VTO"},
    ),
)

PROVIDERS_BY_ID: Dict[str, ProviderSpec] = {p.id: p for p in PROVIDERS}


def get_provider(provider_id: str) -> ProviderSpec:
    spec = PROVIDERS_BY_ID.get((provider_id or "").strip().lower())
    if spec is None:
        valid = ", ".join(PROVIDERS_BY_ID)
        raise ValueError(
            f"Proveedor multimodal no soportado: '{provider_id}'. Disponibles: {valid}"
        )
    return spec


def env_key_for(spec: ProviderSpec) -> Optional[str]:
    """Returns the first non-empty configured key for this provider, or None."""
    load_env_files()
    for name in spec.env_keys:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return None


class MissingApiKeyError(ValueError):
    """
    Neither the panel nor the environment has a key for this provider.

    A distinct type, and not just a message, because the operator reads this one in their
    own language: the frontend translates it from `code`, and the text below is only the
    fallback for a caller that speaks no i18n — curl, a log line, a script.
    """

    code = "missing-api-key"

    def __init__(self, spec: "ProviderSpec"):
        self.provider = spec.id
        self.provider_label = spec.label
        self.env_keys = list(spec.env_keys)
        self.docs_url = spec.docs_url
        super().__init__(
            f"Debe definir las llaves de uso de este modelo de IA o contactar con el "
            f"Administrador. Falta la clave de {spec.label}: introdúcela en el panel, o "
            f"define {' / '.join(spec.env_keys)} en el fichero .env de la raíz del "
            f"repositorio (y reinicia el servicio). Consíguela en {spec.docs_url}"
        )


def resolve_api_key(spec: ProviderSpec, override: Optional[str]) -> str:
    """
    UI field first, .env second.

    The order matters and is deliberate: a key typed for one fitting must be able to
    override a stale one on the server without anybody editing a file.
    """
    typed = (override or "").strip()
    if typed:
        return typed

    from_env = env_key_for(spec)
    if from_env:
        return from_env

    raise MissingApiKeyError(spec)


def describe_providers() -> List[Dict[str, object]]:
    """Catalogue for the frontend. Never leaks a key — only whether one is configured."""
    load_env_files()
    return [
        {
            "id": spec.id,
            "label": spec.label,
            "adapter": spec.adapter,
            "defaultModel": spec.default_model,
            "suggestedModels": list(spec.suggested_models),
            "envKeys": list(spec.env_keys),
            "hasServerKey": env_key_for(spec) is not None,
            "docsUrl": spec.docs_url,
        }
        for spec in PROVIDERS
    ]
