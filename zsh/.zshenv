# ================================================================
# Environment variables for ALL zsh sessions (interactive + non-interactive)
# This file is sourced first by zsh before .zshrc
# ================================================================

# ---- Basic Environment ----
export LANG="en_US.UTF-8"

# ---- Core PATH ----
# Preserve paths inherited from the terminal, virtual environments, and remote tools.
# Zsh keeps PATH and the path array linked; -U removes duplicate entries.
typeset -U path PATH
export PATH="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

# Homebrew: Apple Silicon, Intel, and Linux.
for _brew in /opt/homebrew /usr/local /home/linuxbrew/.linuxbrew; do
  [[ -x "$_brew/bin/brew" ]] && export HOMEBREW_PREFIX="$_brew" && export PATH="$_brew/bin:$_brew/sbin:$PATH" && break
done
unset _brew

# uv tool executables and Cargo-installed tools.
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

# Select an installed editor after PATH is ready; preserve an explicit choice.
if [[ -z "${EDITOR:-}" ]]; then
  if command -v code-insiders >/dev/null 2>&1; then
    export EDITOR="code-insiders"
  elif command -v code >/dev/null 2>&1; then
    export EDITOR="code"
  else
    export EDITOR="nvim"
  fi
fi

# ---- SDKMAN (Java, Maven, Gradle, etc.) ----
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"

# ---- ASDF Version Manager ----
# Current asdf uses shims; retain support for older shell-based installations.
export PATH="${ASDF_DATA_DIR:-$HOME/.asdf}/shims:$PATH"
if [[ -f "$HOMEBREW_PREFIX/opt/asdf/libexec/asdf.sh" ]]; then
  source "$HOMEBREW_PREFIX/opt/asdf/libexec/asdf.sh"
fi

# Homebrew rustup supplies the rustc/cargo proxies here.
if [[ -d "$HOMEBREW_PREFIX/opt/rustup/bin" ]]; then
  export PATH="$HOMEBREW_PREFIX/opt/rustup/bin:$PATH"
fi

# ---- fnm (Fast Node Manager) ----
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
fi

# ---- Local machine overrides & secrets (NOT committed) ----
# Machine-specific env vars and secrets (API tokens, etc.) live in
# ~/.zshenv.local, which sits outside this repo and is gitignored, so it is
# never committed. Sourced last so it can override anything above.
if [[ -f "$HOME/.zshenv.local" ]]; then
  source "$HOME/.zshenv.local"
fi
