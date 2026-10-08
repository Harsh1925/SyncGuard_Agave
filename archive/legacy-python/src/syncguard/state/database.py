from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


@contextmanager
def connect(dsn: str):
    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=5) as conn:
        yield conn


def migrate(dsn: str, directory: Path | None = None) -> None:
    directory = directory or Path("migrations")
    if not directory.is_dir():
        raise FileNotFoundError(
            "Run migrations from the repository root or pass its migrations path"
        )
    with connect(dsn) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(91001)")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        for path in sorted(directory.glob("*.sql")):
            if conn.execute(
                "SELECT 1 FROM schema_migrations WHERE name=%s", (path.name,)
            ).fetchone():
                continue
            conn.execute(path.read_text())
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
