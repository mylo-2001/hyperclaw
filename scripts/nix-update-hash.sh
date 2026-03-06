#!/usr/bin/env bash
# Run: ./scripts/nix-update-hash.sh
# Updates flake.nix and default.nix with the correct npmDepsHash from nix build.
set -e
cd "$(dirname "$0")/.."
echo "Running nix build to compute npmDepsHash..."
out=$(nix build .# 2>&1) || true
hash=$(echo "$out" | grep -oE 'sha256-[A-Za-z0-9+/=]{43}' | tail -1)
if [ -z "$hash" ]; then
  echo "Could not extract hash. Run: nix build .# 2>&1"
  echo "Look for 'got: sha256-...' in the output and manually update flake.nix and default.nix"
  exit 1
fi
echo "Found hash: $hash"
for f in flake.nix default.nix; do
  if [ -f "$f" ]; then
    sed -i.bak "s/sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=/$hash/g" "$f"
    rm -f "$f.bak"
    echo "Updated $f"
  fi
done
echo "Done. Run: nix build .#"
