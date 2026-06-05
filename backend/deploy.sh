#!/data/data/com.termux/files/usr/bin/env bash
set -e

# Source env
export $(grep -v '^#' /data/data/com.termux/files/home/.env | grep "CLOUDFLARE_" | xargs)

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID}"
API_TOKEN="${CLOUDFLARE_API_TOKEN}"
SCRIPT_NAME="github-firehose"

if [ -z "$ACCOUNT_ID" ] || [ -z "$API_TOKEN" ]; then
  echo "Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in ~/.env"
  exit 1
fi

# Quick test to see if the token works
echo "Testing Cloudflare API token..."
TEST=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}" \
  -H "Authorization: Bearer ${API_TOKEN}")

if ! echo "$TEST" | grep -q '"success":true'; then
  echo ""
  echo "ERROR: Your CLOUDFLARE_API_TOKEN is invalid or expired."
  echo ""
  echo "Your current token failed with:"
  echo "$TEST" | grep -o '"message":"[^"]*"' | head -1
  echo ""
  echo "=== HOW TO FIX ==="
  echo ""
  echo "1. Open this URL in your browser:"
  echo "   https://dash.cloudflare.com/profile/api-tokens"
  echo ""
  echo "2. Click 'Create Token' -> 'Custom token'"
  echo ""
  echo "3. Set these exact permissions:"
  echo "   - Account: Cloudflare Workers:Edit"
  echo "   - Account: Account Settings:Read (optional but recommended)"
  echo ""
  echo "4. Under 'Account Resources' select:"
  echo "   - Include: YOUR_ACCOUNT_NAME"
  echo ""
  echo "5. Click 'Continue to summary' -> 'Create token'"
  echo ""
  echo "6. Copy the new token and update ~/.env:"
  echo "   CLOUDFLARE_API_TOKEN=your-new-token-here"
  echo ""
  echo "7. Re-run this script: bash deploy.sh"
  echo ""
  exit 1
fi

echo "Token is valid. Proceeding with deployment..."
echo ""

# Write worker.js to temp
WORKER_FILE="/data/data/com.termux/files/home/github-firehose/backend/dist/worker.js"

if [ ! -f "$WORKER_FILE" ]; then
  echo "Error: ${WORKER_FILE} not found. Run 'npm run build' first."
  exit 1
fi

# Build multipart upload with metadata for Durable Objects
BOUNDARY="----FormBoundary$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')"
METADATA='{"body_part":"script","bindings":[{"type":"durable_object_namespace","name":"FIREHOSE","class_name":"FirehoseDO"}],"compatibility_date":"2024-01-01","usage_model":"bundled","migrations":[{"tag":"v1","new_classes":["FirehoseDO"]}]}'

{
  echo "--${BOUNDARY}"
  echo 'Content-Disposition: form-data; name="metadata"'
  echo 'Content-Type: application/json'
  echo ''
  echo "$METADATA"
  echo ''
  echo "--${BOUNDARY}"
  echo 'Content-Disposition: form-data; name="script"; filename="worker.js"'
  echo 'Content-Type: application/javascript'
  echo ''
  cat "$WORKER_FILE"
  echo ''
  echo "--${BOUNDARY}--"
} > /tmp/worker_upload.txt

echo "Uploading worker script with Durable Object bindings..."

RESPONSE=$(curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: multipart/form-data; boundary=${BOUNDARY}" \
  --data-binary @/tmp/worker_upload.txt)

if ! echo "$RESPONSE" | grep -q '"success":true'; then
  echo ""
  echo "Upload failed. Response:"
  echo "$RESPONSE"
  exit 1
fi

echo "Worker uploaded successfully."

# Generate or use existing webhook secret
WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')}"

# Set the secret
echo ""
echo "Setting GITHUB_WEBHOOK_SECRET..."
SECRET_RESP=$(curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}/secrets" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"GITHUB_WEBHOOK_SECRET\",\"text\":\"${WEBHOOK_SECRET}\",\"type\":\"secret_text\"}")

if echo "$SECRET_RESP" | grep -q '"success":true'; then
  echo "Secret set."
else
  # Secret might already exist — check if error is just "already exists"
  echo "$SECRET_RESP" | grep -q 'already exists' && echo "Secret already exists (not updated)." || echo "Secret warning: $SECRET_RESP"
fi

# Get worker subdomain
SUBDOMAIN=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/subdomain" \
  -H "Authorization: Bearer ${API_TOKEN}" | grep -o '"subdomain":"[^"]*"' | cut -d'"' -f4)

if [ -n "$SUBDOMAIN" ]; then
  WORKER_URL="https://${SCRIPT_NAME}.${SUBDOMAIN}.workers.dev"
  echo ""
  echo "=============================================="
  echo "  DEPLOYED SUCCESSFULLY"
  echo "=============================================="
  echo ""
  echo "Dashboard:     ${WORKER_URL}/"
  echo "Webhook URL:   ${WORKER_URL}/github-webhook"
  echo "API:           ${WORKER_URL}/api/events"
  echo "WebSocket:     wss://${SCRIPT_NAME}.${SUBDOMAIN}.workers.dev/websocket"
  echo ""
  echo "GITHUB_WEBHOOK_SECRET: ${WEBHOOK_SECRET}"
  echo ""
  echo "=== GitHub Webhook Setup ==="
  echo "1. Go to any repo -> Settings -> Webhooks -> Add webhook"
  echo "2. Payload URL: ${WORKER_URL}/github-webhook"
  echo "3. Content type: application/json"
  echo "4. Secret: ${WEBHOOK_SECRET}"
  echo "5. Events: Pushes, Pull requests, Issues"
  echo ""
  echo "=== Update your web dashboard ==="
  echo "If you're running the local dashboard, it connects to localhost:8787 by default."
  echo "To point it at the deployed worker, set these in the dashboard or mobile app:"
  echo "  API:  ${WORKER_URL}/api/events"
  echo "  WS:   wss://${SCRIPT_NAME}.${SUBDOMAIN}.workers.dev/websocket"
  echo "=============================================="
else
  echo "Worker deployed but could not determine subdomain."
  echo "Check your Cloudflare dashboard -> Workers & Pages -> github-firehose"
fi
