"""The Coolify worker: claim → sync → 4 views of the new models → finish.

Medusa is replaced by a fake `_request`, the scrape by a fake `sync`; what is
under test is the worker's own decisions — what it reports, when it spends on
views and when it does not, and that a run is always closed.
"""

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from scraper import worker
from scraper.config import Config, ConfigError
from scraper.report import SyncReport


class FakeMedusa:
    def __init__(self, run: dict[str, Any] | None, cancel_after: int | None = None) -> None:
        self.run = run
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.cancel_after = cancel_after
        self.beats = 0

    def __call__(self, _config: Config, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        body = kwargs.get("json") or {}
        self.calls.append((path, body))
        if path.endswith("/claim"):
            return {"run": self.run}
        if path.endswith("/progress"):
            self.beats += 1
            cancel = self.cancel_after is not None and self.beats > self.cancel_after
            return {"cancel_requested": cancel}
        return {"run": {}}

    def finished(self) -> dict[str, Any]:
        bodies = [b for p, b in self.calls if p.endswith("/finish")]
        assert len(bodies) == 1, "a run must be closed exactly once"
        return bodies[0]


def _report(new: list[dict[str, Any]] | None = None, **fields: Any) -> SyncReport:
    report = SyncReport(collections=1, found=3, **fields)
    report.new_products = new or []
    report.new = len(report.new_products)
    return report


RUN = {
    "id": "csrun_1",
    "trigger": "manual",
    "options": {"full": False, "collection": None, "views_max_cost": 5},
}
NEW = [
    {"handle": "dc1-di-caprio", "title": "DC1", "collection": "di-caprio"},
    {"handle": "case-1-case", "title": "Case", "collection": "case"},
]


@pytest.fixture(autouse=True)
def fast_heartbeat() -> Any:
    with patch("scraper.worker.HEARTBEAT_SECONDS", 0):
        yield


def _run(fake: FakeMedusa, report: SyncReport, config: Config | None = None) -> str | None:
    async def fake_sync(*_a: Any, **kw: Any) -> SyncReport:
        kw["on_progress"]({"phase": "products", "position": 1, "total": 3})
        if kw["should_stop"]():
            report.canceled = True
        return report

    with (
        patch("scraper.worker._request", fake),
        patch("scraper.worker.sync", fake_sync),
        patch.object(Config, "validate", lambda self, dry_run=False: None),
    ):
        return worker.poll_once(config or Config(), "w1")


def test_idle_poll_does_nothing() -> None:
    fake = FakeMedusa(run=None)
    with patch("scraper.worker._request", fake):
        assert worker.poll_once(Config(), "w1") is None
    assert [p for p, _ in fake.calls] == ["/admin/catalog-sync/worker/claim"]


def test_a_run_is_reported_with_its_new_models() -> None:
    fake = FakeMedusa(run=RUN)
    with patch("scraper.worker.generate_views") as views:
        status = _run(fake, _report(NEW[:1]))

    assert status == "succeeded"
    body = fake.finished()
    assert body["status"] == "succeeded"
    assert body["summary"]["new"] == 1
    assert body["new_products"][0]["handle"] == "dc1-di-caprio"
    views.assert_called_once()
    assert views.call_args.args[2] == 5, "the run's own view budget"


def test_views_skip_cases_and_respect_a_zero_budget() -> None:
    report = _report(NEW)
    ctx = MagicMock()
    queued = {"inserted": 4, "already_present": 0}
    with patch("scraper.worker.media_api.enqueue", return_value=queued) as enqueue, \
         patch("scraper.worker.media_runner.run") as run:
        worker.generate_views(Config(), report, 0, ctx)

    assert enqueue.call_args.args[1] == ["dc1-di-caprio"], "a case is not a frame"
    run.assert_not_called()
    assert report.views_queued == 4
    assert report.views_note == "no_budget"


def test_views_without_gemini_are_only_queued() -> None:
    report = _report(NEW[:1])
    no_key = ConfigError("GEMINI_API_KEY is empty")
    with patch("scraper.worker.media_api.enqueue", return_value={"inserted": 4}), \
         patch.object(Config, "validate_media", side_effect=no_key), \
         patch("scraper.worker.media_runner.run") as run:
        worker.generate_views(Config(), report, 5, MagicMock())

    run.assert_not_called()
    assert report.views_note == "not_configured"


def test_views_are_generated_within_the_cap() -> None:
    report = _report(NEW[:1])
    stats = MagicMock(done=4, failed=0, cost_usd=0.16, stopped_because="empty", failures=[])
    with patch("scraper.worker.media_api.enqueue", return_value={"inserted": 4}), \
         patch.object(Config, "validate_media", lambda self: None), \
         patch("scraper.worker.media_runner.run", return_value=stats) as run, \
         patch("scraper.media.checkpoint.run_checkpoint") as checkpoint, \
         patch("scraper.media.selection._load_pilot", return_value={"frames": []}):
        worker.generate_views(Config(), report, 5, MagicMock())

    assert run.call_args.kwargs["max_cost"] == 5
    assert run.call_args.kwargs["handles"] == ["dc1-di-caprio"]
    assert (report.views_generated, report.views_cost_usd, report.views_note) == (4, 0.16, None)
    checkpoint.assert_called_once()


def test_cancel_from_the_panel_closes_the_run_as_canceled() -> None:
    fake = FakeMedusa(run=RUN, cancel_after=0)
    with patch("scraper.worker.generate_views") as views:
        status = _run(fake, _report(NEW[:1]))

    assert status == "canceled"
    assert fake.finished()["status"] == "canceled"
    views.assert_not_called()


def test_a_crash_still_closes_the_run() -> None:
    fake = FakeMedusa(run=RUN)

    async def broken_sync(*_a: Any, **_kw: Any) -> SyncReport:
        raise RuntimeError("supplier exploded")

    with patch("scraper.worker._request", fake), patch("scraper.worker.sync", broken_sync), \
         patch.object(Config, "validate", lambda self, dry_run=False: None):
        status = worker.poll_once(Config(), "w1")

    assert status == "failed"
    body = fake.finished()
    assert body["error_reason"] == "crashed"
    assert "supplier exploded" in body["log_tail"]


def test_bad_configuration_fails_the_run_with_a_reason() -> None:
    fake = FakeMedusa(run=RUN)

    def invalid(self: Config, dry_run: bool = False) -> None:
        raise ConfigError("MEDUSA_ADMIN_API_KEY is empty")

    with patch("scraper.worker._request", fake), patch.object(Config, "validate", invalid):
        status = worker.poll_once(Config(), "w1")

    assert status == "failed"
    assert fake.finished()["error_reason"] == "config_error"


def test_views_also_cover_models_whose_pictures_arrived_late() -> None:
    # Created bare by a run whose uploads all failed: no photo, so no views.
    # The run that finally stores their pictures must queue them like new ones.
    report = _report(NEW)
    report.images_recovered = [
        {"handle": "pt215-peachtree", "collection": "peachtree"},
        {"handle": "dc1-di-caprio", "collection": "di-caprio"},
        {"handle": "case-2-case", "collection": "case"},
    ]
    with patch("scraper.worker.media_api.enqueue", return_value={}) as enqueue:
        worker.generate_views(Config(), report, 0, MagicMock())

    assert enqueue.call_args.args[1] == ["dc1-di-caprio", "pt215-peachtree"]
