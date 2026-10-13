# Active TypeScript verification

Local verification on 2026-10-06:

| Check                                 | Actual result                                                              |
| ------------------------------------- | -------------------------------------------------------------------------- |
| TypeScript workspace checks           | Passed for backend, React dashboard, contracts and CDK                     |
| ESLint                                | Passed                                                                     |
| Prettier check                        | Passed                                                                     |
| Vitest                                | **35 passed, 7 skipped**                                                   |
| Backend/contracts/dashboard/CDK build | Passed; React production bundle generated                                  |
| Local Compose configuration           | Passed                                                                     |
| AWS Compose configuration             | Passed with a temporary synthetic environment fixture; no services started |
| EC2 bootstrap shell syntax            | Passed                                                                     |
| CDK synth                             | Passed; CloudFormation generated locally, no deployment                    |
| CDK resource assertions               | Passed: EC2, private encrypted RDS, CIDR ingress, no ECS service           |
| Frontend premium static audit         | Zero findings; this is not browser verification                            |

The seven skipped tests require a dedicated Postgres or Redis URL. Docker's daemon was not
running, so no running-services end-to-end test or Docker image build is claimed. CI
provisions separate service containers to execute the integration tests.

Browser plugin availability: absent. Playwright/system Chrome was attempted, but launching
Chrome failed under the sandbox and the request to run it outside the sandbox was declined.
**No rendered browser interaction, desktop/mobile layout or screenshot validation is claimed.**
The React development server did start on localhost with permission; typecheck and bundle
success do not replace browser verification.

Unit/boundary tests cover monetary input, invalid dates, normalization, identity preservation,
bigint order, tombstones, full-state change derivation, references, echo matching, seed
reproducibility, unexecuted invariants, Redis-unavailable behavior, HTTP validation and all
five fault hooks in separate processes. CDK tests inspect generated resource properties.
A subprocess fault exit alone does not prove the complete post-commit restart invariant.

## Dependency audit

Affected HTTP/test/development packages were updated, and the shell-quoting dev launcher
was replaced with an argument-array child-process launcher. The audit now reports one
remaining **high-severity tooling advisory** in `brace-expansion@5.0.9`, bundled inside
`aws-cdk-lib@2.272.0`. npm reports that this bundled dependency cannot be automatically
fixed; overriding its version did not change the embedded copy, so no ineffective override
is retained. The advisory is [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7)
with related brace-expansion denial-of-service reports in the audit output.

The backend Dockerfile selects only backend/contracts production dependencies, rather than
installing the infrastructure workspace in the runtime image. That Docker image was not
built locally. A patched upstream CDK bundle is still needed for a clean full-workspace audit.

No AWS deployment, completed chaos run, safe AI ERP write, or full specification acceptance
result is claimed. Those remain explicit in implementation-status.md and acceptance-matrix.md.

## Portfolio demo verification — 2026-10-13

- Typecheck, ESLint and formatting checks passed.
- Vitest suite including demo isolation guards: 37 passed, 7 skipped without dedicated
  integration URLs.
- Docker backend and React images built successfully.
- Separate `syncguard-demo` environment started with its own Postgres database.
- The full `npm run demo -- 42` command passed on a rerun, exported
  `artifacts/demo-report.json`, and preserved the first run.
- Dashboard returned HTTP 200; its API proxy returned healthy ERP/PM/Redis metrics,
  zero open drift and zero pending jobs.
- The live scripted suite passed seven scenarios, including child exit 86 after PM commit,
  lease recovery with `already_committed`, and one destination receipt. All five bounded
  scenario invariants passed.
- Failed source acceptance inferred zero deletes; manual edit produced drift; a new ERP
  update restored convergence; a delayed old update after deletion returned HTTP 409.

These newer Docker results supersede the earlier lack of running-services verification
for the explicitly listed scenarios only. AWS, randomized chaos and browser interaction
verification are still not claimed. The build still reports the previously documented
full-workspace tooling advisory; the selected backend runtime install reported no advisories.

## Specification-feature completion verification — 2026-10-13

These checks supersede the earlier scaffold limitations for the implemented features:

| Check                                     | Actual result                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full service-backed Vitest suite          | 55 passed, zero skipped via disposable test Compose                                                                                                                                              |
| Typecheck / ESLint / formatting           | Passed                                                                                                                                                                                           |
| Backend, contracts, React and CDK build   | Passed                                                                                                                                                                                           |
| Scripted demo after lease-renewal changes | Passed; report exported                                                                                                                                                                          |
| Seeded chaos                              | Two seed-42, 20-step runs completed: five critical boundaries plus 20 injected steps each                                                                                                        |
| Seed reproducibility                      | Planned sequence and actual fault-type order matched across both executions                                                                                                                      |
| Concurrent processes / dropped responses  | Real child workers and PM socket destruction exercised, receipt counts asserted                                                                                                                  |
| Redis outage                              | Isolated Redis stopped: API remained healthy with degraded Redis; restart reconnected automatically                                                                                              |
| Browser                                   | Headless system Chrome via Playwright; desktop 1280×900 and mobile 390×844; validation/focus, refusal, acceptance, snapshot/worker, timeline, drift/recovery and run creation/completion checked |
| UI static audit                           | Strict audit: zero findings                                                                                                                                                                      |
| CDK synthesis                             | Passed locally; no AWS deployment                                                                                                                                                                |

Browser plugin was unavailable, so the installed Playwright tooling and system Chrome were
used. Screenshots were saved outside the repository under /private/tmp. A repeatable
project browser test is now available as `npm run test:e2e` after starting the demo. It uses
system Chrome on macOS when present; elsewhere install Playwright Chromium or set
PLAYWRIGHT_CHROME_PATH. This is one-browser coverage, not all-device accessibility certification.

Optional OpenAI extraction was validated with a synthetic structured provider response;
no live API call or credential validity is claimed. The simulator ERP/control plane share
Postgres, so safe ingress is transactional across those schemas. Independent real ERP
write recovery requires its own adapter. Optional PO validation and drift repair remain
excluded. The existing CDK tooling dependency advisory remains documented above.
