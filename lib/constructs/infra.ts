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
import * as s3 from "aws-cdk-lib/aws-s3";
import { aws_acmpca as acmpca } from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { NagSuppressions } from 'cdk-nag';

export interface InfraProps {
  readonly certArn: string;
  readonly ipRange: string;
}

export class Infra extends Construct {
  public readonly clusterName: string;
  public readonly tlsTargetGroupArn: string;
  public readonly frontendTaskSecurityGroupId: string;
  public readonly backendTaskSecurityGroupId: string;
  public readonly subnets: string[];
  public readonly namespaceArn: string;
  public readonly cfnCertificateAuthorityArn: string;
  public readonly ecsScTlsRoleArn: string;
  public readonly taskRoleArn: string;
  public readonly taskExecutionRoleArn: string;
  public readonly catalogTaskExecutionRoleArn: string;
  public readonly dbEndpointParameter: ssm.StringParameter;
  public readonly dbCredentials: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: InfraProps) {
    super(scope, id);

    const certArn = props.certArn;
    const ipRange = props.ipRange;
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
        cdk.Fn.sub("${Region}a", { Region: cdk.Aws.REGION }),
        cdk.Fn.sub("${Region}b", { Region: cdk.Aws.REGION }),
      ],
      restrictDefaultSecurityGroup: true,
    });

    const flowLogsLogGroup = new logs.LogGroup(this, "FlowLogsLogGroup", {
      logGroupName: "ecs-sample-vpc-flow-logs",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    vpc.addFlowLog("FlowLogs", {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogsLogGroup),
      trafficType: ec2.FlowLogTrafficType.ACCEPT,
      logFormat: [
        ec2.LogFormat.VERSION,
        ec2.LogFormat.ACCOUNT_ID,
        ec2.LogFormat.INTERFACE_ID,
        ec2.LogFormat.SRC_ADDR,
        ec2.LogFormat.DST_ADDR,
        ec2.LogFormat.SRC_PORT,
        ec2.LogFormat.DST_PORT,
        ec2.LogFormat.PROTOCOL,
        ec2.LogFormat.PACKETS,
        ec2.LogFormat.BYTES,
        ec2.LogFormat.START_TIMESTAMP,
        ec2.LogFormat.END_TIMESTAMP,
        ec2.LogFormat.ACTION,
        ec2.LogFormat.LOG_STATUS,
        ec2.LogFormat.FLOW_DIRECTION,
        ec2.LogFormat.TRAFFIC_PATH,
        ec2.LogFormat.custom('${encryption-status}'),
      ],
    });

    const namespace = new serviceDiscovery.PrivateDnsNamespace(this, "DnsNamespace", {
      name: "ecs-sample.local",
      description: "Service discovery namespace",
      vpc,
    });

    const cluster = new ecs.Cluster(this, "EcsCluster", {
      clusterName: "ecs-sample-cluster",
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    const taskExecutionRole = new iam.Role(this, "EcsTaskExecutionRole", {
      roleName: "ecs-sample-EcsTaskExecutionRole",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "ECS Default Task Execution Role",
    });

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

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ],
        resources: ["*"],
      }),
    );

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

    // TLS resources (Private CA + TLS role)
    const taskTlsRole = new iam.Role(this, "taskTlsRole", {
      roleName: "ecs-sample-EcsCertificateRole",
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
      description: "ECS Role for TLS",
    });

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
      tags: [{ key: "AmazonECSManaged", value: "true" }],
    });

    const cfnCACertificate = new acmpca.CfnCertificate(this, "CertificateAuthorityCertificate", {
      certificateAuthorityArn: cfnCertificateAuthority.attrArn,
      certificateSigningRequest: cfnCertificateAuthority.attrCertificateSigningRequest,
      signingAlgorithm: "SHA256WITHRSA",
      validity: { type: "YEARS", value: 2 },
      templateArn: "arn:aws:acm-pca:::template/RootCACertificate/V1",
    });

    new acmpca.CfnCertificateAuthorityActivation(this, "CertificateAuthorityActivation", {
      certificate: cfnCACertificate.attrCertificate,
      certificateAuthorityArn: cfnCertificateAuthority.attrArn,
    });

    // Target group for TLS services
    const tlsTargetGroup = new elbv2.ApplicationTargetGroup(this, "TlsTargetGroup", {
      vpc,
      targetGroupName: "ecs-sample-tls",
      port: HTTP_PORT,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        port: HTTP_PORT.toString(),
        path: "/actuator/health",
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(3),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
    });

    const albLogsBucket = new s3.Bucket(this, "ALBLogsBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }),
      internetFacing: true,
      loadBalancerName: "ecs-sample-alb",
      securityGroup: albSecurityGroup,
    });

    alb.logAccessLogs(albLogsBucket);

    // HTTPS listener → TLS-enabled services
    alb.addListener('Listener', {
      port: HTTPS_PORT,
      open: false,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      defaultAction: elbv2.ListenerAction.forward([tlsTargetGroup]),
      certificates: [{ certificateArn: certArn }],
      sslPolicy: elbv2.SslPolicy.TLS13_EXT2,
    });

    const kmsKey = new kms.Key(this, "KMSKey", {
      description: "ecs-sample CMK",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const dbCredentialSecret = new secretsmanager.Secret(this, "DBCredentialsSecret", {
      secretName: "ecs-sample-catalog-db",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "root" }),
        generateStringKey: "password",
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 16,
      },
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const rdsParameterGroup = new rds.ParameterGroup(this, "CatalogRDSParameterGroup", {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_0,
      }),
    });

    const catalogRDSCluster = new rds.DatabaseCluster(this, "CatalogRDSCluster", {
      clusterIdentifier: "ecs-sample-catalog",
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_0,
      }),
      defaultDatabaseName: "catalog",
      storageEncrypted: true,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      iamAuthentication: true,
      credentials: rds.Credentials.fromSecret(dbCredentialSecret),
      parameterGroup: rdsParameterGroup,
      vpc,
      vpcSubnets: {
        subnets: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }).subnets,
      },
      securityGroups: [catalogRDSSecurityGroup],
      serverlessV2MinCapacity: 1,
      serverlessV2MaxCapacity: 2,
      writer: rds.ClusterInstance.serverlessV2("writer"),
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

    new cdk.CfnOutput(cdk.Stack.of(this), 'ecsSampleAlbDns', { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(cdk.Stack.of(this), 'ecsSampleFlowLogsArn', { value: flowLogsLogGroup.logGroupArn });
    new cdk.CfnOutput(cdk.Stack.of(this), 'ecsSampleVpcId', { value: vpc.vpcId });
    new cdk.CfnOutput(cdk.Stack.of(this), 'ecsSampleTlsUrl', { value: `https://${alb.loadBalancerDnsName}` });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(taskRole, [{
      id: 'AwsSolutions-IAM5',
      reason: 'ECS Exec requires ssmmessages permissions on all resources as the SSM channels are dynamically created',
      appliesTo: ['Resource::*'],
    }], true);
    NagSuppressions.addResourceSuppressions(taskExecutionRole, [{
      id: 'AwsSolutions-IAM4',
      reason: 'AmazonECSTaskExecutionRolePolicy is the AWS-recommended managed policy for ECS task execution',
      appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
    }]);
    NagSuppressions.addResourceSuppressions(catalogTaskExecutionRole, [{
      id: 'AwsSolutions-IAM4',
      reason: 'AmazonECSTaskExecutionRolePolicy is the AWS-recommended managed policy for ECS task execution',
      appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
    }]);
    NagSuppressions.addResourceSuppressions(taskTlsRole, [{
      id: 'AwsSolutions-IAM4',
      reason: 'This AWS managed policy is required for ECS Service Connect TLS functionality',
      appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSInfrastructureRolePolicyForServiceConnectTransportLayerSecurity'],
    }]);
    NagSuppressions.addResourceSuppressions(dbCredentialSecret, [{
      id: 'AwsSolutions-SMG4',
      reason: 'Secret rotation requires a Lambda function and VPC endpoint setup; not included in this sample for simplicity',
    }]);
    NagSuppressions.addResourceSuppressions(catalogRDSCluster, [
      { id: 'AwsSolutions-RDS10', reason: 'Deletion protection disabled intentionally for this sample to allow easy cleanup' },
      { id: 'AwsSolutions-RDS11', reason: 'Using default MySQL port is acceptable for this sample; port obfuscation provides minimal security benefit' },
      { id: 'AwsSolutions-RDS14', reason: 'Backtrack is not supported for Aurora MySQL 3.x (MySQL 8.0 compatible)' },
    ]);
    NagSuppressions.addResourceSuppressions(albLogsBucket, [
      { id: 'AwsSolutions-S1', reason: 'Access logs bucket does not need its own access logs to avoid infinite loop' },
    ], true);
    NagSuppressions.addResourceSuppressions(albSecurityGroup, [
      { id: 'CdkNagValidationFailure', reason: 'IP range is provided via CfnParameter which cannot be resolved at synth time' },
    ]);

    // Expose outputs
    this.dbCredentials = dbCredentialSecret;
    this.dbEndpointParameter = dbEndpointParameter;
    this.clusterName = cluster.clusterName;
    this.tlsTargetGroupArn = tlsTargetGroup.targetGroupArn;
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
