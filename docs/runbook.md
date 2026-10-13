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
PM's optional rate simulator degrades open. Connections retry with a capped delay after
Redis recovery. Deleting Redis data cannot delete operations or tombstones.

## Chaos planning

`npm run cli -w @syncguard/backend -- chaos-plan 42` creates a reproducible sequence.
`POST /chaos/plans` records one durably. Neither executes faults or marks invariants passed.
The TypeScript PRNG differs from the earlier Python implementation; use TypeScript seeds
for current runs. Historical Python code is available in Git history.

## Executed chaos and controlled faults

Start `npm run demo -- 42`, then use Failure Lab or `npm run chaos -- 42 20`. Only the isolated
DEMO_CONTROLS environment permits execution. Each run records seed, configuration, planned
fault sequence, actual evidence, counts and final invariant checks. Failed runs retain
partial evidence; inspect the run's error before retrying with a fresh run ID.

`POST /simulator/faults` accepts target erp/pm, kind, remaining, delay_ms and fail_after.
ERP supports latency, transient_failure and partial_read; PM supports latency, lost_response,
transient_failure and rate_limit. Counts/delays are bounded. Fault settings affect simulator
reads/writes only, never the operational API's process. `kind=none, remaining=0` clears a target.

Invoice ingress uses an operation_id, document and mode (synthetic/llm). Reuse the same
operation ID/document after uncertain transport outcomes; choose a new ID for changed input.
GET /ingress/operations exposes durable pending/accepted/refused records. An unavailable PM
reference lookup leaves the proposal pending for explicit retry. Accepted invoices propagate
through the next normal snapshot and worker delivery. The isolated UI has manual snapshot
and worker-step buttons; the normal Compose stack uses its background processes.

## Repeatable verification

```sh
npm run test:integration
npm run demo -- 42
npm run chaos -- 42 20
npm run test:e2e
```

Test services use disposable ports 55432 and 56379 and are removed afterwards. Demo ports
8100/8101/8102/8180 remain separate from normal application ports. The browser test uses
installed system Chrome on macOS, or Playwright Chromium elsewhere. It creates synthetic
invoices and recorded runs in the isolated database; it does not truncate application data.
