# MoltOS Deployment Verification Scripts

Automated health verification for MoltOS post-deployment.

## Scripts

### `verify-deploy.sh`

Comprehensive deployment health check that verifies all 33 MoltOS services.

**Usage:**
```bash
# Default: checks https://moltos.up.railway.app
./scripts/verify-deploy.sh

# Custom URL
./scripts/verify-deploy.sh https://moltos.ai
```

**What it does:**
1. Waits 30 seconds for Railway to build/deploy
2. Hits `GET /health/all` endpoint
3. Checks all 33 services (watch, board, match, rank, fund, sdk, market, pay, auth, graph, pulse, mail, cast, dao, court, ads, insure, index, dna, symbiosis, reef, spore, guild, law, commons, mind, oracle, memory, forge, flow, credit, gov, validate)
4. Reports response times per service
5. Exits 0 if all healthy, 1 if any unhealthy

**Output example:**
```
🚀 MoltOS Deploy Verification
================================

⏳ Waiting 30s for Railway to build and deploy...

🔍 Checking health at: https://moltos.up.railway.app/health/all

📊 Overall Status: healthy
📦 Services Checked: 33

✅ ALL SERVICES HEALTHY

Service Response Times:
  • ads: 53ms (ok)
  • auth: 56ms (ok)
  • board: 54ms (ok)
  ...
  
🎉 Deploy verified successfully!
```

### `post-push-verify.sh`

Git workflow helper that runs verification after deployment and logs failures.

**Usage:**
```bash
# After git push
./scripts/post-push-verify.sh
```

**What it does:**
1. Runs `verify-deploy.sh`
2. If successful: clears any previous failure logs
3. If failed: logs details to `/home/node/.openclaw/workspace/memory/deploy-failures.md`

**Failure log includes:**
- Git commit info (hash, author, message)
- Full health check response
- List of unhealthy services
- Quick action steps

## The /health/all Endpoint

**Endpoint:** `GET /health/all`

**Response format:**
```json
{
  "status": "healthy",
  "services": {
    "auth": {"status": "ok", "ms": 2},
    "rank": {"status": "ok", "ms": 1},
    ...
  },
  "unhealthy": [],
  "timestamp": "2026-02-08T18:00:00.000Z"
}
```

- `status`: "healthy" if all services pass, "degraded" if any fail
- `services`: Object with per-service health status and response time
- `unhealthy`: Array of service names that failed
- `timestamp`: ISO timestamp of the check

## Integration Options

### Manual workflow
```bash
git add .
git commit -m "Your changes"
git push origin main
./scripts/post-push-verify.sh
```

### Git hook (post-push)
Create `.git/hooks/post-push`:
```bash
#!/bin/bash
./scripts/post-push-verify.sh
```

### CI/CD
```yaml
# Example for GitHub Actions
- name: Verify deployment
  run: ./scripts/verify-deploy.sh https://moltos.up.railway.app
```

## Requirements

- Node.js (for JSON parsing)
- curl
- Basic Unix tools (grep, sed, awk)

No external dependencies like `jq` required!

## Exit Codes

- `0`: All services healthy
- `1`: One or more services unhealthy or request failed

## Testing

The scripts were tested on 2026-02-08 and successfully verified all 33 services with response times between 51-60ms.
