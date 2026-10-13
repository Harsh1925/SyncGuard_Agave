# Specification acceptance matrix

| Specification scenario           | Evidence                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Equivalent normalization         | Domain tests for ERP native fields, decimals, identity and fingerprints                                                           |
| ERP create/update/delete         | Executed scripted demo and seeded chaos through detector, durable queue and PM HTTP                                               |
| Partial snapshot                 | Real adapter consumes persisted partial-read fault after a record; zero derived deletes asserted                                  |
| Same operation x10               | Ten queue deliveries, one PM operation receipt, destination state asserted                                                        |
| Concurrent workers               | Seeded concurrent-delivery step starts two worker processes, then verifies one receipt                                            |
| Different operation/same invoice | ERP unique business constraint plus concurrent ingress acceptance/refusal integration test                                        |
| Lost response                    | PM commits then destroys the response socket; retry verifies `already_committed` and one receipt                                  |
| Crash after external commit      | Child exits 86; destination committed, local operation attempting; lease expiry/recovery verifies receipt                         |
| Other deterministic boundaries   | BEFORE_EXTERNAL_WRITE, DURING_SNAPSHOT, AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT, DURING_RECONCILIATION executed and recovered |
| Out-of-order full state          | Newer work delivered first; older operation suppressed; full latest PM state asserted                                             |
| Delete tombstone                 | Delayed older upsert receives HTTP 409; PM invoice remains absent                                                                 |
| In-flight reconciliation         | Scripted demo asserts deferred record with no false drift                                                                         |
| Manual PM edit                   | HTTP drift injection, detected disagreement, authoritative update and resolved drift                                              |
| Own-write correlation            | Ingress fingerprint audit correlation; first snapshot creates one observation, next creates none                                  |
| Terminal failure/replay          | Failed operation persists; replay queues same identity; recovery verifies before completion                                       |
| Seed reproducibility             | Two completed seed-42/20-step executions have identical planned and actual fault-type order                                       |
| Final invariants                 | Persisted executed-run assertions for receipts, queue completion, ordering/deletion, observation safety and convergence           |
| Dashboard                        | Desktop/mobile browser checks for navigation, invalid seed/focus, deterministic refusal and no page errors                        |
| AI boundary                      | Synthetic acceptance/refusal/concurrent duplicate tests; optional LLM transport parsed and domain validation always applies       |
| AWS                              | CDK assertions and synthesized infrastructure; live rollout not yet exercised                                                     |

`npm run test:integration` provisions disposable Postgres/Redis on separate ports and executes
all tests. `npm run demo -- 42` builds the recording environment. `npm run chaos -- 42 20`
executes randomized failures and exports evidence. CI runs service tests plus both suites.
Assertions establish the recorded finite scenarios, not all distributed schedules or a
production reliability percentage. Live LLM calls and cloud deployment remain credential-dependent.
