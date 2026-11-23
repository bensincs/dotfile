#!/usr/bin/env python3
"""wt ui - a fast keyboard TUI for git worktrees, meant for a Rex popup.

Lists the worktrees of the repository containing the starting directory, or of
every repository with worktrees under $WT_ROOT (default ~/worktrees) when started
outside a repository. All changes go through wt.sh, so its safety checks apply.

Keys: Up/Down or j/k move, Enter opens and focuses, Backspace deletes, n new,
r refresh, q or Esc quits.
"""

import curses
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

WT = str(Path(__file__).with_name("wt.sh"))
ROOT = Path(os.environ.get("WT_ROOT", str(Path.home() / "worktrees")))


def git(*args, cwd=None):
    result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)
    return result.stdout if result.returncode == 0 else None


def repo_of(directory):
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir", cwd=directory)
    return str(Path(common.strip()).parent) if common else None


def discover_repos(start):
    repo = repo_of(start) if os.path.isdir(start) else None
    if repo:
        return [repo]
    repos = []
    for gitfile in sorted(ROOT.glob("*/*/.git")):
        try:
            gitdir = gitfile.read_text().split("gitdir:", 1)[1].strip()
        except (OSError, IndexError):
            continue
        candidate = str(Path(gitdir).parent.parent.parent)
        if candidate not in repos and os.path.isdir(candidate):
            repos.append(candidate)
    return repos


def worktrees(repo):
    rows, path, branch = [], None, ""
    for line in (git("worktree", "list", "--porcelain", cwd=repo) or "").splitlines() + [""]:
        if line.startswith("worktree "):
            path, branch = line[9:], ""
        elif line.startswith("branch "):
            branch = line[7:].replace("refs/heads/", "", 1)
        elif not line and path:
            main = path == repo
            name = os.path.basename(path)
            rows.append({
                "repo": repo, "path": path, "branch": branch, "main": main,
                "name": (branch or "main") + " (main)" if main else name,
                "arg": branch or name if main else name, "state": None,
            })
            path = None
    return rows


def state_of(path):
    if not os.path.isdir(path):
        return "missing", "missing (wt prune)"
    dirty = len((git("status", "--porcelain", cwd=path) or "").splitlines())
    unpushed = int((git("rev-list", "--count", "HEAD", "--not", "--remotes", cwd=path) or "0").strip() or 0)
    if dirty or unpushed:
        return "busy", f"{dirty} uncommitted, {unpushed} unpushed"
    return "clean", "clean"


def run_wt(repo, *args):
    result = subprocess.run(["bash", WT, *args], cwd=repo, text=True, capture_output=True)
    lines = [line for line in (result.stderr + result.stdout).splitlines() if line.strip()]
    return result.returncode == 0, lines[-1] if lines else ""


class App:
    def __init__(self, screen, start):
        self.screen, self.start = screen, start
        self.rows, self.index, self.message, self.chosen = [], 0, "", None
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=8)
        self.repos = discover_repos(start)
        self.refresh()

    def refresh(self, select=None):
        rows = [row for repo in self.repos for row in worktrees(repo)]
        with self.lock:
            self.rows = rows
            if select:
                self.index = next((i for i, r in enumerate(rows) if r["path"] == select), self.index)
            self.index = max(0, min(self.index, len(rows) - 1))
        for row in rows:
            self.pool.submit(self.load_state, row)

    def load_state(self, row):
        row["state"] = state_of(row["path"])

    def current(self):
        with self.lock:
            return self.rows[self.index] if self.rows else None

    def draw(self):
        screen = self.screen
        screen.erase()
        height, width = screen.getmaxyx()
        put = lambda y, x, text, attr=0: screen.addnstr(y, x, text, max(0, width - x - 1), attr)
        title = "Worktrees · " + (os.path.basename(self.repos[0]) if len(self.repos) == 1 else "all repos")
        put(0, 1, title, curses.A_BOLD)
        if not self.repos:
            put(2, 1, "Not in a git repository, and no worktrees under " + str(ROOT) + ".")
        multi = len(self.repos) > 1
        with self.lock:
            rows = list(self.rows)
            index = self.index
        name_width = max([len(self.label(r, multi)) for r in rows] + [10]) + 2
        branch_width = max([len(r["branch"] or "(detached)") for r in rows] + [6]) + 2
        visible = max(1, height - 5)
        top = max(0, min(index - visible // 2, len(rows) - visible))
        for offset, row in enumerate(rows[top:top + visible]):
            y, selected = 2 + offset, top + offset == index
            kind, text = row["state"] or ("loading", "…")
            colour = {"clean": 1, "busy": 2, "missing": 3}.get(kind, 0)
            base = curses.A_REVERSE if selected else 0
            line = f"{'›' if selected else ' '} {self.label(row, multi):<{name_width}}{(row['branch'] or '(detached)'):<{branch_width}}"
            put(y, 1, line, base)
            put(y, 1 + len(line), text, base | curses.color_pair(colour))
        put(height - 2, 1, "enter open   ⌫ delete   n new   r refresh   q quit", curses.A_DIM)
        if self.message:
            put(height - 1, 1, self.message, curses.A_BOLD)
        screen.refresh()

    @staticmethod
    def label(row, multi):
        return (os.path.basename(row["repo"]) + "/" if multi else "") + row["name"]

    def prompt(self, text):
        height, width = self.screen.getmaxyx()
        curses.curs_set(1)
        self.screen.timeout(-1)
        value = ""
        while True:
            self.screen.move(height - 1, 0)
            self.screen.clrtoeol()
            self.screen.addnstr(height - 1, 1, text + value, width - 2)
            self.screen.refresh()
            key = self.screen.get_wch()
            if key in ("\n", "\r", curses.KEY_ENTER):
                break
            if key == "\x1b":
                value = ""
                break
            if key in (curses.KEY_BACKSPACE, "\x7f", "\b"):
                value = value[:-1]
            elif isinstance(key, str) and key.isprintable():
                value += key
        curses.curs_set(0)
        self.screen.timeout(100)
        return value.strip()

    def open(self, row):
        if "REX_SESSION" not in os.environ:
            self.chosen = row["path"]
            return True
        ok, message = run_wt(row["repo"], "go", "--focus", row["arg"])
        self.message = message
        return ok

    def delete(self, row):
        if row["main"]:
            self.message = "The main checkout can't be removed."
            return
        self.message = "Removing " + row["name"] + "…"
        self.draw()
        ok, message = run_wt(row["repo"], "rm", row["arg"])
        self.message = message or ("removed " + row["name"] if ok else "remove failed")
        self.refresh()

    def new(self):
        row = self.current()
        repo = row["repo"] if row else (self.repos[0] if self.repos else None)
        if not repo:
            self.message = "No repository to add a worktree to."
            return
        branch = self.prompt(f"New worktree in {os.path.basename(repo)}, branch: ")
        if not branch:
            self.message = ""
            return
        self.message = "Creating " + branch + "…"
        self.draw()
        ok, message = run_wt(repo, "new", branch)
        self.message = message
        if ok:
            self.refresh(select=str(ROOT / os.path.basename(repo) / branch.replace("/", "-")))

    def loop(self):
        curses.curs_set(0)
        self.screen.timeout(100)
        while True:
            self.draw()
            try:
                key = self.screen.get_wch()
            except curses.error:
                continue
            row = self.current()
            if key in ("q", "\x1b"):
                return
            if key in (curses.KEY_DOWN, "j") and self.rows:
                self.index = min(self.index + 1, len(self.rows) - 1)
            elif key in (curses.KEY_UP, "k") and self.rows:
                self.index = max(self.index - 1, 0)
            elif key in ("\n", "\r", curses.KEY_ENTER) and row:
                if self.open(row):
                    return
            elif key in (curses.KEY_BACKSPACE, curses.KEY_DC, "\x7f", "\b") and row:
                self.delete(row)
            elif key == "n":
                self.new()
            elif key == "r":
                self.message = ""
                self.refresh()


def main(screen, start):
    curses.use_default_colors()
    for pair, colour in ((1, curses.COLOR_GREEN), (2, curses.COLOR_YELLOW), (3, curses.COLOR_RED)):
        curses.init_pair(pair, colour, -1)
    app = App(screen, start)
    try:
        app.loop()
    finally:
        app.pool.shutdown(wait=False, cancel_futures=True)
    return app.chosen


if __name__ == "__main__":
    os.environ.setdefault("ESCDELAY", "25")
    chosen = curses.wrapper(main, sys.argv[1] if len(sys.argv) > 1 else os.getcwd())
    # Outside Rex, hand the chosen path to the zsh `wt` function so it can cd there.
    if chosen and os.environ.get("WT_CHOICE_FILE"):
        Path(os.environ["WT_CHOICE_FILE"]).write_text(chosen)
    elif chosen:
        print(chosen)
