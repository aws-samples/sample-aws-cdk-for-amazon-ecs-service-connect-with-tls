#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsServiceConnectTlsStack } from '../lib/ecs-service-connect-tls-stack';
import { AwsSolutionsChecks } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();

new EcsServiceConnectTlsStack(app, 'EcsServiceConnectTls', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
