# SyncGuard

Specification-driven boilerplate for reliable ERP → PM invoice replication. The original
`SyncGuard_Specification.docx` is preserved. This is a structured development foundation,
not a claim that every final reliability invariant has already been proven.

**Stack:** Python 3.12, FastAPI, Pydantic, Psycopg 3, PostgreSQL 17, SQLite ERP simulator,
HTTP PM simulator, a dependency-free two-page dashboard, Docker Compose, and AWS CDK Python.

## Folder structure

```text
SyncGuard_Agave/
├── SyncGuard_Specification.docx   # Original finalized requirements
├── src/syncguard/
│   ├── domain/                    # Invoice/Vendor/Job, fingerprints, changes, versions
│   ├── adapters/                  # ERP and PM normalization + I/O boundaries
│   ├── state/                     # Migrations, ledger, queue claims, audit repository
│   ├── engine/                    # Snapshot detector, safe worker, reconciler, echo rule
│   ├── api/                       # Operational FastAPI endpoints
│   ├── chaos/                     # Named crash hooks, seeded plans, invariant contracts
│   ├── ingress/                   # Untrusted extraction interface + deterministic validation
│   ├── config.py                  # Environment configuration
│   └── cli.py                     # Independent worker/poller/migration commands
├── simulators/
│   ├── erp/                       # SQLite database, seed, manual create/update/delete API
│   └── pm/                        # REST API, operation receipts, versions, direct-edit injector
├── migrations/                    # Versioned control-plane and PM simulator SQL
├── dashboard/                     # System Health + Operation Timeline / Failure Lab
│   └── src/                       # Shared request helpers, page modules, CSS tokens
├── tests/
│   ├── unit/                      # Domain, normalization, validation, seed, API boundaries
│   ├── integration/               # Actual Postgres snapshot, lease and recovery tests
│   └── acceptance/                # Cross-process failure test ownership / next scenarios
├── infra/cdk/                     # One-stack AWS infrastructure starter (not deployed)
├── scripts/                       # Local smoke-check utility
├── docs/                          # Architecture, runbook, acceptance matrix, implementation status
│   └── adr/                       # Durable architecture decisions
├── .github/workflows/ci.yaml      # Lint, formatting, unit + Postgres integration checks
├── .env.example                   # Configuration reference
├── Dockerfile
├── compose.yaml
├── Makefile
├── requirements.lock              # Resolved backend/development dependency versions
├── pyproject.toml
├── PRODUCT.md
├── DESIGN.md
└── UX-CONTRACT.md
```

## Run with Docker

Start Docker Desktop first, then run from the repository root:

```sh
docker compose up --build -d
docker compose logs -f init worker poller
```

The init service migrates Postgres and seeds the legacy ERP before application services
start. The poller observes snapshots and the separate worker consumes queued changes.

| Service | Local URL |
| --- | --- |
| Dashboard | http://localhost:8080 |
| SyncGuard API / OpenAPI | http://localhost:8000/docs |
| ERP simulator / OpenAPI | http://localhost:8001/docs |
| PM simulator / OpenAPI | http://localhost:8002/docs |
| PostgreSQL | localhost:5432 |

Compose ports bind to localhost. Credentials are local demo defaults. The starter has
no authentication and should remain a local synthetic-data demo.

## Run Python services locally

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -c requirements.lock -e '.[dev]'
cp .env.example .env
set -a
source .env
set +a
docker compose up -d postgres
python -m syncguard.cli bootstrap
uvicorn simulators.pm.app:app --port 8002
```

In separate terminals with the same environment:

```sh
uvicorn syncguard.api.app:app --port 8000
uvicorn simulators.erp.app:app --port 8001
python -m syncguard.cli worker
python -m syncguard.cli poll-loop
```

`.env` is not automatically loaded: export it as above. When using the Compose dashboard
with host-running API services, adapt its nginx upstream; the default expects Compose DNS.

## Verify

```sh
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/pytest
docker compose config --quiet
```

Postgres integration tests skip unless `SYNCGUARD_TEST_DATABASE_URL` points to a **separate
disposable database**. The fixture truncates application and PM simulator tables there.
CI provisions such a database. Example after starting local Postgres:

```sh
docker compose exec postgres createdb -U syncguard syncguard_test
SYNCGUARD_TEST_DATABASE_URL=postgresql://syncguard:syncguard@localhost:5432/syncguard_test .venv/bin/pytest tests/integration
```

Once all services are running: `.venv/bin/python scripts/smoke.py`.

## What to build next

The scaffold contains implemented building blocks for snapshots, ledger/queue, worker
verification/retry, stale suppression and drift detection. Extend them through the vertical
milestones in the specification. See [implementation status](docs/implementation-status.md),
[acceptance matrix](docs/acceptance-matrix.md), and [runbook](docs/runbook.md).

The seeded chaos **runner**, automatic repair, dashboard fault controls, safe ERP invoice
ingress, LLM integration and complete AWS service deployment remain explicit extension
points. Unexecuted invariants are null, never invented passes. AI ingress fails closed with
HTTP 501 until its safe-write path exists.
