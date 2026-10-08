# Acceptance scenario ownership

The finalized matrix is tracked in `docs/acceptance-matrix.md`. This directory is reserved
for process/container tests (including hard worker termination); those must use real
Postgres and running simulators. Unit tests cannot certify a cross-process crash window.

Next executable scenario: launch a worker with
`AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION`, wait for exit code 86, disable the hook,
wait for its lease, restart, and assert one PM record and a succeeded original ledger entry.
Do not add always-passing placeholders or silently skipped acceptance cases.
