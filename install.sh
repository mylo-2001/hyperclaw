#!/bin/bash
set -e

echo ""
echo "⚡ HyperClaw v5.1.0 — AI Gateway Platform"
echo "The Lobster Evolution 🦅"
echo "==========================================="
echo ""

# Check node version
NODE_VER=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js 18+ required (found: $NODE_VER)"
  echo "   Install from: https://nodejs.org"
  exit 1
fi
echo "✅ Node.js v$(node -v | tr -d v) detected"

# Check for pnpm (preferred) or npm
if command -v pnpm &>/dev/null; then
  PM="pnpm"
  echo "✅ pnpm detected (preferred)"
elif command -v npm &>/dev/null; then
  PM="npm"
  echo "✅ npm detected"
else
  echo "❌ No package manager found"
  exit 1
fi

echo ""
echo "📦 Installing dependencies..."
$PM install

echo ""
echo "🔨 Building..."
$PM run build

echo ""
echo "🔗 Installing globally..."
npm install -g .

echo ""
echo "✅ HyperClaw v5.1.5 installed!"
echo ""
echo "  Start setup:   hyperclaw onboard --install-daemon"
echo "  Quick start:   hyperclaw quickstart"
echo "  Health check:  hyperclaw doctor"
echo "  Help:          hyperclaw --help"
echo ""
