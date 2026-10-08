# Scaffold verification

Local verification on 2026-10-06:

- Python lint and formatter checks pass.
- Unit/boundary tests pass (including isolated processes exercising all five hard-exit hooks).
- Postgres integration tests are present but need `SYNCGUARD_TEST_DATABASE_URL`; they were
  not executed locally because a test database was unavailable and Docker's daemon was off.
- `docker compose config --quiet` passes.
- Browser JavaScript modules pass Node syntax checks.
- Frontend premium static audit reports zero findings. This is not browser verification.
- The seeded chaos-plan CLI produces a plan; it does not execute a chaos run.

No running-services end-to-end test, browser rendering test, AWS CDK synth/deploy, or
complete specification acceptance run is claimed. Those are listed explicitly in the
implementation-status document and acceptance matrix. The current dependency set emits
a Starlette TestClient deprecation warning for HTTPX; it does not fail the tests.
