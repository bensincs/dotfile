# Global agent instructions

## herdr (terminal multiplexer)

When `HERDR_ENV=1`, you are running inside a herdr-managed pane. In that case:

- **Prefer herdr for orchestration.** Load and follow the `herdr` skill for the
  command reference. Use it to manage workspaces, tabs, and panes rather than
  cramming everything into one shell.
- **You MUST run these categories in a dedicated work pane, never inline in your
  own pane:**
  - long-running or background processes (dev servers, watchers, `tail -f`, log
    streams, anything that does not return promptly)
  - test suites, builds, linters, and type-checkers
  - anything you want to keep visible, monitor, or coordinate with via
    `herdr wait output` / `herdr wait agent-status`
  - a helper agent spawned for a parallelizable subtask
  Do not paste one of these into your own shell "just this once." If in doubt
  about whether a command returns promptly, treat it as long-running and use a
  work pane.
- **How to use a work pane.** Split with `--no-focus` so you keep your own
  context, rename the new pane `agent-work-<n>` (incrementing `<n>` for each new
  one, e.g. `agent-work-1`, `agent-work-2`) so it is easy to spot in the sidebar,
  then run the command there:
  ```
  NEW_PANE=$(herdr pane split --current --direction right --no-focus \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
  herdr pane rename "$NEW_PANE" "agent-work-1"
  herdr pane run "$NEW_PANE" "..."
  ```
  Reuse an existing `agent-work-<n>` pane for follow-up work instead of spawning
  a new one every time. Do not `--focus` a work pane; leave the user where they
  are.
- **Read results back explicitly**, since `herdr pane run` does not return
  output or an exit code:
  - `herdr pane read <id> --source recent` to inspect current output
  - `herdr wait output <id> --match "<sentinel>" --timeout <ms>` to block until a
    command finishes; append a sentinel (e.g. `... ; echo DONE_<n>`) to commands
    whose completion you need to detect, then wait for it
  - do not assume a command succeeded — verify from the pane output
- **Keep quick, one-shot foreground commands in your own pane** (a single `ls`,
  `git status`, a file read, a fast formatter). Do not over-split for trivial
  work — the work-pane rule is for the long-running/visible categories above,
  not for everything.

When `HERDR_ENV` is unset, ignore the above and behave normally; do not try to
control herdr from outside it.

## WorkIQ (Microsoft 365 data)

When asked about Teams messages/channels, email, meetings, or other Microsoft
365 data, use the `workiq` MCP tools rather than guessing or saying you have
no way to check. This covers questions like "what's in the Engineering
channel today", "what did X say about Y", or "what's on my calendar
tomorrow."
