#!/usr/bin/env bash
set -euo pipefail

CLUSTER="ecs-sample-cluster"
SERVICES="tls-catalog tls-assets tls-ui"
DB_CLUSTER="ecs-sample-catalog"

# Get task IPs
echo "Task IPs:"
IPS=""
for SERVICE in $SERVICES; do
  TASK_ARNS=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" --query "taskArns[]" --output text)
  if [ -n "$TASK_ARNS" ]; then
    IP=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks $TASK_ARNS \
      --query "tasks[0].containers[0].networkInterfaces[0].privateIpv4Address" --output text)
    printf "  %-20s %s\n" "$SERVICE" "$IP"
    IPS="${IPS:+$IPS|}$IP"
  fi
done

if [ -z "$IPS" ]; then
  echo "No task IPs found." >&2
  exit 1
fi

# Get database IP (resolve the RDS endpoint to private IP)
DB_ENDPOINT=$(aws rds describe-db-clusters \
  --db-cluster-identifier "$DB_CLUSTER" \
  --query "DBClusters[0].Endpoint" \
  --output text)
DB_IP=$(host "$DB_ENDPOINT" | awk '/has address/ {print $NF}' | head -1)

# Get ALB private IPs (from ENIs associated with the ALB)
ALB_ENI_IPS=$(aws ec2 describe-network-interfaces \
  --filters "Name=description,Values=*ecs-sample-alb*" \
  --query "NetworkInterfaces[].PrivateIpAddress" \
  --output text | tr '\t\n' ' ')

# Get NAT Gateway private IPs
NAT_GW_IPS=$(aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=$(aws cloudformation describe-stacks \
    --stack-name EcsServiceConnectTls \
    --query "Stacks[0].Outputs[?OutputKey=='ecsSampleVpcId'].OutputValue" \
    --output text)" \
  --query "NatGateways[].NatGatewayAddresses[].PrivateIp" \
  --output text | tr '\t\n' ' ')

# Build exclusion list: DB + ALB + NAT
EXCLUDE_IPS="$DB_IP $ALB_ENI_IPS $NAT_GW_IPS"

echo ""
echo "Excluding: ALB, Database, NAT Gateway, and non-VPC IPs"

# Build CloudWatch Logs Insights query filtering by task IPs and excluding infrastructure
TASK_IP_LIST=$(echo "$IPS" | tr '|' '\n' | sed 's/.*/"&"/' | tr '\n' ',' | sed 's/,$//')
EXCLUDE_IP_LIST=$(echo "$EXCLUDE_IPS" | tr -s ' ' '\n' | grep -v '^$' | sed 's/.*/"&"/' | tr '\n' ',' | sed 's/,$//')

CW_QUERY="fields @message | parse @message '* * * * * * * * * * * * * * * * *' as version, accountId, interfaceId, srcAddr, dstAddr, srcPort, dstPort, protocol, packets, bytes, startTime, endTime, action, logStatus, flowDirection, trafficPath, encryptionStatus | filter (srcAddr in [$TASK_IP_LIST] or dstAddr in [$TASK_IP_LIST]) | filter srcAddr not in [$EXCLUDE_IP_LIST] and dstAddr not in [$EXCLUDE_IP_LIST] | filter srcAddr like /^10\\.0\\./ and dstAddr like /^10\\.0\\./ | sort @timestamp desc | limit 20"

# Query VPC Flow Logs — last 24 hours
QUERY_ID=$(aws logs start-query \
  --log-group-name "ecs-sample-vpc-flow-logs" \
  --start-time "$(date -v-1d +%s)" \
  --end-time "$(date +%s)" \
  --query-string "$CW_QUERY" \
  --output text)

echo ""
echo "Waiting for query results..."
sleep 5

HEADER="src dst srcport dstport proto pkts bytes start end action status direction path encrypted"

RAW=$(aws logs get-query-results --query-id "$QUERY_ID" \
  --query "results[*][?field=='@message'].value" \
  --output text)

RESULTS=$(echo "$RAW" | awk 'NF{for(i=4;i<=NF;i++) printf "%s ", $i; print ""}' || true)

if [ -z "$RESULTS" ]; then
  echo "No matching flow log entries found for task-to-task traffic."
  echo ""
  echo "Tips:"
  echo "  - Generate traffic first: hey -n 1000 -c 1 -q 100 \$APP_URL/home"
  echo "  - Wait a minute for flow logs to populate, then retry."
  exit 0
fi

echo ""
(echo "$HEADER" && echo "$RESULTS") | column -t
