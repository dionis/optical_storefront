"""Configuration loaded from environment variables."""

import os
from dataclasses import dataclass, field


@dataclass
class Config:
    medusa_backend_url: str = field(
        default_factory=lambda: os.getenv("MEDUSA_BACKEND_URL", "http://localhost:9000")
    )
    medusa_admin_api_key: str = field(
        default_factory=lambda: os.getenv("MEDUSA_ADMIN_API_KEY", "")
    )
    r2_access_key_id: str = field(
        default_factory=lambda: os.getenv("R2_ACCESS_KEY_ID", "")
    )
    r2_secret_access_key: str = field(
        default_factory=lambda: os.getenv("R2_SECRET_ACCESS_KEY", "")
    )
    r2_bucket: str = field(
        default_factory=lambda: os.getenv("R2_BUCKET", "eyewear-assets")
    )
    r2_endpoint: str = field(
        default_factory=lambda: os.getenv("R2_ENDPOINT", "")
    )
    r2_public_url: str = field(
        default_factory=lambda: os.getenv("R2_PUBLIC_URL", "")
    )
    meilisearch_host: str = field(
        default_factory=lambda: os.getenv("MEILISEARCH_HOST", "http://localhost:7700")
    )
    meilisearch_master_key: str = field(
        default_factory=lambda: os.getenv("MEILISEARCH_MASTER_KEY", "")
    )
    anthropic_api_key: str = field(
        default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", "")
    )
    rate_limit_seconds: float = field(
        default_factory=lambda: float(os.getenv("SCRAPER_RATE_LIMIT", "1.0"))
    )
    user_agent: str = field(
        default_factory=lambda: os.getenv(
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


_config: Config | None = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config()
    return _config
