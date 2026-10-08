# Active TypeScript scaffold status

| Component         | Implemented foundation                                                                                          | Remaining proof / extension                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Shared model      | Zod Invoice/Vendor/Job types, decimal strings, hashes, stable composite UUIDs, BigInt versions                  | More native vocabulary fixtures                                                         |
| ERP               | Postgres schema, cryptic columns, business uniqueness, consistent reads, CRUD and safe seed marker              | Controlled partial-read/latency API and legacy source import tooling                    |
| PM                | REST API, cursor reads, durable receipts, version/delete fences, direct edits, Redis rate windows               | Response-loss/timeout injection endpoints                                               |
| State store       | Versioned SQL migrations, records, operations, snapshots, membership, jobs, audit, drift, chaos                 | Operational migration rollback policy                                                   |
| Queue/worker      | SKIP LOCKED, claim token, lease recovery, record fence, verification, bounded retry, visible failure and replay | Live concurrent worker and hard-crash restart acceptance harness; long-write heartbeats |
| Snapshot detector | Atomic COMPLETE derivation, five-snapshot retention, serialized pollers                                         | Abandoned snapshot cleanup and process-crash evidence                                   |
| Reconciler        | Active-operation deferral, record-fenced PM reread, durable drift reporting/resolution                          | Race acceptance coverage and optional controlled repair                                 |
| Redis             | TTL cache, bounded post-commit hints and Lua rate windows; safe degradation                                     | Reconnection policy, actual outage recovery scenario                                    |
| React UI          | Health, timeline, operations, seed-plan form, cancellable requests and shared feedback                          | Browser execution approval/QA, full history paging, direct failure/drift controls       |
| Chaos             | Five opt-in hard-exit hooks, deterministic 32-bit plans, durable plans, null unexecuted invariants              | Actual fault runner, counts, restarts and invariant evidence                            |
| AI ingress        | Extractor interface, deterministic reference/duplicate validation, fail-closed endpoint                         | Provider and durable safe ERP write path                                                |
| AWS               | TypeScript CDK EC2/private RDS/IAM/source stack and Compose/systemd bootstrap                                   | Actual AWS rollout, boot/recovery evidence, HTTPS if needed beyond a local/demo scope   |

See verification.md for actual checks. The archived Python tests are not the active stack's
validation evidence. No completed chaos run or public reliability percentage is claimed.
