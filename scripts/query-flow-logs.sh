#!/usr/bin/env bash
set -euo pipefail

CLUSTER="ecs-sample-cluster"
SERVICES="tls-catalog tls-assets tls-ui"

# Step 7 — Get task IPs
IPS=""
for SERVICE in $SERVICES; do
  TASK_ARNS=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" --query "taskArns[]" --output text)
  if [ -n "$TASK_ARNS" ]; then
    IP=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks $TASK_ARNS \
      --query "tasks[0].containers[0].networkInterfaces[0].privateIpv4Address" --output text)
    printf "%-20s %s\n" "$SERVICE" "$IP"
    IPS="${IPS:+$IPS|}$IP"
  fi
done

if [ -z "$IPS" ]; then
  echo "No task IPs found." >&2
  exit 1
fi

# Query VPC Flow Logs — last 24 hours
QUERY_ID=$(aws logs start-query \
  --log-group-name "ecs-sample-vpc-flow-logs" \
  --start-time "$(date -v-1d +%s)" \
  --end-time "$(date +%s)" \
  --query-string 'fields @message | sort @timestamp desc | limit 200' \
  --output text)

echo ""
echo "Waiting for query results..."
sleep 5

HEADER="src dst srcport dstport proto pkts bytes start end action status direction path encrypted"

RAW=$(aws logs get-query-results --query-id "$QUERY_ID" \
  --query "results[*][?field=='@message'].value" \
  --output text)

RESULTS=$(echo "$RAW" | grep -E "$IPS" | head -20 | awk '{for(i=4;i<=NF;i++) printf "%s ", $i; print ""}' || true)

if [ -z "$RESULTS" ]; then
  echo "No matching flow log entries found for task IPs."
  echo ""
  echo "Tips:"
  echo "  - Generate traffic first: hey -n 1000 -c 1 -q 100 \$APP_URL/home"
  echo "  - Wait a minute for flow logs to populate, then retry."
  exit 0
fi

(echo "$HEADER" && echo "$RESULTS") | column -t
