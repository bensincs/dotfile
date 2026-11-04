#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if (( $# == 0 )); then set -- start; fi
exec bash "$DOTFILES_DIR/scripts/thea.sh" "$@"
