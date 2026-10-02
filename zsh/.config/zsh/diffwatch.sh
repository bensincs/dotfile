#!/usr/bin/env bash
set -euo pipefail

# Refresh the private index, never the user's staging area. The opening tree
# stays fixed even when HEAD changes or the agent commits/pushes its work.
if [[ "${1:-}" == "--refresh" ]]; then
  : "${DIFFWATCH_BASELINE:?}" "${GIT_INDEX_FILE:?}" "${GIT_OBJECT_DIRECTORY:?}"
  git add --all -- .
  git --no-pager diff --cached --no-ext-diff --no-textconv --no-color \
    "$DIFFWATCH_BASELINE" -- .
  exit
fi

if ! command -v diffnav >/dev/null 2>&1; then
  echo "diffwatch requires diffnav: brew install diffnav" >&2
  exit 1
fi

repo_root=$(git rev-parse --show-toplevel)
index_path=$(git rev-parse --path-format=absolute --git-path index)
objects_path=$(git rev-parse --path-format=absolute --git-path objects)
export DIFFWATCH_SCRIPT="${BASH_SOURCE[0]}"
cd "$repo_root"

snapshot_dir=$(mktemp -d "${TMPDIR:-/tmp}/diffwatch.XXXXXX")
trap 'rm -rf -- "$snapshot_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Keep snapshot blobs outside the repo, so normal Git garbage collection cannot
# remove the baseline. Read existing objects through an alternate object store.
mkdir "$snapshot_dir/objects"
if [[ -f "$index_path" ]]; then
  cp "$index_path" "$snapshot_dir/index"
fi
export GIT_INDEX_FILE="$snapshot_dir/index"
export GIT_OBJECT_DIRECTORY="$snapshot_dir/objects"
# Git accepts C-style quoted alternate paths (including spaces and colons).
objects_path=${objects_path//\\/\\\\}
objects_path=${objects_path//\"/\\\"}
export GIT_ALTERNATE_OBJECT_DIRECTORIES="\"$objects_path\"${GIT_ALTERNATE_OBJECT_DIRECTORIES:+:$GIT_ALTERNATE_OBJECT_DIRECTORIES}"

git add --all -- .
DIFFWATCH_BASELINE=$(git write-tree)
export DIFFWATCH_BASELINE

# The watch shell expands this variable on each refresh.
# shellcheck disable=SC2016
diffnav "$@" --watch --watch-cmd 'bash "$DIFFWATCH_SCRIPT" --refresh'
