from fastapi.testclient import TestClient

from syncguard.api.app import app
from syncguard.chaos.invariants import pending_results
from syncguard.chaos.planner import plan
from syncguard.domain.models import Job, Vendor
from syncguard.engine.echo import is_known_write
from syncguard.ingress.validation import validate_invoice


def test_seed_reproduces_failure_sequence():
    assert plan(42) == plan(42)
    assert plan(42) != plan(43)


def test_unexecuted_invariants_are_not_passes():
    assert len(pending_results()) == 5
    assert all(item.passed is None for item in pending_results())


def test_validation_refuses_unknown_refs_and_duplicates(invoice):
    assert validate_invoice(invoice, [], [], {invoice.logical_id}) == [
        "unknown_vendor",
        "unknown_or_inactive_job",
        "duplicate_invoice_business_key",
    ]
    assert (
        validate_invoice(
            invoice,
            [Vendor(id="V001", company_id="ACME", name="Harbor Concrete")],
            [Job(id="J001", name="Harbor renovation")],
            set(),
        )
        == []
    )


def test_known_write_requires_exact_fingerprint(invoice):
    assert is_known_write(invoice.fingerprint, invoice.fingerprint)
    assert not is_known_write(invoice.fingerprint, "different")


def test_ingress_fails_closed():
    with TestClient(app) as client:
        assert client.post("/ingress/invoices").status_code == 501


def test_operation_id_is_validated_before_database_access():
    with TestClient(app) as client:
        assert client.get("/operations/not-a-uuid").status_code == 422
