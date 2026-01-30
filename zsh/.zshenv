# ================================================================
# Environment variables for ALL zsh sessions (interactive + non-interactive)
# This file is sourced first by zsh before .zshrc
# ================================================================

# ---- Basic Environment ----
export EDITOR="code"
export LANG="en_US.UTF-8"

# ---- Core PATH ----
# Start with minimal safe PATH
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

# Add Homebrew
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# Add user-local binaries
export PATH="$HOME/.cargo/bin:$PATH"

# ---- SDKMAN (Java, Maven, Gradle, etc.) ----
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"

# ---- ASDF Version Manager ----
if [[ -f "/opt/homebrew/opt/asdf/libexec/asdf.sh" ]]; then
  source "/opt/homebrew/opt/asdf/libexec/asdf.sh"
fi

# ---- fnm (Fast Node Manager) ----
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
fi
