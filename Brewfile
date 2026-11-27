# --- Core CLI ---
brew "git"
brew "git-lfs"
brew "git-delta"
brew "gh"
brew "wget"
brew "mkcert"
brew "age" # Encrypted private backups

# --- Git review ---
brew "diffnav" # Live diff viewer with a file tree

# --- Shell / UX ---
brew "zsh" if OS.linux? # macOS already includes Zsh
brew "flock" if OS.linux? # Process/supervisor singleton locks
brew "starship"
brew "stow"
brew "direnv"
brew "zoxide"
brew "eza"
brew "bat"
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

# --- Private networking ---
brew "tailscale" if OS.linux? # System service and sign-in handled by bootstrap.sh

# --- Monitoring ---
brew "bottom"

# --- Language / tool managers ---
brew "fnm"
brew "asdf"
brew "rustup"
brew "protobuf" # protoc, which Rust crates with protobuf definitions need to build
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
# Azure CLI is installed with uv by bootstrap.sh; Homebrew no longer provides it.
brew "cloudflare-wrangler"
tap "hashicorp/tap"
brew "hashicorp/tap/terraform"

# --- Python tooling ---
brew "uv"
brew "python@3.11"

# --- Dev tooling ---
brew "pre-commit"

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
  cask "tailscale-app"                  # Official Tailscale app and CLI
  cask "copilot-cli"                    # GitHub Copilot CLI
  cask "claude-code"                    # Claude Code
  cask "visual-studio-code@insiders"     # code-insiders CLI and GUI editor
  cask "kitty"                          # terminal
  # Rex Beta is installed manually; see README.md.
  cask "handy"
  cask "font-jetbrains-mono-nerd-font"
end

# --- Media ---
brew "ffmpeg"

if OS.mac?
  tap "bensincs/tap"
  cask "webshow"
end
