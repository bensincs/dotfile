#!/usr/bin/env bash
set -euo pipefail

# Refresh the private index, never the user's staging area. The commit at launch
# stays the baseline even when HEAD changes or the agent commits/pushes its work.
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
# aicode pins the commit before starting either pane; standalone uses HEAD.
baseline=HEAD
if [[ "${1:-}" == "--baseline" ]]; then
  baseline=${2:?--baseline requires a commit}
  shift 2
fi
DIFFWATCH_BASELINE=$(git rev-parse --verify "${baseline}^{tree}")
export DIFFWATCH_BASELINE
objects_path=$(git rev-parse --path-format=absolute --git-path objects)
export DIFFWATCH_SCRIPT="${BASH_SOURCE[0]}"
cd "$repo_root"

snapshot_dir=$(mktemp -d "${TMPDIR:-/tmp}/diffwatch.XXXXXX")
trap 'rm -rf -- "$snapshot_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Keep temporary working-tree blobs outside the repo. Read committed objects
# through an alternate object store.
mkdir "$snapshot_dir/objects"
export GIT_INDEX_FILE="$snapshot_dir/index"
export GIT_OBJECT_DIRECTORY="$snapshot_dir/objects"
# Git accepts C-style quoted alternate paths (including spaces and colons).
objects_path=${objects_path//\\/\\\\}
objects_path=${objects_path//\"/\\\"}
export GIT_ALTERNATE_OBJECT_DIRECTORIES="\"$objects_path\"${GIT_ALTERNATE_OBJECT_DIRECTORIES:+:$GIT_ALTERNATE_OBJECT_DIRECTORIES}"

git read-tree "$DIFFWATCH_BASELINE"
git add --all -- .

# Label only this pane when launched inside herdr; renaming is best-effort.
if [[ "${HERDR_ENV:-}" == "1" && -n "${HERDR_PANE_ID:-}" ]] && \
  command -v herdr >/dev/null 2>&1; then
  herdr pane rename "$HERDR_PANE_ID" "diffwatch · ${repo_root##*/}" >/dev/null 2>&1 || true
fi

# The watch shell expands this variable on each refresh.
# shellcheck disable=SC2016
diffnav "$@" --watch --watch-cmd 'bash "$DIFFWATCH_SCRIPT" --refresh'
