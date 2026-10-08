import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from syncguard.domain.models import Invoice, InvoiceStatus, Vendor

STATUS = {"O": InvoiceStatus.OPEN, "P": InvoiceStatus.PAID, "V": InvoiceStatus.VOID}


def normalize_invoice(row: dict) -> Invoice:
    return Invoice(
        company_id=row["CO_CD"],
        vendor_id=row["VND_NO"],
        invoice_number=row["INV_NO"],
        job_id=row["JB_NO"],
        amount=row["GROSS_AMT"],
        currency=row["CCY"],
        issued_on=row["INV_DT"],
        status=STATUS[row["ST_CD"]],
    )


class ERPAdapter:
    def __init__(self, path: str):
        self.path = path

    @contextmanager
    def snapshot(self) -> Iterator[Iterator[Invoice]]:
        # One SQLite read transaction: all rows share the same consistent database view.
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("BEGIN")
            rows = conn.execute("SELECT * FROM AP_INV ORDER BY CO_CD, VND_NO, INV_NO")
            yield (normalize_invoice(dict(row)) for row in rows)
        finally:
            conn.rollback()
            conn.close()

    def vendors(self) -> list[Vendor]:
        with sqlite3.connect(self.path) as conn:
            rows = conn.execute("SELECT CO_CD, VND_NO, NM FROM AP_VND").fetchall()
        return [Vendor(company_id=company, id=vendor, name=name) for company, vendor, name in rows]
