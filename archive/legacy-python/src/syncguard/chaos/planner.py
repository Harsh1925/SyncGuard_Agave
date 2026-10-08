import random

FAULTS = (
    "lost_response",
    "transient_failure",
    "duplicate_delivery",
    "concurrent_delivery",
    "out_of_order",
    "crash_after_commit",
    "incomplete_snapshot",
    "rate_limit",
)


def plan(seed: int, steps: int = 20) -> list[dict]:
    if not 1 <= steps <= 1000:
        raise ValueError("steps must be between 1 and 1000")
    rng = random.Random(seed)
    return [{"step": step, "fault": rng.choice(FAULTS)} for step in range(steps)]
