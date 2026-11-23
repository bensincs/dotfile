# ================================================================
# Interactive shell configuration
# Sourced after .zshenv for interactive shells only
# ================================================================

# ---- Shell Configuration ----
export ZSH="$HOME/.zsh"

# ---- Starship Prompt ----
if command -v starship >/dev/null 2>&1; then
  eval "$(starship init zsh)"
fi

# ---- History ----
HISTFILE="$HOME/.zsh_history"
HISTSIZE=100000
SAVEHIST=100000
setopt share_history
setopt hist_ignore_all_dups

# ---- Key Bindings ----
# Enable Emacs-style line editing (default)
bindkey -e

# Cmd+Left: jump to beginning of line
bindkey "^[[1;9D" beginning-of-line
bindkey "^[OH" beginning-of-line

# Cmd+Right: jump to end of line
bindkey "^[[1;9C" end-of-line
bindkey "^[OF" end-of-line

# Alt+Left: move backward one word
bindkey "^[[1;3D" backward-word
bindkey "^[b" backward-word

# Alt+Right: move forward one word
bindkey "^[[1;3C" forward-word
bindkey "^[f" forward-word

# ---- Completion ----
autoload -Uz compinit
compinit

# ---- Working directory reporting ----
# OSC 7 tells the terminal (Rex, Kitty) the shell's directory, for tab titles and
# for new tabs and splits that start where this shell is.
__report_cwd() {
  emulate -L zsh
  local LC_ALL=C url="" ch i
  for (( i = 1; i <= ${#PWD}; i++ )); do
    ch="${PWD[i]}"
    if [[ "$ch" == [A-Za-z0-9/._~-] ]]; then
      url+="$ch"
    else
      url+="$(printf '%%%02X' "'$ch")"
    fi
  done
  printf '\e]7;file://%s%s\e\\' "$HOST" "$url"
}
autoload -Uz add-zsh-hook
add-zsh-hook chpwd __report_cwd
__report_cwd

# ---- Aliases ----

# eza (modern ls replacement)
if command -v eza >/dev/null 2>&1; then
  alias ls="eza --icons"
  alias ll="eza -lah --icons --git"
  alias lt="eza --tree --level=2 --icons"
  alias la="eza -a --icons"
else
  alias ll="ls -lah"
fi

# bat (modern cat with syntax highlighting)
if command -v bat >/dev/null 2>&1; then
  alias cat="bat --style=auto"
  alias catt="/bin/cat"  # original cat if needed
  export BAT_THEME="ansi"
  export MANPAGER="sh -c 'col -bx | bat -l man -p'"
fi

# ripgrep
if command -v rg >/dev/null 2>&1; then
  alias grep="rg"
  alias grepp="/usr/bin/grep"  # original grep if needed
fi

# git
alias gs="git status"
alias gp="git pull"

# Watch changes from the commit at launch, across later commits and pushes.
diffwatch() {
  bash "$HOME/.config/zsh/diffwatch.sh" "$@"
}

# wt - git worktrees under ~/worktrees/<repo>/<branch>, each in its own Rex tab.
# Outside Rex, `wt new` and `wt go` cd into the worktree instead.
wt() {
  case "${1:-}" in
    new | go)
      local target
      target="$(bash "$HOME/.config/zsh/wt.sh" "$@")" || return
      [[ -n "$target" && -d "$target" ]] && cd "$target"
      ;;
    ui)
      local choice target
      choice="$(mktemp)"
      WT_CHOICE_FILE="$choice" bash "$HOME/.config/zsh/wt.sh" "$@"
      target="$(<"$choice")"
      rm -f "$choice"
      [[ -n "$target" && -d "$target" ]] && cd "$target"
      ;;
    *) bash "$HOME/.config/zsh/wt.sh" "$@" ;;
  esac
}

# n - live-synced notes pad. Works in any number of terminals or Rex panes.
#   n              open the pad
#   n some text    append a line without opening it
#   cmd | n        append piped output
n() {
  bash "$HOME/.config/zsh/notes.sh" "$@"
}

# kubernetes
alias k="kubectl"

# misc
if command -v code-insiders >/dev/null 2>&1; then
  alias code="code-insiders"
fi
alias c="clear"

# neovim
if command -v nvim >/dev/null 2>&1; then
  alias vim="nvim"
  alias vi="nvim"
fi

# system monitoring
if command -v btm >/dev/null 2>&1; then
  alias top="btm"
  alias htop="btm"
fi

# ---- Interactive Plugins ----

# direnv - automatically load/unload environment variables based on directory
if command -v direnv >/dev/null 2>&1; then
  eval "$(direnv hook zsh)"
fi

# fnm - fast node manager with auto-switching on cd
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --use-on-cd)"
fi

# zoxide - smarter cd command (use 'z' to jump, 'zi' for interactive)
if command -v zoxide >/dev/null 2>&1; then
  eval "$(zoxide init zsh)"
  alias cd="z"  # replace cd with zoxide
fi

# zsh-autosuggestions - fish-like autosuggestions
if [[ -f "$HOMEBREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh" ]]; then
  export ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=244"
  source "$HOMEBREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh"
fi

[[ -d /Applications/Docker.app ]] && export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Machine-local, untracked overrides and private values (e.g. WHATSAPP_ALLOW)
if [[ -f "$HOME/.zshrc.local" ]]; then
  source "$HOME/.zshrc.local"
fi
