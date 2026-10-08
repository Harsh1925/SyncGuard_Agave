# Active acceptance matrix

| Scenario                                 | Current TypeScript evidence                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Equivalent normalization                 | Domain/native-ERP unit test                                                                             |
| ERP create/update/delete                 | Derivation unit tests and implemented detector/worker/PM path; full running-services acceptance pending |
| Incomplete snapshot                      | Postgres integration test for failed source read and zero deletes                                       |
| Duplicate delivery / lost response       | Postgres worker integration test with destination committing before response loss                       |
| Concurrent workers                       | Durable queue and record fences supplied; real two-process race pending                                 |
| Same business invoice                    | ERP uniqueness integration test                                                                         |
| Lease expiry                             | Postgres integration test with new claim token                                                          |
| Worker death after PM commit             | Subprocess fault-hook tests; full kill/restart/receipt assertion pending                                |
| Stale versions and tombstones            | BigInt unit tests and PM receipt/delete-fence integration test                                          |
| Reconciliation during sync / manual edit | Deferral, record-fenced reread and direct-edit code; running-services scenario pending                  |
| Echo rule                                | Exact-fingerprint unit test; future ERP ingress correlation pending                                     |
| Seed reproducibility                     | TypeScript PRNG unit test; executed fault replay pending                                                |
| Final chaos invariants                   | Explicit null unexecuted results; runner/evidence pending                                               |
| React visibility                         | Typecheck and production bundle; browser QA not executed                                                |
| AWS structure                            | CDK template assertions; actual rollout pending                                                         |

Integration tests skip locally without dedicated service URLs. CI provides services. Test
presence does not prove a scenario passed in this environment; see verification.md.
