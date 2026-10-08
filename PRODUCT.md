# SyncGuard product context

Source of truth: `SyncGuard_Specification.docx` (finalized specification).

Replicate ERP-authoritative invoices into a PM replica under duplicate delivery, stale
work, uncertain writes and worker failure. Vendor is ERP-owned reference data; Job is
PM-owned validation data. There is no live Job write path into ERP.

Audience: developers demonstrating and examining synchronization correctness locally.
The dashboard has exactly System Health and Operation Timeline / Failure Lab pages.
English locale, explicit UTC timestamps, synthetic invoice data only.

This repository initially supplies boilerplate, a working-path implementation foundation,
and explicit extension points. Its presence does not certify the specification's final
acceptance matrix. See `docs/implementation-status.md` for what is implemented and deferred.

Active implementation: TypeScript/Node, React/Vite, Postgres, Redis and AWS CDK/EC2.
Redis supplies disposable acceleration; Postgres owns correctness.
