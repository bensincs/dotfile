#!/usr/bin/env bash
# Live-synced notes pad.
#   n              open the pad in nvim
#   n some text    append a line without opening the pad
#   cmd | n        append piped output
# Open pads reload automatically when the file changes.
set -euo pipefail

# Popups and other non-interactive callers may not have Homebrew on PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

file="${NOTES_FILE:-$HOME/notes/dump.md}"
mkdir -p "$(dirname "$file")"

# Start appended text on its own line.
ensure_newline() {
  if [[ -s "$file" && -n "$(tail -c 1 "$file")" ]]; then
    printf '\n' >> "$file"
  fi
}

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
