# Agent Guidelines for dotfiles Repository

This repository contains personal macOS dotfiles managed with GNU Stow. This guide provides essential information for AI coding agents working in this repository.

## Repository Overview

**Type:** Personal dotfiles configuration repository  
**Primary Language:** Shell Script (Bash/Zsh)  
**Deployment Tool:** GNU Stow (symlink farm manager)  
**Package Manager:** Homebrew  
**Target Platform:** macOS (Apple Silicon + Intel compatible)

### Repository Structure

```
dotfiles/
├── bootstrap.sh           # Main setup script
├── Brewfile              # Homebrew dependencies
├── git/                  # Git configuration (stow package)
├── zsh/                  # Zsh shell configuration (stow package)
├── tmux/                 # Tmux configuration (stow package)
├── starship/             # Starship prompt configuration (stow package)
└── opencode/             # OpenCode AI editor configuration (stow package)
```

**Stow Packages:** git, zsh, tmux, starship, opencode  
Each package directory contains dotfiles that will be symlinked to `$HOME` when stowed.

## Build/Test/Lint Commands

### Setup and Installation

```bash
# Complete system bootstrap (installs Homebrew, packages, and stows dotfiles)
./bootstrap.sh

# Install/update Homebrew packages from Brewfile
brew bundle install

# Verify all Brewfile packages are installed
brew bundle check

# Clean up packages not listed in Brewfile
brew bundle cleanup
```

### Dotfile Management

```bash
# Symlink specific package to $HOME
stow git
stow zsh
stow tmux
stow starship
stow opencode

# Remove symlinks for a package
stow -D git

# Restow (useful after modifying files)
stow -R zsh

# Dry run to see what would be symlinked
stow -n -v zsh
```

### Testing

**No automated tests.** This is a configuration repository.

Manual verification:
```bash
# Verify shell configuration loads without errors
zsh -c 'echo "Config loaded successfully"'

# Check for broken symlinks
find ~ -maxdepth 2 -type l ! -exec test -e {} \; -print

# Verify Homebrew packages
brew list
```

### Linting

**No automated linting configured.**

For shell script validation:
```bash
# Install shellcheck (if needed)
brew install shellcheck

# Lint bootstrap script
shellcheck bootstrap.sh
```

## Code Style Guidelines

### Shell Scripting Conventions

#### Error Handling
- **Always use strict mode:** `set -euo pipefail` at the top of Bash scripts
- Exit on undefined variables, pipe failures, and command errors
- Use `command -v` to check if commands exist before executing

```bash
#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew not found"
  exit 1
fi
```

#### Path and Directory Handling
- Detect script directory: `DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`
- Support both Apple Silicon (`/opt/homebrew`) and Intel (`/usr/local`) Homebrew paths
- Always quote variables in paths: `"$DOTFILES_DIR/Brewfile"`

#### Conditional Execution
- Check command existence: `if command -v stow >/dev/null 2>&1; then`
- Check file existence: `if [ -f "$FILE" ]; then`
- Check directory existence: `if [ -d "$DIR" ]; then`

#### Output and Messaging
- Use clear, prefixed messages: `echo "▶ Installing..."`, `echo "✅ Complete"`, `echo "⚠ Warning"`
- Redirect unnecessary output: `>/dev/null 2>&1`

### Configuration File Organization

#### Modular Structure
- **One tool per directory** (e.g., `git/`, `zsh/`, `tmux/`)
- Each directory is a Stow package containing dotfiles in their proper hierarchy
- Files should mirror their target location in `$HOME`

Example: `git/.gitconfig` → `~/.gitconfig`

#### Comments and Documentation
- Use clear section headers with visual separators:
```bash
# ================================================================
# Section Name
# ================================================================

# ---- Subsection ----
```

- Group related settings together
- Add inline comments for non-obvious configurations

#### Zsh Configuration Split
- **`.zshenv`**: Environment variables, PATH, non-interactive tools (sourced first, always)
- **`.zshrc`**: Interactive shell config, aliases, plugins, prompts (interactive only)

### Naming Conventions

#### Files and Directories
- Lowercase with hyphens for multi-word names (e.g., `git-lfs`)
- Dotfile names follow tool conventions (`.gitconfig`, `.zshrc`)
- Package directories use tool name (lowercase)

#### Variables (Shell)
- UPPERCASE for exported environment variables: `EDITOR`, `PATH`, `DOTFILES_DIR`
- lowercase for local script variables
- Descriptive names: `STOW_PACKAGES`, not `pkgs`

#### Arrays (Shell)
- Descriptive plural names: `STOW_PACKAGES=(git zsh tmux)`
- Use bash array syntax: `"${ARRAY[@]}"`

### Formatting

#### Indentation
- **2 spaces** for shell scripts and configuration files
- No tabs (except in Makefiles if added)
- Consistent indentation levels

#### Line Length
- Aim for 80-100 characters max for readability
- Break long commands with `\` line continuation

#### Whitespace
- Blank lines between logical sections
- No trailing whitespace
- Single newline at end of file

## Tool-Specific Guidelines

### Brewfile
- Group packages by category with comments
- Format: `brew "package-name"`, `cask "app-name"`, `tap "org/repo"`
- Alphabetize within categories for easy scanning
- Add comments for non-obvious packages

### Git Configuration
- Use semantic sections: `[user]`, `[core]`, `[credential]`
- Comment credential helpers to explain authentication method
- Set sensible defaults: `pull.rebase = true`, `init.defaultBranch = main`

### Zsh Configuration
- Check command existence before `eval` or `source`
- Use `command -v` instead of `which`
- Initialize plugins at the end to avoid conflicts
- Export minimal variables in `.zshenv`, keep `.zshrc` for interactive tools

## Important Constraints

### What NOT to Do
- **Never commit secrets:** No API keys, tokens, or passwords in dotfiles
- **Never hardcode absolute paths** (except in comments for clarity)
- **Never assume Homebrew location** - support both Intel and Apple Silicon paths
- **Never skip error checking** in bootstrap scripts
- **Do not create documentation files** unless explicitly requested

### Git Best Practices
- Commit related changes together (e.g., all Brewfile updates in one commit)
- Write descriptive commit messages: "Add ripgrep and fd for faster searches"
- Use `.gitignore_global` for patterns that should never be committed (`.DS_Store`, `.envrc`)

## Development Workflow

### Adding New Tool Configuration
1. Create new directory: `mkdir newtool/`
2. Add dotfiles with proper hierarchy: `newtool/.config/newtool/config.toml`
3. Add tool to Brewfile if needed: `brew "newtool"`
4. Add to `STOW_PACKAGES` array in `bootstrap.sh`
5. Test stow: `stow -n -v newtool` (dry run), then `stow newtool`

### Modifying Existing Configuration
1. Edit file in dotfiles directory: `vim zsh/.zshrc`
2. Restow if needed: `stow -R zsh`
3. Test in new shell: `zsh` or `source ~/.zshrc`
4. Commit changes with descriptive message

### Debugging Issues
- Check stow conflicts: `stow -v package` shows what it's doing
- Verify symlinks: `ls -la ~ | grep dotfiles`
- Test shell config: `zsh -x` (debug mode shows execution)
- Check Homebrew: `brew doctor`

## Key Aliases (from .zshrc)

```bash
ll    # ls -lah
gs    # git status
gp    # git pull
k     # kubectl
code  # code-insiders
c     # clear
```

## Environment Details

- **Primary Editor:** VS Code Insiders (`code-insiders`)
- **Shell:** Zsh with Starship prompt
- **Terminal Multiplexer:** Tmux (auto-attaches to "main" session)
- **Version Managers:** fnm (Node), asdf (multi-runtime), rustup (Rust), SDKMAN (JVM)
- **Cloud Platform:** Azure (azure-cli configured)

## Development Tooling Preferences

### Python Projects - Use `uv`

**Ben uses `uv` instead of pip/venv/poetry for Python development.**

Key facts about uv:
- Ultra-fast Python package installer (10-100x faster than pip)
- Manages virtual environments automatically in `.venv/`
- Uses `pyproject.toml` for dependencies (NOT requirements.txt)
- Installed via Homebrew: `brew install uv`

Common uv commands:
```bash
# Initialize new Python project
uv init

# Install dependencies from pyproject.toml
uv sync

# Run Python script with uv-managed environment
uv run script.py

# Add a package
uv add package-name

# Update lock file
uv lock
```

Project structure with uv:
```
project/
├── pyproject.toml          # Dependencies & metadata
├── uv.lock                 # Locked dependency versions
├── .venv/                  # Auto-managed virtual environment
└── package_name/           # Source code (underscores not hyphens)
    ├── __init__.py
    └── main.py
```

**Important:**
- Always use `uv run` to execute scripts (no need to activate venv)
- Dependencies go in `pyproject.toml` under `[project.dependencies]`
- Use `uv sync` not `pip install -r requirements.txt`
- Package directory names use underscores (e.g., `my_package/`)

### Node.js/TypeScript Projects - Use `yarn` workspaces

**Ben uses `yarn` (NOT npm) for JavaScript/TypeScript development.**

Key facts about yarn:
- Preferred package manager for Node.js projects
- Supports monorepo workspaces natively
- Faster and more reliable than npm
- Node.js managed via `fnm` (Fast Node Manager)

Common yarn workspace patterns:
```bash
# Install dependencies in monorepo
yarn install

# Run script from root
yarn dev
yarn build

# Add dependency to specific workspace
yarn workspace @scope/package add dependency
```

Monorepo structure with yarn workspaces:
```
project/
├── package.json           # Root with workspaces config
├── packages/
│   ├── backend/
│   │   └── package.json
│   ├── frontend/
│   │   └── package.json
│   └── shared/
│       └── package.json
└── yarn.lock             # Locked dependencies
```

Root `package.json` workspace config:
```json
{
  "name": "project-root",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev": "yarn workspace backend dev",
    "build": "yarn workspaces run build"
  }
}
```

**Important:**
- Use `yarn` not `npm` for all package management
- Use yarn workspaces for multi-package projects
- Use `fnm` to manage Node.js versions
- Dependencies at root level when shared across packages

### Azure Development - Use `az` CLI

**Ben uses Azure CLI for cloud resource management.**

Key facts about Azure CLI:
- Installed via Homebrew: `brew install azure-cli`
- Authentication persists after `az login`
- Preferred over Azure Portal for automation
- Used for Teams apps, AI Foundry, resource management

Common Azure CLI patterns:
```bash
# Authenticate
az login

# Set default subscription
az account set --subscription "Subscription Name"

# List resources
az resource list --resource-type "Type" -o table

# Create resources programmatically
az group create --name rg-name --location eastus
az <service> create --name resource-name --resource-group rg-name
```

**Authentication best practices:**
- Use `DefaultAzureCredential` in code (falls back to `az login`)
- Check login status: `az account show`
- Multi-tenancy: Use `az login --tenant <tenant-id>` if needed

**Important:**
- CLI-first approach (avoid portal clicks when possible)
- Use Azure CLI extensions for specialized services (e.g., `az ml`, `az containerapp`)
- Resource naming: lowercase with hyphens (e.g., `rg-project-dev`)

## Tool Version Expectations

**Always assume latest stable versions.** Tools are kept up-to-date via Homebrew.

Do NOT hardcode version numbers or check specific versions unless explicitly required.

```bash
# Tools are updated regularly via
brew upgrade

# fnm manages Node.js versions dynamically
fnm use --latest
```

Key installed tools (always latest stable):
- `uv` - Python package manager
- `azure-cli` - Azure command-line interface  
- `fnm` - Fast Node Manager (Node.js version manager)
- `git`, `gh` - Git and GitHub CLI
- `ripgrep`, `fd`, `jq`, `yq` - Modern CLI tools
- `tmux`, `starship`, `direnv` - Shell productivity

## Project Initialization Quick Reference

### New Python Project
```bash
mkdir project && cd project
uv init
# Edit pyproject.toml to add dependencies
uv sync
uv run main.py
```

### New Node.js Monorepo
```bash
mkdir project && cd project
yarn init -y
mkdir -p packages/{backend,frontend,shared}
# Create package.json in each package
# Add "workspaces": ["packages/*"] to root package.json
yarn install
```

### New Azure Resource
```bash
az login
az account set --subscription "Subscription Name"
az group create --name rg-project-dev --location eastus
# Create resources via CLI or IaC
```
