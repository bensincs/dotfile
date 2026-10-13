#!/usr/bin/env bash
# Live-synced notes pad.
#   n              open the pad in nvim
#   n some text    append a line without opening the pad
#   cmd | n        append piped output
#   n --clip       also append the clipboard (your latest highlight) first,
#                  unless it is empty or was already appended
# Open pads reload automatically when the file changes.
set -euo pipefail

# Popups and other non-interactive callers may not have Homebrew on PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

file="${NOTES_FILE:-$HOME/notes/dump.md}"
mkdir -p "$(dirname "$file")"

state="${XDG_CACHE_HOME:-$HOME/.cache}/notes-last-clip"

# Start appended text on its own line.
ensure_newline() {
  if [[ -s "$file" && -n "$(tail -c 1 "$file")" ]]; then
    printf '\n' >> "$file"
  fi
}

# Append the clipboard unless it is blank or the same text as last time, so
# pressing the shortcut without highlighting anything adds nothing.
append_clipboard() {
  local clip hash
  clip="$(pbpaste)"
  [[ -n "${clip//[[:space:]]/}" ]] || return 0
  hash="$(printf '%s' "$clip" | shasum | cut -d' ' -f1)"
  [[ "$(cat "$state" 2>/dev/null || true)" != "$hash" ]] || return 0
  ensure_newline
  printf '%s\n' "$clip" >> "$file"
  mkdir -p "$(dirname "$state")"
  printf '%s' "$hash" > "$state"
}

if [[ "${1:-}" == "--clip" ]]; then
  shift
  append_clipboard
fi

if (( $# > 0 )); then
  ensure_newline
  printf '%s\n' "$*" >> "$file"
  echo "✓ noted" >&2
elif [[ ! -t 0 ]]; then
  ensure_newline
  cat >> "$file"
  echo "✓ noted" >&2
else
  exec nvim -c 'lua require("notes")' "$file"
fi
