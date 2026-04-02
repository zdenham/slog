# Curl Install Distribution

## Objective

Implement the full curl-install distribution system for slog as defined in `plans/curl-install-distribution.md`. This includes:

1. **VERSION file** — already exists at repo root with `0.0.1`
2. **Install script** (`scripts/install.sh`) — bash script that users pipe via `curl | bash` to install slog
3. **Deploy script** (`scripts/deploy.sh`) — builds binaries for all platforms, bumps version, uploads to R2
4. **Wiring** — package.json scripts, .gitignore updates, .env.example, e2e test script

## Acceptance Criteria

- [ ] `VERSION` file exists at repo root (already done)

- [ ] `scripts/install.sh` handles: fetch latest version, detect platform, download binary, update PATH, install skill — with `--yes` flag for non-interactive mode

- [ ] `scripts/deploy.sh` handles: version bumping (patch/minor/major/no-bump), building darwin-arm64 and darwin-x64 binaries, uploading to R2 via wrangler

- [ ] `package.json` has `deploy` and `test:e2e` scripts

- [ ] `dist/` is in `.gitignore`

- [ ] `.env.example` exists with placeholder Cloudflare credentials

- [ ] `scripts/test-e2e.sh` runs full deploy → install → verify cycle

- [ ] Deploy script runs successfully (builds binaries, uploads to R2)

- [ ] Install script works when tested locally

## Context

- R2 bucket: `slog-builds`
- R2 public URL: `https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev`
- Uses Bun for building (`bun build --compile`)
- Uses wrangler for R2 uploads (`npx wrangler r2 object put`)
- `.env` has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
- Existing `scripts/build-npm.sh` already exists
- macOS only for now (darwin-arm64, darwin-x64)
- The plan file is at `plans/curl-install-distribution.md` — refer to it for full details on each phase