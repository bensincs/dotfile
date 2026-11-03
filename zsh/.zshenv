# ================================================================
# Environment variables for ALL zsh sessions (interactive + non-interactive)
# This file is sourced first by zsh before .zshrc
# ================================================================

# ---- Basic Environment ----
if command -v code >/dev/null 2>&1; then export EDITOR="code"; else export EDITOR="nvim"; fi
export LANG="en_US.UTF-8"

# ---- Core PATH ----
# Start with minimal safe PATH
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

# Add Homebrew (macOS: /opt/homebrew, Linux: /home/linuxbrew/.linuxbrew)
for _brew in /opt/homebrew /home/linuxbrew/.linuxbrew; do
  [[ -x "$_brew/bin/brew" ]] && export HOMEBREW_PREFIX="$_brew" && export PATH="$_brew/bin:$_brew/sbin:$PATH" && break
done
unset _brew

# Add user-local binaries
export PATH="$HOME/.cargo/bin:$PATH"

# ---- SDKMAN (Java, Maven, Gradle, etc.) ----
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"

# ---- ASDF Version Manager ----
if [[ -f "$HOMEBREW_PREFIX/opt/asdf/libexec/asdf.sh" ]]; then
  source "$HOMEBREW_PREFIX/opt/asdf/libexec/asdf.sh"
fi

# ---- fnm (Fast Node Manager) ----
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
fi

# ---- Local machine overrides & secrets (NOT committed) ----
# Machine-specific env vars and secrets (API tokens, etc.) live in
# ~/.zshenv.local, which sits outside this repo and is gitignored, so it is
# never committed. Sourced last so it can override anything above.
[[ -f "$HOME/.zshenv.local" ]] && source "$HOME/.zshenv.local"
