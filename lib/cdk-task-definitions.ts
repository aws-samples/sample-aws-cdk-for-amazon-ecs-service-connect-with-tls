import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from "aws-cdk-lib/aws-ecs";
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';

interface CustomProps extends cdk.StackProps {
  readonly taskExecutionRoleArn: string
  readonly catalogTaskExecutionRoleArn: string
  readonly taskRoleArn: string
  readonly dbEndpointParameter: StringParameter
  readonly dbCredentials: Secret
}

export class CdkTaskDefinitionsStack extends cdk.Stack {
  public uiTaskDefinitionArn: string;
  public catalogTaskDefinitionArn: string;
  public assetsTaskDefinitionArn: string;

  constructor(scope: Construct, id: string, props: CustomProps) {
    super(scope, id, props);

    const region = cdk.Stack.of(this).region;
    const account = cdk.Stack.of(this).account;

    const assetsTaskDefinition = new ecs.CfnTaskDefinition(this, 'AssetsTaskDef', {
      family: "ecs-sample-assets",
      networkMode: "awsvpc",
      requiresCompatibilities: [
        "FARGATE"
      ],
      cpu: "1024",
      memory: "2048",
      runtimePlatform: {
        cpuArchitecture: "X86_64",
        operatingSystemFamily: "LINUX"
      },
      containerDefinitions: [{
        name: "application",
        image: "public.ecr.aws/aws-containers/retail-store-sample-assets:0.7.0",
        portMappings: [{
          name: "application",
          containerPort: 8080,
          hostPort: 8080,
          protocol: "tcp",
          appProtocol: "http"
        }],
        essential: true,
        linuxParameters: {
          initProcessEnabled: true
        },
        healthCheck: {
          command: [
            "CMD-SHELL",
            "curl -f http://localhost:8080/health.html || exit 1"
          ],
          interval: 10,
          timeout: 5,
          retries: 3,
          startPeriod: 60
        },
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": "ecs-sample-ecs-tasks",
            "awslogs-region": region,
            "awslogs-stream-prefix": "assets-service"
          }
        }
      }],
      executionRoleArn: props.taskExecutionRoleArn,
      taskRoleArn: props.taskRoleArn
    });


    const catalogTaskDefinition = new ecs.CfnTaskDefinition(this, 'CatalogTaskDef', {
      family: "ecs-sample-catalog",
      networkMode: "awsvpc",
      requiresCompatibilities: [
        "FARGATE"
      ],
      cpu: "1024",
      memory: "2048",
      runtimePlatform: {
        cpuArchitecture: "X86_64",
        operatingSystemFamily: "LINUX"
      },
      containerDefinitions: [{
        name: "application",
        image: "public.ecr.aws/aws-containers/retail-store-sample-catalog:0.7.0",
        portMappings: [{
          name: "application",
          containerPort: 8080,
          hostPort: 8080,
          protocol: "tcp",
          appProtocol: "http"
        }],

        essential: true,
        linuxParameters: {
          initProcessEnabled: true
        },
        healthCheck: {
          command: [
            "CMD-SHELL",
            "curl -f http://localhost:8080/health || exit 1"
          ],
          interval: 10,
          timeout: 5,
          retries: 3,
          startPeriod: 60
        },
        environment: [{
          name: "DB_NAME",
          value: "catalog"
        }],
        secrets: [{
          name: "DB_ENDPOINT",
          valueFrom: `arn:aws:ssm:${region}:${account}:parameter${props.dbEndpointParameter.parameterName}`
        },
        {
          name: "DB_PASSWORD",
          valueFrom: `arn:aws:secretsmanager:${region}:${account}:secret:${props.dbCredentials.secretName}:password::`
        },
        {
          name: "DB_USER",
          valueFrom: `arn:aws:secretsmanager:${region}:${account}:secret:${props.dbCredentials.secretName}:username::`
        }],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": "ecs-sample-ecs-tasks",
            "awslogs-region": region,
            "awslogs-stream-prefix": "catalog-service"
          }
        }
      }],
      executionRoleArn: props.catalogTaskExecutionRoleArn,
      taskRoleArn: props.taskRoleArn
    });

    const uiTaskDefinition = new ecs.CfnTaskDefinition(this, 'UiTaskDef', {
      family: "ecs-sample-ui",
      networkMode: "awsvpc",
      requiresCompatibilities: [
        "FARGATE"
      ],
      cpu: "1024",
      memory: "2048",
      runtimePlatform: {
        cpuArchitecture: "X86_64",
        operatingSystemFamily: "LINUX"
      },
      containerDefinitions: [{
        name: "application",
        image: "public.ecr.aws/aws-containers/retail-store-sample-ui:0.7.0",
        portMappings: [{
          name: "application",
          containerPort: 8080,
          hostPort: 8080,
          protocol: "tcp",
          appProtocol: "http"
        }],
        essential: true,
        linuxParameters: {
          initProcessEnabled: true
        },
        healthCheck: {
          command: [
            "CMD-SHELL",
            "curl -f http://localhost:8080/actuator/health || exit 1"
          ],
          interval: 10,
          timeout: 5,
          retries: 3,
          startPeriod: 60
        },
        environment: [{
          name: "ENDPOINTS_CATALOG",
          value: "http://catalog"
        },
        {
          name: "ENDPOINTS_ASSETS",
          value: "http://assets"
        }],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": `ecs-sample-ecs-tasks`,
            "awslogs-region": region,
            "awslogs-stream-prefix": "ui-service"
          }
        }
      }],
      executionRoleArn: props.taskExecutionRoleArn,
      taskRoleArn: props.taskRoleArn
    });

    this.uiTaskDefinitionArn = uiTaskDefinition.attrTaskDefinitionArn;
    this.assetsTaskDefinitionArn = assetsTaskDefinition.attrTaskDefinitionArn;
    this.catalogTaskDefinitionArn = catalogTaskDefinition.attrTaskDefinitionArn;
  }
}
