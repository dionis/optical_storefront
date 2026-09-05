"""Resolving "which frames" from the command line.

There is NO default selection, on purpose. A default on the argument that decides
how much money a command spends is a trap waiting for somebody to press Enter
once too often, so every path here either names frames explicitly or fails.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

#: The committed pilot cohort. Lives next to its backend consumer rather than in
#: docs/data/, which is gitignored (it holds real prescription scans) — a manifest
#: written there would never be committed, and the whole point of the cohort is
#: that it is fixed and reviewable in version control.
_PILOT_PATH = (
    Path(__file__).resolve().parents[3]
    / "backend"
    / "src"
    / "lib"
    / "frame-media-pilot.json"
)


class SelectionError(ValueError):
    """No frames could be resolved from the arguments given."""


def _load_pilot() -> dict[str, Any]:
    if not _PILOT_PATH.exists():
        raise SelectionError(
            f"Pilot manifest not found at {_PILOT_PATH}. "
            "Regenerate it with: node scripts/build-pilot-set.mjs"
        )
    return json.loads(_PILOT_PATH.read_text(encoding="utf-8"))


def pilot_handles() -> list[str]:
    return [f["handle"] for f in _load_pilot()["frames"]]


def pilot_brand_handles(brand: str) -> list[str]:
    """Frames of one brand within the cohort.

    Matches the display name OR the supplier slug, because the two do not agree
    and both are things a person reasonably types: "Simplylite" is `simply-lite`
    and "Four You" is `4u`. Guessing one from the other is hopeless.
    """
    wanted = brand.strip().lower().replace(" ", "-")
    return [
        f["handle"]
        for f in _load_pilot()["frames"]
        if f["brand"].lower().replace(" ", "-") == wanted
        or str(f.get("brand_slug", "")).lower() == wanted
    ]


def from_file(path: str) -> list[str]:
    """One handle per line; `#` comments and blank lines ignored."""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    handles = [
        line.strip() for line in lines if line.strip() and not line.strip().startswith("#")
    ]
    if not handles:
        raise SelectionError(f"{path} contains no handles.")
    return handles


def resolve(
    *,
    pilot: bool,
    pilot_brand: str | None,
    handles: tuple[str, ...],
    from_file_path: str | None,
    all_frames: bool,
    pending: bool,
) -> tuple[list[str] | None, str]:
    """Returns (handles, description).

    `None` means "whatever is already queued" — the `--pending` and `--all` paths,
    where the server decides the set. Everything else is an explicit list.
    """
    chosen = [
        name
        for name, on in (
            ("--pilot", pilot),
            ("--pilot-brand", bool(pilot_brand)),
            ("--handle", bool(handles)),
            ("--from-file", bool(from_file_path)),
            ("--all", all_frames),
            ("--pending", pending),
        )
        if on
    ]
    if not chosen:
        raise SelectionError(
            "No selection given. Pass one of --pilot, --pilot-brand, --handle, "
            "--from-file, --pending or --all.\n"
            "There is no default on purpose: this argument decides what gets paid for."
        )
    if len(chosen) > 1:
        raise SelectionError(f"Selection arguments are mutually exclusive: {', '.join(chosen)}")

    if pilot:
        return pilot_handles(), "pilot cohort"
    if pilot_brand:
        resolved = pilot_brand_handles(pilot_brand)
        if not resolved:
            raise SelectionError(f"No pilot frames for brand {pilot_brand!r}.")
        return resolved, f"pilot cohort · {pilot_brand}"
    if handles:
        return list(handles), f"{len(handles)} handle(s)"
    if from_file_path:
        resolved = from_file(from_file_path)
        return resolved, f"{len(resolved)} handle(s) from {from_file_path}"
    if pending:
        return None, "already queued"
    return None, "whole catalogue"
