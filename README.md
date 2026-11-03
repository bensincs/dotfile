# dotfiles

Source of truth for my macOS and Linux development environment. Homebrew installs
packages; GNU Stow links their configuration into `$HOME`.

This records package choices and configuration, not a byte-for-byte machine image.
Homebrew installs current releases. Neovim plugins are pinned in `lazy-lock.json`.
Accounts, credentials, personal notes, and project-specific runtimes are separate.

## Platforms and prerequisites

- **macOS, Apple Silicon:** Homebrew at `/opt/homebrew`.
- **macOS, Intel:** Homebrew at `/usr/local`.
- **Linux:** Homebrew normally at `/home/linuxbrew/.linuxbrew`. The CLI setup is
  shared; macOS applications are excluded. Debian/Ubuntu prerequisites are below.
- **Windows:** not supported. WSL is not separately validated.

These are the intended targets, not a claim that every change has been tested on
fresh installations of each OS.

Before cloning:

```bash
# macOS: install Command Line Tools, then wait for installation to finish.
xcode-select --install
```

```bash
# Debian/Ubuntu: Homebrew and Git prerequisites.
sudo apt-get update
sudo apt-get install -y build-essential procps curl file git
```

Other Linux distributions need equivalent build tools. Use a normal user account,
not root, with sudo access and internet access. Homebrew installation runs
non-interactively; resolve any sudo or developer-tool prerequisites it reports.
The shell configuration expects the `en_US.UTF-8` locale to be available.

## Install

```bash
git clone https://github.com/bensincs/dotfile.git "$HOME/dotfiles"
cd "$HOME/dotfiles"
./bootstrap.sh
```

The repository may live elsewhere: bootstrap explicitly targets `$HOME`.
It performs these steps:

1. Find or install Homebrew and load its environment.
2. Trust the Brewfile's third-party taps and install/update its dependencies.
3. Create real directories for Herdr, Pi, and Copilot runtime state.
4. Check **all** Stow packages for conflicts, then link them to `$HOME`.
5. On Linux, install Azure CLI with `uv tool` if `az` is missing.
6. Restore the Neovim plugin versions from `lazy-lock.json`.

Rerunning bootstrap reapplies configuration and may upgrade packages. It does not
back up or overwrite conflicting dotfiles, change your login shell, sign into
services, or install every language runtime. Neovim installs language servers and
Treesitter parsers on demand; those downloads are not all completed by bootstrap.

### Existing dotfiles and recovery

Stow refuses to replace ordinary files, directories with conflicting contents, or
links owned by another checkout. Bootstrap prints the conflicting paths and exits
before linking any packages. Homebrew installation and state-directory creation
may already have happened.

Review and move **only the reported conflicts** outside this repository. For
example, if an existing `.zshrc` conflicts:

```bash
backup="$HOME/dotfiles-backup/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
mv "$HOME/.zshrc" "$backup/.zshrc"
./bootstrap.sh
```

Keep the backup until you have migrated any settings you need. Do not use
`stow --adopt`: it can replace the repository's files with machine-local content,
including secrets. For links owned by an older checkout, unstow from that checkout
first rather than deleting the checkout while its links are still active.

To undo the Zsh links and restore that backup:

```bash
cd "$HOME/dotfiles"
stow --target="$HOME" --delete zsh
mv "$backup/.zshrc" "$HOME/.zshrc"
```

Unstowing removes links, not Homebrew packages or application state. Moving the
checkout also breaks its links: unstow before moving it, then restow afterward.

## Finish setting up the machine

### Shell and local settings

Load Homebrew in the calling shell first (bootstrap runs in a child process),
then start Zsh. This also makes a newly installed Linux Zsh discoverable:

```bash
if ! command -v brew >/dev/null 2>&1; then
  for brew_bin in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
    if [ -x "$brew_bin" ]; then eval "$("$brew_bin" shellenv)"; break; fi
  done
else
  eval "$(brew shellenv)"
fi
exec zsh -l
```

Linux installs Zsh through Homebrew; macOS uses the included Zsh. Bootstrap does
not change the account's default shell. To make the currently selected Zsh the
login shell, register its path if necessary, then use `chsh`:

```bash
zsh_path="$(command -v zsh)"
/usr/bin/grep -qxF "$zsh_path" /etc/shells || printf '%s\n' "$zsh_path" | sudo tee -a /etc/shells
chsh -s "$zsh_path"
```

Log out and back in for the account change to take effect. On managed machines,
follow the administrator's shell policy instead.

Machine-specific settings and secrets belong in these files, **not this repo**:

- `~/.zshenv.local`: environment needed by interactive and non-interactive Zsh.
- `~/.zshrc.local`: interactive-only overrides.

Both are sourced last in their respective startup files and are gitignored.
Create private files before adding values:

```bash
(umask 077; touch "$HOME/.zshenv.local" "$HOME/.zshrc.local")
chmod 600 "$HOME/.zshenv.local" "$HOME/.zshrc.local"
nvim "$HOME/.zshenv.local"
```

The shared PATH preserves inherited entries and adds Homebrew, `~/.local/bin`,
Cargo tools, asdf shims, and Homebrew rustup proxies. Shell history is stored in
`~/.zsh_history`. Git uses Neovim as its editor on both platforms. VS Code Insiders
is installed on macOS, where `code` aliases `code-insiders` when available. On
Linux it is optional: install it using Microsoft's instructions if wanted.

### Runtimes

Homebrew Node runs global CLI tools. Use fnm for project Node versions:

```bash
fnm install --lts --use
fnm default "$(fnm current)"
```

Project `.node-version` / `.nvmrc` files take precedence when switching directories.
Install a Rust toolchain when needed:

```bash
rustup default stable
```

For Python projects use `uv sync` and `uv run`; uv manages their environments.
For asdf projects, install the project's required plugins, then run `asdf install`
from the directory containing `.tool-versions`. No global asdf runtimes or plugins
are selected by this repository.

The SDKMAN loader is optional. Bootstrap does not install SDKMAN or any JVM SDKs;
if needed, install it following <https://sdkman.io/install> and record project
requirements separately.

### Accounts and authentication

These are manual, per-machine steps. Do not copy their tokens into the repo.

- **GitHub:** run `gh auth login`, then `gh auth status`. Shared Git credentials
  use `gh` from PATH. Avoid replacing them with machine-specific absolute paths;
  commands such as `gh auth setup-git` may rewrite the symlinked `.gitconfig`.
- **Azure:** run `az login`, then `az account set --subscription "Subscription Name"`
  if the default subscription is not the intended one.
- **Cloudflare:** run `wrangler login` when using Wrangler.
- **Pi:** start `pi`, then use `/login` for the configured GitHub Copilot provider.
  Model defaults and Cmd+digit bindings live in `pi/.pi/agent/`; available models
  depend on the account. Use `/model` if a configured model is unavailable.
- **Work IQ:** complete Microsoft's first-run EULA/consent and sign-in flow; see
  <https://github.com/microsoft/work-iq>. Its MCP entry is in Pi's `mcp.json`.
- **WhatsApp:** Pi installs the configured `pi-whatsapp` package. Follow its setup
  and device-pairing instructions at <https://github.com/bensincs/pi-whatsapp>.
  Pairing state and private settings are not stored here.

Copilot CLI and Claude Code are installed as macOS casks. On Linux they are
optional, separate installs; Pi is installed on both platforms.

Restore SSH keys, signing keys, Kubernetes credentials, notes, and other personal
files from their separate secure backups as needed. This repo does not provision
a Docker daemon, cloud resources, VS Code extensions, or per-project `.envrc` files.

## Configuration layout

Each tool directory is a Stow package. Its contents mirror their location in
`$HOME`; for example, `git/.gitconfig` becomes `~/.gitconfig`.

| Path | Purpose |
| --- | --- |
| `bootstrap.sh` | Installation order and active Stow packages |
| `Brewfile` | Homebrew, macOS cask, and global npm dependencies |
| `bottom/` | Compact graph layout (`btm -C ~/.config/bottom/graphs.toml`) |
| `copilot/` | Copilot CLI preferences |
| `diffnav/` | Diff viewer layout and theme |
| `git/` | Identity, GitHub credentials, Delta, global ignores |
| `herdr/` | Multiplexer, keybindings, notifications, session restore |
| `kitty/` | macOS terminal, font, palette, Cmd+digit escape sequences |
| `nvim/` | Editor, pinned plugins, LSP, Treesitter, notes pad |
| `pi/` | Agent instructions, MCP servers, package, model shortcuts, skills |
| `starship/` | Prompt configuration |
| `tmux/` | Multiplexer configuration, Ctrl+A prefix |
| `zsh/` | Shell startup files and helper scripts |
| `tests/` | Isolated setup regression checks |

Bootstrap stows every listed package except Kitty on Linux. Pi's Cloudflare skills
are vendored reference material with their own `LICENSE`; do not edit them as part
of routine machine setup. Application-written settings are symlinked too: inspect
`git diff` after using tools that update their own configuration.

## Daily commands

- `ll`, `lt`, `la`: eza listings; `cat`: bat; `grep`: ripgrep.
- `z` / `cd`: zoxide navigation. `gs`, `gp`: Git status and pull. `k`: kubectl.
- `tm`: attach/switch to `$TMUX_SESSION`, defaulting to `main`; `tmd`: detach.
  Set `export TMUX_SESSION=myapp` in a project's `.envrc` and run `direnv allow`
  for a project-specific session. Nothing auto-attaches at shell startup.
- `diffwatch`: watch changes from the commit at launch, including later commits,
  without changing your staging area.
- `n`: open `~/notes/dump.md`; `n some text` or `command | n`: append. Override
  with `NOTES_FILE`. Ctrl+Q closes the pad; Ctrl+E toggles its file tree.
  Herdr: Ctrl+A, then N opens the pad. Ctrl+A, then Ctrl+N also captures the
  clipboard first; clipboard capture uses macOS `pbpaste` and is macOS-only.
- Kitty Cmd+digit selects configured Pi model shortcuts; edit
  `pi/.pi/agent/model-shortcuts.json`, then `/reload` in Pi.

## Verify and maintain

From the repository root:

```bash
# Syntax, configuration, isolated shells, and sandboxed Stow/bootstrap tests.
# Requires Python 3.11+ (included in Brewfile), Zsh, and GNU Stow.
# Does not install packages or change your real home directory.
python3.11 -m unittest discover -s tests -v

# Confirm dependency installation and interactive shell setup on this machine.
brew bundle check --file=Brewfile
zsh -ic 'command -v gh nvim pi az; print -r -- "History: $HISTFILE"'

# Review machine-written changes before committing.
git status --short
git diff
```

The isolated tests do not replace fresh-OS provisioning or account sign-in checks.
To update packages and reapply configuration, run `./bootstrap.sh` again. To preview
or remove one package, explicitly target the home directory:

```bash
stow --target="$HOME" --simulate --verbose zsh
stow --target="$HOME" --restow zsh
stow --target="$HOME" --delete zsh
```

Before removing packages, inspect `brew bundle cleanup --file=Brewfile` without
`--force`. Unlisted packages may still be needed by other work.

When adding a tool, update `Brewfile`, add a package mirroring its home-directory
layout if needed, add it to `STOW_PACKAGES` in `bootstrap.sh`, document its setup
and platform limits here, and run the checks above.
