# AWS CDK starter — milestone 8

The scaffold defines one VPC, private RDS Postgres with generated credentials, an ECS
cluster and an image-backed Fargate task definition. **It does not launch a service and
is not a completed cloud deployment.** No AWS changes have been made.

From this directory, in a separate virtual environment:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
source .venv/bin/activate
cdk synth
```

Before deployment, complete the secret-backed DSN startup, simulator/worker/poller
containers, migration init task, persistent shared ERP storage, health checks and access
rules. Synthesizing an image asset requires Docker. Install the AWS CDK CLI separately.
RDS is retained and deletion-protected; account costs are not estimated by this scaffold.
Finish local crash/chaos proof before spending time on AWS, per the specification.
