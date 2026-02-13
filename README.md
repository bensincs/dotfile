# 🏠 dotfiles

> Personal macOS development environment, finely tuned and battle-tested.

This repository contains my complete macOS setup, managed with [GNU Stow](https://www.gnu.org/software/stow/) for symlink-based configuration and [Homebrew](https://brew.sh/) for dependency management. Every tool and alias is chosen for speed, ergonomics, and developer happiness.

## ⚡ Quick Start

```bash
# Clone this repository
git clone https://github.com/bensincs/dotfile.git ~/dotfiles
cd ~/dotfiles

# Run the bootstrap script
./bootstrap.sh
```

The bootstrap script will:
1. ✅ Install Homebrew (if not already installed)
2. 📦 Install all packages from the Brewfile
3. 🔗 Symlink dotfiles to your home directory using Stow
4. 🎨 Configure your shell with modern CLI tools

**Compatibility:** Apple Silicon and Intel Macs (automatic Homebrew path detection)

## 🛠️ What's Included

### Core Environment

| Category | Tools | Why |
|----------|-------|-----|
| **Shell** | Zsh + [Starship](https://starship.rs/) | Fast, beautiful prompt with git integration |
| **Terminal** | [Kitty](https://sw.kovidgoyal.net/kitty/) | GPU-accelerated, highly configurable |
| **Font** | JetBrains Mono Nerd Font | Perfect for coding with icon support |
| **Multiplexer** | Tmux | Per-project sessions managed via direnv |
| **Editor** | VS Code Insiders + [OpenCode](https://opencode.ai/) | AI-powered coding assistant |
| **Version Control** | Git + GitHub CLI + Delta | Beautiful diffs and seamless GitHub integration |

### Development Stack

**Language & Runtime Managers**
- **[fnm](https://github.com/Schniz/fnm)** - Fast Node.js version manager (auto-switches on `cd`)
- **[uv](https://github.com/astral-sh/uv)** - Ultra-fast Python package installer (10-100x faster than pip)
- **[asdf](https://asdf-vm.com/)** - Multi-runtime manager (Ruby, Java, etc.)
- **[rustup](https://rustup.rs/)** - Rust toolchain installer

**Modern CLI Replacements**
- **[eza](https://github.com/eza-community/eza)** → `ls` - Modern ls with icons and git status
- **[bat](https://github.com/sharkdp/bat)** → `cat` - Syntax highlighting and git integration
- **[ripgrep](https://github.com/BurntSushi/ripgrep)** → `grep` - Blazing fast search (respects .gitignore)
- **[fd](https://github.com/sharkdp/fd)** → `find` - User-friendly alternative to find
- **[zoxide](https://github.com/ajeetdsouza/zoxide)** → `cd` - Smart directory jumper with frecency
- **[bottom](https://github.com/ClementTsang/bottom)** → `top` - Graphical system monitor

**Productivity Tools**
- **[direnv](https://direnv.net/)** - Load/unload environment variables per directory
- **[delta](https://github.com/dandavison/delta)** - Beautiful git diffs with syntax highlighting
- **[jq](https://jqlang.github.io/jq/)** / **[yq](https://github.com/mikefarah/yq)** - JSON/YAML processing
- **[tmux](https://github.com/tmux/tmux)** - Terminal multiplexer with session management

**Cloud & Infrastructure**
- **[Azure CLI](https://learn.microsoft.com/en-us/cli/azure/)** - Azure resource management
- **[kubectl](https://kubernetes.io/docs/reference/kubectl/)** - Kubernetes cluster control

## 📂 Repository Structure

```
dotfiles/
├── bootstrap.sh           # 🚀 Main setup script (idempotent, safe to re-run)
├── Brewfile              # 📦 Homebrew dependencies (kept up-to-date)
├── git/                  # 🔧 Git configuration
│   ├── .gitconfig            # User settings, aliases, delta integration
│   └── .gitignore_global     # Global ignore patterns
├── zsh/                  # 🐚 Zsh shell configuration
│   ├── .zshenv              # Environment variables (sourced always)
│   └── .zshrc               # Interactive shell config (aliases, plugins)
├── tmux/                 # 🖥️  Tmux configuration
│   └── .tmux.conf           # Keybindings and appearance
├── starship/             # ✨ Starship prompt theme
│   └── .config/starship.toml
├── kitty/                # 🐱 Kitty terminal emulator
│   └── .config/kitty/kitty.conf
└── opencode/             # 🤖 OpenCode AI editor
    └── .config/opencode/opencode.json
```

Each directory is a **Stow package** that symlinks its contents to `$HOME` when activated.

## 📖 Usage Guide

### Daily Workflow

**Tmux Session Management** (powered by direnv)
```bash
# Create .envrc in any project directory
cd ~/projects/myapp
echo 'export TMUX_SESSION=myapp' > .envrc
direnv allow

# Attach to project session (or create if doesn't exist)
tm        # Uses TMUX_SESSION from .envrc, or defaults to 'main'

# Detach from current session
tmd       # Alias for 'tmux detach'
```

**Smart Directory Navigation**
```bash
z myapp      # Jump to frequently used directories (zoxide)
ll           # Modern ls with icons and git status (eza)
cat file.py  # Syntax-highlighted output (bat)
```

**Version Management**
```bash
# Node.js (auto-switches based on .nvmrc or .node-version)
fnm use --latest

# Python (use uv instead of pip/venv)
uv init              # Initialize new project
uv sync              # Install dependencies from pyproject.toml
uv run script.py     # Run with auto-managed venv
```

### Managing Dotfiles

```bash
# Symlink a specific package
stow git

# Remove symlinks for a package
stow -D zsh

# Restow after modifying files (useful for updates)
stow -R tmux

# Preview what would be symlinked (dry run)
stow -n -v starship
```

### Managing Homebrew Packages

```bash
# Install/update packages from Brewfile
brew bundle install

# Verify all packages are installed
brew bundle check

# Clean up packages not in Brewfile
brew bundle cleanup

# Update all packages
brew upgrade
```

## 🔧 Key Aliases & Functions

| Alias | Command | Description |
|-------|---------|-------------|
| `ll` | `eza -lah --icons --git` | Detailed list with git status |
| `cat` | `bat --style=auto` | Syntax-highlighted cat |
| `grep` | `rg` | Fast ripgrep search |
| `cd` | `z` | Smart zoxide navigation |
| `gs` | `git status` | Quick git status |
| `gp` | `git pull` | Quick git pull |
| `k` | `kubectl` | Kubernetes shorthand |
| `code` | `code-insiders` | VS Code Insiders |
| `c` | `clear` | Clear terminal |
| `tm` | *function* | Attach/switch tmux session |
| `tmd` | `tmux detach` | Detach from tmux |
| `go` | *function* | Run OpenCode terminal executor |

### Adding New Tools

1. **Add to Brewfile** (if installing via Homebrew)
   ```bash
   brew "tool-name"    # CLI tool
   cask "app-name"     # GUI application
   ```

2. **Create Stow package** (if tool has config files)
   ```bash
   mkdir newtool/
   # Mirror the structure as it appears in $HOME
   # Example: ~/.config/tool/config.yml becomes:
   mkdir -p newtool/.config/tool
   vim newtool/.config/tool/config.yml
   ```

3. **Add to bootstrap script**
   - Add package name to `STOW_PACKAGES` array in `bootstrap.sh`

4. **Activate**
   ```bash
   stow newtool
   ```

## 💡 Design Principles

**Modern over traditional** - Use faster, more ergonomic tools (ripgrep > grep, eza > ls, bat > cat)

**Declarative configuration** - Everything is version controlled and reproducible

**Symlink-based** - Changes to dotfiles are reflected immediately, no manual copying

**Project-aware** - Tools like direnv and fnm automatically adapt to your current project

**AI-powered** - OpenCode and GitHub Copilot integrated into the workflow

## 🎯 Philosophy

This setup prioritizes:
- **Speed**: Fast tools (ripgrep, fd, uv) and minimal shell startup time
- **Ergonomics**: Smart aliases, auto-completion, and sensible defaults
- **Reproducibility**: Everything codified, nothing manual
- **Modularity**: Each tool is a separate Stow package
- **Safety**: Bootstrap script is idempotent and non-destructive

## 🖥️ Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS (Apple Silicon)** | ✅ Fully supported | Homebrew at `/opt/homebrew` |
| **macOS (Intel)** | ✅ Fully supported | Homebrew at `/usr/local` |
| **Linux** | ⚠️ Untested | May work with modifications |
| **Windows** | ❌ Not supported | WSL2 might work but untested |

## 📝 Notes

- **Idempotent**: Bootstrap script is safe to run multiple times
- **Instant updates**: Dotfiles are symlinked, not copied (changes take effect immediately)
- **No secrets**: This repo contains no API keys, tokens, or passwords
- **Personal config**: These are my preferences - fork and customize to your liking!

## 📄 License

MIT - Personal configuration files. Use at your own risk and modify to your heart's content.
