"""Config resolution and fail-fast validation."""

import pytest

from scraper.config import Config, ConfigError


def test_blank_env_falls_back_to_default(monkeypatch):
    """CI passes undefined secrets as "" — that must not beat the default."""
    monkeypatch.setenv("MEDUSA_BACKEND_URL", "")
    monkeypatch.setenv("R2_BUCKET", "   ")
    config = Config()
    assert config.medusa_backend_url == "http://localhost:9000"
    assert config.r2_bucket == "eyewear-assets"


def test_url_trailing_slash_stripped(monkeypatch):
    monkeypatch.setenv("MEDUSA_BACKEND_URL", "https://api.example.com/")
    assert Config().medusa_backend_url == "https://api.example.com"


def test_validate_rejects_empty_admin_key(monkeypatch):
    monkeypatch.setenv("MEDUSA_ADMIN_API_KEY", "")
    with pytest.raises(ConfigError, match="MEDUSA_ADMIN_API_KEY"):
        Config().validate()


def test_validate_rejects_url_without_scheme(monkeypatch):
    monkeypatch.setenv("MEDUSA_BACKEND_URL", "api.example.com")
    monkeypatch.setenv("MEDUSA_ADMIN_API_KEY", "sk_test")
    with pytest.raises(ConfigError, match="must include the scheme"):
        Config().validate()


def test_validate_rejects_r2_endpoint_without_scheme(monkeypatch):
    monkeypatch.setenv("MEDUSA_BACKEND_URL", "https://api.example.com")
    monkeypatch.setenv("MEDUSA_ADMIN_API_KEY", "sk_test")
    monkeypatch.setenv("R2_ENDPOINT", "account.r2.cloudflarestorage.com")
    with pytest.raises(ConfigError, match="R2_ENDPOINT"):
        Config().validate()


def test_validate_passes_with_valid_config(monkeypatch):
    monkeypatch.setenv("MEDUSA_BACKEND_URL", "https://api.example.com")
    monkeypatch.setenv("MEDUSA_ADMIN_API_KEY", "sk_test")
    Config().validate()


def test_dry_run_skips_medusa_requirements(monkeypatch):
    """A dry run never writes, so missing credentials must not block it."""
    monkeypatch.setenv("MEDUSA_BACKEND_URL", "")
    monkeypatch.setenv("MEDUSA_ADMIN_API_KEY", "")
    Config().validate(dry_run=True)


def test_invalid_rate_limit_raises(monkeypatch):
    monkeypatch.setenv("SCRAPER_RATE_LIMIT", "fast")
    with pytest.raises(ConfigError, match="SCRAPER_RATE_LIMIT"):
        Config()
