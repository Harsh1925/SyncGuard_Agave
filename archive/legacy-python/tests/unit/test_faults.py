import os
import subprocess
import sys

import pytest

from syncguard.chaos.faults import FaultPoint


@pytest.mark.parametrize("point", list(FaultPoint))
def test_named_boundary_abruptly_exits_only_when_enabled(point):
    code = (
        "from syncguard.chaos.faults import FaultPoint, hit; "
        f"hit(FaultPoint({str(point)!r})); print('completed')"
    )
    env = os.environ | {"SYNCGUARD_FAULT_POINT": str(point), "SYNCGUARD_ENABLE_FAULTS": "true"}
    crashed = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True)
    assert crashed.returncode == 86
    assert crashed.stdout == b""
    disabled = subprocess.run(
        [sys.executable, "-c", code],
        env=env | {"SYNCGUARD_ENABLE_FAULTS": "false"},
        capture_output=True,
    )
    assert disabled.returncode == 0
    assert disabled.stdout == b"completed\n"
