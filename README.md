# dotfiles

Personal macOS dotfiles managed with [GNU Stow](https://www.gnu.org/software/stow/).

## Quick Start

```bash
git clone <your-repo-url> ~/dotfiles
cd ~/dotfiles
./bootstrap.sh
```

The bootstrap script will:
1. Install Homebrew (if not already installed)
2. Install all packages from the Brewfile
3. Symlink dotfiles to your home directory using Stow

## What's Included

### Core Tools

- **Shell:** Zsh with [Starship](https://starship.rs/) prompt
- **Terminal:** [Kitty](https://sw.kovidgoyal.net/kitty/) with JetBrains Mono Nerd Font
- **Multiplexer:** Tmux
- **Editor:** VS Code Insiders + [OpenCode](https://opencode.ai/) AI assistant
- **Version Control:** Git with Git LFS and GitHub CLI

### Development Tools

**Language/Runtime Managers:**
- fnm (Node.js)
- asdf (multi-runtime)
- rustup (Rust)
- uv (Python)

**CLI Productivity:**
- ripgrep, fd (fast search)
- eza (modern ls)
- bat (cat with syntax highlighting)
- bottom (system monitor)
- zoxide (smart cd)
- direnv (environment variables)
- jq, yq (JSON/YAML processing)

**Cloud:**
- Azure CLI

## Repository Structure

```
dotfiles/
├── bootstrap.sh           # Main setup script
├── Brewfile              # Homebrew dependencies
├── git/                  # Git configuration
│   ├── .gitconfig
│   └── .gitignore_global
├── zsh/                  # Zsh shell configuration
│   ├── .zshenv
│   └── .zshrc
├── tmux/                 # Tmux configuration
│   └── .tmux.conf
├── starship/             # Starship prompt
│   └── .config/starship.toml
├── kitty/                # Kitty terminal
│   └── .config/kitty/kitty.conf
└── opencode/             # OpenCode AI editor
    └── .config/opencode/opencode.json
```

Each directory is a **Stow package** containing dotfiles that will be symlinked to `$HOME`.

## Usage

### Managing Dotfiles

```bash
# Symlink a specific package
stow git

# Remove symlinks for a package
stow -D zsh

# Restow after modifying files
stow -R tmux

# Preview what would be symlinked (dry run)
stow -n -v starship
```

### Managing Homebrew Packages

```bash
# Install/update packages from Brewfile
brew bundle install

# Check if all packages are installed
brew bundle check

# Remove packages not in Brewfile
brew bundle cleanup
```

### Adding New Tools

1. Add the package to `Brewfile` if needed:
   ```bash
   brew "tool-name"
   ```

2. Create a new Stow package directory:
   ```bash
   mkdir newtool/
   ```

3. Add configuration files with proper hierarchy:
   ```bash
   # For ~/.config/tool/config.yml
   mkdir -p newtool/.config/tool
   vim newtool/.config/tool/config.yml
   ```

4. Add to `STOW_PACKAGES` array in `bootstrap.sh`

5. Stow the package:
   ```bash
   stow newtool
   ```

## Platform Support

- **macOS:** Apple Silicon and Intel (automatic Homebrew path detection)
- **Other platforms:** Not tested, may require modifications

## Notes

- Dotfiles are symlinked, not copied, so changes are reflected immediately
- The bootstrap script is idempotent and safe to run multiple times
- Supports both `/opt/homebrew` (Apple Silicon) and `/usr/local` (Intel) Homebrew installations

## License

Personal configuration files. Use at your own risk.
