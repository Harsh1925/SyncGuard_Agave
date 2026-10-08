import sqlite3
from pathlib import Path

from syncguard.domain.models import Invoice

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS AP_VND (
 CO_CD TEXT NOT NULL, VND_NO TEXT NOT NULL, NM TEXT NOT NULL,
 PRIMARY KEY(CO_CD,VND_NO)
);
CREATE TABLE IF NOT EXISTS AP_INV (
 CO_CD TEXT NOT NULL, VND_NO TEXT NOT NULL, INV_NO TEXT NOT NULL,
 JB_NO TEXT NOT NULL, GROSS_AMT TEXT NOT NULL, CCY TEXT NOT NULL,
 INV_DT TEXT NOT NULL, ST_CD TEXT NOT NULL CHECK(ST_CD IN ('O','P','V')),
 PRIMARY KEY(CO_CD,VND_NO,INV_NO),
 FOREIGN KEY(CO_CD,VND_NO) REFERENCES AP_VND(CO_CD,VND_NO)
);
"""


def initialize(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)


def write_invoice(path: str, invoice: Invoice, update: bool = False) -> None:
    values = invoice.canonical()
    status = {"open": "O", "paid": "P", "void": "V"}[values["status"]]
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        if update:
            cursor = conn.execute(
                "UPDATE AP_INV SET JB_NO=?,GROSS_AMT=?,CCY=?,INV_DT=?,ST_CD=? WHERE CO_CD=? AND VND_NO=? AND INV_NO=?",
                (
                    values["job_id"],
                    values["amount"],
                    values["currency"],
                    values["issued_on"],
                    status,
                    values["company_id"],
                    values["vendor_id"],
                    values["invoice_number"],
                ),
            )
            if cursor.rowcount == 0:
                raise KeyError("invoice not found")
        else:
            conn.execute(
                "INSERT INTO AP_INV VALUES (?,?,?,?,?,?,?,?)",
                (
                    values["company_id"],
                    values["vendor_id"],
                    values["invoice_number"],
                    values["job_id"],
                    values["amount"],
                    values["currency"],
                    values["issued_on"],
                    status,
                ),
            )


def seed(path: str) -> None:
    initialize(path)
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT OR IGNORE INTO AP_VND VALUES ('ACME','V001','Harbor Concrete')")
    invoice = Invoice(
        company_id="ACME",
        vendor_id="V001",
        invoice_number="INV-1001",
        job_id="J001",
        amount="1250.00",
        currency="USD",
        issued_on="2026-01-15",
    )
    try:
        write_invoice(path, invoice)
    except sqlite3.IntegrityError:
        pass  # Seed reruns preserve existing demo edits.
