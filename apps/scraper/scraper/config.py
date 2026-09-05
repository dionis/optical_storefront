"""Configuration loaded from environment variables."""

import os
from dataclasses import dataclass, field


class ConfigError(Exception):
    """Raised when required configuration is missing or malformed."""


def _env(name: str, default: str = "") -> str:
    """Read an env var, treating blank/whitespace as unset.

    CI passes undefined GitHub secrets through as empty strings, so `os.getenv`
    with a default silently yields `""` instead of the default — which used to
    surface far downstream as an httpx "URL is missing an http:// protocol"
    traceback. Collapse blank to the default here instead.
    """
    return (os.getenv(name) or "").strip() or default


def _env_url(name: str, default: str = "") -> str:
    """Like `_env`, with the trailing slash stripped so paths can be appended."""
    return _env(name, default).rstrip("/")


# Fragments that only appear in the values shipped in `.env.example`. Left
# unreplaced they are worse than a blank: `R2_ENDPOINT=https://<account-id>.r2…`
# is non-empty, so it satisfies both `validate()`'s scheme check and the "is R2
# configured?" guard in images.py, and then boto3 rejects it with a bare
# `ValueError: Invalid endpoint` — after a whole collection has been scraped.
_PLACEHOLDER_MARKERS = ("<", "your-", "change-me", "example.com")


def _env_optional(name: str, default: str = "", *, url: bool = False) -> str:
    """Read an env var for an OPTIONAL integration, blanking template values.

    Every caller of these has a graceful "not configured" path (hotlink the
    supplier images instead of uploading to R2, and so on). Collapsing an
    unreplaced placeholder to `""` is what routes execution into that path
    rather than into a traceback, and the warning keeps it from being silent —
    a genuine value that trips the heuristic must not vanish unnoticed.

    Only for optional credentials: `SCRAPER_USER_AGENT` legitimately defaults to
    a contact address at example.com and must never be blanked.
    """
    raw = _env(name, default)
    if raw and any(marker in raw.lower() for marker in _PLACEHOLDER_MARKERS):
        print(
            f"[config] WARNING: {name} still holds the .env.example placeholder "
            f"{raw!r} — treating it as unset."
        )
        return ""
    return raw.rstrip("/") if url else raw


def _env_float(name: str, default: float) -> float:
    raw = _env(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as err:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from err


@dataclass
class Config:
    medusa_backend_url: str = field(
        default_factory=lambda: _env_url("MEDUSA_BACKEND_URL", "http://localhost:9000")
    )
    medusa_admin_api_key: str = field(
        default_factory=lambda: _env("MEDUSA_ADMIN_API_KEY")
    )
    # Sales channel the storefront sells from. Products MUST be associated with it,
    # or the Store API (queried via the publishable key) returns nothing. Obtain the
    # id (`sc_...`) from docs/phase-0-setup.md. Empty = don't set it on the payload.
    medusa_sales_channel_id: str = field(
        default_factory=lambda: _env("MEDUSA_SALES_CHANNEL_ID")
    )
    r2_access_key_id: str = field(
        default_factory=lambda: _env_optional("R2_ACCESS_KEY_ID")
    )
    r2_secret_access_key: str = field(
        default_factory=lambda: _env_optional("R2_SECRET_ACCESS_KEY")
    )
    r2_bucket: str = field(
        default_factory=lambda: _env("R2_BUCKET", "eyewear-assets")
    )
    # SigV4 signing region. Cloudflare R2 wants the literal "auto", but most other
    # S3-compatible backends (Supabase Storage among them) sign with the real region
    # and reject "auto" outright, so this cannot stay hardcoded.
    r2_region: str = field(
        default_factory=lambda: _env("R2_REGION", "auto")
    )
    r2_endpoint: str = field(
        default_factory=lambda: _env_optional("R2_ENDPOINT", url=True)
    )
    r2_public_url: str = field(
        default_factory=lambda: _env_optional("R2_PUBLIC_URL", url=True)
    )
    meilisearch_host: str = field(
        default_factory=lambda: _env_url("MEILISEARCH_HOST", "http://localhost:7700")
    )
    meilisearch_master_key: str = field(
        default_factory=lambda: _env_optional("MEILISEARCH_MASTER_KEY")
    )
    anthropic_api_key: str = field(
        default_factory=lambda: _env("ANTHROPIC_API_KEY")
    )
    # Generated media (4 views / promo video). Only `media generate` needs this;
    # every other media subcommand works without it, so it is optional here and
    # checked by `validate_media()` at the point where a missing key costs money.
    gemini_api_key: str = field(
        default_factory=lambda: _env_optional("GEMINI_API_KEY")
    )
    rate_limit_seconds: float = field(
        default_factory=lambda: _env_float("SCRAPER_RATE_LIMIT", 1.0)
    )
    user_agent: str = field(
        default_factory=lambda: _env(
            "SCRAPER_USER_AGENT", "EyewearStoreBot/1.0 (+contact@example.com)"
        )
    )
    base_url: str = "https://caprioptics.com"
    state_db_path: str = "state.db"

    # Collections to scrape (in priority order)
    collections: list[str] = field(
        default_factory=lambda: [
            "di-caprio",
            "4u",
            "peachtree",
            "millennial",
            "simply-lite",
            "flexure",
            "trendy",
            "ago",
            "grande",
            "versailles-palace",
            "candy-shoppe",
            "artistik-eyewear",
            "eyeleos",
            "artistik-galerie",
            "prorx",
            "slimfold",
            "case",
        ]
    )

    @property
    def r2_configured(self) -> bool:
        """True only when R2 has everything boto3 needs to actually upload.

        The endpoint alone used to be the test, so an endpoint set without
        credentials built a client fine and then failed once per image, turning
        a config mistake into hundreds of logged exceptions and a catalog of
        products with no pictures. All three or none.
        """
        return bool(self.r2_endpoint and self.r2_access_key_id and self.r2_secret_access_key)

    def validate(self, dry_run: bool = False) -> None:
        """Fail fast on missing/malformed config before any network call.

        A dry run never talks to Medusa or R2, so only the write path is checked.
        """
        problems: list[str] = []

        if dry_run:
            self._warn_optional()
            return

        if not self.medusa_backend_url:
            problems.append(
                "MEDUSA_BACKEND_URL is empty — set it to the Medusa base URL, "
                "e.g. https://api.example.com"
            )
        elif not self.medusa_backend_url.startswith(("http://", "https://")):
            problems.append(
                f"MEDUSA_BACKEND_URL must include the scheme, got "
                f"{self.medusa_backend_url!r} (expected http:// or https://)"
            )

        if not self.medusa_admin_api_key:
            problems.append(
                "MEDUSA_ADMIN_API_KEY is empty — create a secret admin API key in "
                "the Medusa admin and set it."
            )

        for name, value in (
            ("R2_ENDPOINT", self.r2_endpoint),
            ("R2_PUBLIC_URL", self.r2_public_url),
            ("MEILISEARCH_HOST", self.meilisearch_host),
        ):
            if value and not value.startswith(("http://", "https://")):
                problems.append(
                    f"{name} must include the scheme, got {value!r} "
                    "(expected http:// or https://)"
                )

        if problems:
            raise ConfigError(
                "Invalid scraper configuration:\n"
                + "\n".join(f"  • {p}" for p in problems)
            )

        # Echo the target so a run pointed at the wrong backend is obvious in the log.
        print(f"[config] Medusa target: {self.medusa_backend_url}")
        self._warn_optional()

    def validate_media(self) -> None:
        """Extra checks for `media generate`, which spends money per request.

        Deliberately separate from `validate()`: the other media subcommands only
        read state and must keep working on a machine with no Gemini key.

        Every check here exists because failing LATE is what costs. A run that
        discovers R2 is unconfigured on asset 40 has already paid for 40 images it
        cannot store — the same reasoning that made `r2_configured` demand all three
        credentials instead of just the endpoint.
        """
        problems: list[str] = []

        if not self.gemini_api_key:
            problems.append(
                "GEMINI_API_KEY is empty — get one at https://aistudio.google.com/apikey. "
                "Generation cannot run without it."
            )

        if not self.r2_configured:
            missing = [
                name
                for name, value in (
                    ("R2_ENDPOINT", self.r2_endpoint),
                    ("R2_ACCESS_KEY_ID", self.r2_access_key_id),
                    ("R2_SECRET_ACCESS_KEY", self.r2_secret_access_key),
                )
                if not value
            ]
            problems.append(
                f"R2 is not configured ({', '.join(missing)}). Generated media has no "
                "supplier URL to fall back on, so a run without storage would pay for "
                "images and then throw them away."
            )

        if problems:
            raise ConfigError(
                "Cannot generate media:\n" + "\n".join(f"  • {p}" for p in problems)
            )

    def _warn_optional(self) -> None:
        """Print (don't fail on) optional integrations that will be skipped."""
        if not self.medusa_sales_channel_id:
            print(
                "[config] WARNING: MEDUSA_SALES_CHANNEL_ID unset — pushed products "
                "won't be attached to a sales channel and the storefront Store API "
                "will not return them."
            )
        if not self.r2_configured:
            missing = [
                name
                for name, value in (
                    ("R2_ENDPOINT", self.r2_endpoint),
                    ("R2_ACCESS_KEY_ID", self.r2_access_key_id),
                    ("R2_SECRET_ACCESS_KEY", self.r2_secret_access_key),
                )
                if not value
            ]
            print(
                f"[config] WARNING: R2 not configured ({', '.join(missing)}) — "
                "images stay hotlinked to the supplier and no try-on assets are generated."
            )
        if not self.anthropic_api_key:
            print("[config] WARNING: ANTHROPIC_API_KEY unset — es/fr translations skipped.")


_config: Config | None = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config()
    return _config
