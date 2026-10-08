import sqlite3

import pytest

from simulators.erp.database import seed, write_invoice
from syncguard.adapters.erp import ERPAdapter
from syncguard.adapters.pm import normalize_invoice


def test_erp_pm_equivalent_normalization(tmp_path):
    path = str(tmp_path / "erp.sqlite")
    seed(path)
    with ERPAdapter(path).snapshot() as rows:
        invoice = list(rows)[0]
    assert normalize_invoice({"invoice": invoice.canonical()}).fingerprint == invoice.fingerprint
    assert ERPAdapter(path).vendors()[0].name == "Harbor Concrete"


def test_erp_business_uniqueness(tmp_path, invoice):
    path = str(tmp_path / "erp.sqlite")
    seed(path)
    with pytest.raises(sqlite3.IntegrityError):
        write_invoice(path, invoice)


def test_consistent_snapshot_excludes_later_write(tmp_path, invoice):
    path = str(tmp_path / "erp.sqlite")
    seed(path)
    later = invoice.model_copy(update={"invoice_number": "INV-1002"})
    with ERPAdapter(path).snapshot() as rows:
        first = next(rows)
        write_invoice(path, later)
        assert list(rows) == []
    assert first.invoice_number == "INV-1001"
    with ERPAdapter(path).snapshot() as rows:
        assert len(list(rows)) == 2
