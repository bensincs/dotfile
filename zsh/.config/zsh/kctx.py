#!/usr/bin/env python3
"""kctx - switch kubectl contexts from a fast, filterable list.

Type to filter (exact and contiguous matches rank first), Up/Down to move, Enter to switch, Esc to clear the filter or
quit. Used by the Rex Ctrl+A, K popup and the `kctx` zsh command.
"""

import curses
import json
import os
import subprocess


def load():
    result = subprocess.run(
        ["kubectl", "config", "view", "-o", "json"], text=True, capture_output=True
    )
    if result.returncode != 0:
        return [], "", result.stderr.strip() or "kubectl config view failed"
    config = json.loads(result.stdout or "{}")
    contexts = [
        (item.get("name", ""), (item.get("context") or {}).get("namespace", ""))
        for item in config.get("contexts") or []
    ]
    return sorted(contexts), config.get("current-context", ""), ""


def rank(name, query):
    """Rank a match: exact name, then contiguous text, then characters in order
    (so 'c2qa' finds 'aks-cortex2-qa-...'). Returns None when it doesn't match."""
    name, query = name.lower(), query.lower()
    if not query or name == query:
        return 0
    if query in name:
        return 1
    position = 0
    for char in query:
        position = name.find(char, position)
        if position < 0:
            return None
        position += 1
    return 2


def main(screen):
    curses.use_default_colors()
    curses.init_pair(1, curses.COLOR_GREEN, -1)
    curses.curs_set(0)
    contexts, current, message = load()
    query, index = "", 0
    while True:
        ranked = [(rank(c[0], query), c) for c in contexts]
        shown = [c for score, c in sorted((r for r in ranked if r[0] is not None), key=lambda r: r[0])]
        index = max(0, min(index, len(shown) - 1))
        screen.erase()
        height, width = screen.getmaxyx()
        put = lambda y, x, text, attr=0: screen.addnstr(y, x, text, max(0, width - x - 1), attr)
        put(0, 1, "Kubernetes contexts", curses.A_BOLD)
        put(0, 21, "  current: " + (current or "none"), curses.A_DIM)
        put(1, 1, "› " + query, curses.A_BOLD)
        name_width = max([len(name) for name, _ in shown] + [10]) + 2
        visible = max(1, height - 5)
        top = max(0, min(index - visible // 2, len(shown) - visible))
        for offset, (name, namespace) in enumerate(shown[top:top + visible]):
            selected = top + offset == index
            marker = "*" if name == current else " "
            attr = curses.A_REVERSE if selected else 0
            if name == current:
                attr |= curses.color_pair(1)
            put(3 + offset, 1, f"{marker} {name:<{name_width}}{namespace}", attr)
        if not shown:
            put(3, 1, "No matching contexts." if contexts else "No contexts in kubeconfig.")
        put(height - 2, 1, "type to filter   enter switch   esc clear/quit", curses.A_DIM)
        if message:
            put(height - 1, 1, message, curses.A_BOLD)
        screen.refresh()

        try:
            key = screen.get_wch()
        except curses.error:
            # Interrupted, e.g. by a resize when the popup opens; just redraw.
            continue
        if key == curses.KEY_RESIZE:
            continue
        if key == "\x1b":
            if not query:
                return
            query, index = "", 0
        elif key in ("\n", "\r", curses.KEY_ENTER) and shown:
            name = shown[index][0]
            result = subprocess.run(
                ["kubectl", "config", "use-context", name], text=True, capture_output=True
            )
            if result.returncode == 0:
                return
            message = result.stderr.strip() or "kubectl config use-context failed"
        elif key == curses.KEY_DOWN:
            index += 1
        elif key == curses.KEY_UP:
            index -= 1
        elif key in (curses.KEY_BACKSPACE, "\x7f", "\b"):
            query, index = query[:-1], 0
        elif isinstance(key, str) and key.isprintable():
            query, index = query + key, 0


if __name__ == "__main__":
    os.environ.setdefault("ESCDELAY", "25")
    curses.wrapper(main)
