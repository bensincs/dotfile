# ================================================================
# Interactive shell configuration
# Sourced after .zshenv for interactive shells only
# ================================================================

# ---- Shell Configuration ----
export ZSH="$HOME/.zsh"

# ---- TMUX auto-attach ----
if command -v tmux >/dev/null 2>&1; then
  if [[ -z "$TMUX" && -n "$PS1" ]]; then
    tmux attach -t main || tmux new -s main
  fi
fi

# ---- Starship Prompt ----
if command -v starship >/dev/null 2>&1; then
  eval "$(starship init zsh)"
  export STARSHIP_TMUX_SHOW_VERSION=false
fi

# ---- History ----
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

# kubernetes
alias k="kubectl"

# misc
alias code="code-insiders"
alias c="clear"

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
if [[ -f "/opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh" ]]; then
  export ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=244"
  source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi

