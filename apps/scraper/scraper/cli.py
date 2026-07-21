"""CLI entry point for the scraper."""

import asyncio

import click

from scraper.config import get_config
from scraper.sync import sync


@click.group()
def cli() -> None:
    """Eyewear catalog ingestion CLI."""


@cli.command()
@click.option("--full", is_flag=True, default=False, help="Ignore state cache and re-process all products.")
@click.option("--collection", "collection_slug", default=None, help="Sync only a specific collection slug.")
@click.option("--dry-run", is_flag=True, default=False, help="Parse and print without writing to Medusa or R2.")
def sync_cmd(full: bool, collection_slug: str | None, dry_run: bool) -> None:
    """Sync catalog from caprioptics.com into Medusa + R2."""
    config = get_config()
    collections = [collection_slug] if collection_slug else None
    asyncio.run(sync(config, collections=collections, full=full, dry_run=dry_run))


# Register 'sync' as the public command name
cli.add_command(sync_cmd, name="sync")
