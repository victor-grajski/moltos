#!/bin/bash
# verify-deploy.sh - Verify MoltOS deployment health

set -euo pipefail

URL="${1:-https://moltos.up.railway.app}"
ENDPOINT="${URL}/health/all"
WAIT_TIME=30

echo "🚀 MoltOS Deploy Verification"
echo "================================"
echo ""
echo "⏳ Waiting ${WAIT_TIME}s for Railway to build and deploy..."
sleep "$WAIT_TIME"

echo ""
echo "🔍 Checking health at: $ENDPOINT"
echo ""

# Make the request
RESPONSE=$(curl -s -w "\n%{http_code}" "$ENDPOINT" || echo "000")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ FAILED - HTTP $HTTP_CODE"
  echo ""
  echo "Response:"
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
  exit 1
fi

# Parse the JSON response
STATUS=$(echo "$BODY" | jq -r '.status' 2>/dev/null || echo "unknown")
UNHEALTHY=$(echo "$BODY" | jq -r '.unhealthy[]' 2>/dev/null || echo "")
SERVICE_COUNT=$(echo "$BODY" | jq '.services | length' 2>/dev/null || echo "0")

echo "📊 Overall Status: $STATUS"
echo "📦 Services Checked: $SERVICE_COUNT"
echo ""

if [ "$STATUS" = "healthy" ]; then
  echo "✅ ALL SERVICES HEALTHY"
  echo ""
  echo "Service Response Times:"
  echo "$BODY" | jq -r '.services | to_entries[] | "  • \(.key): \(.value.ms)ms (\(.value.status))"' 2>/dev/null | sort
  echo ""
  echo "🎉 Deploy verified successfully!"
  exit 0
else
  echo "❌ UNHEALTHY SERVICES DETECTED"
  echo ""
  if [ -n "$UNHEALTHY" ]; then
    echo "Failed services:"
    echo "$UNHEALTHY" | while read -r service; do
      if [ -n "$service" ]; then
        STATUS=$(echo "$BODY" | jq -r ".services[\"$service\"].status" 2>/dev/null || echo "unknown")
        ERROR=$(echo "$BODY" | jq -r ".services[\"$service\"].error // empty" 2>/dev/null || echo "")
        echo "  ❌ $service ($STATUS)"
        if [ -n "$ERROR" ]; then
          echo "     Error: $ERROR"
        fi
      fi
    done
    echo ""
  fi
  
  echo "All services:"
  echo "$BODY" | jq -r '.services | to_entries[] | "  \(if .value.status == "ok" then "✅" else "❌" end) \(.key): \(.value.ms)ms (\(.value.status))"' 2>/dev/null | sort
  echo ""
  echo "💥 Deploy verification FAILED"
  exit 1
fi
