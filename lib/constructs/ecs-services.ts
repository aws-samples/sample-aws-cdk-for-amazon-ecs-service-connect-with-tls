import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";

export interface EcsServicesProps {
  readonly prefix: string;
  readonly clusterName: string;
  readonly uiTaskDefinitionArn: string;
  readonly catalogTaskDefinitionArn: string;
  readonly assetsTaskDefinitionArn: string;
  readonly targetGroupArn: string;
  readonly frontendTaskSecurityGroupId: string;
  readonly backendTaskSecurityGroupId: string;
  readonly subnets: string[];
  readonly namespaceArn: string;
  readonly enableTls: boolean;
  readonly cfnCertificateAuthorityArn?: string;
  readonly ecsScTlsRoleArn?: string;
}

export class EcsServices extends Construct {
  constructor(scope: Construct, id: string, props: EcsServicesProps) {
    super(scope, id);

    const prefix = props.prefix;
    const region = cdk.Stack.of(this).region;

    const tlsConfig = props.enableTls && props.cfnCertificateAuthorityArn && props.ecsScTlsRoleArn
      ? {
          issuerCertificateAuthority: {
            awsPcaAuthorityArn: props.cfnCertificateAuthorityArn,
          },
          roleArn: props.ecsScTlsRoleArn,
        }
      : undefined;

    // Service Connect proxy log group
    const scLogGroup = new logs.LogGroup(this, 'ServiceConnectLogGroup', {
      logGroupName: `ecs-sample-${prefix}-service-connect`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const scLogConfiguration = {
      logDriver: "awslogs",
      options: {
        "awslogs-group": scLogGroup.logGroupName,
        "awslogs-region": region,
        "awslogs-stream-prefix": "service-connect",
      },
    };

    const catalogService = new ecs.CfnService(this, 'catalogService', {
      serviceName: `${prefix}-catalog`,
      cluster: props.clusterName,
      taskDefinition: props.catalogTaskDefinitionArn,
      desiredCount: 1,
      enableExecuteCommand: false,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          securityGroups: [props.backendTaskSecurityGroupId],
          subnets: props.subnets,
          assignPublicIp: "DISABLED",
        },
      },
      serviceConnectConfiguration: {
        enabled: true,
        namespace: props.namespaceArn,
        logConfiguration: scLogConfiguration,
        services: [{
          portName: "application",
          discoveryName: `${prefix}-catalog`,
          clientAliases: [{ port: 80, dnsName: `${prefix}-catalog` }],
          tls: tlsConfig,
        }],
      },
    });

    const assetsService = new ecs.CfnService(this, 'assetsService', {
      serviceName: `${prefix}-assets`,
      cluster: props.clusterName,
      taskDefinition: props.assetsTaskDefinitionArn,
      desiredCount: 1,
      enableExecuteCommand: false,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          securityGroups: [props.backendTaskSecurityGroupId],
          subnets: props.subnets,
          assignPublicIp: "DISABLED",
        },
      },
      serviceConnectConfiguration: {
        enabled: true,
        namespace: props.namespaceArn,
        logConfiguration: scLogConfiguration,
        services: [{
          portName: "application",
          discoveryName: `${prefix}-assets`,
          clientAliases: [{ port: 80, dnsName: `${prefix}-assets` }],
          tls: tlsConfig,
        }],
      },
    });

    const uiService = new ecs.CfnService(this, 'uiService', {
      serviceName: `${prefix}-ui`,
      cluster: props.clusterName,
      taskDefinition: props.uiTaskDefinitionArn,
      desiredCount: 1,
      enableExecuteCommand: false,
      launchType: "FARGATE",
      loadBalancers: [{
        targetGroupArn: props.targetGroupArn,
        containerName: "application",
        containerPort: 8080,
      }],
      networkConfiguration: {
        awsvpcConfiguration: {
          securityGroups: [props.frontendTaskSecurityGroupId],
          subnets: props.subnets,
          assignPublicIp: "DISABLED",
        },
      },
      serviceConnectConfiguration: {
        enabled: true,
        namespace: props.namespaceArn,
        logConfiguration: scLogConfiguration,
        services: [{
          portName: "application",
          discoveryName: `${prefix}-ui`,
          clientAliases: [{ port: 80, dnsName: `${prefix}-ui` }],
          tls: tlsConfig,
        }],
      },
    });

    uiService.addDependency(assetsService);
    uiService.addDependency(catalogService);
  }
}
