# Specification implementation status

Source: `SyncGuard_Specification.docx`. Current app scope is the bounded simulator demo,
not a production connector or a claim of exactly-once message delivery.

| Required component       | Implementation and evidence                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ERP / PM simulators      | Cryptic SQL/composite ERP identities, business uniqueness, consistent reads; REST PM, cursor paging, operation receipts, version fences, jobs and direct edits                              |
| Normalized adapters      | Shared Zod Invoice/Vendor/Job models, decimal-safe amounts, stable identity and canonical hashes                                                                                            |
| Durable control plane    | SQL migrations for records, mappings, observations, applied state, tombstones, operations, queue claims, snapshots, audit, drift and runs                                                   |
| Change detector          | COMPLETE-only atomic derivation, create/update/delete full-state jobs, five COMPLETE snapshots plus pinned retention, abandoned snapshot recovery                                           |
| Worker                   | SKIP LOCKED claims, record fences, renewable short leases, retries/backoff, visible terminal failures, verification before retry and replay                                                 |
| Failure simulation       | Persisted opt-in ERP partial-read/latency/transient faults and PM dropped responses/latency/transient/rate faults                                                                           |
| Named crash boundaries   | All five hooks terminate separately restartable child processes; tested recovery includes external commit before local completion                                                           |
| Seeded chaos             | Real executor, recorded seed/configuration/sequence/counts/evidence/invariants; duplicate delivery, two-process races, ordering, crashes, incomplete reads and rate limits                  |
| Reconciliation           | Defers in-flight work, rereads under record fence, detects manual drift, resolves reports after authoritative reconvergence                                                                 |
| Own-write correlation    | Accepted ingress fingerprint correlated in audit; normal ERP→PM propagation is allowed once, with no reverse Job flow                                                                       |
| Invoice ingress          | Durable operation identity and frozen proposal, deterministic fields/vendor/job/duplicate checks, audited refusal, transactionally verified ERP write; synthetic and optional LLM extractor |
| Two-page React dashboard | Health, operation details/audit paging, run controls/results/invariants, named hook selection, drift injection, replay and ingress                                                          |
| Redis                    | TTL metrics, bounded wake hints and rate windows; safe outage degradation and capped automatic reconnect delay                                                                              |
| Delivery                 | Normal Compose, isolated demo/test Compose, CI checks and executed demo/chaos evidence artifacts; CDK EC2/private RDS source and bootstrap                                                  |

## Verification

See `verification.md` for actual checks and `acceptance-matrix.md` for traceability. A completed
run means its recorded assertions passed; failed/unexecuted runs never receive fabricated
success percentages. Run histories are scoped to the synthetic environment.

## External verification and optional work

- AWS infrastructure is implemented and synthesized; actual AWS deployment/boot/recovery
  needs an account, region, allowed CIDR and deployment authorization.
- The OpenAI Responses extractor is implemented and transport-tested with a synthetic response.
  Live provider execution requires `OPENAI_API_KEY` and a configured `OPENAI_MODEL`.
- Optional automatic/controlled drift repair and PO validation are excluded; authoritative
  updates provide demonstrated reconvergence.
- Full production scale, real ERP connectors, broad authentication/RBAC and production OCR
  are outside the specification's V1 simulator scope. Long-run load testing is not claimed.
- The local ERP and control plane share Postgres: invoice ingress and ERP acceptance can
  commit atomically. A real independent legacy destination would require an external
  business-key verification/recovery adapter instead of this shared-database transaction.
