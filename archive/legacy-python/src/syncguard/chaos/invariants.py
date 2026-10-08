from dataclasses import dataclass


@dataclass(frozen=True)
class InvariantResult:
    name: str
    passed: bool | None
    evidence: str


def pending_results() -> list[InvariantResult]:
    """Unexecuted proof must never be presented as a passing chaos run."""
    return [
        InvariantResult(name, None, "Not executed; implement scenario runner and collect evidence")
        for name in (
            "idempotent_financial_effect",
            "no_silent_loss",
            "monotonic_record_state",
            "safe_observation",
            "observable_convergence",
        )
    ]
