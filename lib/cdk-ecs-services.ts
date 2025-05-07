import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from "aws-cdk-lib/aws-ecs";

export interface CustomProps extends cdk.StackProps {
  readonly clusterName: string;
  readonly uiTaskDefinitionArn: string;
  readonly catalogTaskDefinitionArn: string;
  readonly assetsTaskDefinitionArn: string;
  readonly targetGroupArn: string;
  readonly frontendTaskSecurityGroupId: string;
  readonly backendTaskSecurityGroupId: string;
  readonly subnets: string[];
  readonly namespaceArn: string;
  readonly cfnCertificateAuthorityArn: string;
  readonly ecsScTlsRoleArn: string;
}

export class CdkEcsServices extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CustomProps) {
    super(scope, id, props);

    const catalogService = new ecs.CfnService(this, 'catalogService', {
      serviceName: "catalog",
      cluster: props.clusterName,
      taskDefinition: props.catalogTaskDefinitionArn,
      desiredCount: 1,
      enableExecuteCommand: false,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          securityGroups: [props.backendTaskSecurityGroupId],
          subnets: props.subnets,
          assignPublicIp: "DISABLED"
        }
      },
      serviceConnectConfiguration: {
        enabled: true,
        namespace: props.namespaceArn,
        services: [{
          portName: "application",
          discoveryName: "catalog",
          clientAliases: [{
            port: 80,
            dnsName: "catalog"
          }],
          tls: {
            issuerCertificateAuthority: {
              awsPcaAuthorityArn: props.cfnCertificateAuthorityArn,
            },
            roleArn: props.ecsScTlsRoleArn
          }
        }]
      }
    });

    const assetsService = new ecs.CfnService(this, 'assetsService', {
      serviceName: "assets",
      cluster: props.clusterName,
      taskDefinition: props.assetsTaskDefinitionArn,
      desiredCount: 1,
      enableExecuteCommand: false,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          securityGroups: [props.backendTaskSecurityGroupId],
          subnets: props.subnets,
          assignPublicIp: "DISABLED"
        }
      },
      serviceConnectConfiguration: {
        enabled: true,
        namespace: props.namespaceArn,
        services: [{
          portName: "application",
          discoveryName: "assets",
          clientAliases: [{
            port: 80,
            dnsName: "assets"
          }],
          tls: {
            issuerCertificateAuthority: {
              awsPcaAuthorityArn: props.cfnCertificateAuthorityArn,
            },
            roleArn: props.ecsScTlsRoleArn
          }
        }]
      }
    });

    const uiService = new ecs.CfnService(this, 'uiService', {
      serviceName: "ui",
      cluster: props.clusterName,
      taskDefinition: props.uiTaskDefinitionArn,
      desiredCount: 1,
      enableExecuteCommand: false,
      launchType: "FARGATE",
      loadBalancers: [{
        targetGroupArn: props.targetGroupArn,
        containerName: "application",
        containerPort: 8080
      }],
      networkConfiguration: {
        awsvpcConfiguration: {
          securityGroups: [props.frontendTaskSecurityGroupId],
          subnets: props.subnets,
          assignPublicIp: "DISABLED"
        }
      },
      serviceConnectConfiguration: {
        enabled: true,
        namespace: props.namespaceArn,
        services: [{
          portName: "application",
          discoveryName: "ui-tls",
          clientAliases: [{
            port: 80,
            dnsName: "ui-tls"
          }],
          tls: {
            issuerCertificateAuthority: {
              awsPcaAuthorityArn: props.cfnCertificateAuthorityArn,
            },
            roleArn: props.ecsScTlsRoleArn
          }
        }]
      }
    });

    uiService.addDependency(assetsService);
    uiService.addDependency(catalogService);
  }
}
