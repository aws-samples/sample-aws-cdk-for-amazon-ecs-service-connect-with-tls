#!/bin/bash
set -euo pipefail

CLUSTER=ecs-sample-cluster
DB_CLUSTER="ecs-sample-catalog"
SERVICES=("tls-catalog" "tls-assets" "tls-ui")

echo "============================================"
echo " Forcing redeployment of ECS services"
echo " and rebooting Aurora database"
echo "============================================"
echo ""
echo "Cluster:      $CLUSTER"
echo "DB Cluster:   $DB_CLUSTER"
echo "Services:     ${SERVICES[*]}"
echo ""

# Step 1: Reboot Aurora database
echo "[reboot] Rebooting Aurora DB writer instance..."
DB_INSTANCE=$(aws rds describe-db-clusters \
  --db-cluster-identifier "$DB_CLUSTER" \
  --query "DBClusters[0].DBClusterMembers[?IsClusterWriter==\`true\`].DBInstanceIdentifier" \
  --output text)

aws rds reboot-db-instance --db-instance-identifier "$DB_INSTANCE" > /dev/null
echo "         ✔ Reboot triggered for: $DB_INSTANCE"

echo ""
echo "[wait] Waiting for DB instance to become available..."
aws rds wait db-instance-available --db-instance-identifier "$DB_INSTANCE"
echo "       ✔ $DB_INSTANCE is available"

# Step 2: Force new deployments with exec command enabled
echo ""
for SERVICE in "${SERVICES[@]}"; do
  echo "[deploy] Forcing new deployment for: $SERVICE"
  aws ecs update-service \
    --cluster $CLUSTER \
    --service $SERVICE \
    --enable-execute-command \
    --force-new-deployment \
    --no-cli-pager > /dev/null
  echo "         ✔ Deployment triggered (exec command enabled)"
done

echo ""
echo "============================================"
echo " Waiting for services to stabilize..."
echo "============================================"
echo ""

# Step 3: Wait for each service to reach steady state
for SERVICE in "${SERVICES[@]}"; do
  echo "[wait] Waiting for $SERVICE to reach steady state..."
  aws ecs wait services-stable \
    --cluster $CLUSTER \
    --services $SERVICE
  echo "       ✔ $SERVICE is stable"
done

echo ""
echo "============================================"
echo " All services redeployed and stable"
echo "============================================"
echo ""
