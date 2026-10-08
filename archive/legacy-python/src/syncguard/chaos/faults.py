import os
from enum import StrEnum


class FaultPoint(StrEnum):
    BEFORE_EXTERNAL_WRITE = "BEFORE_EXTERNAL_WRITE"
    AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION = "AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION"
    DURING_SNAPSHOT = "DURING_SNAPSHOT"
    AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT = "AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT"
    DURING_RECONCILIATION = "DURING_RECONCILIATION"


def hit(point: FaultPoint) -> None:
    if (
        os.getenv("SYNCGUARD_ENABLE_FAULTS", "false").lower() == "true"
        and os.getenv("SYNCGUARD_FAULT_POINT") == point
    ):
        # Deliberately bypasses finally/transaction cleanup. Never activate in the API.
        os._exit(86)
