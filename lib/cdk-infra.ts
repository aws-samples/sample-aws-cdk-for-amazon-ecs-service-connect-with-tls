import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as logs from "aws-cdk-lib/aws-logs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as serviceDiscovery from "aws-cdk-lib/aws-servicediscovery";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as kms from "aws-cdk-lib/aws-kms";
import * as rds from "aws-cdk-lib/aws-rds";
import { aws_acmpca as acmpca } from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export class CdkInfra extends cdk.Stack {
  public clusterName: string;
  public targetGroupArn: string;
  public frontendTaskSecurityGroupId: string;
  public backendTaskSecurityGroupId: string;
  public subnets: string[];
  public namespaceArn: string;
  public cfnCertificateAuthorityArn: string;
  public ecsScTlsRoleArn: string;
  public taskRoleArn: string;
  public taskExecutionRoleArn: string;
  public catalogTaskExecutionRoleArn: string;
  public dbEndpointParameter: ssm.StringParameter;
  public dbCredentials: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const certArnParam = new cdk.CfnParameter(this, 'certArn', {
      type: 'String',
      description: 'ALB Certificate ARN'
    });

    const ipRangeParam = new cdk.CfnParameter(this, 'ipRange', {
      type: 'String',
      description: 'IP Range'
    });

    const certArn = certArnParam.valueAsString;
    const ipRange = ipRangeParam.valueAsString;
    const HTTP_PORT = 8080;
    const HTTPS_PORT = 443;
    const MYSQL_PORT = 3306; 

    const vpc = new ec2.Vpc(this, "VPC", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      vpcName: "ecs-sample-vpc",
      natGateways: 1,
      subnetConfiguration: [
        {
          subnetType: ec2.SubnetType.PUBLIC,
          name: "Public",
          mapPublicIpOnLaunch: true,
          cidrMask: 24,
        },
        {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          name: "Private",
          cidrMask: 24,
        },
      ],
      availabilityZones: [
        cdk.Fn.sub("${Region}a", {
          Region: cdk.Aws.REGION,
        }),
        cdk.Fn.sub("${Region}b", {
          Region: cdk.Aws.REGION,
        }),
      ],
      restrictDefaultSecurityGroup: false,
    });

    vpc.addFlowLog("FlowLogs",{
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
      trafficType: ec2.FlowLogTrafficType.REJECT
    });

    const namespace = new serviceDiscovery.PrivateDnsNamespace(this, "DnsNamespace", {
      name: "ecs-sample.local",
      description: "Service discovery namespace",
      vpc,
    });

    const cluster = new ecs.Cluster(this, "EcsCluster", {
      clusterName: "ecs-sample-cluster",
      vpc: vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const taskExecutionRole = new iam.Role(this, "EcsTaskExecutionRole", {
      roleName: "ecs-sample-EcsTaskExecutionRole",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "ECS Default Task Execution Role",
    },
    );

    taskExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy",
      ),
    );

    const taskRole = new iam.Role(this, "EcsTaskRole", {
      roleName: "ecs-sample-EcsTaskRole",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "ECS Default Task Role",
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, "ALBSecurityGroup", {
      vpc,
      securityGroupName: "ecs-sample-alb-sg",
      allowAllOutbound: true,
      description: "Security Group for the UI Application Load Balancer",
    });

    albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(ipRange),
      ec2.Port.tcp(HTTPS_PORT),
      "Allow HTTPS inbound traffic",
    );

    const frontendTaskSecurityGroup = new ec2.SecurityGroup(this, "frontendTaskSecurityGroup", {
      vpc,
      securityGroupName: "ecs-sample-frontend-sg",
      description: "Security Group for ECS Frontend Task",
    });

    frontendTaskSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(albSecurityGroup.securityGroupId),
      ec2.Port.tcp(HTTP_PORT),
      "Allow inbound traffic",
    );

    const backendTaskSecurityGroup = new ec2.SecurityGroup(this, "backendTaskSecurityGroup", {
      vpc,
      securityGroupName: "ecs-sample-backend-sg",
      description: "Security Group for ECS Backend Task",
    });

    backendTaskSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(frontendTaskSecurityGroup.securityGroupId),
      ec2.Port.tcp(HTTP_PORT),
      "Allow inbound traffic from the taskSecurityGroup",
    );

    const catalogRDSSecurityGroup = new ec2.SecurityGroup(this, "CatalogRDSSecurityGroup", {
      vpc,
      securityGroupName: "ecs-sample-catalog-rds",
      description: "Security group for Catalog RDS instance",
    });

    catalogRDSSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(backendTaskSecurityGroup.securityGroupId),
      ec2.Port.tcp(MYSQL_PORT),
      "Allow MySQL access from the task Security Group",
    );

    const taskTlsRole = new iam.Role(this, "taskTlsRole", {
      roleName: "ecs-sample-EcsCertificateRole",
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
      description: "ECS Role for TLS",
    },
    );

    taskTlsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSInfrastructureRolePolicyForServiceConnectTransportLayerSecurity",
      ),
    );

    const cfnCertificateAuthority = new acmpca.CfnCertificateAuthority(this, "CertificateAuthority", {
      type: "ROOT",
      keyAlgorithm: "RSA_2048",
      signingAlgorithm: "SHA256WITHRSA",
      usageMode: "SHORT_LIVED_CERTIFICATE",
      subject: {
        country: "US",
        organization: "ecs-sample",
        organizationalUnit: "ecs-sample-ou",
      },
      tags: [
        {
          key: "AmazonECSManaged",
          value: "true",
        },
      ],
    },
    );

    const cfnCACertificate = new acmpca.CfnCertificate(this, "CertificateAuthorityCertificate", {
      certificateAuthorityArn: cfnCertificateAuthority.attrArn,
      certificateSigningRequest:
        cfnCertificateAuthority.attrCertificateSigningRequest,
      signingAlgorithm: "SHA256WITHRSA",
      validity: {
        type: "YEARS",
        value: 2,
      },
      templateArn: "arn:aws:acm-pca:::template/RootCACertificate/V1",
    },
    );

    new acmpca.CfnCertificateAuthorityActivation(
      this,
      "CertificateAuthorityActivation",
      {
        certificate: cfnCACertificate.attrCertificate,
        certificateAuthorityArn: cfnCertificateAuthority.attrArn,
      },
    );

    const targetGroupTLS = new elbv2.ApplicationTargetGroup(this, "TargetGroupTLS", {
      vpc,
      targetGroupName: "ecs-sample-tls",
      port: HTTP_PORT,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        port: HTTP_PORT.toString(),
        path: "/actuator/health",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    }
    );

    const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }),
      internetFacing: true,
      loadBalancerName: "ecs-sample-alb",
      securityGroup: albSecurityGroup,
    });

    const listener = alb.addListener('Listener', {
      port: HTTPS_PORT,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      defaultAction: elbv2.ListenerAction.forward([targetGroupTLS]),
      certificates: [{
        certificateArn: certArn
      }],
      sslPolicy: elbv2.SslPolicy.TLS13_EXT2
    });

    listener.addTargetGroups("AddTargetGroups", {
      targetGroups: [targetGroupTLS],
    });

    const kmsKey = new kms.Key(this, "KMSKey", {
      description: `ecs-sample CMK`,
      enableKeyRotation: true,
    });

    const dbCredentialSecret = new secretsmanager.Secret(this, "DBCredentialsSecret", {
      secretName: "ecs-sample-catalog-db",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "root" }),
        generateStringKey: "password",
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 10,
      },
      encryptionKey: kmsKey,
    },
    );

    const catalogRDSCluster = new rds.DatabaseCluster(this, "CatalogRDSCluster", {
      clusterIdentifier: "ecs-sample-catalog",
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_2_12_2,
      }),
      defaultDatabaseName: "catalog",
      storageEncrypted: true,
      credentials: rds.Credentials.fromSecret(dbCredentialSecret),
      vpc,
      vpcSubnets: {
        subnets: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }).subnets,
      },
      securityGroups: [catalogRDSSecurityGroup],
      writer: rds.ClusterInstance.provisioned("writer", {
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
            ec2.InstanceSize.SMALL,
        ),
      }),
    });

    cdk.Tags.of(catalogRDSCluster).add("environment-name", "ecs-sample");

    const dbEndpointParameter = new ssm.StringParameter(this, "DBEndpointParameter", {
      parameterName: "/ecs-sample/catalog/db-endpoint",
      stringValue: cdk.Fn.join(":", [
        catalogRDSCluster.clusterEndpoint.hostname,
        catalogRDSCluster.clusterEndpoint.port.toString(),
      ]),
    });

    const catalogTaskExecutionRole = new iam.Role(this, "CatalogEcsTaskExecutionRole", {
      roleName: "ecs-sample-CatalogEcsTaskExecutionRole",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "ECS Catalog Task Execution Role",
    });

    catalogTaskExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy",
      ),
    );

    catalogTaskExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [
          dbCredentialSecret.secretArn,
          kmsKey.keyArn,
          dbEndpointParameter.parameterArn,
        ],
        actions: [
          "secretsmanager:GetSecretValue",
          "kms:Decrypt",
          "ssm:GetParameters",
        ],
      }),
    );

    new logs.LogGroup(this, "WorkshopLogGroup", {
      logGroupName: "ecs-sample-ecs-tasks",
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'ecsSampleAlbDns', { value: alb.loadBalancerDnsName});

    this.dbCredentials = dbCredentialSecret;
    this.dbEndpointParameter = dbEndpointParameter;
    this.clusterName = cluster.clusterName;
    this.targetGroupArn = targetGroupTLS.targetGroupArn;
    this.frontendTaskSecurityGroupId = frontendTaskSecurityGroup.securityGroupId;
    this.backendTaskSecurityGroupId = backendTaskSecurityGroup.securityGroupId;
    this.subnets = vpc.privateSubnets.map((x) => x.subnetId);
    this.namespaceArn = namespace.namespaceArn;
    this.cfnCertificateAuthorityArn = cfnCertificateAuthority.attrArn;
    this.ecsScTlsRoleArn = taskTlsRole.roleArn;
    this.taskRoleArn = taskRole.roleArn;
    this.taskExecutionRoleArn = taskExecutionRole.roleArn;
    this.catalogTaskExecutionRoleArn = catalogTaskExecutionRole.roleArn;
  }
}
