# Specification acceptance matrix

| Specification scenario            | Starter evidence / next test                                           |
| --------------------------------- | ---------------------------------------------------------------------- |
| Unified normalization             | Unit test: ERP and PM canonical fingerprints agree                     |
| ERP create                        | Detector/worker/PM code supplied; add running-services acceptance test |
| ERP update                        | Full-state change derivation unit test; add end-to-end update          |
| ERP delete                        | Delete derivation unit test; add end-to-end tombstone                  |
| Partial snapshot                  | Postgres integration test: failed source read derives zero deletes     |
| Same operation ×10                | Duplicate-delivery integration foundation; extend to ten deliveries    |
| Concurrent workers                | Queue/local record locks supplied; add actual two-worker race          |
| Different operation, same invoice | SQLite business uniqueness unit test                                   |
| Lost response                     | Postgres integration test with destination committing then timing out  |
| Crash after external commit       | Named hook supplied; add subprocess kill/restart acceptance test       |
| Out-of-order full-state versions  | Version comparison unit test; add destination ordering test            |
| Delete tombstone                  | Version comparison and durable fences supplied; add resurrection test  |
| Reconciliation during active sync | Deferral code supplied; add Postgres + simulator scenario              |
| Manual replica edit               | Direct-edit API and drift code supplied; add end-to-end scenario       |
| Echo prevention                   | Exact-fingerprint unit test; integrate with eventual ERP ingress       |
| Seed reproducibility              | Seeded sequence unit test; actual failure execution deferred           |
| Final chaos invariants            | Five explicit unexecuted results; runner/evidence deferred             |

Do not mark a scenario complete solely because its code is present. Process crashes and
uncertain external commits must be tested against durable stores and separate processes.
