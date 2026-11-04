#!/usr/bin/env bash
# Linux service wiring. Never invoked by bootstrap; live activation is explicit.
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
THEA_HOME="$HOME/.thea"
STATE="$THEA_HOME/state"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

log() { printf 'thea: %s\n' "$*" >&2; }
die() { log "$*"; exit 1; }

require_linux() {
  [[ "$(uname -s)" == Linux ]] || die "Thea's service requires Linux/systemd."
}

prepare_home() {
  # Folding either directory into the checkout would leak growing private state.
  [[ ! -L "$THEA_HOME" && ! -L "$THEA_HOME/.pi" ]] || die "~/.thea and ~/.thea/.pi must be real directories, not symlinks."
  [[ -f "$THEA_HOME/AGENTS.md" && -f "$THEA_HOME/.pi/settings.json" ]] || die "Stow Thea first; run bootstrap.sh or see README.md."
  umask 077
  mkdir -p "$THEA_HOME/memory" "$THEA_HOME/tasks" "$THEA_HOME/sessions" \
    "$THEA_HOME/.pi/skills" "$STATE/whatsapp"
  chmod 700 "$THEA_HOME" "$STATE" "$STATE/whatsapp"
  if [[ ! -e "$THEA_HOME/memory/MEMORY.md" ]]; then
    printf '# Memory\n\nDurable decisions and an index of supporting notes.\n' > "$THEA_HOME/memory/MEMORY.md"
  fi
  if [[ ! -e "$THEA_HOME/memory/USER.md" ]]; then
    printf '# Ben\n\nExplicit preferences and corrections, recorded as they are learned.\n' > "$THEA_HOME/memory/USER.md"
  fi
  if [[ ! -e "$STATE/env" ]]; then
    printf '# Private shell environment; never commit this file.\nWHATSAPP_ALLOW=\nTZ=UTC\nPI_WHATSAPP_PREFIX="Thea\\n"\n' > "$STATE/env"
  fi
}

load_private_env() {
  set -a
  # This is an explicitly user-owned shell file, not input from WhatsApp.
  source "$STATE/env"
  set +a
  [[ -n "${WHATSAPP_ALLOW:-}" ]] || die "Set WHATSAPP_ALLOW in $STATE/env first."
}

check_lock() {
  local pid=""
  if [[ -f "$1/lock" ]]; then
    read -r pid < "$1/lock" || true
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      die "WhatsApp is still owned by pid $pid ($1). Disconnect it first; do not log out."
    fi
  fi
}

check_connections() {
  check_lock "$HOME/.pi/agent/whatsapp"
  check_lock "$STATE/whatsapp"
}

# Always address the shared/default server, not a caller's named Herdr session.
shared_herdr() {
  env -u HERDR_SOCKET_PATH -u HERDR_PANE_ID -u HERDR_TAB_ID \
    -u HERDR_WORKSPACE_ID -u HERDR_ENV herdr "$@"
}

ensure_server() {
  if shared_herdr workspace list >/dev/null 2>&1; then return 0; fi
  local status
  status="$(shared_herdr status server 2>&1)" || true
  if [[ "$status" != *"status: not running"* ]]; then
    log "Herdr is unreachable or incompatible; not replacing or restarting it."
    return 1
  fi
  # A separate transient service owns a newly needed shared server. Stopping
  # thea.service must not kill the server or any worker panes it owns.
  log "Starting the missing shared Herdr server in its own user unit."
  systemd-run --user --collect --unit=herdr-server \
    --property=Restart=on-failure --property=RestartSec=5 \
    "--setenv=PATH=$PATH" /usr/bin/env \
    -u HERDR_SOCKET_PATH -u HERDR_PANE_ID -u HERDR_TAB_ID -u HERDR_WORKSPACE_ID \
    -u HERDR_ENV -u PI_WHATSAPP -u PI_WHATSAPP_DIR -u WHATSAPP_ALLOW \
    "$(command -v herdr)" server >/dev/null || return 1
  return 1 # Wait for the socket on the next tick, without starting a second server.
}

# Reconcile live IDs every time; never use a saved ID to select a new target.
service_tick() {
  ensure_server || return 1
  local workspaces count workspace tabs panes pane agent named_agent process command now
  workspaces="$(shared_herdr workspace list)" || return 1
  count="$(jq '[.result.workspaces[] | select(.label == "Thea")] | length' <<< "$workspaces")"
  if [[ "$count" == 0 ]]; then
    workspace="$(shared_herdr workspace create --cwd "$THEA_HOME" --label Thea --no-focus | jq -er '.result.workspace.workspace_id')" || return 1
  elif [[ "$count" == 1 ]]; then
    workspace="$(jq -er '.result.workspaces[] | select(.label == "Thea") | .workspace_id' <<< "$workspaces")"
  else
    log "Multiple Thea workspaces exist; refusing to guess or close anything."
    return 1
  fi
  tabs="$(shared_herdr tab list --workspace "$workspace")" || return 1
  panes="$(shared_herdr pane list --workspace "$workspace")" || return 1
  if ! jq -e '.result.tabs | length == 1' <<< "$tabs" >/dev/null || \
     ! jq -e '.result.panes | length == 1' <<< "$panes" >/dev/null; then
    log "The Thea workspace must have one tab and one pane; leaving it untouched."
    return 1
  fi
  if ! jq -e --arg home "$THEA_HOME" '.result.panes[0].cwd == $home' <<< "$panes" >/dev/null; then
    log "Thea workspace cwd does not match $THEA_HOME; leaving it untouched."
    return 1
  fi
  pane="$(jq -er '.result.panes[0].pane_id' <<< "$panes")"
  agent="$(jq -r '.result.panes[0].agent // ""' <<< "$panes")"
  if [[ -n "$agent" && "$agent" != pi ]]; then
    log "A different agent occupies the Thea pane; leaving it untouched."
    return 1
  fi
  # These labels are confined to the validated Thea workspace.
  shared_herdr tab rename "$(jq -er '.result.tabs[0].tab_id' <<< "$tabs")" Thea >/dev/null || return 1
  shared_herdr pane rename "$pane" Thea >/dev/null || return 1
  printf '%s\n' "$pane" > "$STATE/pane-id"
  named_agent=""
  if named_agent="$(shared_herdr agent get thea 2>/dev/null)"; then
    if ! jq -e --arg pane "$pane" '.result.agent.pane_id == $pane' <<< "$named_agent" >/dev/null; then
      log "Agent name 'thea' belongs to another pane; leaving it untouched."
      return 1
    fi
  else
    named_agent=""
  fi
  if [[ "$agent" == pi ]]; then
    # Idle, working, blocked, done, and unknown all count as alive.
    if [[ -z "$named_agent" ]]; then
      shared_herdr agent rename "$pane" thea >/dev/null || return 1
    fi
    launch_delay=30
    return 0
  fi
  now="$(date +%s)"
  (( now >= next_launch )) || return 0
  process="$(shared_herdr pane process-info --pane "$pane")" || return 1
  # Never type into a foreground editor, installer, or an unrecognized agent.
  if ! jq -e '.result.process_info | .shell_pid as $shell |
    (.foreground_processes | length > 0) and all(.foreground_processes[]; .pid == $shell)' <<< "$process" >/dev/null; then
    return 0
  fi
  printf -v command '%q ' bash "$DOTFILES_DIR/scripts/thea.sh" run
  shared_herdr pane run "$pane" "$command" >/dev/null || return 1
  log "Launched Thea in $pane; next retry no sooner than $launch_delay seconds."
  next_launch=$((now + launch_delay))
  if (( launch_delay < 300 )); then launch_delay=$((launch_delay * 2)); fi
  if (( launch_delay > 300 )); then launch_delay=300; fi
}

stop_owned_pane() {
  local pane="" data workspace
  [[ -f "$STATE/pane-id" ]] || return 0
  read -r pane < "$STATE/pane-id" || return 0
  data="$(shared_herdr pane get "$pane" 2>/dev/null)" || return 0
  if ! jq -e --arg pane "$pane" --arg home "$THEA_HOME" \
    '.result.pane | .pane_id == $pane and .agent == "pi" and .cwd == $home' <<< "$data" >/dev/null; then
    return 0
  fi
  workspace="$(jq -er '.result.pane.workspace_id' <<< "$data")" || return 0
  data="$(shared_herdr workspace get "$workspace")" || return 0
  if jq -e '.result.workspace.label == "Thea"' <<< "$data" >/dev/null; then
    shared_herdr pane close "$pane" >/dev/null || true
  fi
}

supervise() {
  prepare_home
  exec 9>"$STATE/supervisor.lock"
  flock -n 9 || die "Another Thea supervisor is already running."
  local next_launch=0 launch_delay=30
  trap 'stop_owned_pane; exit 0' TERM INT
  while true; do
    service_tick || log "Waiting for a safe, available Thea layout."
    [[ "${1:-}" != --once ]] || break
    sleep 10
  done
}

run_pi() {
  prepare_home
  load_private_env
  check_connections
  unset PI_CODING_AGENT_DIR PI_CODING_AGENT_SESSION_DIR
  export PI_WHATSAPP=1 PI_WHATSAPP_DIR="$STATE/whatsapp"
  cd "$THEA_HOME"
  # flock stays in a parent process; --close prevents children retaining its lock.
  exec flock --nonblock --close "$STATE/pi.lock" \
    pi --approve --continue --session-dir "$THEA_HOME/sessions" --name Thea --whatsapp
}

migrate_whatsapp() {
  prepare_home
  local old="${1:-$HOME/.pi/agent/whatsapp}"
  [[ -d "$old/auth" ]] || die "No WhatsApp auth directory at $old."
  if systemctl --user is-active --quiet thea.service; then
    die "Stop Thea before migrating WhatsApp state."
  fi
  check_lock "$old"
  check_lock "$STATE/whatsapp"
  [[ -z "$(find "$STATE/whatsapp" -mindepth 1 -maxdepth 1 -print -quit)" ]] || die "Thea's WhatsApp state is not empty; refusing to overwrite it."
  # Retain the old state as a recovery copy; do not copy a PID lock.
  (
    shopt -s dotglob nullglob
    for entry in "$old"/*; do
      [[ "${entry##*/}" != lock ]] || continue
      cp -a -- "$entry" "$STATE/whatsapp/"
    done
  )
  log "Copied WhatsApp state into Thea's home. Original retained at $old."
}

install_unit() {
  prepare_home
  command -v systemctl >/dev/null || die "systemctl is required."
  command -v systemd-run >/dev/null || die "systemd-run is required."
  command -v flock >/dev/null || die "flock is required."
  command -v jq >/dev/null || die "jq is required."
  command -v herdr >/dev/null || die "herdr is required."
  command -v pi >/dev/null || die "pi is required."
  mkdir -p "$UNIT_DIR"
  python3.11 - "$UNIT_DIR/thea.service" "$DOTFILES_DIR/scripts/thea.sh" "$THEA_HOME" <<'PY'
import os
from pathlib import Path
import sys

path, script, home = map(Path, sys.argv[1:])
marker = "# Managed by dotfiles start-thea.sh"
if path.exists() and not path.read_text().startswith(marker):
    raise SystemExit(f"Refusing to overwrite an unmanaged unit: {path}")

def quote(value, command=False):
    value = str(value)
    if any(c in value for c in "\n\r\0"):
        raise SystemExit("Service paths must not contain control characters")
    value = value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
    if command:
        value = value.replace("$", "$$")
    return '"' + value + '"'

quote(home)  # Validate the unquoted WorkingDirectory value too.

# Keep the selected Homebrew's stable bin directory, not an ephemeral fnm path.
import shutil
brew = shutil.which("brew")
paths = [str(Path(brew).parent)] if brew else []
paths += [str(Path.home() / ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin",
          "/home/linuxbrew/.linuxbrew/bin", "/usr/bin", "/bin"]
unit = f'''{marker}
[Unit]
Description=Thea persistent Pi orchestrator in Herdr
After=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory={str(home).replace("%", "%%")}
ExecStart=/bin/bash {quote(script, command=True)} supervise
Environment={quote("PATH=" + ":".join(dict.fromkeys(paths)))}
UMask=0077
Restart=on-failure
RestartSec=15
TimeoutStopSec=30

[Install]
WantedBy=default.target
'''
temporary = path.with_suffix(".service.tmp")
temporary.write_text(unit)
os.replace(temporary, path)
PY
  systemctl --user daemon-reload
  log "Installed $UNIT_DIR/thea.service (not enabled or started)."
}

require_linux
case "${1:-start}" in
  install) install_unit ;;
  start)
    install_unit
    load_private_env
    check_connections
    [[ -f "$STATE/whatsapp/auth/creds.json" ]] || die "Run setup to pair, or migrate-whatsapp after disconnecting the old Pi."
    systemctl --user enable --now thea.service
    ;;
  setup) run_pi ;;
  migrate-whatsapp) migrate_whatsapp "${2:-$HOME/.pi/agent/whatsapp}" ;;
  stop)
    systemctl --user disable --now thea.service
    stop_owned_pane
    ;;
  status)
    systemctl --user status thea.service --no-pager
    shared_herdr agent get thea
    ;;
  logs) journalctl --user -u thea.service -f ;;
  attach) shared_herdr ;;
  run) run_pi ;;
  supervise) supervise "${2:-}" ;;
  *) die "Usage: ./start-thea.sh {install|start|setup|migrate-whatsapp [old-dir]|stop|status|logs|attach}" ;;
esac
