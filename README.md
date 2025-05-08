# Sample CDK configuration for Amazon ECS Service Connect with TLS

In this sample repository we are going to deploy a multi-layer application on [Amazon Elastic Container Service (Amazon ECS)](https://aws.amazon.com/ecs/) and [AWS Fargate](https://aws.amazon.com/fargate/), by leveraging [Amazon ECS Service Connect](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect.html) for service-to-service communication with TLS enabled.

Amazon ECS Service Connect is the recommended approach for handling service-to-service communication, offering features such as service discovery, connectivity, and traffic monitoring. With Service Connect, your applications can utilize short names and standard ports to connect to ECS services within the same cluster, across different clusters, and even across VPCs within the same AWS Region. [For more detailed information, please refer to the AWS documentation.](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/networking-connecting-services.html#networking-connecting-services-serviceconnect)

Amazon ECS Service Connect supports automatic traffic encryption using _Transport Layer Security (TLS)_ certificates for Amazon ECS services. By configuring your Amazon ECS services to use an [AWS Private Certificate Authority](https://docs.aws.amazon.com/privateca/latest/userguide/PcaWelcome.html), Amazon ECS automatically provisions TLS certificates to encrypt traffic between your Amazon ECS Service Connect services. Amazon ECS handles the generation, rotation, and distribution of TLS certificates used for traffic encryption. [You can find more information here.](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect-tls.html)

To deploy the application you will leverage [AWS Cloud Development Kit (AWS CDK)](https://aws.amazon.com/cdk/).

## Sample Application Overview

In this sample repository utilize a common sample application to provide actual container components. The sample application models a simple web store application, where customers can browse a catalog, add items to their cart, and complete an order through the checkout process.

![Sample application home page](/images/home.png)

### Sample Application Components

The application consists of several components and dependencies:

![Sample application architecture](/images/architecture.png)

| Component     | Description                                                                                   |
| ------------- | :-------------------------------------------------------------------------------------------- |
| UI            | Provides the front end user interface and aggregates API calls to the various other services. |
| Catalog       | API for product listings and details                                                          |
| Cart          | API for customer shopping carts                                                               |
| Checkout      | API to orchestrate the checkout process                                                       |
| Orders        | API to receive and process customer orders                                                    |
| Static assets | Serves static assets like images related to the product catalog                               |

You can find the complete source code for the sample application on [GitHub](https://github.com/aws-containers/retail-store-sample-app).

The application consists of several components and dependencies however, in this sample repository you are going to deploy:
- the `UI` component
- the `Static assets` component
- the `Catalog` component

## Sample Application Architecture

Below is the architecture that you will deploy

![Amazon ECS Service Connect With TLS Architecture](/images/service-connect-with-tls-architecture.jpg)

- **Application Load Balancer (ALB)**: the ALB is exposing the `UI` component frontend with a self-signed HTTPS endpoint.
- **AWS Certificate Manager (ACM)**: the ACM is holding the self-signed certificate of the ALB.
- **Amazon ECS Services**: the 3 application components: `UI`, `Static assets`, `Catalog`, are deployed as ECS Services with ECS Service Connect enabled. 
- **AWS Private Certificate Authority (CA)**: the Private CA allow Amazon ECS to automatically provisions TLS certificates to encrypt traffic between your Amazon ECS Service Connect services. _Please be aware of the [AWS Private CA Pricing.](https://aws.amazon.com/private-ca/pricing/)_
- **AWS Cloud Map**: Amazon ECS Service Connect leverage the AWS Cloud Map namespace for service discoverability.
- **Amazon Aurora**: the `Catalog` service leverage the Amazon Aurora MySQL for storing application sample products catalog.

## Sample Application Deployment

**Warning! - Before starting the deployment, please be aware of the cost associated with running the following sample architecture by reviewing the pricing information associated for all the AWS services used in the Sample CDK. Review the [AWS Pricing page](https://aws.amazon.com/pricing/) for more details.**

To deploy the sample architecture you will need to follow the steps below:
1. Create a Certificate for the ALB
2. Install the required dependencies and Bootstrap the CDK
4. Deploy the infrastructure
5. Deploy the task definitions
6. Deploy the ECS Services

**Note: In this sample project, just for demo purposes, we are going to leverage a self-signed certificate, however this is not recommended to be used in production or in real application deployment.**

### Create a Self-Signed Certificate

Run the following command to create a self-signed certificate.

1. create the a private key

```bash
openssl genrsa 2048 > my-private-key.pem
```

2. create the a new self-signed certificate

```bash
cat << EOF > openssl.cnf
[ req ]
prompt = no
distinguished_name = req_distinguished_name

[ req_distinguished_name ]
C = US
ST = None
L = None
O = Sample
OU = Sample Application
CN = *.amazonaws.com
emailAddress = test@email.com
EOF

openssl req -new -x509 -config openssl.cnf -nodes -sha256 -days 365 -key my-private-key.pem -outform PEM -out my-certificate.pem
```

3. import the certificate into te AWS Certificate Manager

```bash
export ALB_CERTIFICATE_ARN=$(aws acm import-certificate --certificate fileb://my-certificate.pem --private-key fileb://my-private-key.pem --output text)
```

### Install Dependencies And Bootstrap The CDK

1. install the required CDK dependencies 

```bash
npm install
```

2. Bootstrap the CDK stack

```bash
cdk bootstrap
```

### Identify the correct ip range to configure your ALB

Below you can select the correct `IP_RANGE` to be associated to the security Group associated to your Application Load Balancer (ALB).

```bash
IP_RANGE="0.0.0.0/0"
```

**Note: For demo purpose we are going to leverage the wide open ip range `0.0.0.0/0`, however this is not recommend to be used in production. [Check the documentation for more information](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html)**

### Deploy The CDK Stack

1. Deploy the infrastructure stack

```bash
cdk deploy SampleInfra --parameters certArn=$ALB_CERTIFICATE_ARN --parameters ipRange=$IP_RANGE
```

2. Deploy the task definitions stack

```bash
cdk deploy SampleTaskDefinitionsStack
```

3. Deploy the Amazon ECS Service stack

```bash
cdk deploy SampleEcsServices
```

## Sample Application Test

Run the following command to extract the Application Load Balancer DNS name.
```bash
ALB_DNS=$(aws elbv2 describe-load-balancers \
    --names ecs-sample-alb \
    --query 'LoadBalancers[0].DNSName' \
    --output text)
echo https://$ALB_DNS
```

Navigate to the web application.

![Application with Self Signed Certificate](/images/service-connect-ui-tls-cert-exeption.png)

## Sample Application Clean-Up

Run the following command to destroy the deployed application

```bash
cdk destroy --all
```

Run the following command to delete the imported certificate. _If the $ALB_CERTIFICATE_ARN is not set, locate the certificate ARN from the AWS Console._

```bash
aws acm delete-certificate --certificate-arn $ALB_CERTIFICATE_ARN
```