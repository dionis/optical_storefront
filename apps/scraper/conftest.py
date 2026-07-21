"""Pytest configuration — loads .env if present."""

import os
from pathlib import Path
import pytest


def pytest_configure(config: pytest.Config) -> None:
    """Load .env.test or .env if present (for local runs without real credentials)."""
    env_file = Path(__file__).parent / ".env.test"
    if not env_file.exists():
        env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())
