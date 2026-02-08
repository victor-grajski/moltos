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
  echo "$BODY"
  exit 1
fi

# Use Node.js to parse JSON (always available in Node containers)
node -e "
const data = $BODY;
const status = data.status;
const services = data.services;
const unhealthy = data.unhealthy || [];
const serviceCount = Object.keys(services).length;

console.log('📊 Overall Status:', status);
console.log('📦 Services Checked:', serviceCount);
console.log('');

if (status === 'healthy') {
  console.log('✅ ALL SERVICES HEALTHY');
  console.log('');
  console.log('Service Response Times:');
  
  // Sort and display services
  const sorted = Object.entries(services).sort((a, b) => a[0].localeCompare(b[0]));
  sorted.forEach(([name, info]) => {
    console.log('  • ' + name + ': ' + info.ms + 'ms (' + info.status + ')');
  });
  
  console.log('');
  console.log('🎉 Deploy verified successfully!');
  process.exit(0);
} else {
  console.log('❌ UNHEALTHY SERVICES DETECTED');
  console.log('');
  
  if (unhealthy.length > 0) {
    console.log('Failed services:');
    unhealthy.forEach(serviceName => {
      const info = services[serviceName];
      console.log('  ❌ ' + serviceName + ' (' + info.status + ')');
      if (info.error) {
        console.log('     Error: ' + info.error);
      }
    });
    console.log('');
  }
  
  console.log('All services:');
  const sorted = Object.entries(services).sort((a, b) => a[0].localeCompare(b[0]));
  sorted.forEach(([name, info]) => {
    const icon = info.status === 'ok' ? '✅' : '❌';
    console.log('  ' + icon + ' ' + name + ': ' + info.ms + 'ms (' + info.status + ')');
  });
  
  console.log('');
  console.log('💥 Deploy verification FAILED');
  process.exit(1);
}
"
