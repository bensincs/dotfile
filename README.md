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
3. Create real directories for Herdr, Pi, Copilot, and Thea runtime state.
4. Check **all** Stow packages for conflicts, then link them to `$HOME`; the special
   `.thea` package targets `$HOME/.thea` instead.
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
- **WhatsApp:** only Thea's profile declares `pi-whatsapp`; ordinary Pi sessions
  do not load it. See the controlled setup/cutover below and
  <https://github.com/bensincs/pi-whatsapp>. Existing Pi processes keep already-loaded
  extensions until they reload or exit; do not reload this live connection mid-cutover.

Copilot CLI and Claude Code are installed as macOS casks. On Linux they are
optional, separate installs; Pi is installed on both platforms.

Restore SSH keys, signing keys, Kubernetes credentials, notes, and other personal
files from their separate secure backups as needed. This repo does not provision
a Docker daemon, cloud resources, VS Code extensions, or per-project `.envrc` files.

## Thea: persistent Herdr orchestrator (Linux)

Thea is a Pi agent with a durable home, inspired by Hermes's persistent memory and
learned skills. Her main job is to coordinate other agents in the **shared** Herdr
server. Workers use their own repository/worktree directories; Thea has no projects
directory and does not become a second checkout manager.

All Thea-specific runtime code lives inside `.thea`. The package deploys
`AGENTS.md`, `.pi/settings.json`, and `start.sh`. Its `.stow-local-ignore` allowlist
prevents deploying any runtime data accidentally created in the source directory.
The live `~/.thea` and `~/.thea/.pi` must be **real directories**, not folded Stow
links into this checkout. Only the configuration and service script are symlinked:

```text
~/.thea/
├── AGENTS.md              # stowed identity and operating rules
├── start.sh               # stowed installer, supervisor, and Pi launcher
├── .pi/
│   ├── settings.json      # stowed profile; only this profile loads WhatsApp
│   └── skills/            # learned, locally owned orchestration skills
├── memory/
│   ├── MEMORY.md          # concise durable knowledge and note index
│   └── USER.md            # explicit user preferences and corrections
├── tasks/                 # request, worker, status, evidence, next action
├── sessions/              # Pi transcripts and compaction history
└── state/
    ├── env                # private service environment, mode 0600
    └── whatsapp/          # pairing, inbox, reminders, connection lock
```

Identity/configuration belongs in dotfiles. Learned knowledge, transcripts,
credentials, and live task state do not: back up the real home separately using
private, encrypted storage. Reinstalling must not overwrite those files. Gitignore
also protects runtime files if someone accidentally launches Pi in the source
`.thea` directory.

Thea uses the normal Pi account credentials, MCP configuration, and shared skills.
Her project-local profile adds her identity, learned skills, model preferences, and
WhatsApp package. It is profile isolation, not an operating-system sandbox.

### Learning and orchestration behavior

The instructions tell Thea to read memory and reconcile unfinished tasks at the
start of substantive work. After meaningful work she records verified knowledge
and corrections, updates the task ledger, and saves proven workflows as Agent
Skills under `.pi/skills/`. Newly created skills need `/reload` in that session.

This first implementation is **prompt-driven curation**, not Hermes's separate
automatic memory engine, conversation-search database, or training loop. Pi's
compaction preserves transcripts but does not itself write durable memory. Thea
must save important state before requesting compaction; older transcripts remain
available for targeted recall.

Routine delegation is permitted within Ben's requested task. Interrupting
unrelated agents, destructive operations, publishing, deployments, and granting
other agents broader permissions still need appropriate approval.

### Prepare without activating

Requires Linux, a working systemd user manager, Herdr, Pi, jq, flock, and Python
3.11. The Brewfile supplies CLI dependencies; systemd comes from the distribution.
After bootstrap, install the unit without enabling or starting it:

```bash
~/.thea/start.sh install
nvim "$HOME/.thea/state/env"
```

Set `WHATSAPP_ALLOW` to the allowed phone number(s), digits with country code,
comma-separated. `TZ=UTC` and a Thea prefix are seeded; change them if desired.
Any additional environment-only credentials belong in this private file, not in
the unit or the repository. The service does not depend on an interactive shell
exporting them.

If stowing only this profile rather than running the full bootstrap:

```bash
mkdir -p "$HOME/.thea/.pi"
stow --dir="$PWD" --target="$HOME/.thea" --simulate .thea
stow --dir="$PWD" --target="$HOME/.thea" .thea
```

`~/.thea/start.sh` is the single entry point for installation, startup, supervision,
and Pi launching. The installer never overwrites an unmanaged `thea.service`.
Systemd's installed unit lives in `~/.config/systemd/user/` and references the stable
`~/.thea/start.sh` path. If the checkout moves, unstow before moving and restow
afterward; the unit's script path does not need changing.

### Controlled WhatsApp handoff

Do not perform this from the phone expecting the old connection to remain active.
Use a terminal. No script automatically disconnects the current WhatsApp owner or
copies its credentials during bootstrap/install.

For the existing linked device:

1. Finish any live work and use `/whatsapp disconnect` in the old Pi. **Do not use
   `/whatsapp logout`**, which unlinks the device.
2. Copy the disconnected state into Thea's home. The command refuses live PID
   locks, an active Thea service, or a nonempty destination. It leaves the original
   directory intact as a recovery copy and omits the old PID lock.
3. Start Thea only when the handoff is intended.

```bash
~/.thea/start.sh migrate-whatsapp
# If the old plugin used PI_WHATSAPP_DIR, pass that old directory explicitly:
# ~/.thea/start.sh migrate-whatsapp /path/to/old/whatsapp
~/.thea/start.sh start
```

For a new device/account, run `~/.thea/start.sh setup` instead of migration. It opens
Pi interactively in Thea's home: complete `/login` if needed and scan the WhatsApp
QR code. Exit that setup Pi before starting the service.

`start` installs/updates the unit and runs `systemctl --user enable --now
thea.service`. It refuses an active legacy WhatsApp lock or missing local pairing
state. Only Thea's launcher enables WhatsApp and selects her private state directory.
Do not reconnect the old Pi after cutover. Stop Thea before using a recovery copy.

### Supervision and operation

The service finds or creates workspace **Thea**, containing one tab **Thea** and
one Pi pane named **thea**, in the default/shared Herdr server. It discovers live
IDs on each pass rather than trusting saved pane IDs. Pi resumes the most recent
session from Thea's home. The supervisor uses the CLI rather than typing prompts
into worker panes.

It never stops/restarts a running shared server. If no server is running, it
starts one in a **separate** transient `herdr-server` user service, so stopping
Thea does not kill workers. That separate unit can recover its own crashed server.
An incompatible/unreachable server is not permission to replace it.

Live Pi states (`idle`, `working`, `blocked`, `done`, `unknown`) are not failures.
Only a validated, available shell in Thea's pane is relaunched, with retries backed
off to at most once every five minutes. Ambiguous layouts, extra tabs/panes, an
unrelated occupant, or a conflicting agent name are left alone and logged. Do not
put workers in Thea's workspace.

```bash
~/.thea/start.sh status
~/.thea/start.sh logs
~/.thea/start.sh attach   # open the shared Herdr UI; select workspace Thea
~/.thea/start.sh stop     # disable service and close only its validated Pi pane
```

Stopping Thea does not stop the shared server, workers, or remove learned data.
Status/process liveness is not proof of WhatsApp/provider readiness: inspect the
Pi footer and test a message after setup, reconnection, and any server restore.
Authentication/approval prompts are not automatically answered or restarted away.

To run after logout and start at boot without an interactive login, explicitly
enable user lingering where the machine's policy permits:

```bash
sudo loginctl enable-linger "$USER"
loginctl show-user "$USER" -p Linger
```

For a consistent private backup, stop Thea first and back up `~/.thea`; retain the
separate Pi provider credentials securely as well. A dotfiles clone alone cannot
restore learned knowledge or account state. The repository tests use fake Herdr,
Pi, and systemd commands; live reboot/reconnection acceptance testing is a separate
step at activation.

## Configuration layout

Each tool directory is a Stow package. Its contents mirror their location in
`$HOME`; for example, `git/.gitconfig` becomes `~/.gitconfig`.

| Path | Purpose |
| --- | --- |
| `bootstrap.sh` | Installation order and active Stow packages |
| `.thea/` | Identity, Pi settings, and service code, stowed into `~/.thea` |
| `.thea/start.sh` | Single entry point: Linux service, setup, and supervision |
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

Bootstrap stows every tool package except Kitty on Linux, plus the separately
targeted `.thea` package. It does not install or activate Thea's service. Pi's Cloudflare skills
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
