"""`media stream` building blocks: stop at the first error, checkpoint hook, manifest.

No network: the Medusa client and the generator are replaced, so what is under
test is only the loop's decisions.
"""

from __future__ import annotations

import json

import pytest

from scraper.media import fixture, runner


def _asset(i: int, slot: str = "front") -> dict:
    return {
        "id": f"a{i}",
        "kind": "view",
        "product_handle": f"frame-{i}",
        "colorway": "Black",
        "slot": slot,
        "source_image_url": "products/x.webp",
    }


@pytest.fixture
def fake_backend(monkeypatch):
    """A queue of assets served in batches, and a log of what was reported."""
    state = {"queue": [], "reports": []}

    def claim(_config, _run_id, want, _kind, slots=None, handles=None):
        batch, state["queue"] = state["queue"][:want], state["queue"][want:]
        return {"assets": batch, "image_model_id": "m"}

    def report(_config, **fields):
        state["reports"].append(fields)
        return {}

    monkeypatch.setattr(runner.api, "claim", claim)
    monkeypatch.setattr(runner.api, "report", report)
    return state


def _drain(**kwargs):
    stats = runner.RunStats(run_id="t")
    runner._drain(
        None, stats, kind="view", handles=None, slots=None, max_cost=100.0,
        limit=None, batch=3, echo=lambda _msg: None, **kwargs,
    )
    return stats


def test_stop_on_error_ends_the_run_at_the_first_failure(fake_backend, monkeypatch):
    fake_backend["queue"] = [_asset(i) for i in range(6)]

    def generate(_config, asset, _model, _workdir):
        if asset["id"] == "a2":
            raise RuntimeError("HTTP 429 quota")
        return {"status": "done", "output_key": "k", "cost_usd": 0.04}

    monkeypatch.setattr(runner, "_generate_view", generate)
    stats = _drain(stop_on_error=True)

    assert stats.stopped_because == "error"
    assert (stats.done, stats.failed) == (2, 1)
    assert stats.failures[-1]["reason"] == "rate_limited"
    # The failure is recorded on the server before stopping, and nothing after it ran.
    assert fake_backend["reports"][-1]["status"] == "failed"
    assert [r["id"] for r in fake_backend["reports"]] == ["a0", "a1", "a2"]


def test_per_image_failures_are_skipped_but_run_failures_still_stop(fake_backend, monkeypatch):
    fake_backend["queue"] = [_asset(i) for i in range(6)]

    def generate(_config, asset, _model, _workdir):
        if asset["id"] == "a1":
            raise RuntimeError("la respuesta no traia ninguna imagen")  # a case, not a frame
        if asset["id"] == "a4":
            raise RuntimeError("HTTP 403 API_KEY_INVALID")
        return {"status": "done", "output_key": "k", "cost_usd": 0.04}

    monkeypatch.setattr(runner, "_generate_view", generate)
    stats = _drain(stop_on_error=True, tolerate=frozenset({"no_image_returned"}))

    assert stats.stopped_because == "error"
    assert [f["reason"] for f in stats.failures] == ["no_image_returned", "auth_failed"]
    assert stats.done == 3


def test_without_stop_on_error_a_single_failure_is_tolerated(fake_backend, monkeypatch):
    fake_backend["queue"] = [_asset(i) for i in range(4)]

    def generate(_config, asset, _model, _workdir):
        if asset["id"] == "a1":
            raise RuntimeError("boom")
        return {"status": "done", "output_key": "k", "cost_usd": 0.04}

    monkeypatch.setattr(runner, "_generate_view", generate)
    stats = _drain()

    assert stats.stopped_because == "empty"
    assert (stats.done, stats.failed) == (3, 1)


def test_on_done_sees_every_success_and_its_exception_ends_the_run(fake_backend, monkeypatch):
    fake_backend["queue"] = [_asset(i) for i in range(5)]
    monkeypatch.setattr(
        runner, "_generate_view",
        lambda *_a: {"status": "done", "output_key": "k", "cost_usd": 0.01},
    )
    seen: list[str] = []

    def on_done(asset):
        seen.append(asset["id"])
        if len(seen) == 3:
            raise ConnectionError("checkpoint failed")

    with pytest.raises(ConnectionError):
        _drain(on_done=on_done)
    assert seen == ["a0", "a1", "a2"]


def test_manifest_matches_the_fixture_data_and_orders_slots():
    assets = [
        {"kind": "view", "product_handle": "dc407-di-caprio", "colorway": "Black",
         "slot": slot, "output_key": f"k-{slot}"}
        for slot in ("back", "right", "front", "left")
    ] + [
        {"kind": "video", "product_handle": "dc407-di-caprio", "colorway": "Black",
         "output_key": "k-video"},
        {"kind": "view", "product_handle": "x", "colorway": "Red", "slot": "front",
         "output_key": None},  # no file behind it: never published
    ]
    data = fixture.collect(assets, pilot_frames=[])
    manifest = json.loads(fixture.manifest_json(data, "2026-09-27T00:00:00+00:00"))

    slots = manifest["views"]["dc407-di-caprio"]["Black"]
    assert list(slots) == ["front", "left", "right", "back"]
    assert manifest["videos"] == {"dc407-di-caprio": {"Black": "k-video"}}
    assert manifest["totals"] == {"frames": 1, "colorways": 1, "views": 4, "videos": 1}
    assert "x" not in manifest["views"]
    # The SKU comes from the catalogue, so the storefront's SKU join resolves it.
    assert manifest["index"][0]["sku"] == "DC407"
