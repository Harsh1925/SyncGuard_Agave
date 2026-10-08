import sqlite3

from fastapi import FastAPI, HTTPException

from simulators.erp.database import write_invoice
from syncguard.adapters.erp import ERPAdapter
from syncguard.config import Settings
from syncguard.domain.models import Invoice

app = FastAPI(title="Legacy ERP simulator")


@app.get("/health")
def health():
    with sqlite3.connect(Settings.from_env().erp_path) as conn:
        conn.execute("SELECT count(*) FROM AP_INV").fetchone()
    return {"status": "ok"}


@app.get("/invoices")
def invoices():
    with ERPAdapter(Settings.from_env().erp_path).snapshot() as rows:
        return [item.canonical() for item in rows]


@app.post("/invoices", status_code=201)
def create(invoice: Invoice):
    try:
        write_invoice(Settings.from_env().erp_path, invoice)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "duplicate business invoice or invalid vendor") from exc
    return {"logical_id": invoice.logical_id}


@app.put("/invoices")
def update(invoice: Invoice):
    try:
        write_invoice(Settings.from_env().erp_path, invoice, update=True)
    except KeyError as exc:
        raise HTTPException(404, "invoice not found") from exc
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "invalid vendor") from exc
    return {"logical_id": invoice.logical_id}


@app.delete("/invoices/{company}/{vendor}/{number}")
def delete(company: str, vendor: str, number: str):
    with sqlite3.connect(Settings.from_env().erp_path) as conn:
        conn.execute(
            "DELETE FROM AP_INV WHERE CO_CD=? AND VND_NO=? AND INV_NO=?", (company, vendor, number)
        )
    return {"deleted": True}
