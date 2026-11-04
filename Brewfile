# --- Core CLI ---
brew "git"
brew "git-lfs"
brew "git-delta"
brew "gh"
brew "wget"
brew "mkcert"

# --- Git review ---
brew "diffnav" # Live diff viewer with a file tree
brew "lazygit"

# --- Shell / UX ---
brew "zsh" if OS.linux? # macOS already includes Zsh
brew "flock" if OS.linux? # Thea process/supervisor singleton locks
brew "starship"
brew "stow"
brew "direnv"
brew "zoxide"
brew "eza"
brew "bat"
brew "tldr" if OS.mac?
brew "tlrc" if OS.linux? # tldr client; Homebrew has no tldr formula on Linux
brew "tree"
brew "zsh-autosuggestions"
brew "neovim" # Live-synced notes pad (the `n` command)
brew "tree-sitter-cli" # Builds Neovim treesitter parsers
brew "typescript" # tsc 7, including its built-in language server
brew "yaml-language-server" # Neovim LSP (mason's npm feed lags)

# --- Search / text / data ---
brew "ripgrep"
brew "fd"
brew "jq"
brew "yq"

# --- Monitoring ---
brew "bottom"

# --- Language / tool managers ---
brew "fnm"
brew "asdf"
brew "rustup"
brew "go"

# --- Kubernetes / Operators ---
brew "operator-sdk"
brew "kubernetes-cli"
brew "kustomize"
brew "helm"
brew "kind"
tap "azure/kubelogin"
brew "azure/kubelogin/kubelogin"

# --- Cloud / IaC ---
tap "azure/functions"
brew "azure-cli" if OS.mac? # Linux: uv tool install azure-cli (bootstrap.sh)
brew "cloudflare-wrangler"
tap "hashicorp/tap"
brew "hashicorp/tap/terraform"

# --- Python tooling ---
brew "uv"
brew "python@3.11"

# --- Dev tooling ---
brew "pre-commit"

# --- Terminal multiplexer ---
brew "tmux"

# --- Agent multiplexer ---
brew "herdr"

# --- Coding agents ---
brew "pi-coding-agent"

# --- Synergy ---
if OS.mac?
  brew "gettext"
  brew "nss"
end


# --- Microsoft Work IQ CLI ---
# Homebrew Node runs global CLI tools; fnm manages project-specific versions.
brew "node"
npm "@microsoft/workiq"

# --- macOS only: casks and desktop bits ---
if OS.mac?
  cask "copilot-cli"                    # GitHub Copilot CLI
  cask "claude-code"                    # Claude Code
  cask "visual-studio-code@insiders"     # code-insiders CLI and GUI editor
  brew "terminal-notifier"              # herdr [ui.toast] delivery = "system"
  cask "kitty"                          # terminal
  cask "font-jetbrains-mono-nerd-font"
  cask "wireshark"
end

# --- Media ---
brew "ffmpeg"

if OS.mac?
  tap "bensincs/tap"
  cask "webshow"
end
