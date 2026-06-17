# Amazon ECS Service Connect with TLS — Verifying Encryption with VPC Flow Logs

Deploy a multi-layer application on [Amazon ECS](https://aws.amazon.com/ecs/) with [AWS Fargate](https://aws.amazon.com/fargate/), using [Amazon ECS Service Connect](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect.html) for encrypted service-to-service communication. Then use [VPC Encryption Controls](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-encryption-controls.html) and VPC Flow Logs to verify that traffic between services is encrypted.

## Application Overview

This sample deploys a web store application with the following components:

![Sample application home page](/images/home.png)

| Component     | Description                                                     |
| ------------- | :-------------------------------------------------------------- |
| UI            | Front-end user interface, aggregates API calls to other services |
| Catalog       | API for product listings and details                            |
| Static assets | Serves static assets like product images                        |

Source code for the full sample application: [GitHub](https://github.com/aws-containers/retail-store-sample-app)

## Architecture

![Amazon ECS Service Connect With TLS Architecture](/images/service-connect-with-tls-architecture.png)

Key components:
- **VPC** with public and private subnets, NAT Gateway, and VPC Flow Logs (with encryption status field)
- **ECS Cluster** running on AWS Fargate
- **ECS Service Connect with TLS** — automatic mTLS between services via AWS Private CA
- **Application Load Balancer** — HTTPS listener with self-signed certificate
- **Aurora MySQL Serverless v2** — shared database for the product catalog
- **AWS Private Certificate Authority** — provisions and rotates certificates for Service Connect TLS
- **AWS Cloud Map** — namespace for Service Connect service discovery
- **VPC Flow Logs** — all traffic logged to CloudWatch with custom format including `encryption-status`

Infrastructure is defined using [AWS CDK](https://aws.amazon.com/cdk/).

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js (v18+)
- AWS CDK CLI (`npm install -g aws-cdk`)
- [hey](https://github.com/rakyll/hey) load generator (`brew install hey` on macOS)
- An AWS account with permissions to create VPCs, ECS clusters, RDS instances, Private CA, and CloudWatch resources

**Warning! Review the [AWS Pricing page](https://aws.amazon.com/pricing/) for cost details before deploying. Note the [AWS Private CA pricing](https://aws.amazon.com/private-ca/pricing/) in particular.**

## Deployment

### Step 1 — Clone the Repository

```bash
git clone https://github.com/aws-samples/ecs-service-connect-samples.git
cd ecs-service-connect-samples
```

### Step 2 — Run the Setup Script

The setup script creates a self-signed certificate, imports it into ACM, installs dependencies, and deploys the CDK stack. The stack deploys the application with ECS Service Connect TLS enabled, but **without VPC Encryption Controls** — so the flow logs won't yet report encryption status. It typically takes 15–20 minutes.

```bash
sh scripts/setup.sh
```

Once the script completes, export the values it prints:

```bash
export ALB_CERTIFICATE_ARN=<value from script output>
export APP_URL=<value from script output>
export VPC_ID=<value from script output>
export FLOW_LOGS_ARN=<value from script output>
```

## Verifying Encryption with VPC Flow Logs

### Step 3 — Enable VPC Encryption Controls

Enable VPC Encryption Controls in monitor mode to get visibility into the encryption status of traffic. This also enables reporting of the `encryption-status` field in VPC Flow Logs.

```bash
aws ec2 create-vpc-encryption-control \
  --vpc-id $VPC_ID \
  --tag-specifications 'ResourceType=vpc-encryption-control,Tags=[{Key=Name,Value=ecs-sample-encryption-control}]'
```

### Step 4 — Generate Traffic

Send requests to the application:

```bash
hey -n 1000 -c 1 -q 100 $APP_URL/catalog
```

### Step 5 — Check VPC Flow Logs (Traffic Not Encrypted)

Query the flow logs to see the encryption status. Since the services were deployed before VPC Encryption Controls were enabled, the traffic is still **not encrypted at the VPC level**. Different resources require different steps to become encrypted — see the [documentation](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-encryption-controls.html) for details. For AWS Fargate tasks specifically, encryption takes effect automatically the next time a task is replaced, whether through a new deployment, a rolling update, or a platform version refresh.

```bash
sh scripts/query-flow-logs.sh
```

The `encryption-status` column should show `0` (not encrypted) for traffic between the services. In the next steps, we will force the AWS Fargate deployment and reboot the Aurora Serverless database to accelerate the migration to encrypted hardware for demo purposes.

### Step 6 — Force Redeployment of Services

Force a redeployment so the tasks pick up the VPC Encryption Controls. For demo purposes, the script also enables ECS Exec (`--enable-execute-command`) to allow remote access into the running containers for TLS certificate verification in Step 9.

```bash
sh scripts/force-redeploy-services.sh
```

The script reboots the Aurora database, triggers a new deployment for each service with remote access enabled, and waits for them to stabilize.

### Step 7 — Generate More Traffic

Send more requests to the application:

```bash
hey -n 1000 -c 1 -q 100 $APP_URL/catalog
```

### Step 8 — Verify Traffic Is Now Encrypted (Status `1`)

Query the flow logs again:

```bash
sh scripts/query-flow-logs.sh
```

The `encryption-status` column for traffic between ECS tasks and the database should now show `1`, confirming that VPC Encryption Controls are actively encrypting traffic at the Nitro hardware level. Note that not all services are encrypted immediately — some resources (such as the Application Load Balancer) migrate automatically in the background and may take additional time before their traffic shows as encrypted. See the [VPC Encryption Controls documentation](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-encryption-controls.html) for details on automatic migration timelines.

## Verifying ECS Service Connect TLS Certificate

### Step 9 — Verify the TLS Certificate

Connect to a running task and verify that Service Connect TLS is using certificates for service-to-service communication.

First, get the private IP of the Catalog task and a UI task ARN to exec into:

```bash
CLUSTER=ecs-sample-cluster

CATALOG_TASK_ARN=$(aws ecs list-tasks --cluster $CLUSTER \
  --service-name tls-catalog --query 'taskArns[0]' --output text)

CATALOG_PRIVATE_IP=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $CATALOG_TASK_ARN \
  --query "tasks[0].containers[?name=='application'].networkInterfaces[0].privateIpv4Address" \
  --output text)

UI_TASK_ARN=$(aws ecs list-tasks --cluster $CLUSTER \
  --service-name tls-ui --query 'taskArns[0]' --output text)

echo "Catalog Private IP: $CATALOG_PRIVATE_IP"
echo "UI Task ARN:        $UI_TASK_ARN"
```

Start an interactive session in the UI task:

```bash
aws ecs execute-command --cluster $CLUSTER \
  --task $UI_TASK_ARN \
  --container application \
  --interactive \
  --command "/bin/bash"
```

Once inside the container, install `openssl` and verify the TLS certificate on the Catalog service. Replace `<CATALOG_PRIVATE_IP>` with the Catalog private IP printed in the previous step:

```bash
dnf install openssl -y

openssl s_client -connect <CATALOG_PRIVATE_IP>:8080 < /dev/null 2>/dev/null \
  | openssl x509 -noout -text
```

You should see a certificate issued by your Private CA with a Subject Alternative Name matching `tls-catalog.ecs-sample.local`, confirming that ECS Service Connect TLS is encrypting service-to-service traffic with automatically rotated certificates.

To exit the session:

```bash
exit
```

## Scripts

| Script | Description |
| ------ | ----------- |
| `scripts/setup.sh` | End-to-end setup: generates certificate, imports to ACM, installs deps, bootstraps CDK, deploys stack |
| `scripts/force-redeploy-services.sh` | Reboots Aurora DB, forces ECS service redeployment with exec enabled, waits for stability |
| `scripts/query-flow-logs.sh` | Retrieves ECS task IPs and queries VPC Flow Logs filtered by those IPs |

## Clean-Up

To avoid ongoing charges, destroy all resources when you're done. This removes the VPC, ECS cluster, Aurora database, Private CA, ALB, and all associated resources. The VPC Encryption Control and ACM certificate were created outside of CDK, so they need to be deleted separately.

```bash
# Delete the VPC Encryption Control
VPC_ENCRYPTION_CONTROL_ID=$(aws ec2 describe-vpc-encryption-controls \
  --vpc-ids $VPC_ID \
  --query "VpcEncryptionControls[0].VpcEncryptionControlId" \
  --output text)
aws ec2 delete-vpc-encryption-control \
    --vpc-encryption-control-id $VPC_ENCRYPTION_CONTROL_ID

# Force delete ECS services
CLUSTER=ecs-sample-cluster
for SERVICE in tls-catalog tls-assets tls-ui; do
  aws ecs delete-service --cluster $CLUSTER --service $SERVICE --force --no-cli-pager
done

# Destroy all AWS resources created by the CDK stack
cdk destroy EcsServiceConnectTls --force

# Delete the self-signed certificate from ACM
aws acm delete-certificate --certificate-arn $ALB_CERTIFICATE_ARN

# Remove local certificate files
rm -f my-private-key.pem my-certificate.pem openssl.cnf
```
