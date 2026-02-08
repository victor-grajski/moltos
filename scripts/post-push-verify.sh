#!/bin/bash
# post-push-verify.sh - Run after git push to verify deployment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORY_DIR="/home/node/.openclaw/workspace/memory"
FAILURE_LOG="$MEMORY_DIR/deploy-failures.md"

echo ""
echo "🔄 Post-push verification started"
echo "================================"
echo ""

# Run the verification script
if "$SCRIPT_DIR/verify-deploy.sh"; then
  echo ""
  echo "✅ Deployment verification passed!"
  
  # Clear any previous failure log
  if [ -f "$FAILURE_LOG" ]; then
    rm "$FAILURE_LOG"
    echo "🧹 Cleared previous failure log"
  fi
  
  exit 0
else
  EXIT_CODE=$?
  echo ""
  echo "❌ Deployment verification failed!"
  echo ""
  
  # Log the failure
  mkdir -p "$MEMORY_DIR"
  
  {
    echo "# Deploy Failure - $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
    echo ""
    echo "## Git Info"
    echo '```'
    git log -1 --pretty=format:"Commit: %H%nAuthor: %an <%ae>%nDate: %ad%nMessage: %s%n%b"
    echo ""
    echo '```'
    echo ""
    echo "## Failed Health Check"
    echo ""
    echo "URL: https://moltos.up.railway.app/health/all"
    echo ""
    
    # Try to get the health status
    echo "### Response:"
    echo '```json'
    curl -s https://moltos.up.railway.app/health/all 2>/dev/null | jq . || echo "Failed to fetch health status"
    echo '```'
    echo ""
    
    echo "### Unhealthy Services:"
    UNHEALTHY=$(curl -s https://moltos.up.railway.app/health/all 2>/dev/null | jq -r '.unhealthy[]' 2>/dev/null || echo "")
    if [ -n "$UNHEALTHY" ]; then
      echo "$UNHEALTHY" | while read -r service; do
        if [ -n "$service" ]; then
          echo "- $service"
        fi
      done
    else
      echo "- Could not determine unhealthy services"
    fi
    echo ""
    echo "---"
    echo ""
    echo "**Action Required:** Check Railway logs and fix unhealthy services"
    echo ""
  } > "$FAILURE_LOG"
  
  echo "📝 Failure details logged to: $FAILURE_LOG"
  echo ""
  echo "🔍 Quick action steps:"
  echo "  1. Check Railway logs: railway logs --service web"
  echo "  2. Review failure log: cat $FAILURE_LOG"
  echo "  3. Test locally: npm start"
  echo "  4. Fix and push again"
  echo ""
  
  exit "$EXIT_CODE"
fi
