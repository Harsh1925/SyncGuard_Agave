#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { SyncGuardStack } from '../lib/stack.js';
const app = new App();
new SyncGuardStack(app, 'SyncGuardDemo', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
