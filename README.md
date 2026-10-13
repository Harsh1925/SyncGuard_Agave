# SyncGuard

Fault-tolerant ERP → PM invoice synchronization scaffold using **TypeScript, React, Redis,
Postgres, AWS CDK and EC2**. The finalized `SyncGuard_Specification.docx` remains unchanged.
The repository contains the active TypeScript implementation.

## Project structure

```text
SyncGuard_Agave/
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── adapters/       # Native ERP/PM normalization and I/O
│   │   │   ├── api/            # Fastify operational API and OpenAPI explorer
│   │   │   ├── chaos/          # Seeded plans and five deterministic crash hooks
│   │   │   ├── domain/         # Canonical money, identity, hashes and version rules
│   │   │   ├── engine/         # Snapshot detector, safe worker and reconciler
│   │   │   ├── ingress/        # Untrusted extraction and deterministic validation
│   │   │   ├── simulators/     # Legacy ERP and modern PM HTTP services
│   │   │   ├── state/          # Postgres transactions/queue/audit and optional Redis
│   │   │   ├── cli.ts          # Independent process entry points
│   │   │   └── config.ts       # Validated environment settings
│   │   └── tests/             # Vitest unit, API, fault and integration tests
│   └── dashboard/
│       ├── src/components/    # Shared UI feedback
│       ├── src/lib/           # API and cancellable request hook
│       ├── src/pages/         # System Health and Operation Timeline / Failure Lab
│       ├── src/App.tsx        # Two-route React shell
│       ├── src/styles.css     # Preserved design tokens
│       ├── Dockerfile         # React build → nginx
│       └── nginx.conf         # SPA routing and same-origin API proxy
├── packages/contracts/       # Shared Zod schemas and TypeScript contracts
├── migrations/               # Control plane, PM schema and Postgres ERP schema
├── infra/cdk/
│   ├── bin/app.ts            # CDK application
│   ├── lib/stack.ts          # EC2, private RDS, IAM, network and source asset
│   ├── test/                 # CloudFormation resource assertions
│   └── bootstrap.sh          # EC2 setup, Secrets Manager and systemd startup
├── scripts/                  # Dev process launcher and read-only smoke checks
├── docs/                     # Migration details, code walkthrough, runbook and status
├── .github/workflows/ci.yaml
├── compose.yaml              # Local Postgres + Redis + all app services
├── compose.aws.yaml          # EC2 services using external RDS
├── Dockerfile                # Backend TypeScript runtime
├── package.json              # npm workspaces and shared commands
├── package-lock.json         # Resolved dependencies
└── tsconfig.base.json        # Shared strict compiler settings
```

## Technology responsibilities

| Technology                  | Responsibility                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| TypeScript / Node / Fastify | API, worker, poller, adapters, simulators and validation                                                |
| React / Vite / React Router | Exactly two operational dashboard pages                                                                 |
| Postgres                    | Durable queue, operation ledger, mappings, versions, tombstones, snapshots and audit; simulator schemas |
| Redis                       | Three-second metrics cache, bounded worker wake hints and PM rate windows                               |
| AWS CDK in TypeScript       | One VPC, private RDS, EC2, IAM and source assets                                                        |
| EC2 / Docker Compose        | Runs app, worker, poller, simulators, dashboard and Redis                                               |

Postgres remains the durable queue required by the specification. Redis contains no
correctness-critical financial state. Money is a decimal string; bigint versions stay
strings on the wire and use BigInt for comparisons.

## Recruiter demo

With Docker Desktop running, execute:

```sh
npm ci
npm run demo -- 42
```

This builds an isolated recording environment and executes assertions for invoice
create/update/delete, ten deliveries with concurrent worker instances, a real worker
crash after PM commit, lease recovery, failed-snapshot safety, drift detection and stale
update rejection after deletion. Open http://localhost:8180 for the dashboard and
http://localhost:8100/demo/runs for persisted evidence. Normal application data is untouched.

See [the acceptance matrix](docs/acceptance-matrix.md) for executed scenarios and
verification limits. The scripted demo is complemented by `npm run chaos -- 42 20`, an executed seeded failure
suite. The dashboard also supports validated synthetic invoice ingress and optional LLM
extraction. Actual AWS deployment remains account-dependent.

## Local Docker setup

Start Docker Desktop, then:

```sh
npm ci
docker compose up --build -d
docker compose logs -f init worker poller
```

The init service migrates and seeds the source before workers start. Named Postgres data
persists across container restarts; Redis may be discarded safely.

| Service                | Local address              |
| ---------------------- | -------------------------- |
| React dashboard        | http://localhost:8080      |
| SyncGuard API explorer | http://localhost:8000/docs |
| ERP simulator explorer | http://localhost:8001/docs |
| PM simulator explorer  | http://localhost:8002/docs |
| Postgres               | localhost:5432             |
| Redis                  | localhost:6379             |

The local Compose ports bind to localhost. The scaffold uses synthetic data and has no
application authentication. Cloud HTTP access is restricted by an explicit CIDR.

## Node development setup

Use Node **22.12+** (the Docker images and CI use Node 22).

```sh
npm ci
cp .env.example .env
docker compose up -d postgres redis
npm run migrate
npm run seed
npm run cli -w @syncguard/backend -- pm
```

In separate terminals:

```sh
npm run dev
npm run worker
npm run cli -w @syncguard/backend -- poll-loop
npm run cli -w @syncguard/backend -- erp
```

The Vite dashboard is http://127.0.0.1:5173 and proxies `/api` to the host API on port 8000.
Backend npm scripts load the root `.env` when it exists. Production containers execute
TypeScript using the declared `tsx` runtime dependency; strict compilation happens in CI/build.

Example normalized invoice (amount must be a string):

```json
{
  "company_id": "ACME",
  "vendor_id": "V001",
  "invoice_number": "INV-1002",
  "job_id": "J001",
  "amount": "1400.00",
  "currency": "USD",
  "issued_on": "2026-01-16",
  "status": "open"
}
```

Send it to ERP `POST /invoices`; ERP `PUT /invoices` accepts the same full shape for edits.
Run `npm run poll` to observe it once. A running worker replicates it to PM.

## Checks and tests

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
docker compose config --quiet
```

Postgres/Redis integration tests run only when their dedicated environment variables are
set. The database fixture truncates application and simulator tables: use a disposable DB.

```sh
docker compose exec postgres createdb -U syncguard syncguard_test
TEST_DATABASE_URL=postgresql://syncguard:syncguard@localhost:5432/syncguard_test TEST_REDIS_URL=redis://localhost:6379 npm test
```

CI provides separate Postgres and Redis services for those tests. `npx tsx scripts/smoke.ts`
checks the running local Compose services without writing data.

## AWS starter

```sh
npm run cdk:synth
npm run diff -w @syncguard/infra -- -c allowedCidr=YOUR_PUBLIC_IP/32
```

See [EC2 deployment instructions](infra/cdk/README.md) before deployment. Synthesis does not
create resources. No AWS deployment has been performed. The default CIDR is loopback, so
an actual deployment requires your allowed public IP/range. RDS is retained and deletion-protected.

## Migration details and important code

- [Complete stack-change explanation](docs/stack-migration.md)
- [Important code walkthrough](docs/code-walkthrough.md)
- [Architecture](docs/architecture.md)
- [Implementation status and remaining work](docs/implementation-status.md)
- [Acceptance matrix](docs/acceptance-matrix.md)
- [Failure runbook](docs/runbook.md)
- [Actual verification and limitations](docs/verification.md)

If you previously used the Python scaffold with edited SQLite source data, import all
source data into the new ERP schema before polling. Bootstrap refuses an empty new source
when old complete snapshots exist; it does not silently import or delete legacy invoices.

The executed chaos runner, safe invoice ingress and Failure Lab are implemented. Optional
repair/PO validation are omitted. A planned run is not proof; invariant results become
passed only after runtime assertions succeed. See the acceptance matrix for tested scenarios.

## Required-feature commands

```sh
npm run test:integration        # Disposable Postgres/Redis; all tests
npm run demo -- 42              # Build isolated demo and execute the walking/recovery suite
npm run chaos -- 42 20          # Execute seeded failures against the running demo
```

Failure Lab: http://localhost:8180/operations. Choose a seed and named boundary, then run
chaos and expand its result. For ingress use synthetic JSON without credentials, or set
`OPENAI_API_KEY` and `OPENAI_MODEL` in the local environment and rebuild the API for optional
LLM extraction. Financial validation is always deterministic. No live provider or AWS
execution is implied by local tests.
