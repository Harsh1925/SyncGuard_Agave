# AWS CDK + EC2 starter

The active stack is TypeScript CDK. It defines **one EC2 instance** for application containers
and Redis, with **private RDS Postgres** for all durable schemas. There is no ECS/Fargate
service. No AWS deployment has been performed.

## Defined resources

- Two-AZ VPC: public compute and isolated database subnets; no NAT gateways.
- Amazon Linux 2023 EC2 `t3.medium`, encrypted 30 GiB root disk, IMDSv2 required.
- Private encrypted Postgres 17 RDS `db.t4g.micro`, generated credentials, backups,
  deletion protection and RETAIN removal policy.
- HTTP ingress only from `allowedCidr`; no SSH rule; RDS ingress only from compute.
- Instance role with SSM administration plus scoped source-asset and secret read grants.
- Packaged source asset, excluding environment/secrets, Python archive, installed
  dependencies, build output and local artifacts.
- User-data bootstrap downloading the source, RDS certificate bundle and secret, then
  starting the Compose deployment through systemd.

Redis runs privately inside EC2's Docker network. It is intentionally ephemeral because
Postgres owns durable work. EC2 exposes nginx port 80; backend and simulator ports remain
inside that network. This is a single-instance HTTP demo, not a completed production rollout.

## Review and synthesize

From the repository root:

```sh
npm ci
npm run typecheck
npm run cdk:synth
npm run diff -w @syncguard/infra -- -c allowedCidr=YOUR_PUBLIC_IP/32
```

Synthesis writes CloudFormation locally and does not deploy. The checked-in default CIDR
is `127.0.0.1/32`; supply a real allowed public IP/range for actual access. The concrete AWS
account/region come from your CDK environment, rather than hard-coded account identifiers.

Once local reliability tests pass and you choose to deploy:

```sh
npx cdk bootstrap aws://YOUR_ACCOUNT/YOUR_REGION
npm run deploy -w @syncguard/infra -- -c allowedCidr=YOUR_PUBLIC_IP/32
```

These are instructions only; they were not executed as deployment actions during migration.
Review the template and account costs before running them. Outputs include instance ID,
dashboard URL and database endpoint. RDS is retained if the stack is deleted.

## EC2 startup behavior

1. Install Docker, jq, unzip and AWS CLI; install the pinned Compose plugin.
2. Download the CDK source asset using the instance role.
3. Read generated DB credentials from Secrets Manager without shell tracing.
4. Download RDS CA certificates and write root-readable `.env` configuration.
5. Start `compose.aws.yaml`, whose init service migrates and seeds Postgres.
6. Start dashboard, API, PM/ERP simulators, poller, worker and Redis.

Use SSM Session Manager for diagnostics. Logs are available through cloud-init/systemd
and Docker; the starter does not provision a full observability stack. RDS certificate
verification is enabled through `DATABASE_SSL_CA_FILE`.

Actual EC2 boot, IAM/network behavior, database connectivity, service startup, secret
rotation and cloud crash recovery require deployment verification. The user-data wiring
and resource assertions are implementation foundations, not evidence of a successful rollout.
