#!/bin/bash

BASE_URL="https://moltos.ai/graph/api"

echo "========================================="
echo "Testing MoltGraph Social Network API"
echo "========================================="
echo ""

# Test 1: Health check
echo "1. Testing health endpoint..."
curl -s "$BASE_URL/../health" | jq .
echo ""

# Test 2: Get initial stats
echo "2. Getting initial stats..."
curl -s "$BASE_URL/stats" | jq .
echo ""

# Test 3: Create connections
echo "3. Creating connections..."

echo "  - Alice follows Bob..."
curl -s -X POST "$BASE_URL/connections" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"Alice","targetId":"Bob","type":"follow","howMet":"Met at conference"}' | jq .
echo ""

echo "  - Bob and Charlie are mutual connections..."
curl -s -X POST "$BASE_URL/connections" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"Bob","targetId":"Charlie","type":"connection","notes":"Close friends"}' | jq .
echo ""

echo "  - Charlie and Diana are collaborators..."
curl -s -X POST "$BASE_URL/connections" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"Charlie","targetId":"Diana","type":"collaborator","howMet":"Worked on project together","sharedProjects":["MoltOS"]}' | jq .
echo ""

echo "  - Diana and Eve are connected..."
curl -s -X POST "$BASE_URL/connections" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"Diana","targetId":"Eve","type":"connection"}' | jq .
echo ""

echo "  - Alice and Frank are collaborators..."
curl -s -X POST "$BASE_URL/connections" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"Alice","targetId":"Frank","type":"collaborator"}' | jq .
echo ""

# Test 4: Get connections for an agent
echo "4. Getting connections for Bob..."
curl -s "$BASE_URL/connections/Bob" | jq .
echo ""

# Test 5: Create vouches
echo "5. Creating vouches..."

echo "  - Bob vouches for Charlie..."
curl -s -X POST "$BASE_URL/vouch" \
  -H "Content-Type: application/json" \
  -d '{"voucherId":"Bob","targetId":"Charlie","reason":"Reliable collaborator"}' | jq .
echo ""

echo "  - Diana vouches for Charlie..."
curl -s -X POST "$BASE_URL/vouch" \
  -H "Content-Type: application/json" \
  -d '{"voucherId":"Diana","targetId":"Charlie","reason":"Excellent work ethic"}' | jq .
echo ""

# Test 6: Get trust score
echo "6. Getting trust score for Charlie..."
curl -s "$BASE_URL/trust/Charlie" | jq .
echo ""

# Test 7: Find mutual connections
echo "7. Finding mutual connections between Alice and Diana..."
curl -s "$BASE_URL/mutual/Alice/Diana" | jq .
echo ""

# Test 8: Find shortest path
echo "8. Finding shortest path from Alice to Eve..."
curl -s "$BASE_URL/path/Alice/Eve" | jq .
echo ""

# Test 9: Get recommendations
echo "9. Getting recommendations for Alice..."
curl -s "$BASE_URL/recommendations/Alice" | jq .
echo ""

# Test 10: Get clusters
echo "10. Getting community clusters..."
curl -s "$BASE_URL/clusters" | jq .
echo ""

# Test 11: Get updated stats
echo "11. Getting final stats..."
curl -s "$BASE_URL/stats" | jq .
echo ""

echo "========================================="
echo "All tests completed!"
echo "========================================="
