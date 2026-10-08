# TypeScript stack migration

The requested active stack is now **TypeScript, React, Redis, Postgres, AWS CDK and EC2**.
This changes implementation technology while preserving the finalized specification's
ERP-authoritative Invoice flow and Postgres durability boundaries.

## Before and after

| Area               | Previous scaffold                           | Active implementation                                                   |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------- |
| Backend            | Python / FastAPI / Pydantic                 | TypeScript / Node.js / Fastify / Zod                                    |
| Frontend           | Static HTML with browser JavaScript modules | React with TypeScript, Vite and React Router                            |
| Shared types       | Python models separate from JavaScript UI   | `@syncguard/contracts` npm workspace                                    |
| Financial amounts  | Python Decimal                              | Decimal strings with `decimal.js`; Postgres numeric(18,2)               |
| Version comparison | Python integers                             | Postgres bigint → string on the wire → JavaScript BigInt for comparison |
| ERP storage        | SQLite file and named Docker volume         | `erp_sim` Postgres schema with cryptic columns and composite keys       |
| State store        | Psycopg and plain SQL                       | `pg` connection pool and plain SQL                                      |
| Durable queue      | Postgres rows / SKIP LOCKED                 | Same durable design, ported to asynchronous TypeScript                  |
| Redis              | Absent                                      | TTL metrics cache, bounded worker wake-up hints, atomic PM rate windows |
| Cloud compute      | Python CDK / ECS Fargate task starter       | TypeScript CDK / EC2 instance with Docker Compose                       |
| AWS data           | Private RDS definition                      | Private encrypted RDS plus generated Secrets Manager credentials        |
| Cloud startup      | Unwired task definition                     | Source asset, EC2 user data, RDS CA bundle and systemd Compose startup  |
| Tests              | pytest                                      | Vitest, Fastify injection, subprocess hooks and CDK assertions          |
| Tooling            | venv, pip, Ruff, Make                       | npm workspaces, package-lock, TypeScript, ESLint, Prettier, Make        |
| CI                 | Python lint/tests                           | Node checks, build, Postgres and Redis integration service containers   |

## Files and folder changes

- Preserved the previous code under `archive/legacy-python/`. It is excluded from npm
  builds, current tests, formatting and Docker/CDK source assets.
- Added `apps/backend/src/` with domain, adapters, state, engine, API, simulators, chaos
  and ingress modules. The API, worker, poller and simulators have independent CLI commands.
- Added `apps/dashboard/src/` with a shared shell, Health and Operations pages, API helpers,
  a cancellable resource hook and one status component. Existing CSS/visual direction is retained.
- Added `packages/contracts/src/index.ts` so the backend and frontend share invoice schemas
  and operation/metrics/timeline/chaos result types.
- Retained SQL migrations 001 and 002 and added 003 for legacy ERP simulation. No existing
  control-plane table is dropped or renamed by the new migration.
- Replaced the root Dockerfile, Compose file, environment example, Makefile and CI workflow.
- Added `compose.aws.yaml`, a React build Dockerfile, TypeScript CDK files and an EC2
  bootstrap shell script. No AWS resources have been deployed by this migration.
- Added `package.json`, workspace manifests, lockfile, TS configs, lint/format configuration,
  Vitest configuration and updated setup/architecture/runbook documentation.

## Redis design decision

The specification explicitly requires a Postgres-backed durable queue. Adding Redis does
not require replacing that correctness boundary with a separate Redis job queue.

`RedisSupport` provides three real uses:

1. `/metrics` reads through a **three-second cache**, reducing repeated dashboard queries.
2. After a snapshot's ledger/jobs transaction commits, the poller pushes a bounded list
   hint. Idle workers consume a hint or wait one second, then query Postgres again.
3. The PM simulator increments a per-IP fixed-window rate counter with an atomic Lua script
   and returns HTTP 429 after 100 requests in 60 seconds.

Redis is deliberately disposable. No financial payload, operation status, applied version
or tombstone depends on its retention. A missing hint cannot lose a job. Cache failure
falls back to Postgres; unavailable Redis is visible as degraded health. The simulator's
optional rate limit degrades open. Existing connected processes fall back if Redis goes
away; restart them to reconnect after recovery because automatic Redis reconnection is
disabled in this starter to keep shutdown and failure behavior bounded.

## Financial and migration safeguards

- The invoice amount API requires a **string**, such as `"1250.00"`. Numeric JS values,
  negative amounts, non-finite values, exponents and more than two decimal places are refused.
- UUID derivation retains the old Python composite-key encoding, including Unicode
  escaping; tests pin both ASCII and Unicode business identifiers.
- Versions and IDs coming from Postgres bigint columns remain strings in API responses.
  `BigInt` is used internally, avoiding precision loss past 2^53.
- The ERP snapshot reads in `REPEATABLE READ READ ONLY`; there are still no source webhooks
  or dependable ERP change timestamps.
- Redis notifications happen after the durable commit, never as the only enqueue action.
- Fault hooks refuse activation on the main operational API; only disposable worker/poller/
  reconciler processes should terminate at a test boundary.
- Seed/bootstrap checks for old complete snapshots alongside an empty new ERP schema.
  If that state exists, it refuses startup until legacy source data has been imported.

Existing SQL state is structurally compatible, but the old SQLite source is **not silently
imported**. If you previously ran the Python scaffold with real demo edits, back up the
database and migrate all legacy invoices/vendors into `erp_sim` before enabling the new
poller. The startup guard prevents interpreting an empty new source as mass deletion.
Pure TypeScript hashes use normalized sorted JSON; non-ASCII state may generate a harmless
new observation because hash serialization changed, even though logical IDs are preserved.

## Configuration changes

| Previous variable           | Current variable                          |
| --------------------------- | ----------------------------------------- |
| SYNCGUARD_DATABASE_URL      | DATABASE_URL                              |
| SYNCGUARD_PM_URL            | PM_URL                                    |
| SYNCGUARD_LEASE_SECONDS     | LEASE_SECONDS                             |
| SYNCGUARD_MAX_ATTEMPTS      | MAX_ATTEMPTS                              |
| SYNCGUARD_POLL_SECONDS      | POLL_SECONDS                              |
| SYNCGUARD_ENABLE_FAULTS     | ENABLE_FAULTS                             |
| SYNCGUARD_FAULT_POINT       | FAULT_POINT                               |
| SYNCGUARD_TEST_DATABASE_URL | TEST_DATABASE_URL                         |
| SYNCGUARD_ERP_PATH          | Removed: ERP is now in Postgres           |
| —                           | REDIS_URL, optional TEST_REDIS_URL        |
| —                           | DATABASE_SSL_CA_FILE for verified RDS TLS |

Backend npm commands load the repository-root `.env` if present. Compose injects service
configuration explicitly; EC2 bootstrap writes its own protected environment file.

## AWS changes and operational limits

CDK creates one VPC without NAT gateways, an EC2 instance in a public subnet, private RDS
subnets, security groups, an SSM-enabled instance role and a source S3 asset. Only HTTP 80
from `allowedCidr` is exposed. SSH is not opened. Postgres accepts connections only from
the compute security group. Redis and simulator ports stay inside the Docker network.

EC2 uses Docker Compose to start React/nginx, API, worker, poller, ERP, PM and Redis.
All durable schemas live in RDS, so an EC2 restart does not remove invoice or control-plane
state. Secrets Manager credentials are fetched at boot using the instance role and written
to a root-readable environment file. The RDS CA bundle enables certificate verification.
Systemd starts/stops the Compose deployment after reboots.

This remains a **single-instance demo**: HTTP rather than HTTPS, no automatic scaling or
multi-instance failover, and no tested cloud rollout. RDS is retained and deletion-protected.
Destroying the CDK stack does not automatically delete that retained database. Secret
rotation requires refreshing the environment file/restarting containers in this starter.

## Deferred scope remains explicit

The change does not invent a completed seeded chaos runner, automatic repair, AI extraction
provider or safe AI→ERP financial write implementation. Ingress still returns 501 and
unexecuted invariant results remain null. Full cross-process crash recovery and concurrent
worker acceptance tests remain required before calling the finalized project complete.
