"""What one catalog sync did, in numbers the owner can read.

`sync()` fills a `SyncReport` as it goes. The CLI prints it at the end; the
Coolify worker sends it to Medusa, where the admin panel shows it as «resultado
de la última corrida». The field names match `RunSummary` in
apps/backend/src/lib/catalog-sync.ts — the server keeps only those.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

#: Errors kept per run. A broken backend fails every product with the same
#: message; the first 200 already say everything.
MAX_ERRORS = 200


@dataclass
class SyncReport:
    collections: int = 0
    found: int = 0
    new: int = 0
    updated: int = 0
    unchanged: int = 0
    failed: int = 0
    drafted: int = 0
    # Collections the supplier returned nothing for (fetch failure or empty).
    empty_collections: list[str] = field(default_factory=list)
    # [{handle, title, brand, thumbnail, colors, collection}] — models CREATED this run.
    new_products: list[dict[str, Any]] = field(default_factory=list)
    # [{handle, collection}] — models that existed WITHOUT pictures and got them
    # this run (an earlier run whose uploads all failed). Their 4 views were
    # never possible, so the worker treats them like new models.
    images_recovered: list[dict[str, str]] = field(default_factory=list)
    errors: list[dict[str, str | None]] = field(default_factory=list)
    # Ten consecutive failures: the backend or the network is down.
    aborted: bool = False
    # Stopped from the panel before the end.
    canceled: bool = False

    # 4 views of the new models (filled by the worker, not by sync()).
    views_queued: int = 0
    views_generated: int = 0
    views_failed: int = 0
    views_cost_usd: float = 0.0
    views_note: str | None = None

    def add_error(self, handle: str | None, message: str) -> None:
        if len(self.errors) < MAX_ERRORS:
            self.errors.append({"handle": handle, "message": message[:500]})

    @property
    def new_handles(self) -> list[str]:
        return [p["handle"] for p in self.new_products]

    @property
    def outcome(self) -> str:
        """`succeeded` · `partial` · `failed` · `canceled` (the run's final status)."""
        if self.canceled:
            return "canceled"
        if self.aborted:
            return "failed"
        # Errors without a failed product count too: a model created with no
        # pictures, or views that could not be queued, still need a look.
        if self.failed or self.empty_collections or self.errors:
            return "partial"
        return "succeeded"

    def summary(self) -> dict[str, Any]:
        return {
            "collections": self.collections,
            "found": self.found,
            "new": self.new,
            "updated": self.updated,
            "unchanged": self.unchanged,
            "failed": self.failed,
            "drafted": self.drafted,
            "views_queued": self.views_queued,
            "views_generated": self.views_generated,
            "views_failed": self.views_failed,
            "views_cost_usd": round(self.views_cost_usd, 4),
            "views_note": self.views_note,
        }

    def print_summary(self, echo: Callable[[str], Any] = print) -> None:
        rule = "─" * 62
        echo("")
        echo(rule)
        echo(f"  RESUMEN DE LA CORRIDA · {self.outcome}")
        echo(f"    colecciones      {self.collections}")
        echo(f"    encontrados      {self.found}")
        echo(f"    NUEVOS           {self.new}")
        echo(f"    actualizados     {self.updated}")
        echo(f"    sin cambios      {self.unchanged}")
        echo(f"    fallidos         {self.failed}")
        echo(f"    descontinuados   {self.drafted}")
        if self.empty_collections:
            echo(f"    sin datos        {', '.join(self.empty_collections)}")
        if self.views_queued or self.views_note:
            echo(
                f"    vistas           {self.views_generated} generadas, "
                f"{self.views_failed} fallidas, ${self.views_cost_usd:.2f}"
                + (f" ({self.views_note})" if self.views_note else "")
            )
        for item in self.new_products[:20]:
            echo(f"    + {item['handle']}  {item.get('title') or ''}")
        if len(self.new_products) > 20:
            echo(f"    + … y {len(self.new_products) - 20} más")
        echo(rule)
