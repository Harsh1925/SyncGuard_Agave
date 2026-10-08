from uuid import UUID

from fastapi import FastAPI, HTTPException, Query
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, model_validator

from syncguard.config import Settings
from syncguard.domain.models import Action, Invoice
from syncguard.state.database import connect

app = FastAPI(title="Modern PM simulator")


class WriteRequest(BaseModel):
    operation_id: UUID
    version: int = Field(gt=0)
    action: Action
    invoice: Invoice | None = None

    @model_validator(mode="after")
    def validate_action(self):
        if (self.action == Action.UPSERT) != (self.invoice is not None):
            raise ValueError("upsert requires an invoice; delete requires null")
        return self


@app.get("/health")
def health():
    with connect(Settings.from_env().database_url) as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/jobs")
def jobs():
    with connect(Settings.from_env().database_url) as conn:
        return conn.execute("SELECT * FROM pm_sim.jobs ORDER BY id").fetchall()


@app.get("/operations/{operation_id}")
def operation(operation_id: UUID):
    with connect(Settings.from_env().database_url) as conn:
        receipt = conn.execute(
            "SELECT * FROM pm_sim.receipts WHERE operation_id=%s", (operation_id,)
        ).fetchone()
    if receipt is None:
        raise HTTPException(404, "operation not found")
    return receipt


@app.get("/invoices")
def invoices(cursor: UUID | None = None, limit: int = Query(50, ge=1, le=100)):
    with connect(Settings.from_env().database_url) as conn:
        rows = conn.execute(
            "SELECT * FROM pm_sim.invoices WHERE NOT deleted AND (%s::uuid IS NULL OR id>%s) ORDER BY id LIMIT %s",
            (cursor, cursor, limit + 1),
        ).fetchall()
    more = len(rows) > limit
    items = rows[:limit]
    return {"items": items, "next_cursor": str(items[-1]["id"]) if more else None}


@app.get("/invoices/{logical_id}")
def invoice(logical_id: UUID):
    with connect(Settings.from_env().database_url) as conn:
        row = conn.execute(
            "SELECT * FROM pm_sim.invoices WHERE id=%s AND NOT deleted", (logical_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "invoice not found")
    return row


@app.put("/invoices/{logical_id}")
def write(logical_id: UUID, body: WriteRequest):
    if body.invoice and body.invoice.logical_id != str(logical_id):
        raise HTTPException(422, "logical identity does not match invoice business key")
    payload = body.model_dump(mode="json")
    with connect(Settings.from_env().database_url) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,1))", (str(logical_id),))
        existing = conn.execute(
            "SELECT * FROM pm_sim.receipts WHERE operation_id=%s", (body.operation_id,)
        ).fetchone()
        if existing:
            if existing["request"] != payload or existing["logical_id"] != logical_id:
                raise HTTPException(409, "operation ID reused with different desired state")
            return {"id": logical_id, "duplicate": True}
        row = conn.execute(
            "SELECT version FROM pm_sim.invoices WHERE id=%s", (logical_id,)
        ).fetchone()
        if row and body.version <= row["version"]:
            raise HTTPException(409, "stale replica version")
        conn.execute(
            """INSERT INTO pm_sim.invoices(id,version,invoice,deleted,operation_id) VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,invoice=EXCLUDED.invoice,
            deleted=EXCLUDED.deleted,operation_id=EXCLUDED.operation_id,updated_at=now()""",
            (
                logical_id,
                body.version,
                Jsonb(body.invoice.canonical()) if body.invoice else None,
                body.action == Action.DELETE,
                body.operation_id,
            ),
        )
        conn.execute(
            "INSERT INTO pm_sim.receipts(operation_id,logical_id,version,request) VALUES (%s,%s,%s,%s)",
            (body.operation_id, logical_id, body.version, Jsonb(payload)),
        )
    return {"id": logical_id, "duplicate": False}


@app.patch("/invoices/{logical_id}/direct-edit")
def direct_edit(logical_id: UUID, invoice: Invoice):
    if invoice.logical_id != str(logical_id):
        raise HTTPException(422, "business identity cannot be edited")
    with connect(Settings.from_env().database_url) as conn:
        row = conn.execute(
            "UPDATE pm_sim.invoices SET invoice=%s,updated_at=now() WHERE id=%s AND NOT deleted RETURNING id",
            (Jsonb(invoice.canonical()), logical_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "invoice not found")
    return {"id": logical_id, "drift_injected": True}
