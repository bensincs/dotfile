#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/dotfiles/rust-tools"
TARGET_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/dotfiles/rust-target"
BINARIES=(azctx kctx wt)

die() { printf 'Rust tools: %s\n' "$*" >&2; exit 1; }

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    die "SHA-256 requires shasum (macOS) or sha256sum (Linux)"
  fi
}

check_destination() {
  local destination="$BIN_DIR/$1" receipt="$STATE_DIR/$1.sha256"
  [[ ! -L "$destination" ]] || die "refusing to replace symlink $destination"
  if [[ -e "$destination" ]]; then
    [[ -f "$destination" && -f "$receipt" && ! -L "$receipt" ]] ||
      die "unmanaged executable at $destination; back it up before installing"
    grep -qxF "$(hash_file "$destination")" "$receipt" ||
      die "$destination was modified outside this installer; back it up first"
  fi
}

# Do not write binaries through a Stow-folded ~/.local directory into the repo.
[[ ! -L "$HOME/.local" && ! -L "$BIN_DIR" ]] || die "~/.local and ~/.local/bin must be real directories"
for binary in "${BINARIES[@]}"; do check_destination "$binary"; done

# Use Rustup's toolchain dispatch, not whichever Homebrew cargo is first on PATH.
if command -v rustup >/dev/null 2>&1; then
  RUSTUP="$(command -v rustup)"
else
  if ! command -v brew >/dev/null 2>&1; then
    for prefix in /opt/homebrew /usr/local /home/linuxbrew/.linuxbrew; do
      if [[ -x "$prefix/bin/brew" ]]; then export PATH="$prefix/bin:$PATH"; break; fi
    done
  fi
  command -v brew >/dev/null 2>&1 || die "install the Brewfile dependencies first"
  RUSTUP="$(brew --prefix rustup)/bin/rustup"
  [[ -x "$RUSTUP" ]] || die "Rustup is missing; install the Brewfile dependencies first"
fi

if ! "$RUSTUP" run stable rustc --version >/dev/null 2>&1; then
  echo "▶ Installing the stable Rust toolchain..."
  "$RUSTUP" toolchain install stable --profile minimal --no-self-update
fi

echo "▶ Building Rust tools..."
"$RUSTUP" run stable cargo build --release --locked --workspace \
  --manifest-path "$DOTFILES_DIR/tools/Cargo.toml" --target-dir "$TARGET_DIR"

# Verify all build outputs and recheck destinations before replacing anything.
for binary in "${BINARIES[@]}"; do
  [[ -x "$TARGET_DIR/release/$binary" ]] || die "build did not produce $binary"
  check_destination "$binary"
done

mkdir -p "$BIN_DIR" "$STATE_DIR"
work="$(mktemp -d "$BIN_DIR/.rust-tools.XXXXXX")"
trap 'rm -rf -- "$work"; if [[ -n "${receipt_tmp:-}" ]]; then rm -f -- "$receipt_tmp"; fi' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for binary in "${BINARIES[@]}"; do
  install -m 755 "$TARGET_DIR/release/$binary" "$work/$binary"
  receipt="$STATE_DIR/$binary.sha256"
  receipt_tmp="$(mktemp "$STATE_DIR/.$binary.XXXXXX")"
  hash_file "$work/$binary" > "$receipt_tmp"
  if [[ -f "$BIN_DIR/$binary" ]]; then hash_file "$BIN_DIR/$binary" >> "$receipt_tmp"; fi
  # Record both hashes first: an interrupted rename leaves either the old or
  # new binary managed. Receipt files are private and replaced atomically too.
  mv -f -- "$receipt_tmp" "$receipt"
  mv -f -- "$work/$binary" "$BIN_DIR/$binary"
  echo "▶ Installed $BIN_DIR/$binary"
done
