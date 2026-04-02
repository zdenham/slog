#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUCKET="slog-builds"
BASE_URL="https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev"

# Parse args
BUMP_TYPE="patch"
for arg in "$@"; do
  case "$arg" in
    --major) BUMP_TYPE="major" ;;
    --minor) BUMP_TYPE="minor" ;;
    --no-bump) BUMP_TYPE="none" ;;
  esac
done

# Load .env
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Preflight: verify Cloudflare auth
echo "Verifying Cloudflare authentication..."
if ! npx wrangler r2 bucket list &>/dev/null; then
  echo "Error: Cloudflare authentication failed."
  echo "Please check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env"
  exit 1
fi
echo "Cloudflare auth verified."

# Version bump
CURRENT_VERSION=$(cat VERSION)
if [ "$BUMP_TYPE" = "none" ]; then
  NEW_VERSION="$CURRENT_VERSION"
else
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  case $BUMP_TYPE in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
  esac
  NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
  echo -n "$NEW_VERSION" > VERSION
fi

TAG="v${NEW_VERSION}"
echo "Deploying $TAG..."

# Update version in source
sed -i '' "s/export const VERSION = \".*\"/export const VERSION = \"${NEW_VERSION}\"/" src/version.ts

# Build binaries
mkdir -p dist
echo "Building darwin-arm64..."
bun build --compile --target=bun-darwin-arm64 src/cli.ts --outfile dist/slog-darwin-arm64
echo "Building darwin-x64..."
bun build --compile --target=bun-darwin-x64 src/cli.ts --outfile dist/slog-darwin-x64

# Prepare install script
sed "s|__BASE_URL__|${BASE_URL}|g" scripts/install.sh > dist/install.sh

# Upload to R2
echo "Uploading to R2..."

npx wrangler r2 object put "$BUCKET/install.sh" \
  --file=dist/install.sh --content-type="text/plain" --remote

echo -n "$TAG" > dist/latest
npx wrangler r2 object put "$BUCKET/latest" \
  --file=dist/latest --content-type="text/plain" --remote

npx wrangler r2 object put "$BUCKET/$TAG/skill.md" \
  --file=skill.md --content-type="text/plain" --remote

for target in darwin-arm64 darwin-x64; do
  npx wrangler r2 object put "$BUCKET/$TAG/bin/slog-$target" \
    --file="dist/slog-$target" --content-type="application/octet-stream" --remote
done

echo ""
echo "Deployed slog $TAG"
echo ""
echo "Install:"
echo "  curl -fsSL $BASE_URL/install.sh | bash"
