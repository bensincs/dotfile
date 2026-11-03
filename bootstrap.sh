#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS="$(uname -s)"   # Darwin (Mac) or Linux (cloud dev box)
export NONINTERACTIVE=1

echo "▶ Using dotfiles directory: $DOTFILES_DIR ($OS)"

# ----------------------------
# 1. Install Homebrew (if missing)
# ----------------------------
if ! command -v brew >/dev/null 2>&1; then
  echo "▶ Homebrew not found. Installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Ensure brew is on PATH (Apple Silicon, Intel, Linux)
for b in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
  if [ -x "$b" ]; then eval "$("$b" shellenv)"; break; fi
done

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

# Directories apps write their own state into must be real, not stow-folded symlinks into this
# repo (on a fresh machine stow would otherwise link the whole directory).
mkdir -p "$HOME/.config/herdr" "$HOME/.pi/agent" "$HOME/.copilot"

STOW_PACKAGES=(
  bottom
  diffnav
  git
  nvim
  pi
  starship
  zsh
  tmux
  herdr
  copilot
)
[ "$OS" = Darwin ] && STOW_PACKAGES+=(kitty)

for pkg in "${STOW_PACKAGES[@]}"; do
  if [ -d "$pkg" ]; then
    echo "  • stow $pkg"
    stow "$pkg"
  else
    echo "  ⚠ package '$pkg' not found, skipping"
  fi
done

# ----------------------------
# 5. Linux-only tools Homebrew doesn't provide there
# ----------------------------
if [ "$OS" = Linux ] && ! command -v az >/dev/null 2>&1; then
  echo "▶ Installing Azure CLI (uv tool)..."
  uv tool install -q azure-cli
fi

# ----------------------------
# 6. Neovim plugins
# ----------------------------
# Installs the versions pinned in nvim/.config/nvim/lazy-lock.json.
if command -v nvim >/dev/null 2>&1; then
  echo "▶ Installing Neovim plugins..."
  nvim --headless "+Lazy! restore" +qa
else
  echo "⚠ nvim not found, skipping plugins"
fi

echo "✅ Bootstrap complete"
