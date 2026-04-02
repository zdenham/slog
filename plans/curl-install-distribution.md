# slog: curl | bash Distribution

Distribute slog via `curl https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev/install.sh | bash` — a single command that installs the binary, updates PATH, and optionally copies the skill file.

## Versioning

Version is the single source of truth in a plain text `VERSION` file at the repo root:

```
0.0.1
```

The deploy script reads this file, auto-bumps the patch version (or minor/major with `--minor`/`--major`), and uses it for bucket paths. The version string is prefixed with `v` for tags and R2 paths (e.g. `v0.1.1`).

## Architecture

```
R2 Bucket (slog-builds)
├── install.sh                        ← installer (always at root, knows latest version)
├── latest                            ← plain text file containing current version e.g. "v0.0.1"
└── v0.0.1/
    ├── skill.md                      ← slog skill file
    └── bin/
        ├── slog-darwin-arm64         ← macOS Apple Silicon
        └── slog-darwin-x64           ← macOS Intel
```

```
User runs: curl https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev/install.sh | bash
                    │
                    ▼
          fetch /latest → "v0.0.1"
                    │
                    ▼
            detect OS/arch
                    │
                    ▼
        download /v0.0.1/bin/slog-<os>-<arch>
        to ~/.slog/bin/slog
                    │
                    ▼
        add ~/.slog/bin to PATH
        in shell profile (if needed)
                    │
                    ▼
        ask: install skill? where?
                    │
                    ▼
        download /v0.0.1/skill.md
        to chosen directory
```

## Phases

- [x] Phase 0: Create `VERSION` file

- [x] Phase 1: Create the install script (`scripts/install.sh`)

- [x] Phase 2: Create the deploy script (`scripts/deploy.sh`)

- [x] Phase 3: Wire up package.json scripts and document usage

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 0: Version File

Create `VERSION` at the repo root — plain text, single line, no trailing newline:

```
0.0.1
```

## Phase 1: Install Script (`scripts/install.sh`)

Interactive bash script downloaded and piped to bash by the end user.

### Behavior

1. **Fetch latest version**: `curl -fsSL https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev/latest` → version string (e.g. `v0.0.1`)

2. **Detect platform**: `uname -s` / `uname -m` → map to binary suffix (`darwin-arm64`, `darwin-x64`)

   - Fail with clear message on non-macOS platforms

3. **Set install directory**: Default `~/.slog/bin`

   - Create directory if it doesn't exist

4. **Download binary**: `curl -fsSL https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev/<version>/bin/slog-<os>-<arch>` → `~/.slog/bin/slog`

   - `chmod +x` after download
   - Verify it runs: `~/.slog/bin/slog --help` or similar smoke check

5. **Update PATH** (interactive):

   - Check if `~/.slog/bin` is already in PATH
   - If not, detect shell profile (`~/.zshrc`, `~/.bash_profile`)
   - Ask user: "Add \~/.slog/bin to PATH in &lt;detected profile&gt;? \[Y/n\]"
   - If yes, append `export PATH="$HOME/.slog/bin:$PATH"` to profile
   - Print reminder to `source <profile>` or open new terminal

6. **Install skill** (interactive):

   - Ask: "Install slog skill? \[Y/n\]"
   - If yes, ask: "Skill directory \[default: current directory\]:"
   - Download `<version>/skill.md` to chosen directory as `slog.md`
   - Confirm installation

7. **Print summary**: what was installed (including version), where, next steps

### Design notes

- `BASE_URL` is baked into the script at deploy time (sed replacement or heredoc variable)
- Script must work when piped (`curl | bash`) — use `/dev/tty` for interactive prompts
- Support `--yes` / `-y` flag to skip all prompts and accept defaults (for CI and e2e testing)
- Use `curl` with `wget` fallback for downloading
- No dependencies beyond standard POSIX + curl/wget

## Phase 2: Deploy Script (`scripts/deploy.sh`)

Run locally to build all platforms and upload to R2. Follows the same pattern as anvil's `scripts/distribute.sh` — uses `wrangler` for R2 uploads.

### Usage

```bash
./scripts/deploy.sh              # bump patch (default): 0.0.1 → 0.1.1
./scripts/deploy.sh --minor      # bump minor: 0.1.1 → 0.2.0
./scripts/deploy.sh --major      # bump major: 0.2.0 → 1.0.0
./scripts/deploy.sh --no-bump    # deploy current version without bumping
```

### Prerequisites

- `VERSION` file at repo root with current version

- `.env` with Cloudflare credentials (same as anvil):

  ```
  CLOUDFLARE_API_TOKEN=...
  CLOUDFLARE_ACCOUNT_ID=...
  ```

- `bun` installed (for building)

- `wrangler` available via `npx` (Cloudflare CLI for R2 uploads)

### Steps

1. **Parse args** — default `patch`, accept `--minor`, `--major`, `--no-bump`

2. **Load .env** — `set -a; source .env; set +a` (wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` automatically from env)

3. **Preflight: verify Cloudflare auth** (same as anvil):

   ```bash
   echo "Verifying Cloudflare authentication..."
   if ! npx wrangler r2 bucket list &>/dev/null; then
     echo "Error: Cloudflare authentication failed."
     echo "Please check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env"
     exit 1
   fi
   echo "Cloudflare auth verified."
   ```

4. **Version bump** — read `VERSION`, split on `.`, bump the appropriate component, write back:

   ```bash
   CURRENT_VERSION=$(cat VERSION)
   IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
   
   case $BUMP_TYPE in
     major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
     minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
     patch) PATCH=$((PATCH + 1)) ;;
   esac
   
   NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
   echo -n "$NEW_VERSION" > VERSION
   TAG="v${NEW_VERSION}"
   ```

   If `--no-bump`, skip and use current version.

5. **Build binaries** for all platforms:

   ```bash
   bun build --compile --target=bun-darwin-arm64 src/cli.ts --outfile dist/slog-darwin-arm64
   bun build --compile --target=bun-darwin-x64 src/cli.ts --outfile dist/slog-darwin-x64
   ```

   Output to `dist/` directory (gitignored)

6. **Prepare install script**: Copy `scripts/install.sh` → `dist/install.sh`, replace `__BASE_URL__` placeholder with the R2 public URL

7. **Upload to R2** using wrangler (same pattern as anvil's [distribute.sh](http://distribute.sh)):

   ```bash
   BUCKET="slog-builds"
   
   # Installer at root
   npx wrangler r2 object put "$BUCKET/install.sh" \
     --file=dist/install.sh --content-type="text/plain" --remote
   
   # Update latest pointer
   echo -n "$TAG" > dist/latest
   npx wrangler r2 object put "$BUCKET/latest" \
     --file=dist/latest --content-type="text/plain" --remote
   
   # Versioned assets
   npx wrangler r2 object put "$BUCKET/$TAG/skill.md" \
     --file=skill.md --content-type="text/plain" --remote
   
   for target in darwin-arm64 darwin-x64; do
     npx wrangler r2 object put "$BUCKET/$TAG/bin/slog-$target" \
       --file="dist/slog-$target" --content-type="application/octet-stream" --remote
   done
   ```

8. **Print summary** — version deployed and install command

## Phase 3: Wiring & Docs

1. **package.json scripts**:

   - `"deploy"`: `"bash scripts/deploy.sh"` — build + upload everything
   - `"test:e2e"`: `"bash scripts/test-e2e.sh"` — full deploy → install → verify cycle

2. **.gitignore**: Ensure `dist/` directory is ignored

3. **.env.example**: Create with placeholder Cloudflare credentials:

   ```
   CLOUDFLARE_API_TOKEN=
   CLOUDFLARE_ACCOUNT_ID=
   ```

4. `scripts/test-e2e.sh`: E2E test script that cleans previous install, deploys with `--no-bump`, installs with `--yes`, verifies binary/version/PATH/skill, and exits non-zero on failure

5. **Print usage instructions** at end of deploy — just the curl command, nothing more

## Non-Interactive Mode

The install script supports a `--yes` (`-y`) flag that skips all interactive prompts and accepts defaults:

```bash
curl -fsSL https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev/install.sh | bash -s -- --yes
```

When `--yes` is passed:

- PATH update: auto-accepts (adds to detected shell profile)
- Skill install: auto-accepts with default directory (current directory)

Implementation: check for `--yes` or `-y` in `$@` at the top of [install.sh](http://install.sh). When set, replace `/dev/tty` reads with the default answers.

## E2E Testing

Manual end-to-end test to verify the full deploy → install → run cycle.

### Prerequisites

- A deployed version in R2 (run deploy first)
- No existing slog install (or clean it first)

### Steps

```bash
# 0. Clean previous install
rm -rf ~/.slog
# Remove the PATH line from shell profile if present
sed -i '' '/\.slog\/bin/d' ~/.zshrc

# 1. Deploy current version
./scripts/deploy.sh --no-bump

# 2. Install via curl | bash (non-interactive)
curl -fsSL https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev/install.sh | bash -s -- --yes

# 3. Verify installation
# Binary exists and is executable
test -x ~/.slog/bin/slog && echo "✓ binary installed" || echo "✗ binary missing"

# Version matches what we deployed
EXPECTED="v$(cat VERSION)"
ACTUAL=$(~/.slog/bin/slog --version)
[ "$ACTUAL" = "$EXPECTED" ] && echo "✓ version $ACTUAL" || echo "✗ expected $EXPECTED, got $ACTUAL"

# PATH was added to shell profile
grep -q '.slog/bin' ~/.zshrc && echo "✓ PATH configured" || echo "✗ PATH not in .zshrc"

# Skill file was downloaded
test -f slog.md && echo "✓ skill installed" || echo "✗ skill missing"

# 4. Cleanup
rm -f slog.md
```

### Package.json script

Add a convenience script that runs the full cycle:

```json
"test:e2e": "bash scripts/test-e2e.sh"
```

`scripts/test-e2e.sh` wraps the steps above — cleans, deploys with `--no-bump`, installs with `--yes`, runs assertions, and exits non-zero on any failure.

## Open Questions

1. **~~R2 public URL~~**: Resolved — `https://pub-dfc2c649e67847a89ddc778f1b506f58.r2.dev`
2. **~~Windows~~**: Resolved — skip Windows for now. The equivalent is `irm | iex` (PowerShell) with a separate `install.ps1`, but it's a different script and binary format (`.exe`). Follow-up if there's demand.
3. **~~Skill destination default~~**: Resolved — default is the current directory (`.`)