# TypeScript local operations

Start Compose and inspect `init`, `worker` and `poller` logs. The first seed creates ACME /
V001 / INV-1001 for USD 1250.00, job J001. Subsequent bootstraps preserve deliberate edits
and deletes using an initialization marker.

## Walking slice

Create/update an invoice through ERP `/invoices`. Run `npm run poll` or leave the poller
running. The worker verifies/writes PM state, then the React health page exposes the ledger
operation. Select it to inspect versions, attempts, verification and audit events.

## Drift

Wait for operations to settle. Read PM state and call
`PATCH /invoices/:id/direct-edit` with the same identity and changed amount. Call operational
`POST /reconciliation` or `npm run reconcile`. The health page shows unresolved drift.
Automatic repair is an optional, deferred feature.

## Crash after external commit

Stop the normal worker and start a disposable worker with pending work:

```sh
docker compose stop worker
docker compose run --rm -e ENABLE_FAULTS=true -e FAULT_POINT=AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION worker
```

The fault process exits with code 86 after PM commit. Wait at least the lease (10 seconds by
default), then `docker compose start worker`. The original operation should verify the
already committed destination rather than write a duplicate. This manual procedure still
needs an automated cross-process assertion harness.

Other points: BEFORE_EXTERNAL_WRITE, DURING_SNAPSHOT,
AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT and DURING_RECONCILIATION. Use the corresponding
disposable worker/poller/reconciler command. The operational API refuses ENABLE_FAULTS=true.

## Retry/replay

Transient errors receive bounded exponential backoff. Failed work remains in Postgres.
After fixing the cause, `POST /operations/:id/replay` queues another delivery of the same
logical operation; stale work remains suppressed.

## Redis outage

Accepted work stays in Postgres. Connected processes fall back to polling/uncached metrics;
PM's optional rate simulator degrades open. Restart processes after Redis recovery to
reconnect in this starter. Deleting Redis data cannot delete operations or tombstones.

## Chaos planning

`npm run cli -w @syncguard/backend -- chaos-plan 42` creates a reproducible sequence.
`POST /chaos/plans` records one durably. Neither executes faults or marks invariants passed.
The TypeScript PRNG differs from the earlier Python implementation; use TypeScript seeds
for current runs. Historical Python code is available in Git history.
