import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { expect, it } from 'vitest';
import { SyncGuardStack } from '../lib/stack.js';
it('uses EC2, private encrypted RDS, CIDR-scoped HTTP, and no ECS service', () => {
  const app = new App({
    outdir: mkdtempSync(join(tmpdir(), 'syncguard-cdk-')),
    context: { allowedCidr: '203.0.113.10/32' },
  });
  const stack = new SyncGuardStack(app, 'Test', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::EC2::Instance', 1);
  template.resourceCountIs('AWS::ECS::Service', 0);
  template.hasResourceProperties('AWS::RDS::DBInstance', {
    Engine: 'postgres',
    PubliclyAccessible: false,
    StorageEncrypted: true,
    DeletionProtection: true,
  });
  template.hasResourceProperties('AWS::EC2::SecurityGroup', {
    SecurityGroupIngress: Match.arrayWith([
      Match.objectLike({ CidrIp: '203.0.113.10/32', FromPort: 80, ToPort: 80 }),
    ]),
  });
  expect(template.findResources('AWS::EC2::Instance')).toBeTruthy();
});
