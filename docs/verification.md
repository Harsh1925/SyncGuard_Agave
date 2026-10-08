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
