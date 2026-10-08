# ADR 0001: Python backend with a Postgres control plane

Status: scaffold decision, 2026-10-06.

The specification fixes Postgres as the durable queue/state store but leaves the application
language open. Python/FastAPI provides small simulator APIs, deterministic validation and
an eventual thin AI boundary without introducing additional runtime stacks.

Use plain SQL for transactional reliability boundaries so queue locks, uniqueness and
snapshot commits remain reviewable. Keep normalized domain rules separate from adapters,
SQL repositories and HTTP routes. SQLite models the unmodifiable legacy ERP. No Redis,
Kafka, Kubernetes, generic connector abstraction or reverse Job synchronization is added.

The dashboard uses static HTML and browser modules to preserve the two-page scope and
avoid requiring a JavaScript build tool for starter visibility. AWS infrastructure remains
a separate final-milestone CDK starter.
