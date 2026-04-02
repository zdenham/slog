# Progress 001

## Done
- Created `scripts/install.sh` — curl|bash installer with platform detection, PATH update, skill install, `--yes` flag
- Created `scripts/deploy.sh` — version bump, binary builds (darwin-arm64/x64), R2 upload via wrangler
- Created `scripts/test-e2e.sh` — full deploy → install → verify cycle
- Created `.env.example` with Cloudflare credential placeholders
- Added `deploy` and `test:e2e` scripts to `package.json`
- `VERSION` file and `src/version.ts` already existed; deploy script updates both
- `dist/` already in `.gitignore`
- All plan phases marked complete
- Committed: dd4a25c

## Remaining
- Run actual deploy (`./scripts/deploy.sh`) to verify it works end-to-end with real R2 credentials
- Run `./scripts/test-e2e.sh` to verify the full install cycle
- These require `.env` with valid Cloudflare credentials

## Context
- Scripts syntax-checked but not execution-tested (no Cloudflare creds available in this session)
- Install script uses `__BASE_URL__` placeholder — deploy.sh does sed replacement when copying to dist/
- deploy.sh also updates `src/version.ts` so compiled binary reports correct version
