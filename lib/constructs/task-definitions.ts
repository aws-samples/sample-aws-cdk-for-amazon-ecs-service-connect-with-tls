import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from "aws-cdk-lib/aws-ecs";
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { NagSuppressions } from 'cdk-nag';

export interface TaskDefinitionsProps {
  readonly taskExecutionRoleArn: string;
  readonly catalogTaskExecutionRoleArn: string;
  readonly taskRoleArn: string;
  readonly dbEndpointParameter: StringParameter;
  readonly dbCredentials: Secret;
}

export class TaskDefinitions extends Construct {
  public readonly catalogTaskDefinitionArn: string;
  public readonly assetsTaskDefinitionArn: string;

  constructor(scope: Construct, id: string, props: TaskDefinitionsProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const region = stack.region;
    const account = stack.account;

    const assetsTaskDefinition = new ecs.CfnTaskDefinition(this, 'AssetsTaskDef', {
      family: "ecs-sample-assets",
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "1024",
      memory: "2048",
      runtimePlatform: {
        cpuArchitecture: "X86_64",
        operatingSystemFamily: "LINUX",
      },
      containerDefinitions: [{
        name: "application",
        image: "public.ecr.aws/aws-containers/retail-store-sample-assets:0.7.0",
        portMappings: [{
          name: "application",
          containerPort: 8080,
          hostPort: 8080,
          protocol: "tcp",
          appProtocol: "http",
        }],
        essential: true,
        linuxParameters: { initProcessEnabled: true },
        healthCheck: {
          command: ["CMD-SHELL", "curl -f http://localhost:8080/health.html || exit 1"],
          interval: 5,
          timeout: 3,
          retries: 2,
          startPeriod: 10,
        },
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": "ecs-sample-ecs-tasks",
            "awslogs-region": region,
            "awslogs-stream-prefix": "assets-service",
          },
        },
      }],
      executionRoleArn: props.taskExecutionRoleArn,
      taskRoleArn: props.taskRoleArn,
    });

    const catalogTaskDefinition = new ecs.CfnTaskDefinition(this, 'CatalogTaskDef', {
      family: "ecs-sample-catalog",
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "1024",
      memory: "2048",
      runtimePlatform: {
        cpuArchitecture: "X86_64",
        operatingSystemFamily: "LINUX",
      },
      containerDefinitions: [{
        name: "application",
        image: "public.ecr.aws/aws-containers/retail-store-sample-catalog:0.7.0",
        portMappings: [{
          name: "application",
          containerPort: 8080,
          hostPort: 8080,
          protocol: "tcp",
          appProtocol: "http",
        }],
        essential: true,
        linuxParameters: { initProcessEnabled: true },
        healthCheck: {
          command: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
          interval: 5,
          timeout: 3,
          retries: 2,
          startPeriod: 10,
        },
        environment: [{ name: "DB_NAME", value: "catalog" }],
        secrets: [
          {
            name: "DB_ENDPOINT",
            valueFrom: `arn:aws:ssm:${region}:${account}:parameter${props.dbEndpointParameter.parameterName}`,
          },
          {
            name: "DB_PASSWORD",
            valueFrom: `arn:aws:secretsmanager:${region}:${account}:secret:${props.dbCredentials.secretName}:password::`,
          },
          {
            name: "DB_USER",
            valueFrom: `arn:aws:secretsmanager:${region}:${account}:secret:${props.dbCredentials.secretName}:username::`,
          },
        ],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": "ecs-sample-ecs-tasks",
            "awslogs-region": region,
            "awslogs-stream-prefix": "catalog-service",
          },
        },
      }],
      executionRoleArn: props.catalogTaskExecutionRoleArn,
      taskRoleArn: props.taskRoleArn,
    });

    this.assetsTaskDefinitionArn = assetsTaskDefinition.attrTaskDefinitionArn;
    this.catalogTaskDefinitionArn = catalogTaskDefinition.attrTaskDefinitionArn;

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(catalogTaskDefinition, [{
      id: 'AwsSolutions-ECS2',
      reason: 'DB_NAME is a non-sensitive static database name, not a secret',
    }]);
  }
}
