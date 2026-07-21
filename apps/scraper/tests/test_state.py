"""State store tests."""

import os
import tempfile

from scraper.state import StateStore


def test_new_product_has_changed() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        store = StateStore(os.path.join(tmpdir, "state.db"))
        assert store.has_changed("test-handle", "abc123") is True


def test_unchanged_product_not_changed() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        store = StateStore(os.path.join(tmpdir, "state.db"))
        store.mark_seen("test-handle", "abc123")
        assert store.has_changed("test-handle", "abc123") is False


def test_updated_product_has_changed() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        store = StateStore(os.path.join(tmpdir, "state.db"))
        store.mark_seen("test-handle", "abc123")
        assert store.has_changed("test-handle", "def456") is True


def test_mark_seen_is_idempotent() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        store = StateStore(os.path.join(tmpdir, "state.db"))
        store.mark_seen("test-handle", "abc123")
        store.mark_seen("test-handle", "abc123")  # should not raise
        assert store.has_changed("test-handle", "abc123") is False
