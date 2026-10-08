from dataclasses import asdict
from uuid import UUID, uuid4

import httpx
import psycopg
from fastapi import FastAPI, HTTPException, Query
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from syncguard.adapters.erp import ERPAdapter
from syncguard.adapters.pm import PMAdapter
from syncguard.chaos.invariants import pending_results
from syncguard.chaos.planner import plan
from syncguard.config import Settings
from syncguard.engine.detector import SnapshotDetector
from syncguard.engine.reconciler import Reconciler
from syncguard.state.database import connect
from syncguard.state.repository import audit

app = FastAPI(
    title="SyncGuard", version="0.1.0", description="Specification scaffold; local demo API"
)


@app.exception_handler(psycopg.OperationalError)
def database_unavailable(request, exc):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=503, content={"detail": "State database unavailable"})


@app.get("/health")
def health():
    settings = Settings.from_env()
    with connect(settings.database_url) as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/metrics")
def metrics():
    settings = Settings.from_env()
    with connect(settings.database_url) as conn:
        counts = conn.execute(
            "SELECT status,count(*) AS count FROM jobs GROUP BY status"
        ).fetchall()
        snapshot = conn.execute(
            "SELECT completed_at FROM snapshots WHERE status='COMPLETE' ORDER BY completed_at DESC LIMIT 1"
        ).fetchone()
        sync = conn.execute(
            "SELECT max(completed_at) AS completed_at FROM operations WHERE status='succeeded'"
        ).fetchone()
        drift = conn.execute(
            "SELECT count(*) AS count FROM drift_reports WHERE resolved_at IS NULL"
        ).fetchone()
        lag = conn.execute(
            "SELECT EXTRACT(epoch FROM now()-min(created_at)) AS seconds FROM jobs WHERE status IN ('pending','claimed','retrying')"
        ).fetchone()
    try:
        with ERPAdapter(settings.erp_path).snapshot() as records:
            list(records)
        erp_health = "ok"
    except Exception:
        erp_health = "unavailable"
    try:
        response = httpx.get(f"{settings.pm_url}/health", timeout=2)
        pm_health = "ok" if response.is_success else "unavailable"
    except httpx.HTTPError:
        pm_health = "unavailable"
    return {
        "jobs": {item["status"]: item["count"] for item in counts},
        "last_complete_snapshot": snapshot["completed_at"] if snapshot else None,
        "last_successful_sync": sync["completed_at"],
        "drift_count": drift["count"],
        "sync_lag_seconds": lag["seconds"] or 0,
        "erp": erp_health,
        "pm": pm_health,
    }


@app.get("/operations")
def operations(limit: int = Query(25, ge=1, le=100)):
    # Starter exposes bounded recent history; full history paging is a documented extension.
    with connect(Settings.from_env().database_url) as conn:
        return conn.execute(
            "SELECT * FROM operations ORDER BY created_at DESC,operation_id DESC LIMIT %s", (limit,)
        ).fetchall()


@app.get("/operations/{operation_id}")
def operation(operation_id: UUID):
    with connect(Settings.from_env().database_url) as conn:
        row = conn.execute(
            "SELECT * FROM operations WHERE operation_id=%s", (operation_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "operation not found")
    return row


@app.get("/operations/{operation_id}/timeline")
def timeline(
    operation_id: UUID, after: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200)
):
    with connect(Settings.from_env().database_url) as conn:
        return conn.execute(
            "SELECT * FROM audit_events WHERE operation_id=%s AND id>%s ORDER BY id LIMIT %s",
            (operation_id, after, limit),
        ).fetchall()


@app.post("/operations/{operation_id}/replay", status_code=202)
def replay(operation_id: UUID):
    with connect(Settings.from_env().database_url) as conn:
        row = conn.execute(
            "SELECT * FROM operations WHERE operation_id=%s FOR UPDATE", (operation_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "operation not found")
        if row["status"] != "failed":
            raise HTTPException(409, "only terminal failures can be replayed")
        conn.execute(
            "UPDATE operations SET status='pending',error=NULL WHERE operation_id=%s",
            (operation_id,),
        )
        conn.execute("INSERT INTO jobs(operation_id) VALUES (%s)", (operation_id,))
        audit(conn, "job_replayed", str(operation_id))
    return {"operation_id": operation_id, "status": "pending"}


@app.post("/snapshots", status_code=201)
def snapshot():
    settings = Settings.from_env()
    return SnapshotDetector(settings.database_url, ERPAdapter(settings.erp_path)).run()


@app.post("/reconciliation")
def reconcile():
    settings = Settings.from_env()
    return Reconciler(
        settings.database_url, ERPAdapter(settings.erp_path), PMAdapter(settings.pm_url)
    ).run()


class ChaosPlanRequest(BaseModel):
    seed: int = Field(ge=0, le=2**63 - 1)
    steps: int = Field(default=20, ge=1, le=1000)


@app.post("/chaos/plans", status_code=201)
def chaos_plan(body: ChaosPlanRequest):
    run_id = uuid4()
    sequence = plan(body.seed, body.steps)
    results = [asdict(item) for item in pending_results()]
    with connect(Settings.from_env().database_url) as conn:
        conn.execute(
            "INSERT INTO chaos_runs(id,seed,configuration,failure_sequence,invariant_results) VALUES (%s,%s,%s,%s,%s)",
            (run_id, body.seed, Jsonb(body.model_dump()), Jsonb(sequence), Jsonb(results)),
        )
    return {
        "id": run_id,
        "status": "planned",
        "seed": body.seed,
        "sequence": sequence,
        "invariants": results,
    }


@app.post("/ingress/invoices")
def ingress():
    # Fail closed until the ERP uncertain-write/business-key verification path is implemented.
    raise HTTPException(501, "AI invoice ingress is not enabled in the scaffold")
