# Important code explained

## End-to-end flow

1. An invoice is created or edited in the legacy ERP simulator.
2. `ERPAdapter.snapshot()` reads a consistent view of the source.
3. `SnapshotDetector.run()` compares it against the last COMPLETE snapshot.
4. One transaction records COMPLETE membership, the new observation version, a stable
   operation, its full desired state and a durable queue job.
5. An optional Redis hint wakes an idle worker.
6. `SyncWorker.runOnce()` claims work, fences the logical record, rejects stale work and
   persists write intent.
7. `PMAdapter.verify()` checks whether the external effect already exists. If not, the
   worker writes, verifies, then records local success and applied state.
8. The React health/timeline pages expose operations and audit evidence through the API.

## Shared contracts: packages/contracts/src/index.ts

`invoiceSchema` is the runtime trust boundary for normalized financial data. TypeScript
types alone disappear at runtime; Zod checks actual request payloads and adapter results.
The schema rejects extra fields, trims required IDs, validates calendar dates, limits
currency to three uppercase letters and requires bounded decimal-string amounts.

The exported `Invoice`, `Operation`, `Metrics`, `AuditEvent` and `ChaosPlan` types are
consumed by both applications. They avoid separately maintained frontend/backend shapes.
The browser still treats server responses as typed contracts; deeper runtime response
validation is a future hardening step, not a claim made by the current generic fetch helper.

## Domain: apps/backend/src/domain/invoice.ts

`normalizeInvoice()` converts equivalent amounts to two-decimal strings with Decimal.js.
`fingerprint()` hashes normalized JSON with sorted keys so object insertion ordering
cannot invent a change. `logicalId()` derives a UUID from company/vendor/invoice-number,
using structured encoding to avoid delimiter collisions.

`operationId()` derives a stable identity from logical record, destination, version and
action. Repeated delivery of one version resolves the same ledger operation.
`isStale()` compares the incoming version against applied and tombstone versions using
BigInt. Delete version 44 therefore blocks an old update version 43.

`deriveChanges()` returns a full desired invoice for create/update and null for deletion.
The engine does not depend on applying a series of field diffs in arrival order.

## Database boundaries: state/database.ts and migrations/

`transaction()` checks out one pg client for BEGIN, all queries, COMMIT/ROLLBACK and release.
`inTransaction()` uses an already checked-out client, allowing a worker's session record
lock to span multiple durable transactions around external HTTP.

`migrate()` acquires a migration advisory lock and applies each SQL file once using
`schema_migrations`. The SQL tables separate observed state from applied state and retain
the financial operation ledger, snapshots, queue leases, audit, drift and chaos evidence.
The ERP simulator has a database-level company/vendor/invoice-number primary key; PM
has a separate operation receipt primary key. These protect different identities.

Postgres bigint values are not globally converted to JS Number. RDS TLS uses a supplied
CA bundle with certificate verification enabled. The local database connection stays local.

## Durable queue: state/repository.ts

`enqueueChange()` advances the Postgres observation sequence, updates observed state,
inserts the stable operation and queues its delivery. The caller owns the transaction,
so detection and accepted work cannot commit separately.

`claim()` performs an atomic CTE + UPDATE with `FOR UPDATE SKIP LOCKED`. Workers can own
different jobs without waiting on every claimed row. An expired lease becomes reclaimable.
The claim token changes on each claim; `finishJob()` updates only the matching token, so
an old owner cannot finalize a newly reclaimed queue row.

Sequence gaps after rollback are fine. The requirement is monotonic ordering, not contiguous
version numbers. Operation uniqueness and ERP business uniqueness are distinct backstops.

## Safe observation: engine/detector.ts

The detector first commits IN_PROGRESS, then reads the ERP. Only a fully successful read
can enter the transaction that writes membership, COMPLETE, changes, operations and jobs.
A failure records FAILED and leaves the previous COMPLETE baseline intact.

The poller's session advisory lock serializes source observation with other pollers and
reconciliation. Retention removes older complete snapshots, preserving five recent ones
and explicitly retained snapshots. Redis notification occurs only after Postgres commit.
An abandoned IN_PROGRESS snapshot is never used to derive deletes.

## Recovery: engine/worker.ts and adapters/pm.ts

Queue-row ownership alone is insufficient: different deliveries may reference the same
operation or logical record. The worker additionally acquires a per-record session lock.
Connections used for session locks are explicitly closed on release, preventing a leaked
session lock from contaminating a reusable pooled connection.

Already completed operations are acknowledged without another write. Old versions are
suppressed, including work superseded by a newer observation. Before a side effect, the
ledger commits attempting status and the write-requested audit event.

`verify()` looks up the operation receipt and checks normalized current destination state.
A lost response or process death after PM commit therefore leads to verification on the
next delivery. It does not blindly repeat a financial create. PM persists its receipt and
invoice/delete fence atomically, and rejects conflicting operation reuse or stale versions.

Success commits applied state, tombstone where relevant, ledger success and job completion.
Transient errors receive bounded exponential backoff; permanent 4xx errors or exhausted
attempts remain visible as failed. Replay creates another delivery of the same operation.
Long writes may need heartbeat support beyond this short-lease starter.

## Reconciliation: engine/reconciler.ts

Reconciliation independently compares ERP authority and PM state. It takes the poller's
source fence, then checks the worker's record fence and active ledger operations.
Actively converging records are deferred.

For stable records, it re-reads PM after obtaining the record fence. This prevents using
an initial list value that a worker already changed before classification. Real differences
are persisted as open drift reports; matching records resolve previous reports. Arbitrary
manual external edits can still race reads and need further acceptance coverage.

## Redis: state/redis.ts

One helper owns cache reads/writes, queue wake hints and atomic rate counters. Offline
command queueing is disabled; connection retries use a capped three-second delay. Optional Redis failures never
remove accepted Postgres work. The Lua rate script makes increment plus first-use expiry
atomic. The Redis list is bounded to 100 hints and carries no authoritative invoice state.

## React: dashboard pages and useResource.ts

`App.tsx` owns the two routes. `Health.tsx` loads metrics and recent operations in parallel.
Selecting a row opens the operation URL; `Operations.tsx` loads the ledger and audit timeline
in parallel, validates an entered UUID and embeds the executable Failure Lab.

`useResource()` centralizes loading/error/retry behavior. Its effect aborts on cleanup and
ignores results from obsolete requests. This matters when navigating quickly between
operation IDs: a slower old response must not overwrite the new operation. Native semantic
links, forms, buttons and shared live-region feedback preserve accessible interaction.

The UI distinguishes planned chaos from executed proof. Rendering a null invariant as
pass would be a product correctness bug; the contract makes that state explicit.

## AWS: infra/cdk/lib/stack.ts and bootstrap.sh

The CDK stack defines EC2 instead of ECS. It connects only compute's security group to
private RDS and grants the instance narrowly scoped access to its secret and source asset.
No static AWS keys are stored in the repository; SSM handles administration without SSH.

User data downloads the packaged source, reads the generated secret, downloads RDS CA
certificates, writes environment configuration and installs a systemd unit. That unit
starts `compose.aws.yaml`, which has no local Postgres container and keeps Redis/backend
ports private. The only ingress is the nginx dashboard/API proxy from the configured CIDR.

Synthesis and resource assertions prove template structure, not a successful EC2 boot.
Actual AWS deployment and recovery must still be exercised separately.

## Executed portfolio demo

`compose.demo.yaml` runs a separate Postgres database, PM/ERP simulators, API and dashboard.
`scripts/demo.ts` starts that environment and invokes the backend demo command. It passes
arguments directly to Docker without a shell and fails if startup or a scenario fails.

`apps/backend/src/demo/runner.ts` drives the real detector, Postgres queue, worker and HTTP
PM adapter. It uses a database advisory lock to prevent overlapping demo runs. Each run
creates a fresh invoice, so rerunning never truncates the database. A dedicated database
name check blocks accidentally running the suite against the normal application database.

The crash scenario spawns `worker-once` in a child process with the existing named fault
hook. It asserts exit 86, confirms that PM committed while local status is still attempting,
waits for lease expiry, then asserts `already_committed` recovery and one receipt. The
other assertions cover ten deliveries, two worker instances, failed snapshot acceptance,
in-flight drift deferral, manual edit detection, authoritative reconvergence and stale
update rejection after deletion. External HTTP operations are outside ledger transactions.

Runs and evidence use the existing `chaos_runs` table with `configuration.kind=scripted-demo`.
`GET /demo/runs` exposes the latest 20 records; `GET /drift` exposes the latest 100 drift
reports. These are bounded read-only views, not unrestricted history pagination. Completion
means the recorded assertions passed; it does not mean the full randomized chaos specification
or production reliability has been proven. See `acceptance-matrix.md` for tested scenarios.

## Required-feature completion

`chaos/runner.ts` reads persisted seeded plans, starts real worker processes, configures
simulator faults and asserts final state. Critical hooks always run independently of the
random seed. Fault settings are consumed atomically in Postgres and reset when a run ends.
The PM dropped-response hook runs only after its receipt and invoice commit. Run creation
returns 202; the dashboard monitors durable status rather than keeping an HTTP request open.

`ingress/service.ts` records operation identity before extraction/writing, freezes the first
normalized proposal, serializes business-identity writes and validates vendor/job references.
The simulated ERP and ingress acceptance share one transaction; rollback prevents uncertain
partial acceptance. ERP never needs an operation-ID column. Reusing an operation ID with
changed input is refused; a same-input retry returns the previous result. Accepted own writes
are correlated by fingerprint in the next source observation, without suppressing normal
ERP→PM propagation. The optional extractor uses structured output via the documented
[OpenAI Responses API](https://developers.openai.com/api/docs/guides/structured-outputs);
all extracted values remain untrusted until domain validation.

Worker leases are renewed while a record fence protects external effects. Redis outage
falls back to Postgres/uncached reads and reconnects automatically. A subsequent poll marks
abandoned IN_PROGRESS snapshots FAILED while holding the exclusive poller lock.

`components/FailureLab.tsx` reuses shared resource/action hooks. Reads and requests abort on
navigation, feedback stays beside the action, and running/failed/unexecuted evidence is
shown explicitly. Fault execution is enabled only when DEMO_CONTROLS=true and the database
is syncguard_demo. Normal/EC2 environments cannot activate simulator faults through the UI.
