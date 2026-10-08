# Local operations and failure experiments

## Walking slice

1. Start Compose. Confirm `init` exited successfully.
2. The ERP seed includes ACME / V001 / INV-1001, job J001, USD 1250.00.
3. The poller derives a create and the worker verifies/writes it into PM.
4. Open System Health, select an operation and inspect its audit timeline.
5. Use ERP `/docs` to update the amount or delete the invoice; another complete poll derives
   full-state work. PM `/invoices` exposes the resulting normalized replica.

## Manual drift

Wait for all operations to settle. Fetch the PM invoice and use
`PATCH /invoices/{logical_id}/direct-edit` with the same identity and a different amount.
Run `POST /reconciliation`; the API records drift and the health page shows its count.
Repair remains an extension point; automatic repair is optional in the specification.

## Highest-priority crash boundary

Stop the normal worker before starting the disposable crash worker:

```sh
docker compose stop worker
docker compose run --rm -e SYNCGUARD_ENABLE_FAULTS=true -e SYNCGUARD_FAULT_POINT=AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION worker
```

Ensure an ERP change has produced pending work. The disposable worker exits abruptly
with code 86 after PM commit. Wait at least the configured lease (10 seconds by default),
then `docker compose start worker`. Inspect the original operation: recovery should find
the committed PM state, audit verification and complete the existing operation.
This is a manual experiment; an automated restart/assertion harness is still required.

Other points: BEFORE_EXTERNAL_WRITE, DURING_SNAPSHOT,
AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT, DURING_RECONCILIATION. Use a disposable poller
or reconciler process for its corresponding point. Never enable hard-exit hooks on the API.

## Durable failure and replay

`GET /operations` exposes failed operations and their error. Once the cause is fixed,
`POST /operations/{operation_id}/replay` creates another delivery of the same logical
operation. Stale replay remains suppressed by version ordering.

## Chaos plan

`python -m syncguard.cli chaos-plan --seed 42` generates a reproducible failure sequence.
`POST /chaos/plans` also records it durably. Neither executes faults. The dashboard explicitly
shows unexecuted invariant results, so a plan cannot be mistaken for a reliability result.
