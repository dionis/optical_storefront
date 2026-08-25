"""
Identifies which build of this service is actually running.

Written after three rounds of debugging a failure that had already been fixed: the
Python service does not hot-reload, the operator refreshed the browser instead of
restarting it, and nothing on screen or in the log distinguished "the fix is not working"
from "the fix is not running". A fingerprint of the source plus a list of behaviours
settles that in one glance.

FEATURES is a plain list of behaviour names. The frontend knows which ones it expects and
says so loudly when the service predates them — a stale backend then announces itself
instead of being mistaken for a bug.
"""

import hashlib
from pathlib import Path
from typing import Dict, List

_HERE = Path(__file__).resolve().parent
_API_DIR = _HERE.parent / "api"

# Behaviours the running code has. Add a name here when adding one the panel can rely on;
# never rename an existing one, or an older frontend stops recognising it.
FEATURES: List[str] = [
    "env-file",  # .env loaded from the repository root
    "try-on-render",  # the composed picture of the patient wearing the frame
    "model-listing",  # POST /api/vision-measure/models
    "reasoning-budget",  # a wider allowance once a vendor asks for max_completion_tokens
    "vendor-error-detail",  # the vendor's own message in the 400 log lines
    "failure-logging",  # a failed run leaves a line in the service log
    "truncation-detail",  # a cut-off answer is reported as such, not as bad JSON
    "cost-estimate",  # per-call and per-request token cost in the response
    "transient-retry",  # 429/5xx retried with backoff instead of failing the run
    "request-isolation",  # per-request id on every envelope and log line
    "directed-param-fix",  # the 400 ladder fixes the parameter the vendor named
    "profile-view",  # optional AI-generated side view of the patient wearing it
    "generated-image-recompress",  # AI images re-encoded to JPEG before leaving
    "param-memo",  # per-model memory of rejected parameters, names only
    "error-codes",  # machine-readable codes so the UI can localise the message
    "extra-instructions",  # optician notes appended to the system prompt
    "parallel-calls",  # A/B proposals and both renders run concurrently
    "capri-protocol",  # frame identifier drives the Capri fitting protocol
    "input-validation",  # the two photographs are judged before being measured
    "url-context",  # Gemini opens the supplier product page during the measurement
    "retrieval-provenance",  # the report says whether that page was actually read
    "openai-web-search",  # OpenAI reaches the supplier page via the Responses API
    "browsing-timeout",  # a run that opens pages gets its own, longer budget
    "shared-image-prep",  # A/B decode and re-encode the photographs once, not twice
    "search-without-json-mode",  # OpenAI web search cannot coexist with JSON mode
    "shared-render-prep",  # front and profile share one prepared pair
    "image-retry",  # the render rides out a capacity dip instead of dying on it
    "congestion-diagnosis",  # 503 capacity and 429 quota are told apart, out loud
    "browse-urls-in-user-turn",  # the tool reads the request, not the instructions
    "capri-page-layout",  # the prompt describes how the supplier page is laid out
]


def source_fingerprint() -> str:
    """
    Short hash of every source file that decides this service's behaviour.

    Deliberately computed at runtime rather than stamped at build time: there is no build
    step here, and a stamp someone forgets to bump is worse than none.
    """
    digest = hashlib.sha256()
    files = sorted(
        [*_HERE.glob("*.py"), *_API_DIR.glob("*.py")],
        key=lambda p: p.name,
    )
    for path in files:
        try:
            digest.update(path.name.encode("utf-8"))
            digest.update(path.read_bytes())
        except OSError:
            continue
    return digest.hexdigest()[:12]


def describe_build() -> Dict[str, object]:
    return {
        "fingerprint": source_fingerprint(),
        "features": list(FEATURES),
    }


def banner() -> str:
    """One line for the startup log, so the terminal says what it is serving."""
    return (
        f"[VISION] Build {source_fingerprint()} · "
        f"{len(FEATURES)} funciones: {', '.join(FEATURES)}"
    )
