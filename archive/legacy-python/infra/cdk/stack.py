from pathlib import Path

from aws_cdk import CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_ec2 as ec2
from aws_cdk import aws_ecs as ecs
from aws_cdk import aws_rds as rds
from constructs import Construct


class SyncGuardStack(Stack):
    """One-stack infrastructure starter; deployment activation is intentionally deferred."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs):
        super().__init__(scope, construct_id, **kwargs)
        vpc = ec2.Vpc(
            self,
            "Vpc",
            max_azs=2,
            nat_gateways=0,
            subnet_configuration=[
                ec2.SubnetConfiguration(name="Public", subnet_type=ec2.SubnetType.PUBLIC),
                ec2.SubnetConfiguration(
                    name="Database", subnet_type=ec2.SubnetType.PRIVATE_ISOLATED
                ),
            ],
        )
        compute_security = ec2.SecurityGroup(self, "ComputeSecurity", vpc=vpc)
        database = rds.DatabaseInstance(
            self,
            "StateDatabase",
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_ISOLATED),
            engine=rds.DatabaseInstanceEngine.postgres(version=rds.PostgresEngineVersion.VER_17),
            instance_type=ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
            database_name="syncguard",
            credentials=rds.Credentials.from_generated_secret("syncguard"),
            allocated_storage=20,
            max_allocated_storage=30,
            storage_encrypted=True,
            publicly_accessible=False,
            multi_az=False,
            backup_retention=Duration.days(1),
            deletion_protection=True,
            removal_policy=RemovalPolicy.RETAIN,
        )
        database.connections.allow_default_port_from(compute_security)
        cluster = ecs.Cluster(self, "Cluster", vpc=vpc)
        task = ecs.FargateTaskDefinition(self, "ApplicationTask", cpu=256, memory_limit_mib=512)
        image = ecs.ContainerImage.from_asset(str(Path(__file__).resolve().parents[2]))
        container = task.add_container(
            "Api",
            image=image,
            logging=ecs.LogDrivers.aws_logs(stream_prefix="syncguard"),
            environment={"SYNCGUARD_PM_URL": "http://localhost:8002"},
            secrets={
                "SYNCGUARD_DB_PASSWORD": ecs.Secret.from_secrets_manager(
                    database.secret, "password"
                )
            },
        )
        container.add_port_mappings(ecs.PortMapping(container_port=8000))
        # Before adding an ECS Service: construct a secret-backed DSN at startup,
        # persist ERP SQLite on shared EFS (or use a separate ERP Postgres database),
        # define PM/worker/poller containers, run migrations, and add demo access rules.
        # This starter defines compute but launches zero tasks; see infra/cdk/README.md.
        CfnOutput(self, "DatabaseEndpoint", value=database.db_instance_endpoint_address)
        CfnOutput(self, "ClusterName", value=cluster.cluster_name)
        CfnOutput(self, "TaskDefinition", value=task.task_definition_arn)
