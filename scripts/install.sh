#!/bin/bash
set -euo pipefail

BASE_URL="__BASE_URL__"
INSTALL_DIR="$HOME/.slog/bin"
BINARY_NAME="slog"

# Parse flags
AUTO_YES=false
SKIP_SKILL=false
for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=true ;;
    --skip-skill) SKIP_SKILL=true ;;
  esac
done

prompt() {
  local message="$1"
  local default="$2"
  if [ "$AUTO_YES" = true ]; then
    echo "$default"
    return
  fi
  printf "%s " "$message" </dev/tty >/dev/tty
  read -r answer </dev/tty
  echo "${answer:-$default}"
}

info() { printf "\033[1;34m>\033[0m %s\n" "$1"; }
success() { printf "\033[1;32m✓\033[0m %s\n" "$1"; }
error() { printf "\033[1;31m✗\033[0m %s\n" "$1" >&2; exit 1; }

# 1. Fetch latest version
info "Fetching latest version..."
VERSION=$(curl -fsSL "$BASE_URL/latest") || error "Failed to fetch latest version"
success "Latest version: $VERSION"

# 2. Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) ;;
  *) error "Unsupported OS: $OS (only macOS is supported)" ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) error "Unsupported architecture: $ARCH" ;;
esac

PLATFORM="${OS}-${ARCH}"
info "Detected platform: $PLATFORM"

# 3. Create install directory
mkdir -p "$INSTALL_DIR"

# 4. Download binary
BINARY_URL="$BASE_URL/$VERSION/bin/slog-$PLATFORM"
info "Downloading slog $VERSION..."
curl -fsSL "$BINARY_URL" -o "$INSTALL_DIR/$BINARY_NAME" || error "Failed to download binary"
chmod +x "$INSTALL_DIR/$BINARY_NAME"

# Smoke check
if "$INSTALL_DIR/$BINARY_NAME" --version >/dev/null 2>&1; then
  success "Binary installed to $INSTALL_DIR/$BINARY_NAME"
else
  error "Binary smoke check failed"
fi

# 5. Update PATH
if echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  success "PATH already includes $INSTALL_DIR"
else
  # Detect shell profile — use env file so non-interactive shells (e.g. Claude Code) also get it
  SHELL_NAME=$(basename "$SHELL")
  case "$SHELL_NAME" in
    zsh) PROFILE="$HOME/.zshenv" ;;
    bash)
      if [ -f "$HOME/.bash_profile" ]; then
        PROFILE="$HOME/.bash_profile"
      else
        PROFILE="$HOME/.bashrc"
      fi
      ;;
    *) PROFILE="$HOME/.profile" ;;
  esac

  answer=$(prompt "Add $INSTALL_DIR to PATH in $PROFILE? [Y/n]" "Y")
  case "$answer" in
    [nN]*)
      echo "  Skipping PATH update. Add manually:"
      echo "    export PATH=\"\$HOME/.slog/bin:\$PATH\""
      ;;
    *)
      echo '' >> "$PROFILE"
      echo 'export PATH="$HOME/.slog/bin:$PATH"' >> "$PROFILE"
      success "Added to $PROFILE — restart your shell or run: source $PROFILE"
      ;;
  esac
fi

# 6. Install skill
if [ "$SKIP_SKILL" = true ]; then
  info "Skipping skill install (--skip-skill)"
else
  answer=$(prompt "Install slog skill? [Y/n]" "Y")
  case "$answer" in
    [nN]*)
      info "Skipping skill install"
      ;;
    *)
      if [ "$AUTO_YES" = true ]; then
        SKILL_DIR="."
      else
        printf "Skill directory [default: current directory]: " </dev/tty >/dev/tty
        read -r SKILL_DIR </dev/tty
        SKILL_DIR="${SKILL_DIR:-.}"
      fi
      mkdir -p "$SKILL_DIR"
      curl -fsSL "$BASE_URL/$VERSION/skill.md" -o "$SKILL_DIR/slog.md" || error "Failed to download skill"
      success "Skill installed to $SKILL_DIR/slog.md"
      ;;
  esac
fi

# 7. Summary
echo ""
echo "slog $VERSION installed successfully!"
echo "  Binary: $INSTALL_DIR/$BINARY_NAME"
echo "  Run: slog serve"
