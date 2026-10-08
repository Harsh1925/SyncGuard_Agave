import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { Stack, CfnOutput, Duration, RemovalPolicy, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as assets from 'aws-cdk-lib/aws-s3-assets';
import type { Construct } from 'constructs';

export class SyncGuardStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const cidr = String(this.node.tryGetContext('allowedCidr') ?? '127.0.0.1/32');
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Compute', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'Database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });
    const computeSG = new ec2.SecurityGroup(this, 'ComputeSecurity', {
      vpc,
      description: 'Restricted HTTP demo access; administration via SSM',
    });
    computeSG.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(80), 'Dashboard and API proxy');
    const database = new rds.DatabaseInstance(this, 'StateDatabase', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromGeneratedSecret('syncguard'),
      databaseName: 'syncguard',
      allocatedStorage: 20,
      maxAllocatedStorage: 30,
      storageEncrypted: true,
      publiclyAccessible: false,
      multiAz: false,
      backupRetention: Duration.days(1),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    database.connections.allowDefaultPortFrom(computeSG);
    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    database.secret!.grantRead(role);
    const source = new assets.Asset(this, 'Source', {
      path: root,
      exclude: [
        'node_modules/**',
        '**/node_modules/**',
        '.venv/**',
        '.git/**',
        '.env',
        '.aws/**',
        '.codex/**',
        '.agents/**',
        'certs/**',
        '**/dist/**',
        '**/cdk.out/**',
        'cdk.out/**',
        'artifacts/**',
        '**/__pycache__/**',
        'syncguard.egg-info/**',
        '.pytest_cache/**',
        '.ruff_cache/**',
      ],
    });
    source.grantRead(role);
    const bootstrap = readFileSync(join(root, 'infra/cdk/bootstrap.sh'), 'utf8');
    const userdata = ec2.UserData.forLinux();
    userdata.addCommands(
      `export SYNCGUARD_REGION='${this.region}'`,
      `export SYNCGUARD_SOURCE='s3://${source.s3BucketName}/${source.s3ObjectKey}'`,
      `export SYNCGUARD_SECRET='${database.secret!.secretArn}'`,
      `export SYNCGUARD_DB_HOST='${database.dbInstanceEndpointAddress}'`,
      bootstrap,
    );
    const instance = new ec2.Instance(this, 'ApplicationInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: computeSG,
      role,
      instanceType: new ec2.InstanceType('t3.medium'),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      requireImdsv2: true,
      userData: userdata,
      blockDevices: [
        { deviceName: '/dev/xvda', volume: ec2.BlockDeviceVolume.ebs(30, { encrypted: true }) },
      ],
    });
    instance.node.addDependency(database);
    new CfnOutput(this, 'DashboardUrl', { value: `http://${instance.instancePublicIp}` });
    new CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new CfnOutput(this, 'DatabaseEndpoint', { value: database.dbInstanceEndpointAddress });
  }
}
