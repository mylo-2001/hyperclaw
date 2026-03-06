#!/usr/bin/env bash
# restart-mac.sh — restart the HyperClaw LaunchAgent on macOS
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/ai.hyperclaw.gateway.plist"
LABEL="ai.hyperclaw.gateway"

if [ ! -f "$PLIST" ]; then
  echo "  ✖  LaunchAgent plist not found: $PLIST"
  echo "     Run: hyperclaw daemon install"
  exit 1
fi

echo "  ↻  Restarting HyperClaw LaunchAgent..."
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 2

# Verify
if launchctl print "gui/$(id -u)/$LABEL" &>/dev/null; then
  echo "  ✔  HyperClaw restarted successfully"
else
  echo "  ✖  Failed to restart — check: launchctl error $LABEL"
  exit 1
fi
