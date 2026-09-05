"""Generate one asset, store it the way this store stores images, report it.

The loop is deliberately small: claim a batch, do the work, report each result,
repeat until Medusa says there is nothing left or the budget refuses. All the
judgement — what is left, what may be spent — lives on the server; this module
only executes and reports honestly.

STORING IT "THE WAY IMAGES ARE STORED TODAY" IS NOT A PROMISE, IT IS AN IMPORT.
`_optimize_image` and `_get_s3_client` come straight from `scraper.images`, so a
generated view goes through the same WebP/1600px/quality-85 pipeline, the same
boto3 client with path-style addressing and standard retries, and the same
immutable cache headers as every supplier photo. Reimplementing any of that here
is how the two drift apart.
"""

from __future__ import annotations

import hashlib
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx

from scraper.config import Config
from scraper.images import _get_s3_client, _optimize_image
from scraper.media import client as api
from scraper.media.gemini_media import generate_video, generate_views

#: Bumped by hand when VIEW_PROMPTS or IDENTITY_GUARD changes upstream. It is part
#: of the fingerprint, so raising it marks every existing asset stale — a
#: catalogue-wide sweep. Must always be deliberate. Keep in step with
#: PROMPT_VERSION in apps/backend/src/lib/frame-media.ts.
PROMPT_VERSION = 1

#: Consecutive failures that stop the run. Same value, and the same reasoning, as
#: `_MAX_CONSECUTIVE_FAILURES` in sync.py: a run of failures this long is an
#: outage, not a blip, and grinding on only spends money against a broken API.
MAX_CONSECUTIVE_FAILURES = 10


@dataclass
class RunStats:
    run_id: str
    done: int = 0
    failed: int = 0
    skipped: int = 0
    cost_usd: float = 0.0
    stopped_because: str | None = None
    failures: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "done": self.done,
            "failed": self.failed,
            "skipped": self.skipped,
            "cost_usd": round(self.cost_usd, 6),
            "stopped_because": self.stopped_because,
            "failures": self.failures,
        }


def new_run_id() -> str:
    return uuid.uuid4().hex[:16]


def _fetch_source(url: str, config: Config) -> bytes:
    with httpx.Client(timeout=60, follow_redirects=True) as http:
        response = http.get(url, headers={"User-Agent": config.user_agent})
        response.raise_for_status()
        return response.content


def _fingerprint(source: bytes, model_id: str) -> str:
    """Ties the result to the exact input that was paid for.

    Mirrors `fingerprint()` in apps/backend/src/lib/frame-media.ts — the two must
    agree or the backend will think every asset this CLI produces is stale.
    """
    digest = hashlib.sha256(source).hexdigest()
    return hashlib.sha256(
        f"{digest}|{model_id}|pv{PROMPT_VERSION}".encode("utf-8")
    ).hexdigest()


def _color_slug(colorway: str | None) -> str:
    """Same rule images.py uses for try-on assets: lower-case, spaces to underscores."""
    return (colorway or "default").strip().lower().replace(" ", "_")


def _output_key(asset: dict[str, Any]) -> str:
    handle = asset["product_handle"]
    colour = _color_slug(asset.get("colorway"))
    kind = asset["kind"]
    if kind == "view":
        return f"products/{handle}/views/{handle}_{colour}_{asset['slot']}.webp"
    if kind == "video":
        return f"products/{handle}/video/{handle}_{colour}.mp4"
    return f"models/{handle}/{handle}_{colour}.glb"


def _upload(config: Config, key: str, body: bytes, content_type: str) -> None:
    s3 = _get_s3_client(config)
    s3.put_object(
        Bucket=config.r2_bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
        # Same headers as every other product image: the key is content-addressed
        # by name, so a regeneration writes a new object rather than mutating one.
        CacheControl="public, max-age=31536000, immutable",
    )


def _classify(error: Exception | str) -> str:
    """Map a provider failure to a machine code the panel can translate.

    Codes, never prose: this module cannot know the operator's language, and the
    backend stores the code so `adm.media.err.<reason>` resolves in the panel.
    """
    text = str(error)
    if "HTTP 401" in text or "HTTP 403" in text or "API_KEY" in text.upper():
        return "auth_failed"
    if "HTTP 404" in text:
        return "model_not_found"
    if "HTTP 429" in text:
        return "rate_limited"
    if "timed out" in text.lower() or "timeout" in text.lower():
        return "timeout"
    if "no traia ninguna imagen" in text or "did not return" in text.lower():
        return "no_image_returned"
    return "provider_rejected"


def _generate_view(
    config: Config, asset: dict[str, Any], model_id: str, workdir: Path
) -> dict[str, Any]:
    """One view, one request.

    `slots=[slot]` on purpose: the module already issues one API call per view so
    a bad angle can be retried alone, and asking it for one keeps that property
    while bounding what a single failure costs.
    """
    source_url = asset["source_image_url"]
    source = _fetch_source(source_url, config)

    suffix = ".jpg" if source_url.lower().endswith((".jpg", ".jpeg")) else ".png"
    source_path = workdir / f"src{suffix}"
    source_path.write_bytes(source)

    result = generate_views(
        image_path=str(source_path),
        api_key=config.gemini_api_key,
        output_root=str(workdir),
        slots=[asset["slot"]],
        model=model_id,
    )

    produced = result.get("views", {}).get(asset["slot"])
    if not produced:
        failure = result.get("failures", {}).get(asset["slot"], "no image returned")
        raise RuntimeError(str(failure))

    # Through the SAME optimiser every supplier photo goes through. Gemini returns
    # a large PNG; the store serves WebP at 1600px, so this is also where the 2K
    # question gets settled in practice.
    optimized = _optimize_image(Path(produced).read_bytes())
    key = _output_key(asset)
    _upload(config, key, optimized, "image/webp")

    usage = result.get("usage_by_view", {}).get(asset["slot"], {})
    return {
        "status": "done",
        "output_key": key,
        "output_bytes": len(optimized),
        "output_mime": "image/webp",
        "source_fingerprint": _fingerprint(source, model_id),
        "provider_model": result.get("model"),
        "billing_unit": "tokens",
        "tokens_prompt": usage.get("prompt"),
        "tokens_output": usage.get("output"),
        "cost_usd": result.get("cost_by_view_usd", {}).get(asset["slot"]),
        "receipt": _read_receipt(result.get("receipt")),
    }


def _generate_video(
    config: Config,
    asset: dict[str, Any],
    model_id: str,
    prompt: str | None,
    workdir: Path,
    on_operation: Callable[[str], None],
) -> dict[str, Any]:
    """One promotional video.

    `generate_video` submits, polls and downloads in one blocking call of up to
    fifteen minutes — which is fine in a foreground script and was the entire
    reason the earlier design needed a submit/poll split.

    The one property kept from that design: the Veo operation name is persisted
    the moment it exists, via `on_operation`, so a Ctrl-C three minutes in resumes
    that operation next run instead of paying $0.80 for another one.
    """
    source = _fetch_source(asset["source_image_url"], config)
    source_path = workdir / "src.png"
    source_path.write_bytes(source)

    result = generate_video(
        image_path=str(source_path),
        api_key=config.gemini_api_key,
        output_root=str(workdir),
        prompt=prompt,
        model=model_id,
        progress_callback=lambda _fraction, _text: None,
    )

    operation = result.get("operation")
    if operation:
        on_operation(str(operation))

    video_bytes = Path(str(result["path"])).read_bytes()
    key = _output_key(asset)
    _upload(config, key, video_bytes, "video/mp4")

    return {
        "status": "done",
        "output_key": key,
        "output_bytes": len(video_bytes),
        "output_mime": "video/mp4",
        "source_fingerprint": _fingerprint(source, model_id),
        "provider_model": result.get("model"),
        "operation": operation,
        # Veo bills per second of output and reports no token count. An honest
        # absence beats a plausible-looking zero, which reads as "this was free".
        "billing_unit": "seconds",
        "cost_usd": result.get("cost_total_usd"),
        "receipt": _read_receipt(result.get("receipt")),
    }


def _read_receipt(path: Any) -> dict[str, Any] | None:
    """The module writes cost.json beside its output; store it verbatim.

    Keeping the provider's own receipt is what makes a charge reconcilable
    against a bill weeks later. A figure recomputed here could not do that.
    """
    if not path:
        return None
    try:
        import json

        return json.loads(Path(str(path)).read_text(encoding="utf-8"))
    except Exception:
        return None


def run(
    config: Config,
    *,
    kind: str,
    handles: list[str] | None,
    slots: list[str] | None,
    max_cost: float,
    limit: int | None,
    batch: int,
    dry_run: bool,
    echo: Callable[[str], None],
) -> RunStats:
    """Claim, generate, report — until there is nothing left, or a brake trips."""
    stats = RunStats(run_id=new_run_id())
    echo(f"[media] run {stats.run_id} · kind={kind} · max-cost=${max_cost:.2f}")

    processed = 0
    consecutive_failures = 0

    while True:
        if limit is not None and processed >= limit:
            stats.stopped_because = "limit"
            break
        if stats.cost_usd >= max_cost:
            stats.stopped_because = "max_cost"
            break

        want = batch
        if limit is not None:
            want = min(want, limit - processed)

        try:
            batch_response = api.claim(
                config, stats.run_id, want, kind, slots=slots, handles=handles
            )
        except api.MediaApiError as err:
            # 409 is the server's budget refusing. That is a clean stop with a
            # reason, not a crash — the remaining assets stay claimable.
            if err.status == 409:
                stats.stopped_because = err.reason or "budget"
                echo(f"[media] stopped: {err.reason} — {err}")
                break
            raise

        assets = batch_response.get("assets", [])
        if not assets:
            stats.stopped_because = stats.stopped_because or "empty"
            break

        model_id = (
            batch_response.get("video_model_id")
            if kind == "video"
            else batch_response.get("image_model_id")
        )
        prompt = batch_response.get("video_prompt")

        for asset in assets:
            label = f"{asset['product_handle']} {asset.get('colorway') or ''} {asset.get('slot') or kind}".strip()
            processed += 1

            if dry_run:
                echo(f"[media]   [dry-run] would generate {label}")
                stats.skipped += 1
                continue

            started = time.monotonic()
            with tempfile.TemporaryDirectory(prefix="frame-media-") as tmp:
                workdir = Path(tmp)
                try:
                    if kind == "view":
                        outcome = _generate_view(config, asset, model_id, workdir)
                    elif kind == "video":
                        outcome = _generate_video(
                            config,
                            asset,
                            model_id,
                            prompt,
                            workdir,
                            on_operation=lambda op: api.report(
                                config,
                                run_id=stats.run_id,
                                id=asset["id"],
                                status="awaiting_external",
                                operation=op,
                            ),
                        )
                    else:
                        raise RuntimeError("3D models are produced offline, not here")
                except Exception as err:  # noqa: BLE001 — one asset must not end the run
                    reason = _classify(err)
                    consecutive_failures += 1
                    stats.failed += 1
                    stats.failures.append(
                        {"asset": label, "reason": reason, "note": str(err)[:300]}
                    )
                    api.report(
                        config,
                        run_id=stats.run_id,
                        id=asset["id"],
                        status="failed",
                        reason=reason,
                        note=str(err)[:1000],
                    )
                    echo(f"[media]   {label} ✗ {reason} — {str(err)[:140]}")

                    if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                        stats.stopped_because = "consecutive_failures"
                        echo(
                            f"[media] aborting: {consecutive_failures} failures in a row — "
                            "check the API key, the quota and the network path."
                        )
                        return stats
                    continue

            consecutive_failures = 0
            cost = float(outcome.get("cost_usd") or 0.0)
            stats.cost_usd += cost
            stats.done += 1
            api.report(config, run_id=stats.run_id, id=asset["id"], **outcome)
            echo(
                f"[media]   {label} ✓ {time.monotonic() - started:.1f}s "
                f"${cost:.4f} (run total ${stats.cost_usd:.2f})"
            )

            if stats.cost_usd >= max_cost:
                stats.stopped_because = "max_cost"
                echo(f"[media] reached --max-cost ${max_cost:.2f}; stopping.")
                return stats

    return stats
