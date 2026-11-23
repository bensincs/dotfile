#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS="$(uname -s)"   # Darwin (Mac) or Linux (cloud dev box)
export NONINTERACTIVE=1

echo "▶ Using dotfiles directory: $DOTFILES_DIR ($OS)"

# ----------------------------
# 1. Install Homebrew (if missing)
# ----------------------------
find_homebrew() {
  if command -v brew >/dev/null 2>&1; then return 0; fi
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
    if [ -x "$b" ]; then
      export PATH="${b%/*}:$PATH"
      return 0
    fi
  done
  return 1
}

# Reuse an existing installation even when the calling shell has not loaded it.
if ! find_homebrew; then
  echo "▶ Homebrew not found. Installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  find_homebrew
fi
eval "$(brew shellenv)"
export PATH="$HOME/.local/bin:$PATH"

echo "▶ Homebrew ready: $(command -v brew)"

# ----------------------------
# 2. Brew Bundle
# ----------------------------
if [ -f "$DOTFILES_DIR/Brewfile" ]; then
  # Homebrew refuses third-party taps until trusted (safe to repeat, works before tapping).
  echo "▶ Trusting Brewfile taps..."
  brew trust --tap azure/kubelogin azure/functions hashicorp/tap bensincs/tap

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
mkdir -p "$HOME/.pi/agent" "$HOME/.copilot"

STOW_PACKAGES=(
  agents
  bottom
  diffnav
  git
  nvim
  pi
  starship
  zsh
  tmux
  copilot
)
[ "$OS" = Darwin ] && STOW_PACKAGES+=(kitty rex)

# Check the complete set before linking anything. Never adopt or overwrite
# existing dotfiles automatically; the README explains how to back them up.
if ! stow --dir="$DOTFILES_DIR" --target="$HOME" --simulate "${STOW_PACKAGES[@]}"; then
  echo "⚠ Dotfile conflicts found. No packages were stowed." >&2
  echo "  Back up the conflicting paths outside this repo, then rerun bootstrap.sh." >&2
  echo "  See README.md: Existing dotfiles and recovery." >&2
  exit 1
fi

stow --dir="$DOTFILES_DIR" --target="$HOME" "${STOW_PACKAGES[@]}"

# ----------------------------
# 5. Azure CLI (not available in Homebrew)
# ----------------------------
if ! command -v az >/dev/null 2>&1; then
  echo "▶ Installing Azure CLI (uv tool)..."
  uv tool install -q azure-cli
fi

# ----------------------------
# 6. Rex CLI (Linux only)
# ----------------------------
if [ "$OS" = Linux ] && ! command -v rex >/dev/null 2>&1; then
  echo "▶ Installing Rex CLI (official installer)..."
  curl -fsSL https://pkgs.superlogical.com/rex/install.sh | sh
fi

# ----------------------------
# 7. Neovim plugins
# ----------------------------
# Installs the versions pinned in nvim/.config/nvim/lazy-lock.json.
if command -v nvim >/dev/null 2>&1; then
  echo "▶ Installing Neovim plugins..."
  nvim --headless "+Lazy! restore" +qa
else
  echo "⚠ nvim not found, skipping plugins"
fi

# ----------------------------
# 8. Tailscale
# ----------------------------
if [ "$OS" = Darwin ]; then
  if ! tailscale status >/dev/null 2>&1; then
    echo "▶ Opening Tailscale. Approve permissions and sign into your tailnet."
    open -a Tailscale
  fi
elif [ "$OS" = Linux ]; then
  echo "▶ Starting the Tailscale system service (sudo required)..."
  sudo --preserve-env=HOME "$(command -v brew)" services start tailscale

  # Service startup can return before tailscaled's local API is ready.
  # JSON status succeeds even before the device has signed in.
  for attempt in {1..30}; do
    if tailscale status --json >/dev/null 2>&1; then break; fi
    if [ "$attempt" -eq 30 ]; then
      echo "⚠ Tailscale service did not become ready. Check: tailscale status" >&2
      exit 1
    fi
    sleep 1
  done

  if ! tailscale status >/dev/null 2>&1; then
    echo "▶ Connecting Tailscale. Open the login URL if prompted."
    sudo "$(command -v tailscale)" up
  fi
fi

echo "✅ Bootstrap complete"
