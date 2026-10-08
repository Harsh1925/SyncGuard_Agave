from uuid import uuid4

from psycopg.types.json import Jsonb

from syncguard.domain.models import operation_id


def audit(conn, event: str, operation: str | None = None, **detail) -> None:
    conn.execute(
        "INSERT INTO audit_events(operation_id,event,detail) VALUES (%s,%s,%s)",
        (operation, event, Jsonb(detail)),
    )


def enqueue_change(conn, change) -> str:
    version = conn.execute("SELECT nextval('observation_version') AS version").fetchone()["version"]
    key = change.logical_id
    if change.desired is not None:
        identity = {
            name: change.desired[name] for name in ("company_id", "vendor_id", "invoice_number")
        }
        conn.execute(
            """INSERT INTO records(logical_id,erp_identity,business_key,observed_version,
                 observed_fingerprint,observed_state) VALUES (%s,%s,%s,%s,%s,%s)
               ON CONFLICT(logical_id) DO UPDATE SET observed_version=EXCLUDED.observed_version,
                 observed_fingerprint=EXCLUDED.observed_fingerprint,
                 observed_state=EXCLUDED.observed_state,updated_at=now()""",
            (
                key,
                Jsonb(identity),
                Jsonb(identity),
                version,
                change.fingerprint,
                Jsonb(change.desired),
            ),
        )
    else:
        conn.execute(
            "UPDATE records SET observed_version=%s,observed_state=NULL,observed_fingerprint=NULL,updated_at=now() WHERE logical_id=%s",
            (version, key),
        )
    op = operation_id(key, version, change.action)
    conn.execute(
        "INSERT INTO operations(operation_id,logical_id,version,action,desired,fingerprint) VALUES (%s,%s,%s,%s,%s,%s)",
        (
            op,
            key,
            version,
            change.action,
            Jsonb(change.desired) if change.desired else None,
            change.fingerprint,
        ),
    )
    conn.execute("INSERT INTO jobs(operation_id) VALUES (%s)", (op,))
    audit(conn, "change_detected", op, action=change.action, version=version)
    audit(conn, "job_queued", op)
    return op


def claim(conn, worker: str, lease_seconds: int) -> dict | None:
    token = uuid4()
    row = conn.execute(
        """WITH candidate AS (
             SELECT id,status FROM jobs WHERE
               (status IN ('pending','retrying') AND available_at <= now()) OR
               (status='claimed' AND lease_until < now())
             ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1
           ) UPDATE jobs j SET status='claimed',claimed_by=%s,claim_token=%s,
             lease_until=now() + %s * interval '1 second',attempts=attempts+1
             FROM candidate c WHERE j.id=c.id RETURNING j.*, c.status AS previous_status""",
        (worker, token, lease_seconds),
    ).fetchone()
    if row:
        audit(
            conn,
            "job_reclaimed" if row["previous_status"] == "claimed" else "job_claimed",
            str(row["operation_id"]),
            worker=worker,
            job_id=row["id"],
        )
    return row


def finish_job(conn, job: dict, status: str, error: str | None = None, delay: int = 0) -> bool:
    row = conn.execute(
        """UPDATE jobs SET status=%s,error=%s,lease_until=NULL,claimed_by=NULL,claim_token=NULL,
           available_at=now() + %s * interval '1 second'
           WHERE id=%s AND claim_token=%s RETURNING id""",
        (status, error, delay, job["id"], job["claim_token"]),
    ).fetchone()
    return row is not None
