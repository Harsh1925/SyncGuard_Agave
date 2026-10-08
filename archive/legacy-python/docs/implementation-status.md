# Scaffold implementation status

This document distinguishes code foundations from proven final acceptance. “Implemented”
means a starter implementation exists; it does not mean all distributed failure cases passed.

| Component           | Supplied foundation                                                                                                          | Remaining work                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Legacy ERP          | Consistent SQLite reads, cryptic fields, business uniqueness, vendor seed, CRUD                                              | Configurable latency and partial-read/network fault API                                                     |
| Modern PM           | Durable records/receipts, version fences, delete retention, cursor reads, Job references, direct edits                       | Rate-limit and response-loss injection controls                                                             |
| Normalization       | Invoice/Vendor/Job models, canonical money/hash, adapters                                                                    | Broader fixtures and native PM vocabulary variants                                                          |
| Control plane       | SQL migrations for mapping, state, snapshots, operations, jobs, audit, drift and chaos                                       | Migration rollback/version policy and hardened operational tooling                                          |
| Snapshot detector   | Serialized full snapshots, atomic derivation, COMPLETE-only baseline, five-snapshot retention                                | Explicit abandoned snapshot cleanup and crash test evidence                                                 |
| Queue/worker        | Skip-locked claims, claim tokens, leases, local record locks, verify-before-write, bounded retries, visible failures, replay | Real concurrent/process-crash acceptance harness, heartbeat strategy if writes exceed lease                 |
| Versions/tombstones | Full-state jobs, observation/applied versions, local and PM delete fences                                                    | Cross-process out-of-order and resurrection proof                                                           |
| Echo rule           | Exact expected-fingerprint helper; ERP forward observation is preserved                                                      | Integrate ledger correlation/audit into eventual ERP ingress                                                |
| Reconciliation      | Active-operation deferral, drift persistence/resolution, direct PM edit path                                                 | Race coverage and optional controlled repair                                                                |
| Chaos               | All five named hard-exit hooks, stable seeded plans, durable plan records, honest null invariant results                     | Fault execution, process/container restart runner, counts and invariant evidence                            |
| Dashboard           | Two connected pages, metrics, bounded history, audit lookup, seed-plan input, loading/error/empty states                     | Paging through full history, drift/fault controls, completed run reports                                    |
| AI ingress          | Extraction protocol, deterministic vendor/job/duplicate validation, fail-closed endpoint                                     | Provider integration and durable safe ERP writes with business-key outcome verification                     |
| AWS                 | VPC, RDS and ECS task starter                                                                                                | Service startup, credentials/DSN, persistent ERP, migration init, worker/PM/poller wiring, deployment proof |

No optional Purchase Order flow is introduced. No numeric reliability claim is published.
