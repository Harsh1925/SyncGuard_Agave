# ADR 0002: TypeScript, React, Redis, Postgres and CDK/EC2

Status: active scaffold decision, 2026-10-06. Replaces the earlier Python technology choice.

The user explicitly selected TypeScript, React, Redis, Postgres, AWS CDK and EC2. Use an
npm workspace with a Fastify backend, React/Vite dashboard, shared Zod contracts and
TypeScript CDK. Port the existing reliability boundaries rather than redesigning entity authority.

Postgres remains the specified durable queue/control plane. Redis handles short-lived
cache, wake-up and rate-window state; its loss must not lose a financial operation. The
ERP moves from SQLite to a separate Postgres schema with consistent reads and business
uniqueness. An initialization marker prevents seeding from resurrecting deliberately deleted
source invoices and guards legacy source migration before the new poller starts.

EC2 runs the demo containers and Redis; private RDS holds durable state. Use SSM, generated
Secrets Manager credentials, verified RDS TLS and CIDR-restricted HTTP access. Preserve
the two-page dashboard and keep the thin AI workload disabled until safe ERP writes exist.

The previous scaffold is available in Git history. This architecture remains a bounded
single-instance demo; final distributed correctness is established through the
specification's acceptance tests, not the technology switch alone.
