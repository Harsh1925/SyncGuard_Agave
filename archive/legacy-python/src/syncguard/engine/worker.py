import logging
import time
from uuid import uuid4

import httpx

from syncguard.chaos.faults import FaultPoint, hit
from syncguard.domain.models import is_stale
from syncguard.state.database import connect
from syncguard.state.repository import audit, claim, finish_job

logger = logging.getLogger(__name__)


class SyncWorker:
    def __init__(self, settings, destination):
        self.settings, self.destination = settings, destination
        self.worker_id = str(uuid4())

    def run_once(self) -> bool:
        with connect(self.settings.database_url) as conn:
            job = claim(conn, self.worker_id, self.settings.lease_seconds)
            conn.commit()
            if job is None:
                return False
            operation = conn.execute(
                "SELECT * FROM operations WHERE operation_id=%s", (job["operation_id"],)
            ).fetchone()
            key = str(operation["logical_id"])
            locked = conn.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s,0)) AS locked", (key,)
            ).fetchone()["locked"]
            if not locked:
                finish_job(conn, job, "retrying", "record owned by another worker", delay=1)
                return True
            conn.commit()
            try:
                # Reload after obtaining per-record ownership; another job may have completed.
                operation = conn.execute(
                    "SELECT * FROM operations WHERE operation_id=%s", (job["operation_id"],)
                ).fetchone()
                record = conn.execute(
                    "SELECT * FROM records WHERE logical_id=%s", (key,)
                ).fetchone()
                if operation["status"] in ("succeeded", "suppressed"):
                    finish_job(conn, job, "succeeded")
                    audit(conn, "duplicate_suppressed", str(operation["operation_id"]))
                    conn.commit()
                    return True
                if (
                    is_stale(
                        operation["version"], record["applied_version"], record["tombstone_version"]
                    )
                    or operation["version"] < record["observed_version"]
                ):
                    conn.execute(
                        "UPDATE operations SET status='suppressed',completed_at=now() WHERE operation_id=%s",
                        (operation["operation_id"],),
                    )
                    finish_job(conn, job, "succeeded")
                    audit(
                        conn,
                        "stale_suppressed",
                        str(operation["operation_id"]),
                        version=operation["version"],
                    )
                    conn.commit()
                    return True
                conn.execute(
                    "UPDATE operations SET status='attempting',attempts=attempts+1 WHERE operation_id=%s",
                    (operation["operation_id"],),
                )
                audit(conn, "write_requested", str(operation["operation_id"]))
                conn.commit()  # Persist intent BEFORE any external side effect.
                verified = self.destination.verify(operation)
                audit(
                    conn, "destination_verified", str(operation["operation_id"]), matched=verified
                )
                conn.commit()
                if not verified:
                    hit(FaultPoint.BEFORE_EXTERNAL_WRITE)
                    self.destination.write(operation)
                    hit(FaultPoint.AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION)
                    if not self.destination.verify(operation):
                        raise RuntimeError("destination write did not verify")
                conn.execute(
                    """UPDATE records SET applied_version=%s,applied_fingerprint=%s,
                    pm_id=%s,tombstone_version=CASE WHEN %s='delete' THEN %s ELSE tombstone_version END,
                    updated_at=now() WHERE logical_id=%s""",
                    (
                        operation["version"],
                        operation["fingerprint"],
                        key,
                        operation["action"],
                        operation["version"],
                        key,
                    ),
                )
                conn.execute(
                    "UPDATE operations SET status='succeeded',verification_outcome=%s,destination_reference=%s,error=NULL,completed_at=now() WHERE operation_id=%s",
                    (
                        "already_committed" if verified else "verified_after_write",
                        key,
                        operation["operation_id"],
                    ),
                )
                finish_job(conn, job, "succeeded")
                audit(conn, "write_succeeded", str(operation["operation_id"]))
                if operation["action"] == "delete":
                    audit(
                        conn,
                        "tombstone_created",
                        str(operation["operation_id"]),
                        version=operation["version"],
                    )
                conn.commit()
            except Exception as exc:
                conn.rollback()
                retryable = (
                    not isinstance(exc, httpx.HTTPStatusError)
                    or exc.response.status_code in (408, 429)
                    or exc.response.status_code >= 500
                )
                retry = retryable and job["attempts"] < self.settings.max_attempts
                status = "retrying" if retry else "failed"
                # A stale lease holder must never finalize a reclaimed queue row.
                if finish_job(conn, job, status, str(exc), min(2 ** job["attempts"], 30)):
                    conn.execute(
                        "UPDATE operations SET status=%s,error=%s WHERE operation_id=%s",
                        (status, str(exc), operation["operation_id"]),
                    )
                    audit(
                        conn,
                        "write_retrying" if retry else "write_failed",
                        str(operation["operation_id"]),
                        error=str(exc),
                    )
                conn.commit()
            finally:
                conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))", (key,))
        return True

    def run_forever(self) -> None:
        while True:
            try:
                if not self.run_once():
                    time.sleep(0.5)
            except Exception:
                logger.exception("worker iteration failed; durable lease remains recoverable")
                time.sleep(1)
