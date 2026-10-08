from uuid import uuid4

from psycopg.types.json import Jsonb

from syncguard.chaos.faults import FaultPoint, hit
from syncguard.domain.changes import derive_changes
from syncguard.state.database import connect
from syncguard.state.repository import audit, enqueue_change


class SnapshotDetector:
    def __init__(self, dsn: str, erp):
        self.dsn, self.erp = dsn, erp

    def run(self) -> dict:
        snapshot_id = uuid4()
        with connect(self.dsn) as conn:
            # Serialize pollers across the source read and durable derivation boundary.
            conn.execute("SELECT pg_advisory_lock(91002)")
            previous = conn.execute(
                "SELECT id FROM snapshots WHERE status='COMPLETE' ORDER BY completed_at DESC LIMIT 1"
            ).fetchone()
            previous_id = previous["id"] if previous else None
            conn.execute(
                "INSERT INTO snapshots(id,status,previous_complete_id) VALUES (%s,'IN_PROGRESS',%s)",
                (snapshot_id, previous_id),
            )
            audit(conn, "snapshot_started", snapshot_id=str(snapshot_id))
            conn.commit()
            try:
                invoices = []
                with self.erp.snapshot() as records:
                    for invoice in records:
                        invoices.append(invoice)
                        hit(FaultPoint.DURING_SNAPSHOT)
                hit(FaultPoint.AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT)
                previous_members = (
                    conn.execute(
                        "SELECT logical_id,fingerprint FROM snapshot_members WHERE snapshot_id=%s",
                        (previous_id,),
                    ).fetchall()
                    if previous_id
                    else []
                )
                previous_state = {str(row["logical_id"]): row for row in previous_members}
                changes = derive_changes(previous_state, invoices)
                for invoice in invoices:
                    conn.execute(
                        "INSERT INTO snapshot_members(snapshot_id,logical_id,fingerprint,state) VALUES (%s,%s,%s,%s)",
                        (
                            snapshot_id,
                            invoice.logical_id,
                            invoice.fingerprint,
                            Jsonb(invoice.canonical()),
                        ),
                    )
                # COMPLETE, observations, ledger and queue commit together; never partial deletion.
                conn.execute(
                    "UPDATE snapshots SET status='COMPLETE',completed_at=now() WHERE id=%s",
                    (snapshot_id,),
                )
                operations = [enqueue_change(conn, change) for change in changes]
                audit(
                    conn, "snapshot_completed", snapshot_id=str(snapshot_id), changes=len(changes)
                )
                conn.execute("""DELETE FROM snapshots WHERE status='COMPLETE' AND NOT retained AND id NOT IN
                    (SELECT id FROM snapshots WHERE status='COMPLETE' ORDER BY completed_at DESC LIMIT 5)""")
                conn.commit()
                return {
                    "snapshot_id": str(snapshot_id),
                    "changes": len(changes),
                    "operations": operations,
                }
            except Exception as exc:
                conn.rollback()
                conn.execute(
                    "UPDATE snapshots SET status='FAILED',error=%s,completed_at=now() WHERE id=%s",
                    (str(exc), snapshot_id),
                )
                audit(conn, "snapshot_failed", snapshot_id=str(snapshot_id), error=str(exc))
                conn.commit()
                raise
            finally:
                conn.execute("SELECT pg_advisory_unlock(91002)")
