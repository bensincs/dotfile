#!/usr/bin/env bash
set -euo pipefail

if [[ "${HERDR_ENV:-}" != "1" || -z "${HERDR_PANE_ID:-}" ]]; then
  echo "Run aicode from a repo inside herdr." >&2
  exit 1
fi

for tool in git herdr jq opencode diffnav; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "aicode requires $tool." >&2
    exit 1
  fi
done

repo_root=$(git rev-parse --show-toplevel)
if ! branch=$(git symbolic-ref --quiet --short HEAD); then
  echo "Check out a branch before running aicode (HEAD is detached)." >&2
  exit 1
fi
baseline=$(git rev-parse --verify HEAD)
cd "$repo_root"
helper="$HOME/.config/zsh/diffwatch.sh"
if [[ ! -f "$helper" ]]; then
  echo "Missing diffwatch.sh; stow the zsh package first." >&2
  exit 1
fi

# Explicitly target the invoking pane's workspace, not whichever tab has focus.
workspace=$(herdr pane current --pane "$HERDR_PANE_ID" | jq -er '.result.pane.workspace_id')
tab=$(herdr tab create --workspace "$workspace" --cwd "$repo_root" \
  --label "${repo_root##*/} · $branch" --no-focus)
tab_id=$(jq -er '.result.tab.tab_id' <<< "$tab")
agent_pane=$(jq -er '.result.root_pane.pane_id' <<< "$tab")
diff_pane=$(herdr pane split "$agent_pane" --direction right --ratio 0.5 \
  --cwd "$repo_root" --no-focus | jq -er '.result.pane.pane_id')

herdr pane rename "$agent_pane" "OpenCode · ${repo_root##*/}" >/dev/null
herdr pane rename "$diff_pane" "Diff · $branch" >/dev/null

# Quote each argument for the receiving shell, including paths and user input.
printf -v diff_command '%q ' bash "$helper" --baseline "$baseline"
printf -v agent_command '%q ' opencode "$@"
herdr pane run "$diff_pane" "$diff_command"
herdr pane run "$agent_pane" "$agent_command"
herdr tab focus "$tab_id" >/dev/null
