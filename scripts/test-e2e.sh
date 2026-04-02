#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_URL="https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev"
FAILURES=0

check() {
  local desc="$1"
  shift
  if "$@"; then
    printf "\033[1;32m✓\033[0m %s\n" "$desc"
  else
    printf "\033[1;31m✗\033[0m %s\n" "$desc"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "=== slog e2e test ==="
echo ""

# 0. Clean previous install
echo "Cleaning previous install..."
rm -rf ~/.slog
sed -i '' '/\.slog\/bin/d' ~/.zshrc 2>/dev/null || true
rm -f slog.md

# 1. Deploy current version (no bump)
echo "Deploying..."
./scripts/deploy.sh --no-bump

# 2. Install via curl | bash (non-interactive)
echo ""
echo "Installing..."
curl -fsSL "$BASE_URL/install.sh" | bash -s -- --yes

# 3. Verify
echo ""
echo "Verifying..."

check "binary installed" test -x ~/.slog/bin/slog

EXPECTED="v$(cat VERSION)"
ACTUAL=$(~/.slog/bin/slog --version 2>/dev/null || echo "FAILED")
check "version matches ($EXPECTED)" [ "$ACTUAL" = "$EXPECTED" ]

check "PATH in .zshrc" grep -q '.slog/bin' ~/.zshrc

check "skill file installed" test -f slog.md

# 4. Cleanup
rm -f slog.md

echo ""
if [ $FAILURES -eq 0 ]; then
  echo "All checks passed!"
else
  echo "$FAILURES check(s) failed"
  exit 1
fi
