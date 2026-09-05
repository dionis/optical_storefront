"""Talking to Medusa's frame-media admin API.

Medusa owns the state and the money; this CLI only executes. Everything the run
needs to know — what is left to do, what it may spend, what has already been paid
for — comes from here, so the script and the admin panel can never disagree about
the same queue.

There is deliberately NO local state file. No `media.db` beside `state.db`: the
truth lives in Postgres, which is what lets a second terminal (or a second
server) run the same command without redoing work that has already been billed.
"""

from __future__ import annotations

from typing import Any

import httpx

from scraper.config import Config
from scraper.medusa_push import _admin_client

_ADMIN_PREFIX = "/admin/frame-media"


class MediaApiError(RuntimeError):
    """A frame-media route refused.

    `reason` is the machine code the route sends alongside its English `message`;
    callers branch on the code, never on the prose.
    """

    def __init__(self, message: str, *, status: int, reason: str | None, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.reason = reason
        self.payload = payload


def _request(config: Config, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    # Reuses the scraper's pooled admin client, and with it the authentication
    # detail that costs an afternoon to rediscover: Medusa v2 authenticates a
    # secret admin API key over HTTP Basic (token as the username, empty
    # password), NOT with a Bearer header.
    client = _admin_client(config)
    url = f"{config.medusa_backend_url.rstrip('/')}{path}"
    try:
        response = client.request(method, url, **kwargs)
    except httpx.HTTPError as err:
        raise MediaApiError(
            f"Cannot reach Medusa at {config.medusa_backend_url}: {err}",
            status=0,
            reason="unreachable",
        ) from err

    if response.status_code >= 400:
        body: Any = {}
        try:
            body = response.json()
        except ValueError:
            # Express answers a missing route with an HTML page, not JSON. Dumping
            # that page as the error message is how a plain 404 ends up looking
            # like a crash, so non-JSON bodies get a short summary instead.
            body = {"message": f"HTTP {response.status_code} (non-JSON response)"}
        raise MediaApiError(
            body.get("message") or f"HTTP {response.status_code}",
            status=response.status_code,
            reason=body.get("reason"),
            payload=body,
        )

    return response.json() if response.content else {}


def progress(config: Config, scope: str | None = None) -> dict[str, Any]:
    params = {"scope": scope} if scope else None
    return _request(config, "GET", f"{_ADMIN_PREFIX}/progress", params=params)


def enqueue(
    config: Config,
    handles: list[str],
    kind: str = "view",
    slots: list[str] | None = None,
    colorways: list[str] | None = None,
) -> dict[str, Any]:
    """Declare intent. Writes `pending` rows; spends nothing."""
    body: dict[str, Any] = {"handles": handles, "kind": kind}
    if slots:
        body["slots"] = slots
    if colorways:
        body["colorways"] = colorways
    return _request(config, "POST", f"{_ADMIN_PREFIX}/enqueue", json=body)


def claim(
    config: Config,
    run_id: str,
    limit: int,
    kind: str,
    slots: list[str] | None = None,
    handles: list[str] | None = None,
) -> dict[str, Any]:
    """Take the next batch, leased.

    A 409 here is the budget refusing, not an error in the request — the caller
    turns it into a clean stop rather than a traceback.
    """
    body: dict[str, Any] = {"run_id": run_id, "limit": limit, "kind": kind}
    if slots:
        body["slots"] = slots
    if handles:
        body["handles"] = handles
    return _request(config, "POST", f"{_ADMIN_PREFIX}/claim", json=body)


def report(config: Config, **fields: Any) -> dict[str, Any]:
    """Record one finished asset, with its receipt exactly as the provider gave it."""
    return _request(config, "POST", f"{_ADMIN_PREFIX}/report", json=fields)


def board(config: Config, **params: Any) -> dict[str, Any]:
    return _request(config, "GET", _ADMIN_PREFIX, params=params)


def retry(
    config: Config,
    handles: list[str] | None = None,
    kind: str | None = None,
    slots: list[str] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Reset failed assets to `pending` with `attempts` back to zero.

    A dedicated route rather than a loop of `report` calls: reporting a failure
    INCREMENTS attempts, so a retry built that way would push assets past the
    ceiling instead of clearing it.
    """
    body: dict[str, Any] = {"force": force}
    if handles:
        body["handles"] = handles
    if kind:
        body["kind"] = kind
    if slots:
        body["slots"] = slots
    return _request(config, "POST", f"{_ADMIN_PREFIX}/retry", json=body)
