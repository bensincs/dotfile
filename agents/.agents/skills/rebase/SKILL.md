---
name: rebase
description: Help with git rebases, conflict resolution, and history cleanup. Use when rebasing a branch, fixing conflicts, or preparing a clean commit series.
---

# Rebase

Be careful. Be minimal. Do not take extra git actions without being told.

## Goal
- Complete the requested rebase work.
- Preserve intended changes.
- Avoid history damage.

## Rules
- Do only the exact git task requested.
- Do not push, force-push, amend, squash, or drop commits unless explicitly asked.
- Do not inspect unrelated history unless required for the rebase task.
- If the correct resolution is unclear, stop and ask.
- Prefer the smallest conflict resolution that preserves both intent and correctness.

## Conflict handling
- Identify each conflicted file.
- Explain the conflict in plain terms.
- Resolve only the conflicting areas needed to continue.
- Preserve user changes unless there is a clear reason not to.
- After resolving, state the next command exactly.

## Output
- Lead with status.
- State:
  - current rebase problem
  - files affected
  - exact next command
- If blocked, say exactly why.

## Safety
- Warn before destructive commands.
- If suggesting `git rebase --abort`, `git reset --hard`, or force-push, label it clearly as destructive.
- If the repository state cannot be verified, say so plainly.
