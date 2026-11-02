"""`python -m scraper worker` — the catalog scraper as a Coolify service.

The worker never decides WHEN to scrape. It polls Medusa once a minute
(`POST /admin/catalog-sync/worker/claim`) and runs whatever is queued there: the
owner's «Ejecutar ahora» button, or the monthly run the backend's
`catalog-sync-schedule` job queues. Everything the owner sees — the schedule,
the progress bar, «Detener», the summary of the last run — lives in Medusa;
this process only executes and reports.

One run is:

1. `sync()` — supplier → Medusa, as the CLI does, with a heartbeat per product
   and a check for «Detener» between products.
2. The 4 views of the models that run CREATED: queued in frame-media (free) and,
   when the run's `views_max_cost` is above 0 and Gemini + R2 are configured,
   generated up to that cap. The frame-media monthly ceiling still applies on
   the server, so a wrong cap here cannot overspend the month.
3. The summary, sent back to Medusa (`finish`).

Why poll instead of the backend calling us: the worker has no public port (the
same rule as vision-measure), so nothing has to be exposed, and a worker that is
down simply leaves the run queued — the panel says so.
"""

from __future__ import annotations

import asyncio
import os
import platform
import socket
import sys
import time
import traceback
from collections import deque
from collections.abc import Callable
from typing import Any, TextIO

from scraper.config import Config, ConfigError
from scraper.media import client as media_api
from scraper.media import runner as media_runner
from scraper.media.client import MediaApiError, _request
from scraper.report import SyncReport
from scraper.sync import sync

_PREFIX = "/admin/catalog-sync/worker"

#: Seconds between polls while idle. The panel calls a worker offline after
#: three missed polls (WORKER_ONLINE_MS in apps/backend/src/lib/catalog-sync.ts).
POLL_SECONDS = 60

#: Minimum seconds between heartbeats. Each product already takes 15–75 s, so in
#: practice this is one per product; it only throttles the fast "unchanged" path.
HEARTBEAT_SECONDS = 15

#: Log lines kept for the panel's «Ver registro».
LOG_LINES = 400

#: Never views for these collections — the prompts describe eyewear, and a case
#: fails `no_image_returned` (same default as FRAME_MEDIA_EXCLUDED_COLLECTIONS).
VIEW_EXCLUDED_COLLECTIONS = frozenset(
    s.strip()
    for s in os.getenv("CATALOG_VIEWS_EXCLUDED_COLLECTIONS", "case").split(",")
    if s.strip()
)


def default_worker_id() -> str:
    return (os.getenv("SCRAPER_WORKER_ID") or socket.gethostname() or "worker")[:80]


class LogTail:
    """A stream that writes through and remembers the last lines.

    Installed over stdout/stderr during a run, so the panel shows exactly what
    the Coolify log shows, without the worker having to log twice.
    """

    def __init__(self, stream: TextIO, lines: deque[str]) -> None:
        self._stream = stream
        self._lines = lines
        self._partial = ""

    def write(self, data: str) -> int:
        self._stream.write(data)
        self._partial += data
        *complete, self._partial = self._partial.split("\n")
        self._lines.extend(complete)
        return len(data)

    def flush(self) -> None:
        self._stream.flush()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)


class RunContext:
    """Heartbeat, cancellation and log capture for one claimed run."""

    def __init__(self, config: Config, run_id: str, worker_id: str) -> None:
        self.config = config
        self.run_id = run_id
        self.worker_id = worker_id
        self.lines: deque[str] = deque(maxlen=LOG_LINES)
        self.stop_requested = False
        self.gone = False
        self._last_beat = 0.0
        self._last_progress: dict[str, Any] | None = None

    def log_tail(self) -> str:
        return "\n".join(self.lines)

    def beat(self, progress: dict[str, Any] | None = None, *, force: bool = False) -> None:
        if progress is not None:
            self._last_progress = progress
        now = time.monotonic()
        if not force and now - self._last_beat < HEARTBEAT_SECONDS:
            return
        self._last_beat = now
        try:
            answer = _request(
                self.config,
                "POST",
                f"{_PREFIX}/runs/{self.run_id}/progress",
                json={
                    "worker_id": self.worker_id,
                    "progress": self._last_progress,
                    "log_tail": self.log_tail(),
                },
            )
            if answer.get("cancel_requested"):
                self.stop_requested = True
        except MediaApiError as err:
            if err.status == 409:
                # Declared lost, or canceled: this run is not ours any more.
                self.gone = True
                self.stop_requested = True
            else:
                # A missed heartbeat is not a reason to abandon a scrape; the
                # server only gives up after 20 minutes of silence.
                print(f"[worker] heartbeat failed: {err}", file=sys.__stderr__)

    def should_stop(self) -> bool:
        self.beat()
        return self.stop_requested


def claim(config: Config, worker_id: str) -> dict[str, Any] | None:
    answer = _request(
        config,
        "POST",
        f"{_PREFIX}/claim",
        json={
            "worker_id": worker_id,
            "info": {
                "python": platform.python_version(),
                "gemini": bool(config.gemini_api_key),
                "r2": config.r2_configured,
                "translation": bool(config.anthropic_api_key),
            },
        },
    )
    return answer.get("run")


def finish(
    ctx: RunContext,
    status: str,
    report: SyncReport | None,
    error_reason: str | None = None,
) -> None:
    body: dict[str, Any] = {
        "worker_id": ctx.worker_id,
        "status": status,
        "summary": report.summary() if report else {},
        "new_products": report.new_products if report else [],
        "errors": report.errors if report else [],
        "error_reason": error_reason,
        "log_tail": ctx.log_tail(),
    }
    try:
        _request(ctx.config, "POST", f"{_PREFIX}/runs/{ctx.run_id}/finish", json=body)
    except MediaApiError as err:
        print(f"[worker] could not close run {ctx.run_id}: {err}", file=sys.__stderr__)


def generate_views(config: Config, report: SyncReport, max_cost: float, ctx: RunContext) -> None:
    """Queue — and, within `max_cost`, generate — the 4 views of the new models."""
    handles = [
        p["handle"]
        for p in report.new_products
        if p.get("collection") not in VIEW_EXCLUDED_COLLECTIONS
    ]
    if not handles:
        return

    print(f"\n[worker] ── 4 views for {len(handles)} new model(s) ──", flush=True)
    ctx.beat({"phase": "views", "total": len(handles)}, force=True)
    try:
        queued = media_api.enqueue(config, handles, kind="view")
    except MediaApiError as err:
        report.views_note = "enqueue_failed"
        report.add_error(None, f"views enqueue: {err}")
        return
    report.views_queued = int(queued.get("inserted", 0)) + int(queued.get("already_present", 0))

    if max_cost <= 0:
        report.views_note = "no_budget"
        print("[worker]   views queued only (budget 0).", flush=True)
        return
    try:
        config.validate_media()
    except ConfigError as err:
        report.views_note = "not_configured"
        print(f"[worker]   views queued only — {err}", flush=True)
        return

    def echo(line: str) -> None:
        print(line, flush=True)
        ctx.beat()

    try:
        stats = media_runner.run(
            config,
            kind="view",
            handles=handles,
            slots=None,
            max_cost=max_cost,
            limit=None,
            batch=8,
            dry_run=False,
            echo=echo,
        )
    except MediaApiError as err:
        report.views_note = err.reason or "media_error"
        report.add_error(None, f"views: {err}")
        return

    report.views_generated = stats.done
    report.views_failed = stats.failed
    report.views_cost_usd = stats.cost_usd
    if stats.stopped_because and stats.stopped_because != "empty":
        report.views_note = stats.stopped_because
    for failure in stats.failures[:20]:
        note = f"view: {failure.get('reason')} {failure.get('note') or ''}"
        report.add_error(failure.get("asset"), note.strip())

    if stats.done:
        # Same two free steps `media stream` runs at each checkpoint: copy the keys
        # onto the variants, and republish the storefront's live manifest so the
        # new views show without a deploy.
        try:
            from scraper.media.checkpoint import run_checkpoint
            from scraper.media.selection import _load_pilot

            run_checkpoint(config, handles, _load_pilot()["frames"])
        except Exception as err:  # noqa: BLE001 — the files are in R2 either way
            report.add_error(None, f"views publish: {err}")


def execute(config: Config, run: dict[str, Any], worker_id: str) -> str:
    """Runs one claimed run to its end and reports it. Returns the final status."""
    ctx = RunContext(config, run["id"], worker_id)
    options = run.get("options") or {}
    out, err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = LogTail(out, ctx.lines), LogTail(err, ctx.lines)
    report: SyncReport | None = None
    try:
        print(f"[worker] run {run['id']} ({run.get('trigger')}) options={options}", flush=True)
        try:
            config.validate()
        except ConfigError as error:
            print(f"[worker] configuration error: {error}", flush=True)
            finish(ctx, "failed", None, "config_error")
            return "failed"

        collection = options.get("collection")
        report = asyncio.run(
            sync(
                config,
                collections=[collection] if collection else None,
                full=bool(options.get("full")),
                run_id=run["id"],
                on_progress=ctx.beat,
                should_stop=ctx.should_stop,
            )
        )
        if ctx.gone:
            return "gone"
        if not report.canceled and not report.aborted:
            generate_views(config, report, float(options.get("views_max_cost") or 0), ctx)

        report.print_summary()
        status = report.outcome
        finish(ctx, status, report, "aborted_failures" if report.aborted else None)
        return status
    except Exception:  # noqa: BLE001 — the run must be closed, whatever broke
        print(traceback.format_exc(), flush=True)
        if not ctx.gone:
            finish(ctx, "failed", report, "crashed")
        return "failed"
    finally:
        sys.stdout, sys.stderr = out, err


def poll_once(config: Config, worker_id: str) -> str | None:
    """One poll: claim and execute. Returns the run's status, or None when idle."""
    run = claim(config, worker_id)
    if not run:
        return None
    return execute(config, run, worker_id)


def loop(
    config: Config,
    worker_id: str,
    interval: float = POLL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    """Poll forever. A backend that is down is waited out, never a crash loop."""
    print(
        f"[worker] {worker_id} polling {config.medusa_backend_url} every {interval:.0f}s",
        flush=True,
    )
    while True:
        try:
            status = poll_once(config, worker_id)
            if status:
                print(f"[worker] run finished: {status}", flush=True)
                continue  # something else may be queued already
        except MediaApiError as err:
            print(f"[worker] backend unavailable: {err}", flush=True)
        sleep(interval)
