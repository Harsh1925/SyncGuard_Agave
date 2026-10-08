from psycopg.types.json import Jsonb

from syncguard.chaos.faults import FaultPoint, hit
from syncguard.domain.models import Invoice
from syncguard.state.database import connect
from syncguard.state.repository import audit


class Reconciler:
    def __init__(self, dsn: str, erp, pm):
        self.dsn, self.erp, self.pm = dsn, erp, pm

    def run(self) -> dict:
        # Serialize with pollers to prevent a newly derived operation racing classification.
        with connect(self.dsn) as conn:
            conn.execute("SELECT pg_advisory_lock(91002)")
            try:
                with self.erp.snapshot() as invoices:
                    authoritative = {item.logical_id: item for item in invoices}
                replica = self.pm.invoices()
                drift, deferred = [], []
                open_drift = {
                    str(row["logical_id"])
                    for row in conn.execute(
                        "SELECT logical_id FROM drift_reports WHERE resolved_at IS NULL"
                    ).fetchall()
                }
                for key in sorted(authoritative.keys() | replica.keys() | open_drift):
                    hit(FaultPoint.DURING_RECONCILIATION)
                    # Share the worker's record fence. Fetch actual PM state after acquiring
                    # it, so a worker completing after the initial list read cannot cause
                    # a false drift report against an outdated replica value.
                    locked = conn.execute(
                        "SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0)) AS locked",
                        (key,),
                    ).fetchone()["locked"]
                    active = conn.execute(
                        "SELECT 1 FROM operations WHERE logical_id=%s AND status IN ('pending','attempting','retrying') LIMIT 1",
                        (key,),
                    ).fetchone()
                    if active or not locked:
                        deferred.append(key)
                        audit(conn, "reconciliation_deferred", logical_id=key)
                        continue
                    source = authoritative.get(key)
                    actual = self.pm.get(key)
                    target = Invoice.model_validate(actual["invoice"]) if actual else None
                    if (source.fingerprint if source else None) != (
                        target.fingerprint if target else None
                    ):
                        drift.append(key)
                        conn.execute(
                            """INSERT INTO drift_reports(logical_id,authoritative,replica) VALUES (%s,%s,%s)
                            ON CONFLICT(logical_id) WHERE resolved_at IS NULL DO UPDATE SET
                            authoritative=EXCLUDED.authoritative,replica=EXCLUDED.replica,detected_at=now()""",
                            (
                                key,
                                Jsonb(source.canonical()) if source else None,
                                Jsonb(target.canonical()) if target else None,
                            ),
                        )
                        audit(conn, "drift_detected", logical_id=key)
                    else:
                        conn.execute(
                            "UPDATE drift_reports SET resolved_at=now() WHERE logical_id=%s AND resolved_at IS NULL",
                            (key,),
                        )
                return {"drift": drift, "deferred": deferred}
            finally:
                conn.execute("SELECT pg_advisory_unlock(91002)")
