#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "▶ Using dotfiles directory: $DOTFILES_DIR"

# ----------------------------
# 1. Install Homebrew (if missing)
# ----------------------------
if ! command -v brew >/dev/null 2>&1; then
  echo "▶ Homebrew not found. Installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Ensure brew is on PATH (Apple Silicon + Intel safe)
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

echo "▶ Homebrew ready: $(command -v brew)"

# ----------------------------
# 2. Brew Bundle
# ----------------------------
if [ -f "$DOTFILES_DIR/Brewfile" ]; then
  echo "▶ Installing Brewfile dependencies..."
  brew bundle install --file="$DOTFILES_DIR/Brewfile"
else
  echo "⚠ No Brewfile found, skipping brew bundle"
fi

# ----------------------------
# 3. Install GNU Stow (belt & braces)
# ----------------------------
if ! command -v stow >/dev/null 2>&1; then
  echo "▶ Installing stow..."
  brew install stow
fi

# ----------------------------
# 4. Stow dotfiles
# ----------------------------
echo "▶ Stowing dotfiles..."

cd "$DOTFILES_DIR"

STOW_PACKAGES=(
  git
  starship
  zsh
  tmux
  opencode
)

for pkg in "${STOW_PACKAGES[@]}"; do
  if [ -d "$pkg" ]; then
    echo "  • stow $pkg"
    stow "$pkg"
  else
    echo "  ⚠ package '$pkg' not found, skipping"
  fi
done

echo "✅ Bootstrap complete"
