# Agent guidelines

## Scope and source of truth

Personal macOS (Apple Silicon and Intel) and Linux dotfiles. Homebrew installs
packages; GNU Stow links configuration into `$HOME`.

- `README.md`: installation, manual account/runtime setup, recovery, workflows.
- `Brewfile`: package dependencies and platform-specific applications.
- `bootstrap.sh`: installation order and the authoritative `STOW_PACKAGES` list.
- Tool directories: Stow packages mirroring their home-directory layout.
- `tests/test_setup.py`: isolated setup regression tests.

Packages: bottom, copilot, diffnav, git, herdr, kitty, nvim, pi, starship, tmux,
zsh. Kitty is macOS-only. Pi's Cloudflare skills are vendored reference material
with their own license; do not rewrite them during setup maintenance.

Do not duplicate the README's environment inventory here. Update the README when
setup behavior, dependencies, platform support, or manual steps change.

## Safety

- Never run bootstrap, install packages, change the login shell, or alter the real
  home directory just to validate a change. Those require an explicit setup request.
- Never commit credentials, account state, or private shell overrides.
  `~/.zshenv.local` and `~/.zshrc.local` are the machine-local override files.
- Do not use `stow --adopt`, automatically overwrite dotfiles, or silently move
  existing configuration. Preserve backups and explain conflicts.
- Preserve unrelated working-tree changes. Tools can update symlinked configuration
  files themselves; inspect the diff before changing or committing them.
- Do not add documentation files unless requested. Keep the existing setup guide
  accurate rather than adding parallel instructions.

## Checks

Run from the repository root with Python 3.11+ (included in the Brewfile):

```bash
python3.11 -m unittest discover -s tests -v
```

Tests use temporary home directories, real Stow, and mocked package-manager,
account-CLI, and Neovim commands. They do not provision a machine. Zsh and Stow
must be installed to run their tests rather than skip them.

For syntax-only checks:

```bash
bash -n bootstrap.sh
for file in zsh/.config/zsh/*.sh; do bash -n "$file"; done
zsh -n zsh/.zshenv
zsh -n zsh/.zshrc
```

Only when asked to verify the installed machine:

```bash
brew bundle check --file=Brewfile
zsh -ic 'command -v gh nvim pi az; print -r -- "History: $HISTFILE"'
```

`zsh -c` is non-interactive and does not load `.zshrc`. Do not present it as an
interactive configuration check. Report fresh-OS and platform testing limits.

## Editing conventions

- Make the smallest correct change and preserve the surrounding style.
- Bash scripts use `#!/usr/bin/env bash`, `set -euo pipefail`, quoted paths,
  Bash arrays, and two-space indentation. Preserve macOS Bash 3.2 compatibility.
- Find the checkout relative to `${BASH_SOURCE[0]}`, not the caller's directory.
- Explicitly target `$HOME` in Stow commands. Do not rely on the checkout's parent.
- Support `/opt/homebrew`, `/usr/local`, and `/home/linuxbrew/.linuxbrew`; otherwise
  avoid machine-specific absolute paths. Respect a Homebrew already on PATH.
- Preserve inherited PATH entries. Keep user-local executables and asdf shims
  discoverable. Guard optional integrations with command/file checks.
- `.zshenv`: environment for all Zsh sessions. `.zshrc`: interactive behavior,
  history, aliases, completion, prompt, and interactive plugins.
- One tool per Stow package. Group Brewfile dependencies by purpose and guard
  macOS-only casks. Add dependencies for every configured command.
- Prefer current stable tooling. Do not invent runtime versions or account details.
  Preserve Neovim's committed plugin lockfile unless updating plugins is intended.
- Python projects use uv; JavaScript/TypeScript projects use Yarn. Use Azure CLI
  for Azure tasks. These preferences do not imply those projects live in this repo.

## Adding a tool

1. Add its installable dependency to `Brewfile`, with platform guards as needed.
2. Add configuration in a directory mirroring its target home-directory paths.
3. Add that package to `STOW_PACKAGES` in `bootstrap.sh`.
4. Document any account setup, runtime initialization, or platform limits in README.
5. Run isolated tests. For a requested real installation, preview first:

```bash
stow --target="$HOME" --simulate --verbose package
```
