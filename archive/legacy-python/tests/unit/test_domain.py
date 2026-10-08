from decimal import Decimal

import pytest
from pydantic import ValidationError

from syncguard.domain.changes import derive_changes
from syncguard.domain.models import Action, Invoice, is_stale, operation_id


def test_money_encoding_does_not_create_false_change(invoice):
    same = invoice.model_copy(update={"amount": Decimal("1250.0")})
    assert same.fingerprint == invoice.fingerprint


def test_composite_key_encoding_has_no_delimiter_collision(invoice):
    first = invoice.model_copy(update={"company_id": "A:B", "vendor_id": "C"})
    second = invoice.model_copy(update={"company_id": "A", "vendor_id": "B:C"})
    assert first.logical_id != second.logical_id


@pytest.mark.parametrize("amount", ["-1", "0.001", "NaN", "Infinity"])
def test_invalid_money_is_refused(invoice, amount):
    with pytest.raises(ValidationError):
        Invoice.model_validate(invoice.canonical() | {"amount": amount})


def test_stable_operation_identity_and_distinct_versions(invoice):
    assert operation_id(invoice.logical_id, 1, Action.UPSERT) == operation_id(
        invoice.logical_id, 1, Action.UPSERT
    )
    assert operation_id(invoice.logical_id, 1, Action.UPSERT) != operation_id(
        invoice.logical_id, 2, Action.UPSERT
    )


@pytest.mark.parametrize(
    "version,applied,tombstone,expected",
    [(43, 43, None, True), (41, 43, None, True), (43, 44, 44, True), (45, 44, 44, False)],
)
def test_stale_ordering_includes_tombstone(version, applied, tombstone, expected):
    assert is_stale(version, applied, tombstone) is expected


def test_full_state_create_update_delete(invoice):
    assert derive_changes({}, [invoice])[0].desired == invoice.canonical()
    previous = {invoice.logical_id: {"fingerprint": invoice.fingerprint}}
    assert derive_changes(previous, [invoice]) == []
    changed = invoice.model_copy(update={"amount": Decimal("1400.00")})
    assert derive_changes(previous, [changed])[0].desired == changed.canonical()
    assert derive_changes(previous, [])[0].action == Action.DELETE
