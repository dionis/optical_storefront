"""CLI entry point for the scraper."""

import asyncio
import sys
from pathlib import Path

import click
from dotenv import load_dotenv

from scraper.config import ConfigError, get_config
from scraper.media.cli import media_group
from scraper.sync import sync

# Resolved from this file, not the working directory, so `python -m scraper` picks
# up the same `.env` no matter where it is invoked from. Nothing used to load it
# at all: the app relied on an editor injecting the file, so any other caller — a
# cron job, a plain shell, a container — silently fell back to the defaults and
# reported "R2 not configured" with correct credentials sitting in `.env`.
#
# `override=False` (the default) keeps real environment variables winning over the
# file, which is what CI and Coolify depend on.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


@click.group()
def cli() -> None:
    """Eyewear catalog ingestion CLI."""
    # The log uses box-drawing rules and ✓/✗ marks. On Windows, Python picks the
    # console encoding only for a terminal; the moment output is piped or
    # redirected (`> sync.log`, `| tee`) it falls back to cp1252 and the first
    # such character kills the run with UnicodeEncodeError — before a single
    # product is touched. Pin UTF-8 so a redirected run behaves like a live one.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    load_dotenv(_ENV_FILE)


@cli.command()
@click.option("--full", is_flag=True, default=False, help="Ignore state cache and re-process all products.")
@click.option("--collection", "collection_slug", default=None, help="Sync only a specific collection slug.")
@click.option("--dry-run", is_flag=True, default=False, help="Parse and print without writing to Medusa or R2.")
def sync_cmd(full: bool, collection_slug: str | None, dry_run: bool) -> None:
    """Sync catalog from caprioptics.com into Medusa + R2."""
    try:
        config = get_config()
        config.validate(dry_run=dry_run)
    except ConfigError as err:
        # Surface the actual cause instead of a network traceback 130 products in.
        raise click.ClickException(str(err)) from err
    collections = [collection_slug] if collection_slug else None
    report = asyncio.run(sync(config, collections=collections, full=full, dry_run=dry_run))
    report.print_summary(click.echo)
    if report.aborted:
        raise SystemExit(1)


# Register 'sync' as the public command name
cli.add_command(sync_cmd, name="sync")


@cli.command("worker")
@click.option("--once", is_flag=True, help="Poll once, run what is queued, exit.")
@click.option("--interval", type=float, default=None, help="Seconds between polls (default 60).")
@click.option("--worker-id", default=None, help="Name shown in the panel (default: hostname).")
def worker_cmd(once: bool, interval: float | None, worker_id: str | None) -> None:
    """Run catalog syncs queued in Medusa (panel button or monthly schedule).

    The process the Coolify app runs. It never scrapes on its own initiative:
    the schedule and the «Ejecutar ahora» button live in the admin panel.
    """
    from scraper import worker

    try:
        config = get_config()
        config.validate()
    except ConfigError as err:
        raise click.ClickException(str(err)) from err
    wid = worker_id or worker.default_worker_id()
    if once:
        status = worker.poll_once(config, wid)
        click.echo(f"[worker] {status or 'nothing queued'}")
        return
    worker.loop(config, wid, interval=interval or worker.POLL_SECONDS)

# `media` is the generated-media executor: 4 views, promo video, 3D work orders.
# It lives here rather than in its own app so it reuses what the scraper already
# solved — the WebP/R2 image pipeline, the Medusa admin client and its HTTP Basic
# quirk, and this file's .env loading and UTF-8 stream fix.
cli.add_command(media_group, name="media")
