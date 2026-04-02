# Progress 002

## Done
- Fixed deploy script: added `$HOME/.bun/bin` to PATH fallback, replaced `npx` with `bunx`
- Ran deploy successfully — builds both darwin-arm64 and darwin-x64, uploads all artifacts to R2
- Tested install via `bash dist/install.sh --yes` — binary installs, PATH updated, skill downloaded
- Tested install via `curl -fsSL .../install.sh | bash -s -- --yes` — works end-to-end
- Ran full e2e test (`scripts/test-e2e.sh`) — all 4 checks pass (binary installed, version matches, PATH in .zshrc, skill file installed)
- Committed: 0d0b43a

## Remaining
- All acceptance criteria are met

## Context
- The `--remote` flag on wrangler r2 commands is required (uses Cloudflare's remote storage)
- Binary smoke check (`slog --version`) confirms compiled binary works correctly
