from dataclasses import dataclass

from syncguard.domain.models import Action, Invoice


@dataclass(frozen=True)
class Change:
    logical_id: str
    action: Action
    desired: dict | None
    fingerprint: str | None


def derive_changes(previous: dict[str, dict], current: list[Invoice]) -> list[Change]:
    """Caller must establish COMPLETE status before supplying either snapshot."""
    seen = {invoice.logical_id: invoice for invoice in current}
    changes = [
        Change(key, Action.UPSERT, invoice.canonical(), invoice.fingerprint)
        for key, invoice in seen.items()
        if key not in previous or previous[key]["fingerprint"] != invoice.fingerprint
    ]
    changes.extend(Change(key, Action.DELETE, None, None) for key in previous.keys() - seen.keys())
    return sorted(changes, key=lambda change: change.logical_id)
