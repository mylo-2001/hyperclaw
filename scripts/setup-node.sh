#!/usr/bin/env bash
# setup-node.sh — install HyperClaw on a remote Node (server, Pi, VM)
# Usage: curl -sSL https://hyperclaw.ai/setup-node.sh | bash
# Or:    ./scripts/setup-node.sh [--port 18789] [--bind 127.0.0.1]
set -euo pipefail

PORT="${HYPERCLAW_PORT:-18789}"
BIND="${HYPERCLAW_BIND:-127.0.0.1}"
HC_DIR="$HOME/.hyperclaw"

echo ""
echo "  ⚡ HyperClaw Node Setup"
echo "  ────────────────────────"
echo "  Port: $PORT"
echo "  Bind: $BIND"
echo ""

# Check node version
NODE_VER=$(node --version 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
if [ "$NODE_VER" -lt 22 ]; then
  echo "  ✖  Node.js ≥22 required (found: $(node --version 2>/dev/null || echo 'not installed'))"
  echo "     Install: https://nodejs.org or use nvm"
  exit 1
fi
echo "  ✔  Node.js $(node --version)"

# Check pnpm or npm
if command -v pnpm &>/dev/null; then
  PKG="pnpm"
elif command -v npm &>/dev/null; then
  PKG="npm"
else
  echo "  ✖  npm or pnpm required"
  exit 1
fi
echo "  ✔  Package manager: $PKG"

# Install hyperclaw globally
echo "  ↓  Installing HyperClaw..."
$PKG install -g hyperclaw

# Create config dir
mkdir -p "$HC_DIR/logs" "$HC_DIR/credentials"
chmod 700 "$HC_DIR" "$HC_DIR/credentials"

# Write minimal config
if [ ! -f "$HC_DIR/openclaw.json" ]; then
  TOKEN=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")
  cat > "$HC_DIR/openclaw.json" << CONF
{
  "gateway": {
    "port": $PORT,
    "bind": "$BIND",
    "authToken": "$TOKEN",
    "runtime": "node",
    "enabledChannels": [],
    "hooks": true
  }
}
CONF
  chmod 600 "$HC_DIR/openclaw.json"
  echo "  ✔  Config written to $HC_DIR/openclaw.json"
  echo "  ⚠   Gateway token: $TOKEN"
  echo "      (save this — you'll need it to connect from your main machine)"
fi

# Install daemon
hyperclaw daemon install --skip-banner 2>/dev/null || true

echo ""
echo "  ✔  HyperClaw node ready"
echo "     Start: hyperclaw daemon start"
echo "     Add to main: hyperclaw node add"
echo ""
