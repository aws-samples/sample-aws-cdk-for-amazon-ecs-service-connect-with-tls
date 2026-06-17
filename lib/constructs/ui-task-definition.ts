import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from "aws-cdk-lib/aws-ecs";
import { NagSuppressions } from 'cdk-nag';

export interface UiTaskDefinitionProps {
  readonly prefix: string;
  readonly taskExecutionRoleArn: string;
  readonly taskRoleArn: string;
  readonly catalogEndpoint: string;
  readonly assetsEndpoint: string;
}

export class UiTaskDefinition extends Construct {
  public readonly uiTaskDefinitionArn: string;

  constructor(scope: Construct, id: string, props: UiTaskDefinitionProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const region = stack.region;

    const uiTaskDefinition = new ecs.CfnTaskDefinition(this, 'UiTaskDef', {
      family: `ecs-sample-${props.prefix}-ui`,
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
        image: "public.ecr.aws/aws-containers/retail-store-sample-ui:0.7.0",
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
          command: ["CMD-SHELL", "curl -f http://localhost:8080/actuator/health || exit 1"],
          interval: 5,
          timeout: 3,
          retries: 2,
          startPeriod: 10,
        },
        environment: [
          { name: "ENDPOINTS_CATALOG", value: props.catalogEndpoint },
          { name: "ENDPOINTS_ASSETS", value: props.assetsEndpoint },
        ],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": "ecs-sample-ecs-tasks",
            "awslogs-region": region,
            "awslogs-stream-prefix": `${props.prefix}-ui-service`,
          },
        },
      }],
      executionRoleArn: props.taskExecutionRoleArn,
      taskRoleArn: props.taskRoleArn,
    });

    this.uiTaskDefinitionArn = uiTaskDefinition.attrTaskDefinitionArn;

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(uiTaskDefinition, [{
      id: 'AwsSolutions-ECS2',
      reason: 'ENDPOINTS_CATALOG and ENDPOINTS_ASSETS are non-sensitive service discovery URLs',
    }]);
  }
}
