#!/usr/bin/env python3.11
"""A closed-world Herdr fake. Unknown commands fail rather than touch real panes."""

import json
import os
from pathlib import Path
import sys

if os.environ.get("HERDR_SOCKET_PATH"):
    raise SystemExit("Supervisor leaked caller socket instead of selecting the shared server")

args = sys.argv[1:]
path = Path(os.environ["MOCK_HERDR_STATE"])
state = json.loads(path.read_text())
with Path(os.environ["MOCK_HERDR_LOG"]).open("a") as log:
    log.write(json.dumps(args) + "\n")


def result(**data):
    path.write_text(json.dumps(state))
    print(json.dumps({"result": data}))
    sys.exit(0)


def fail():
    print("mock: unavailable or unsupported command", file=sys.stderr)
    sys.exit(1)


def option(name):
    return args[args.index(name) + 1]


if args == ["status", "server"]:
    print("status: " + state.get("server", "running"))
    sys.exit(0)
if state.get("server", "running") != "running":
    fail()
if args == ["workspace", "list"]:
    result(workspaces=state["workspaces"])
if args[:2] == ["workspace", "create"]:
    workspace = {"workspace_id": "w99", "label": option("--label")}
    state["workspaces"].append(workspace)
    state["tabs"].append({"tab_id": "w99:t1", "workspace_id": "w99", "label": "1"})
    pane = {"pane_id": "w99:p1", "tab_id": "w99:t1", "workspace_id": "w99",
            "cwd": option("--cwd"), "agent": None}
    state["panes"].append(pane)
    result(workspace=workspace, tab=state["tabs"][-1], root_pane=pane)
if args[:2] == ["workspace", "get"]:
    for workspace in state["workspaces"]:
        if workspace["workspace_id"] == args[2]:
            result(workspace=workspace)
    fail()
if args[:2] == ["tab", "list"]:
    result(tabs=[tab for tab in state["tabs"] if tab["workspace_id"] == option("--workspace")])
if args[:2] == ["pane", "list"]:
    result(panes=[pane for pane in state["panes"] if pane["workspace_id"] == option("--workspace")])
if args[:2] == ["pane", "get"]:
    for pane in state["panes"]:
        if pane["pane_id"] == args[2]:
            result(pane=pane)
    fail()
if args[:2] == ["agent", "get"]:
    if state.get("named_elsewhere"):
        result(agent={"pane_id": "w1:p1", "agent": "pi", "cwd": "/other/repo"})
    for pane in state["panes"]:
        if pane.get("agent") == "pi" and state.get("named"):
            result(agent=pane)
    fail()
if args[:2] == ["agent", "rename"]:
    state["named"] = True
    result(ok=True)
if args[:2] == ["tab", "rename"] or args[:2] == ["pane", "rename"]:
    result(ok=True)
if args[:2] == ["pane", "process-info"]:
    result(process_info={"shell_pid": 100, "foreground_processes": [
        {"pid": 200 if state.get("foreground_busy") else 100},
    ]})
if args[:2] == ["pane", "run"]:
    state["launches"] = state.get("launches", 0) + 1
    result(ok=True)
if args[:2] == ["pane", "close"]:
    state.setdefault("closed", []).append(args[2])
    result(ok=True)
fail()
