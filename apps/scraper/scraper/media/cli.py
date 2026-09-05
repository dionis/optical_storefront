"""`python -m scraper media …` — the executor for generated frame media.

Runs on the server, by hand, when the owner decides. The admin panel decides
WHAT (it enqueues and it publishes); this decides WHEN. A `pending` row in the
panel is authorised work waiting for somebody to run it, not work that was lost.

Why a CLI rather than a button: a real run takes hours and costs money, so
whoever starts it has to be able to watch it, bound it and stop it. A button in a
browser gives none of that — it gives an HTTP request that dies with the tab.
"""

from __future__ import annotations

import functools
import json

import click

from scraper.config import ConfigError, get_config
from scraper.media import client as api
from scraper.media.client import MediaApiError
from scraper.media import runner
from scraper.media.selection import SelectionError, resolve

SLOTS = ["front", "left", "right", "back"]


def _handle_api_errors(fn):
    """Turn a MediaApiError into a readable CLI failure instead of a traceback.

    The 404 case earns its own wording because it is the state every deployment
    passes through: the backend serving this store is deployed from `main`, so
    until that merge lands the frame-media routes simply are not there. A raw
    stack trace with an HTML error page in it says none of that.
    """

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except MediaApiError as err:
            if err.status == 404:
                raise click.ClickException(
                    "The backend has no frame-media routes yet.\n"
                    "They ship with the backend deploy: merge develop → main and let "
                    "Coolify redeploy (its entrypoint runs `medusa db:migrate`, which "
                    "creates the tables too).\n"
                    f"Tried: {err}"
                ) from err
            if err.status == 0:
                raise click.ClickException(
                    f"{err}\nCheck MEDUSA_BACKEND_URL in apps/scraper/.env."
                ) from err
            if err.status in (401, 403):
                raise click.ClickException(
                    f"Medusa refused the admin key ({err.status}).\n"
                    "MEDUSA_ADMIN_API_KEY must be a secret admin API key, sent over "
                    "HTTP Basic — not a publishable key."
                ) from err
            raise click.ClickException(
                f"{err}" + (f" [{err.reason}]" if err.reason else "")
            ) from err

    return wrapper


def _selection_options(fn):
    """Selection flags, shared verbatim by `plan` and `generate`.

    Sharing them is the point: you rehearse and then execute by changing one
    word, without retyping the command — which is where the expensive mistakes
    get made.
    """
    for option in reversed(
        [
            click.option("--pilot", is_flag=True, help="The 70-frame pilot cohort."),
            click.option(
                "--pilot-brand",
                default=None,
                help="One brand inside the pilot (name or slug, e.g. simply-lite).",
            ),
            click.option(
                "--handle", "handles", multiple=True,
                help="Medusa handle. Repeatable. NOT the storefront seed slug.",
            ),
            click.option(
                "--from-file", "from_file_path", default=None,
                help="File with one handle per line; # comments ignored.",
            ),
            click.option("--all", "all_frames", is_flag=True, help="The whole catalogue."),
            click.option(
                "--pending", is_flag=True,
                help="Whatever the panel already queued, without re-selecting.",
            ),
            click.option(
                "--kind",
                type=click.Choice(["views", "video", "model3d"]),
                default="views",
                show_default=True,
            ),
            click.option(
                "--slot", "slot_list", default=None,
                help=f"Comma-separated subset of {','.join(SLOTS)}.",
            ),
        ]
    ):
        fn = option(fn)
    return fn


def _kind(value: str) -> str:
    """CLI says `views`; the data model says `view` (one row per view)."""
    return {"views": "view", "video": "video", "model3d": "model3d"}[value]


def _slots(slot_list: str | None) -> list[str] | None:
    if not slot_list:
        return None
    slots = [s.strip() for s in slot_list.split(",") if s.strip()]
    unknown = [s for s in slots if s not in SLOTS]
    if unknown:
        raise click.ClickException(f"Unknown slot(s): {', '.join(unknown)}")
    return slots


@click.group("media")
def media_group() -> None:
    """Generate and index the 4 views, the promo video and the 3D work orders."""


@media_group.command("plan")
@_selection_options
@_handle_api_errors
def plan_cmd(
    pilot: bool,
    pilot_brand: str | None,
    handles: tuple[str, ...],
    from_file_path: str | None,
    all_frames: bool,
    pending: bool,
    kind: str,
    slot_list: str | None,
) -> None:
    """Rehearse: enqueue nothing, spend nothing, print what it would cost."""
    config = get_config()
    config.validate()

    try:
        selected, description = resolve(
            pilot=pilot, pilot_brand=pilot_brand, handles=handles,
            from_file_path=from_file_path, all_frames=all_frames, pending=pending,
        )
    except SelectionError as err:
        raise click.ClickException(str(err)) from err

    slots = _slots(slot_list)
    click.echo(f"Selection: {description}")
    if selected:
        click.echo(f"Frames:    {len(selected)}")
    if slots:
        click.echo(f"Slots:     {', '.join(slots)}")

    state = api.progress(config, scope="pilot" if pilot else None)
    outstanding = state.get("outstanding", {})
    estimate = outstanding.get("estimate", {})
    spend = state.get("spend", {})
    tier = state.get("tier", {})

    click.echo("")
    click.echo(f"Queued views:  {outstanding.get('views', 0)}")
    click.echo(f"Queued videos: {outstanding.get('videos', 0)}")
    click.echo(f"Would cost:    ${estimate.get('total_usd', 0):.2f}")
    click.echo("")
    click.echo(
        f"Tier {tier.get('level')} · spent this month ${spend.get('month_to_date_usd', 0):.2f} "
        f"of ${spend.get('ceiling_usd_views', 0):.2f} (views)"
    )
    click.echo("")
    click.echo("Nothing was generated. Re-run with `generate --max-cost N` to execute.")


@media_group.command("generate")
@_selection_options
@click.option(
    "--max-cost", type=float, required=True,
    help="Hard USD ceiling for THIS run. Required — see the note in the docs.",
)
@click.option("--limit", type=int, default=None, help="Max assets this run.")
@click.option("--batch", type=int, default=8, show_default=True, help="Assets per claim.")
@click.option("--dry-run", is_flag=True, help="Walk the queue without calling Gemini.")
@click.option("--yes", "assume_yes", is_flag=True, help="Skip the confirmation prompt.")
@click.option("--report", "report_path", default=None, help="Write a JSON run report here.")
@_handle_api_errors
def generate_cmd(
    pilot: bool,
    pilot_brand: str | None,
    handles: tuple[str, ...],
    from_file_path: str | None,
    all_frames: bool,
    pending: bool,
    kind: str,
    slot_list: str | None,
    max_cost: float,
    limit: int | None,
    batch: int,
    dry_run: bool,
    assume_yes: bool,
    report_path: str | None,
) -> None:
    """Generate media. THIS SPENDS MONEY.

    `--max-cost` is mandatory rather than configurable: this command runs outside
    the panel, the module has no ceiling of its own, and the whole catalogue is
    $223. A ceiling that lives in a config somebody set three months ago is not a
    ceiling; written on every invocation, it is a decision.
    """
    config = get_config()
    try:
        config.validate()
        if not dry_run:
            config.validate_media()
    except ConfigError as err:
        # Surface the real cause instead of a network traceback 40 assets in.
        raise click.ClickException(str(err)) from err

    try:
        selected, description = resolve(
            pilot=pilot, pilot_brand=pilot_brand, handles=handles,
            from_file_path=from_file_path, all_frames=all_frames, pending=pending,
        )
    except SelectionError as err:
        raise click.ClickException(str(err)) from err

    slots = _slots(slot_list)
    media_kind = _kind(kind)

    if media_kind == "model3d":
        raise click.ClickException(
            "3D models are produced by the offline GPU pipeline, not here.\n"
            "Use the admin panel to raise a work order, then upload the .glb."
        )

    # Enqueue first: asking for assets that already exist is free (the unique
    # index makes it a no-op), and it means `--handle` works on frames nobody
    # queued from the panel.
    if selected:
        queued = api.enqueue(config, selected, kind=media_kind, slots=slots)
        if queued.get("unknown_handles"):
            click.echo(
                f"[media] WARNING: {len(queued['unknown_handles'])} handle(s) unknown to "
                f"Medusa, e.g. {queued['unknown_handles'][:3]} — did you pass a seed slug?"
            )
        if queued.get("skipped_no_source_image"):
            click.echo(
                f"[media] {len(queued['skipped_no_source_image'])} variant(s) have no "
                "source photo and were skipped: there is nothing to generate from."
            )
        click.echo(
            f"[media] queued {queued.get('inserted', 0)} new asset(s); "
            f"{queued.get('already_present', 0)} already existed."
        )

    state = api.progress(config, scope="pilot" if pilot else None)
    estimate = state.get("outstanding", {}).get("estimate", {}).get("total_usd", 0.0)

    click.echo("")
    click.echo(f"Selection:  {description}")
    click.echo(f"Kind:       {kind}")
    click.echo(f"Outstanding estimate: ${estimate:.2f}")
    click.echo(f"This run will stop at: ${max_cost:.2f}")
    click.echo("")

    if not assume_yes and not dry_run:
        click.confirm("Proceed and spend up to this amount?", abort=True)

    stats = runner.run(
        config,
        kind=media_kind,
        handles=selected,
        slots=slots,
        max_cost=max_cost,
        limit=limit,
        batch=batch,
        dry_run=dry_run,
        echo=click.echo,
    )

    click.echo("")
    click.echo(
        f"[media] done={stats.done} failed={stats.failed} skipped={stats.skipped} "
        f"spent=${stats.cost_usd:.4f} stopped={stats.stopped_because}"
    )

    if report_path:
        with open(report_path, "w", encoding="utf-8") as handle:
            json.dump(stats.as_dict(), handle, indent=2, ensure_ascii=False)
        click.echo(f"[media] report → {report_path}")

    if stats.failed and not stats.done:
        raise SystemExit(1)


@media_group.command("status")
@click.option("--pilot", is_flag=True, help="Restrict to the pilot cohort.")
@click.option("--json", "as_json", is_flag=True, help="Machine-readable output.")
@_handle_api_errors
def status_cmd(pilot: bool, as_json: bool) -> None:
    """Where the queue stands, read from Medusa — the same numbers the panel shows."""
    config = get_config()
    config.validate()
    state = api.progress(config, scope="pilot" if pilot else None)

    if as_json:
        click.echo(json.dumps(state, indent=2, ensure_ascii=False))
        return

    for kind, counts in (state.get("by_kind") or {}).items():
        parts = " ".join(f"{status}={count}" for status, count in sorted(counts.items()))
        click.echo(f"{kind:8} {parts}")

    spend = state.get("spend", {})
    tier = state.get("tier", {})
    click.echo("")
    click.echo(
        f"tier {tier.get('level')} · month ${spend.get('month_to_date_usd', 0):.2f}"
        f"/${spend.get('ceiling_usd_views', 0):.2f} views"
        f" · today ${spend.get('today_usd', 0):.2f}/${spend.get('daily_ceiling_usd', 0):.2f}"
    )


@media_group.command("retry")
@_selection_options
@_handle_api_errors
def retry_cmd(
    pilot: bool,
    pilot_brand: str | None,
    handles: tuple[str, ...],
    from_file_path: str | None,
    all_frames: bool,
    pending: bool,
    kind: str,
    slot_list: str | None,
) -> None:
    """Return failed assets to the queue. Spends nothing by itself."""
    config = get_config()
    config.validate()

    try:
        selected, description = resolve(
            pilot=pilot, pilot_brand=pilot_brand, handles=handles,
            from_file_path=from_file_path, all_frames=all_frames, pending=pending,
        )
    except SelectionError as err:
        raise click.ClickException(str(err)) from err

    result = api.retry(
        config,
        handles=selected,
        kind=_kind(kind),
        slots=_slots(slot_list),
    )
    click.echo(f"Requeued {result.get('requeued', 0)} failed asset(s) from {description}.")
    if result.get("blocked_non_retryable"):
        click.echo(
            f"Left alone: {result['blocked_non_retryable']} asset(s) failed for a reason "
            "retrying will not fix (bad key, unknown model, missing source photo). "
            "Fix the cause, then re-run with the panel's force option."
        )
    click.echo("They will be picked up by the next `media generate`.")
