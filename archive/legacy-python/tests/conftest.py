import os

import pytest

from syncguard.domain.models import Invoice
from syncguard.state.database import connect, migrate


@pytest.fixture
def invoice():
    return Invoice(
        company_id="ACME",
        vendor_id="V001",
        invoice_number="INV-1001",
        job_id="J001",
        amount="1250.00",
        currency="USD",
        issued_on="2026-01-15",
    )


@pytest.fixture
def postgres_dsn():
    dsn = os.getenv("SYNCGUARD_TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("Set SYNCGUARD_TEST_DATABASE_URL to a disposable Postgres database")
    migrate(dsn)
    with connect(dsn) as conn:
        conn.execute(
            "TRUNCATE audit_events,jobs,operations,snapshot_members,snapshots,records,drift_reports,chaos_runs,pm_sim.receipts,pm_sim.invoices CASCADE"
        )
    return dsn
