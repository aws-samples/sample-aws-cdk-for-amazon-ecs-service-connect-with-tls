#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkInfra } from '../lib/cdk-infra';
import { CdkEcsServices } from '../lib/cdk-ecs-services';
import { CdkTaskDefinitionsStack } from '../lib/cdk-task-definitions';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();
const infra = new CdkInfra(app, 'SampleInfra', {});

const taskDef = new CdkTaskDefinitionsStack(app, 'SampleTaskDefinitionsStack', {
    taskExecutionRoleArn: infra.taskExecutionRoleArn,
    catalogTaskExecutionRoleArn: infra.catalogTaskExecutionRoleArn,
    taskRoleArn: infra.taskRoleArn,
    dbEndpointParameter: infra.dbEndpointParameter,
    dbCredentials: infra.dbCredentials
});
taskDef.addDependency(infra);

const services = new CdkEcsServices(app, 'SampleEcsServices', {
    clusterName: infra.clusterName,
    uiTaskDefinitionArn: taskDef.uiTaskDefinitionArn,
    catalogTaskDefinitionArn: taskDef.catalogTaskDefinitionArn,
    assetsTaskDefinitionArn: taskDef.assetsTaskDefinitionArn,
    targetGroupArn: infra.targetGroupArn,
    frontendTaskSecurityGroupId: infra.frontendTaskSecurityGroupId,
    backendTaskSecurityGroupId: infra.backendTaskSecurityGroupId,
    subnets: infra.subnets,
    namespaceArn: infra.namespaceArn,
    cfnCertificateAuthorityArn: infra.cfnCertificateAuthorityArn,
    ecsScTlsRoleArn: infra.ecsScTlsRoleArn,
});
services.addDependency(infra);
services.addDependency(taskDef);

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))  