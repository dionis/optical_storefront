"""SQLite state store for change detection (last-seen content hash per product)."""

import sqlite3
from contextlib import contextmanager
from typing import Generator


class StateStore:
    def __init__(self, db_path: str = "state.db") -> None:
        self._db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS product_state (
                    handle      TEXT PRIMARY KEY,
                    content_hash TEXT NOT NULL,
                    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )

    @contextmanager
    def _connect(self) -> Generator[sqlite3.Connection, None, None]:
        conn = sqlite3.connect(self._db_path)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def has_changed(self, handle: str, content_hash: str) -> bool:
        """Returns True if this product is new or its hash has changed."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT content_hash FROM product_state WHERE handle = ?", (handle,)
            ).fetchone()
            return row is None or row[0] != content_hash

    def mark_seen(self, handle: str, content_hash: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO product_state (handle, content_hash, updated_at)
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(handle) DO UPDATE SET
                    content_hash = excluded.content_hash,
                    updated_at   = excluded.updated_at
                """,
                (handle, content_hash),
            )

    def all_handles(self) -> list[str]:
        with self._connect() as conn:
            rows = conn.execute("SELECT handle FROM product_state").fetchall()
            return [r[0] for r in rows]
