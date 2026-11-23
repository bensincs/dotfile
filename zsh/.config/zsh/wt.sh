#!/usr/bin/env bash
# wt - git worktrees under one predictable root, opened in Rex tabs when available.
#
#   wt new <branch> [base]   create a worktree (and the branch if needed)
#   wt ls                    list this repo's worktrees with their state
#   wt go <name>             open a worktree (Rex tab, or cd outside Rex)
#   wt rm <name>             remove a clean, fully pushed worktree
#   wt prune                 forget worktrees whose folders are already gone
#
# Worktrees live at ${WT_ROOT:-~/worktrees}/<repo>/<branch, with / as ->.
# <name> is that folder name or the branch name. Outside Rex, `wt new` and
# `wt go` print the path on stdout so the zsh `wt` function can cd into it.
set -euo pipefail

root="${WT_ROOT:-$HOME/worktrees}"

die() { printf 'wt: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*" >&2; }

usage() {
  sed -n '3,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
}

slug() { printf '%s' "${1//\//-}"; }

repo_dir() {
  local common
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ||
    die "not inside a git repository"
  dirname "$common"
}

in_rex() {
  [[ -n "${REX_SESSION:-}" ]] && command -v rex >/dev/null 2>&1 && command -v jq >/dev/null 2>&1
}

# Prints "path<TAB>branch" for each worktree; branch is empty when detached.
worktrees() {
  git -C "$1" worktree list --porcelain | awk '
    /^worktree / { if (path != "") print path "\t" branch; path = substr($0, 10); branch = "" }
    /^branch /   { branch = substr($0, 8); sub(/^refs\/heads\//, "", branch) }
    END          { if (path != "") print path "\t" branch }'
}

# Finds a worktree by folder name, branch, or branch slug. Prints "path<TAB>branch".
resolve() {
  local repo="$1" name="$2" path branch
  while IFS=$'\t' read -r path branch; do
    if [[ "${path##*/}" == "$name" || "$branch" == "$name" || "$(slug "$branch")" == "$name" ]]; then
      printf '%s\t%s\n' "$path" "$branch"
      return 0
    fi
  done < <(worktrees "$repo")
  die "no worktree named '$name' in $(basename "$repo"); see: wt ls"
}

# Counts uncommitted (including untracked) files and commits on no remote.
dirty_count() { git -C "$1" status --porcelain | wc -l | tr -d ' '; }
unpushed_count() { git -C "$1" rev-list --count HEAD --not --remotes 2>/dev/null || echo 0; }

rex_window() {
  rex window ls -s "$REX_SESSION" --json |
    jq -r --arg label "$1" '[.windows[] | select(.label == $label) | .window_id][0] // empty'
}

rex_current_window() {
  rex window ls -s "$REX_SESSION" --json |
    jq -r --arg block "${REX_BLOCK:-}" \
      '[.windows[] | select([.. | .block_id? // empty] | index($block)) | .window_id][0] // empty'
}

# Focuses the worktree's Rex tab, opening one if needed. Outside Rex, prints the path.
open_worktree() {
  local path="$1" label window
  label="${path##*/}"
  if ! in_rex; then
    printf '%s\n' "$path"
    return 0
  fi
  window="$(rex_window "$label")"
  if [[ -n "$window" ]]; then
    rex focus -s "$REX_SESSION" "$window" >/dev/null
    say "focused Rex tab '$label'"
  else
    rex window new -s "$REX_SESSION" "$label" -c "$path" >/dev/null
    say "opened Rex tab '$label'"
  fi
}

cmd_new() {
  [[ $# -ge 1 && $# -le 2 ]] || die "usage: wt new <branch> [base]"
  local branch="$1" base="${2:-}" repo path default
  git check-ref-format --branch "$branch" >/dev/null 2>&1 || die "invalid branch name: $branch"
  repo="$(repo_dir)"
  path="$root/$(basename "$repo")/$(slug "$branch")"
  [[ ! -e "$path" ]] || die "$path already exists; use: wt go $(slug "$branch")"

  mkdir -p "${path%/*}"
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
    [[ -z "$base" ]] || die "branch $branch already exists; omit [base]"
    git -C "$repo" worktree add "$path" "$branch" >&2
  elif [[ -z "$base" ]] && git -C "$repo" show-ref --quiet "refs/remotes/origin/$branch"; then
    git -C "$repo" worktree add --track -b "$branch" "$path" "origin/$branch" >&2
  else
    if [[ -z "$base" ]]; then
      default="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
      if [[ -n "$default" ]]; then
        git -C "$repo" fetch --quiet origin "${default#origin/}" ||
          say "wt: fetch failed; branching from the local $default"
        base="$default"
      else
        base="HEAD"
      fi
    fi
    git -C "$repo" worktree add --no-track -b "$branch" "$path" "$base" >&2
  fi
  open_worktree "$path"
}

cmd_ls() {
  [[ $# -eq 0 ]] || die "usage: wt ls"
  local repo path branch dirty unpushed state
  repo="$(repo_dir)"
  while IFS=$'\t' read -r path branch; do
    if [[ ! -d "$path" ]]; then
      state="missing (wt prune)"
    else
      dirty="$(dirty_count "$path")"
      unpushed="$(unpushed_count "$path")"
      state="clean"
      if [[ "$dirty" != 0 || "$unpushed" != 0 ]]; then
        state="${dirty} uncommitted, ${unpushed} unpushed"
      fi
    fi
    printf '%-32s %-40s %s\n' "${path##*/}" "${branch:-(detached)}" "$state"
  done < <(worktrees "$repo")
}

cmd_go() {
  [[ $# -eq 1 ]] || die "usage: wt go <name>"
  local repo found path
  repo="$(repo_dir)"
  found="$(resolve "$repo" "$1")"
  path="${found%%$'\t'*}"
  [[ -d "$path" ]] || die "$path is missing; run: wt prune"
  open_worktree "$path"
}

cmd_rm() {
  [[ $# -eq 1 ]] || die "usage: wt rm <name>"
  local repo found path branch dirty unpushed window current
  repo="$(repo_dir)"
  found="$(resolve "$repo" "$1")"
  path="${found%%$'\t'*}"
  branch="${found#*$'\t'}"
  [[ "$path" != "$repo" ]] || die "refusing to remove the main worktree"
  case "$PWD/" in "$path"/*) die "leave $path first" ;; esac

  dirty="$(dirty_count "$path")"
  unpushed="$(unpushed_count "$path")"
  [[ "$dirty" == 0 ]] || die "$1 has $dirty uncommitted file(s); commit or stash them first"
  [[ "$unpushed" == 0 ]] || die "$1 has $unpushed unpushed commit(s); push them first"

  if in_rex; then
    window="$(rex_window "${path##*/}")"
    current="$(rex_current_window)"
    if [[ -n "$window" && "$window" != "$current" ]]; then
      rex window close -s "$REX_SESSION" "$window" >/dev/null && say "closed Rex tab '${path##*/}'"
    fi
  fi

  git -C "$repo" worktree remove "$path"
  say "removed worktree $path"
  rmdir "${path%/*}" 2>/dev/null || true
  if [[ -n "$branch" ]] && ! git -C "$repo" branch -d "$branch" >/dev/null 2>&1; then
    say "kept branch $branch (not merged); delete it with: git branch -D $branch"
  elif [[ -n "$branch" ]]; then
    say "deleted merged branch $branch"
  fi
}

cmd_prune() {
  [[ $# -eq 0 ]] || die "usage: wt prune"
  git -C "$(repo_dir)" worktree prune --verbose
}

command="${1:-}"
[[ $# -gt 0 ]] && shift
case "$command" in
  new) cmd_new "$@" ;;
  ls | list) cmd_ls "$@" ;;
  go) cmd_go "$@" ;;
  rm | remove) cmd_rm "$@" ;;
  prune) cmd_prune "$@" ;;
  "" | -h | --help | help) usage ;;
  *) usage; exit 2 ;;
esac
