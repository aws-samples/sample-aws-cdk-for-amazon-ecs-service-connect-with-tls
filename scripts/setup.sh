#!/bin/bash
set -euo pipefail

echo "============================================"
echo " ECS Service Connect TLS - Setup Script"
echo "============================================"
echo ""

# --- Step 1: Create a self-signed certificate ---

echo "[1/5] Generating a private key..."
openssl genrsa 2048 > my-private-key.pem
echo "       ✔ Private key saved to my-private-key.pem"

echo ""
echo "[2/5] Creating certificate configuration..."
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
echo "       ✔ Config saved to openssl.cnf"

echo ""
echo "[3/5] Generating self-signed certificate (valid for 365 days)..."
openssl req -new -x509 -config openssl.cnf -nodes -sha256 -days 365 \
  -key my-private-key.pem -outform PEM -out my-certificate.pem
echo "       ✔ Certificate saved to my-certificate.pem"
echo "       ⚠ Self-signed certificates are for demo purposes only."

echo ""
echo "[4/5] Importing certificate into AWS Certificate Manager..."
ALB_CERTIFICATE_ARN=$(aws acm import-certificate \
  --certificate fileb://my-certificate.pem \
  --private-key fileb://my-private-key.pem \
  --output text)
echo "       ✔ Certificate imported: $ALB_CERTIFICATE_ARN"

# --- Step 2: Deploy the CDK stack ---

echo ""
echo "[5/5] Installing dependencies and deploying the CDK stack..."
echo "       This will create the VPC, ECS cluster, database, and services."
echo "       It typically takes 15-20 minutes."
echo ""

npm install --silent

echo ""
echo "       ✔ Dependencies installed"
echo ""

export IP_RANGE="$(curl -s https://checkip.amazonaws.com)/32"
echo "       Using IP range: $IP_RANGE"
echo ""

cdk bootstrap --quiet

echo ""
echo "       ✔ CDK bootstrapped"
echo ""
echo "       Deploying EcsServiceConnectTls stack..."
echo ""

cdk deploy EcsServiceConnectTls \
  --parameters certArn="$ALB_CERTIFICATE_ARN" \
  --parameters ipRange="$IP_RANGE" \
  --require-approval never

echo ""
echo "       ✔ Stack deployed successfully"

# --- Step 3: Retrieve stack outputs ---

echo ""
echo "[6/6] Retrieving stack outputs..."

APP_URL=$(aws cloudformation describe-stacks \
  --stack-name EcsServiceConnectTls \
  --query "Stacks[0].Outputs[?OutputKey=='ecsSampleTlsUrl'].OutputValue" \
  --output text)

FLOW_LOGS_ARN=$(aws cloudformation describe-stacks \
  --stack-name EcsServiceConnectTls \
  --query "Stacks[0].Outputs[?OutputKey=='ecsSampleFlowLogsArn'].OutputValue" \
  --output text)

VPC_ID=$(aws cloudformation describe-stacks \
  --stack-name EcsServiceConnectTls \
  --query "Stacks[0].Outputs[?OutputKey=='ecsSampleVpcId'].OutputValue" \
  --output text)

echo ""
echo "============================================"
echo " Deployment complete!"
echo "============================================"
echo ""
echo " TLS endpoint:      $APP_URL"
echo " VPC ID:            $VPC_ID"
echo " Flow Logs ARN:     $FLOW_LOGS_ARN"
echo " Certificate ARN:   $ALB_CERTIFICATE_ARN"
echo ""
echo "Run the following to export these values into your shell:"
echo ""
echo "  export ALB_CERTIFICATE_ARN=$ALB_CERTIFICATE_ARN"
echo "  export APP_URL=$APP_URL"
echo "  export VPC_ID=$VPC_ID"
echo "  export FLOW_LOGS_ARN=$FLOW_LOGS_ARN"
echo ""
