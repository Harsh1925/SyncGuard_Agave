from contextlib import contextmanager
from dataclasses import replace

import pytest

from simulators.erp.database import seed
from syncguard.adapters.erp import ERPAdapter
from syncguard.config import Settings
from syncguard.domain.changes import Change
from syncguard.domain.models import Action
from syncguard.engine.detector import SnapshotDetector
from syncguard.engine.worker import SyncWorker
from syncguard.state.database import connect
from syncguard.state.repository import claim, enqueue_change

pytestmark = pytest.mark.integration


def test_partial_snapshot_never_derives_deletes(postgres_dsn, tmp_path, invoice):
    path = str(tmp_path / "erp.sqlite")
    seed(path)
    detector = SnapshotDetector(postgres_dsn, ERPAdapter(path))
    detector.run()

    class BrokenERP:
        @contextmanager
        def snapshot(self):
            def rows():
                yield invoice
                raise RuntimeError("partial read")

            yield rows()

    with pytest.raises(RuntimeError):
        SnapshotDetector(postgres_dsn, BrokenERP()).run()
    with connect(postgres_dsn) as conn:
        assert (
            conn.execute("SELECT count(*) AS n FROM operations WHERE action='delete'").fetchone()[
                "n"
            ]
            == 0
        )
        assert (
            conn.execute("SELECT count(*) AS n FROM snapshots WHERE status='FAILED'").fetchone()[
                "n"
            ]
            == 1
        )


def test_expired_lease_can_be_reclaimed(postgres_dsn, invoice):
    with connect(postgres_dsn) as conn:
        enqueue_change(
            conn,
            Change(invoice.logical_id, Action.UPSERT, invoice.canonical(), invoice.fingerprint),
        )
        first = claim(conn, "worker-a", 1)
        conn.execute(
            "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (first["id"],)
        )
    with connect(postgres_dsn) as conn:
        second = claim(conn, "worker-b", 1)
        assert second["id"] == first["id"]
        assert second["claim_token"] != first["claim_token"]


def test_duplicate_delivery_and_lost_response_verify_before_retry(postgres_dsn, invoice):
    class Destination:
        committed = False
        writes = 0

        def verify(self, operation):
            return self.committed

        def write(self, operation):
            self.writes += 1
            self.committed = True
            raise TimeoutError("commit happened, response lost")

    target = Destination()
    settings = replace(Settings.from_env(), database_url=postgres_dsn)
    worker = SyncWorker(settings, target)
    with connect(postgres_dsn) as conn:
        op = enqueue_change(
            conn,
            Change(invoice.logical_id, Action.UPSERT, invoice.canonical(), invoice.fingerprint),
        )
        conn.execute("INSERT INTO jobs(operation_id) VALUES (%s)", (op,))
    assert worker.run_once()
    assert worker.run_once()
    with connect(postgres_dsn) as conn:
        conn.execute("UPDATE jobs SET available_at=now() WHERE status='retrying'")
    assert worker.run_once()
    assert target.writes == 1
    with connect(postgres_dsn) as conn:
        assert (
            conn.execute("SELECT status FROM operations WHERE operation_id=%s", (op,)).fetchone()[
                "status"
            ]
            == "succeeded"
        )
