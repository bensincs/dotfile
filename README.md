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
3. Create real directories for Pi and Copilot runtime state.
4. Check **all** Stow packages for conflicts, then link them to `$HOME`.
5. Install Azure CLI with `uv tool` if `az` is missing (macOS and Linux).
6. Install the Rex CLI with its official installer if `rex` is missing (Linux only).
7. Restore the Neovim plugin versions from `lazy-lock.json`.
8. Set up Tailscale: open the macOS app or start the Linux system service and
   connect, prompting for sign-in when needed.

Rerunning bootstrap reapplies configuration and may upgrade packages. It does not
back up or overwrite conflicting dotfiles, change your login shell, or install
every language runtime. Tailscale setup may prompt for sudo, macOS permissions,
and browser sign-in; other service sign-ins remain manual. Neovim installs language
servers and Treesitter parsers on demand; those downloads are not all completed
by bootstrap.

### Rex

On Linux, bootstrap installs the Rex CLI when `rex` is missing using:

```bash
curl -fsSL https://pkgs.superlogical.com/rex/install.sh | sh
```

On both platforms, bootstrap then runs `rex terminfo setup`. It installs Rex's
`xterm-rex` terminal type in `~/.terminfo`, writes an ssh guard to
`~/.config/rex/ssh_config` (generated per machine and gitignored), and adds one `Include`
line to the top of `~/.ssh/config` so ssh sends `xterm-256color` to hosts
without `xterm-rex`. Check with `rex terminfo status`.

The macOS client configuration in `rex/` is not stowed on Linux.

#### Terminal client (macOS)

Install Rex Beta manually; it is not installed by the Brewfile. Bootstrap stows
`rex/` alongside Kitty on macOS and leaves Kitty unchanged. To link just Rex:

```bash
stow --target="$HOME" --simulate --verbose rex
stow --target="$HOME" rex
rex config reload
```

In Rex's command palette, run **Apply Kitty Style**. This imports the
repo-managed Solarized Dark palette and sets JetBrainsMono Nerd Font Mono at
13 pt, 8 pt padding, a left sidebar, a steady bar cursor, and copy-on-selection.
Install the font from the Brewfile if it is missing. Text color remapping,
contrast adjustment, and Display P3 are disabled to preserve application colors.

Appearance settings are stored by Rex, not loaded automatically from `init.lua`.
Run **Apply Kitty Style** again after changing the theme or style action.
Alternatively, with Rex's Remote Control explicitly enabled, run
`rex do kitty_style` (use `-C CLIENT` before `do` if several apps are connected).
No account state or application preferences are committed.

Rex uses Ctrl+A as a leader: then V splits right, H splits below, T opens a
new tab, X closes the focused pane, P opens the command palette, N opens the
notes pad as a popup (Ctrl+N appends the clipboard first), W opens the
worktree manager (`wt ui`), and arrow keys
focus the pane in that direction. Ctrl+A twice sends a literal Ctrl+A to the
terminal. Cmd pane/tab management shortcuts are disabled.

Shell editing, clipboard, and font-size shortcuts still match Kitty. Cmd+0–9
send the same explicit CSI-u sequences for Pi model shortcuts, replacing Rex's
default tab-selection and font-reset bindings. Rex does not document equivalents
for Kitty's exact 95% opacity, blur radius, per-tab colors, or window geometry;
those remain under Rex's own UI behavior. The macOS client style is not applied
to Linux servers.

### Shared agent skills

The `agents/` Stow package links the entire `.agents/` directory on macOS and
Linux. Skills live at `~/.agents/skills/`, shared by Pi and other agents that
support this location. This includes the former Pi-only skills and Rex's official
skill. The Rex skill reads its guide from the installed Rex CLI; no separate
skill installation is needed, but the CLI must be installed before using it.

Back up an existing `~/.agents/` directory before linking, following the recovery
instructions below. When migrating from the old Pi-only layout, remove only the
old Stow-owned `~/.pi/agent/skills` symlink, never a real skills directory.

```bash
stow --target="$HOME" --simulate --verbose agents
stow --target="$HOME" agents
```

Run `/reload` in Pi to discover the shared skills. Changes under `~/.agents/`
now land in this repo; review them before committing.

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
Per-project `.me/` and `.local/` directories are also globally ignored. Already
tracked files remain tracked; these rules only hide untracked content.
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

### Tailscale: private access between devices

Run `./bootstrap.sh` on each device; no separate Tailscale setup commands are
needed. The Brewfile selects the platform's package, and bootstrap handles startup
and prompts for connection/sign-in when the device is not already connected.

- **macOS (currently requires macOS 13+):** installs the official app and opens it
  if disconnected. Approve the VPN/network extension permissions and sign in.
  Enable launch at login in the app. Do not also install the Homebrew
  `tailscale` formula. If the App Store version is already installed, follow
  [Tailscale's migration guidance](https://tailscale.com/kb/1065/macos-variants)
  before running bootstrap instead of installing a second copy.
- **Linux (systemd required):** installs the CLI/daemon and uses sudo to start
  Homebrew's persistent system service. Bootstrap waits for the daemon, then runs
  `tailscale up` if disconnected. Open the printed login URL to finish sign-in;
  bootstrap waits for the connection. Do not also run a separate distro-managed
  `tailscaled` service.

Reruns leave an existing connection and its Tailscale preferences unchanged.
Device identity, keys, and service state stay local, outside Git; no Stow package
or committed authentication key is needed.

Repeat sign-in on every Mac and Linux device you want to reach. Approve devices
in the [admin console](https://login.tailscale.com/admin/machines) if your tailnet
requires it. Enable MagicDNS in the console's DNS settings to use device names.

Once connected, on either platform:

```bash
tailscale status
tailscale ip -4
# Replace home-linux with the destination's name from tailscale status.
tailscale ping home-linux
ssh your-linux-user@home-linux
```

Tailscale provides a private network, not an SSH server. For incoming SSH, enable
**System Settings → General → Sharing → Remote Login** on macOS, or install and
enable your distribution's OpenSSH server on Linux. Normal SSH users, keys, and
host-key checks still apply; Tailscale SSH is not enabled by these steps.
Other services (web apps, Screen Sharing, etc.) must also be enabled and listening
on an address reachable over Tailscale, not just `127.0.0.1`.

Both devices must be online, awake, and connected to Tailscale. Tailnet access
rules and host firewalls must allow the connection. Devices on the same tailnet
are not necessarily all authorized to access each other. No router port
forwarding, exit node, or subnet router is needed for direct access between
enrolled devices.

### Accounts and authentication

These are manual, per-machine steps. Do not copy their tokens into the repo.

- **GitHub:** run `gh auth login`, then `gh auth status`. Shared Git credentials
  use `gh` from PATH. Avoid replacing them with machine-specific absolute paths;
  commands such as `gh auth setup-git` may rewrite the symlinked `.gitconfig`.
- **Azure:** bootstrap installs Azure CLI through `uv tool` on macOS and Linux
  when `az` is missing; existing installations are reused. Run `az login`, then
  `az account set --subscription "Subscription Name"` if needed.
- **Cloudflare:** run `wrangler login` when using Wrangler.
- **Pi:** start `pi`, then use `/login` for the configured GitHub Copilot provider.
  Model defaults and Cmd+digit bindings live in `pi/.pi/agent/`; available models
  depend on the account. Use `/model` if a configured model is unavailable.
- **Work IQ:** complete Microsoft's first-run EULA/consent and sign-in flow; see
  <https://github.com/microsoft/work-iq>. Its MCP entry is in Pi's `mcp.json`.

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
| `agents/` | Shared agent skills, including Rex and vendored Cloudflare references |
| `bottom/` | Compact graph layout (`btm -C ~/.config/bottom/graphs.toml`) |
| `copilot/` | Copilot CLI preferences |
| `diffnav/` | Diff viewer layout and theme |
| `git/` | Identity, GitHub credentials, Delta, global ignores |
| `kitty/` | macOS terminal, font, palette, Cmd+digit escape sequences |
| `nvim/` | Editor, pinned plugins, LSP, Treesitter, notes pad |
| `pi/` | Pi instructions, MCP servers, package, and model shortcuts |
| `rex/` | macOS Rex shortcuts, Kitty palette, Apply Kitty Style action |
| `starship/` | Prompt configuration |
| `tmux/` | Multiplexer configuration, Ctrl+A prefix |
| `zsh/` | Shell startup files and helper scripts |
| `tests/` | Isolated setup regression checks |

Bootstrap stows every tool package except Kitty and Rex on Linux. The Cloudflare
skills under `agents/.agents/skills/cloudflare-skills/` are vendored reference
material with their own `LICENSE`; do not edit them as part of routine machine setup. Application-written settings are symlinked too: inspect
`git diff` after using tools that update their own configuration.

## Daily commands

- `ll`, `lt`, `la`: eza listings; `cat`: bat; `grep`: ripgrep.
- `z` / `cd`: zoxide navigation. `gs`, `gp`: Git status and pull. `k`: kubectl.
- `tm`: attach/switch to `$TMUX_SESSION`, defaulting to `main`; `tmd`: detach.
  Set `export TMUX_SESSION=myapp` in a project's `.envrc` and run `direnv allow`
  for a project-specific session. Nothing auto-attaches at shell startup.
- `wt`: git worktrees at `~/worktrees/<repo>/<branch>` (override with `WT_ROOT`).
  `wt new <branch> [base]` creates one from the fresh default branch (or an
  existing local/remote branch); `wt go <name>` opens it; `wt ls` shows each
  worktree's uncommitted and unpushed counts; `wt rm <name>` removes only clean,
  fully pushed worktrees and deletes the branch if merged; `wt prune` forgets
  worktrees whose folders are gone. Inside Rex, `new` and `go` open a background
  tab named `wt:<repo>/<worktree>` (`wt:<repo>/<branch>` for the main checkout)
  without taking focus (`wt go --focus` switches to it), and `rm` closes it;
  elsewhere they `cd`. `wt ui` (Rex: Ctrl+A, then W) is a popup for the focused
  pane's repo, or every repo under `~/worktrees` outside one: Enter opens and
  switches, Backspace removes (same safety checks), N creates, R refreshes,
  Q or Esc closes. Never delete a worktree folder with `rm -rf`.
- `diffwatch`: watch changes from the commit at launch, including later commits,
  without changing your staging area.
- `n`: open `~/notes/dump.md`; `n some text` or `command | n`: append. Override
  with `NOTES_FILE`. Ctrl+Q closes the pad; Ctrl+E toggles its file tree.
  `n --clip` appends the clipboard first (macOS `pbpaste` only). In Rex, Ctrl+A
  then N opens the pad as a floating popup (also **Open Notes Pad** in the
  palette); Ctrl+A then Ctrl+N appends the clipboard first.
- Kitty and Rex Cmd+digit select configured Pi model shortcuts; edit
  `pi/.pi/agent/model-shortcuts.json`, then `/reload` in Pi.
- Pi: `/skill:fluent-ui redesign this screen` converts an existing UI to real
  Fluent UI components. It requires Stagehand task checks, Playwright assertions
  and screenshots, and visual inspection before calling the result verified.
  Reuse configured browser tools or project-local SDKs; Stagehand needs authorized
  model access. Run `/reload` to discover a newly added skill.

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
