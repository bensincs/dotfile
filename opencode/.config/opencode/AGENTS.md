# Global agent instructions

## herdr (terminal multiplexer)

**Herdr is opt-in.** Use OpenCode's normal tools in the current session by
default, including for tests, builds, linters, and type-checkers.

- Do not use herdr to start tasks, spawn agents, or create workspaces, tabs,
  or panes unless the user explicitly asks for that herdr action.
- Running inside herdr (`HERDR_ENV=1`) is not a reason to load the `herdr`
  skill or orchestrate work through herdr. Long-running tasks are not an
  automatic exception.
- When the user explicitly requests herdr control, load the `herdr` skill
  for the command reference. Only control herdr when `HERDR_ENV=1`.

## WorkIQ (Microsoft 365 data)

When asked about Teams messages/channels, email, meetings, or other Microsoft
365 data, use the `workiq` MCP tools rather than guessing or saying you have
no way to check. This covers questions like "what's in the Engineering
channel today", "what did X say about Y", or "what's on my calendar
tomorrow."
