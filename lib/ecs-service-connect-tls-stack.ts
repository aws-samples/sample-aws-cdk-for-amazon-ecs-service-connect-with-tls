import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Infra } from './constructs/infra';
import { TaskDefinitions } from './constructs/task-definitions';
import { UiTaskDefinition } from './constructs/ui-task-definition';
import { EcsServices } from './constructs/ecs-services';

export class EcsServiceConnectTlsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const certArnParam = new cdk.CfnParameter(this, 'certArn', {
      type: 'String',
      description: 'ALB Certificate ARN',
      allowedPattern: '^arn:aws:acm:[a-z0-9-]+:\\d{12}:certificate\\/[a-f0-9-]+$',
      constraintDescription: 'Must be a valid ACM certificate ARN (e.g. arn:aws:acm:us-east-1:123456789012:certificate/abcd-1234-efgh)',
    });

    const ipRangeParam = new cdk.CfnParameter(this, 'ipRange', {
      type: 'String',
      description: 'IP Range',
      allowedPattern: '^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\/\\d{1,2}$',
      constraintDescription: 'Must be a valid CIDR block (e.g. 192.168.1.0/24)',
    });

    // Shared infrastructure (VPC, cluster, RDS, ALB, PCA, roles)
    const infra = new Infra(this, 'Infra', {
      certArn: certArnParam.valueAsString,
      ipRange: ipRangeParam.valueAsString,
    });

    // Shared task definitions (catalog + assets)
    const taskDefs = new TaskDefinitions(this, 'TaskDefinitions', {
      taskExecutionRoleArn: infra.taskExecutionRoleArn,
      catalogTaskExecutionRoleArn: infra.catalogTaskExecutionRoleArn,
      taskRoleArn: infra.taskRoleArn,
      dbEndpointParameter: infra.dbEndpointParameter,
      dbCredentials: infra.dbCredentials,
    });
    taskDefs.node.addDependency(infra);

    // --- TLS-enabled instance ---
    const tlsUiTaskDef = new UiTaskDefinition(this, 'TlsUiTaskDef', {
      prefix: 'tls',
      taskExecutionRoleArn: infra.taskExecutionRoleArn,
      taskRoleArn: infra.taskRoleArn,
      catalogEndpoint: 'http://tls-catalog',
      assetsEndpoint: 'http://tls-assets',
    });
    tlsUiTaskDef.node.addDependency(infra);

    const tlsServices = new EcsServices(this, 'TlsServices', {
      prefix: 'tls',
      clusterName: infra.clusterName,
      uiTaskDefinitionArn: tlsUiTaskDef.uiTaskDefinitionArn,
      catalogTaskDefinitionArn: taskDefs.catalogTaskDefinitionArn,
      assetsTaskDefinitionArn: taskDefs.assetsTaskDefinitionArn,
      targetGroupArn: infra.tlsTargetGroupArn,
      frontendTaskSecurityGroupId: infra.frontendTaskSecurityGroupId,
      backendTaskSecurityGroupId: infra.backendTaskSecurityGroupId,
      subnets: infra.subnets,
      namespaceArn: infra.namespaceArn,
      enableTls: true,
      cfnCertificateAuthorityArn: infra.cfnCertificateAuthorityArn,
      ecsScTlsRoleArn: infra.ecsScTlsRoleArn,
    });
    tlsServices.node.addDependency(infra);
    tlsServices.node.addDependency(taskDefs);
    tlsServices.node.addDependency(tlsUiTaskDef);
  }
}
