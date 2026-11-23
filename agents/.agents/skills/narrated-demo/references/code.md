# Code scenes

Code steps show real source files in VS Code, running in the browser from a private local server, and highlight the lines the narrator is talking about. The editor sits in a window whose title bar shows the project and file. Files open off camera, and so do jumps of more than about 40 lines; shorter moves glide on camera, then the lines highlight.

```js
export default {
  code: { root: '.' },   // the project whose files are shown; defaults to the working directory
  steps: [
    { say: 'The setup script checks for conflicts first.', code: 'bootstrap.sh:84-89' },
    { say: 'Only then does it create the links.', code: ':91' },          // same file, line 91
    { say: 'Here, the dry run.', code: { file: 'bootstrap.sh', lines: [84, 89], note: 'dry run first', zoom: true } },
    { say: 'And the whole file, from the top.', code: 'bootstrap.sh' },
  ],
};
```

## `code` on a step

| Form | Shows |
|---|---|
| `'path/file.ts'` | The file, no highlight |
| `'path/file.ts:40'` | Line 40 highlighted |
| `'path/file.ts:40-48'` | Lines 40–48 highlighted |
| `':52-60'` | Lines in the file shown last |
| `{ file, at: 80 }` | Scrolls to line 80 without highlighting anything |
| `{ file, lines: [40, 48], note, zoom, color, size }` | Highlighted lines, plus options |

- **`note`:** a chalk note in the editor's empty space beside the lines (on a dark panel when the lines are long). Yellow by default; `color` takes a board colour name. It clears at the next step.
- **`zoom: true`** (or `zoom: true` on the step): the camera eases in on the highlighted lines.
- **`annotate`** on a code step draws chalk items over the editor, aimed by selector or `[x, y]` in page pixels.
- **Paths** are relative to `code.root`. Every file and line range is checked before anything is recorded.
- **Code steps can't have `do`.** Code scenes are read-only: nothing is typed, saved or run.

## Spec options

```js
code: {
  root: '.',                       // project folder (absolute, or relative to the working directory)
  theme: 'Default Dark Modern',    // any built-in VS Code theme, e.g. 'Default Light Modern', 'Solarized Dark'
  fontSize: 22,                    // readable at 1080p in the default 1440 x 900 viewport
  cli: undefined,                  // path to the VS Code CLI if it isn't found automatically
  settings: {},                    // extra VS Code settings, e.g. { 'editor.fontFamily': 'JetBrains Mono' }
}
```

## The editor

- **Found automatically:** the VS Code CLI with `serve-web` (VS Code 1.89 or later), from the standard macOS app locations or PATH. Set `code.cli` or `NARRATED_DEMO_VSCODE` otherwise. If none is installed, ask before installing anything.
- **Private and disposable:** the server listens on 127.0.0.1 only, on a free port, with a throwaway profile. It stops when the render ends. Running it accepts Microsoft's VS Code Server licence terms.
- **First start downloads VS Code's web assets** (a minute or so), cached in `~/.cache/narrated-demo/vscode-cli`. Later starts take about 15 seconds, off camera.
- **Uncluttered:** no side bars, panels, status bar, minimap, AI chat, git or workspace-trust prompts. One tab with breadcrumbs. Selection is a soft teal.
- **Viewport:** the editor uses the spec's `viewport` (default 1440 × 900): about 26 lines of 95 characters at 22 px. Longer lines wrap, so nothing is hidden off the right edge (`settings: { 'editor.wordWrap': 'off' }` to turn that off).

## Writing code steps

- **Read the file first.** Explain what the code does, never what it might do. Don't invent behaviour or output.
- **One idea per step:** a function, a guard, a decision. Don't read lines aloud; say why they matter.
- **Short ranges:** 1–12 lines, so both ends fit with room for captions. Split longer explanations into several steps; the editor glides between them.
- **Stay in one file for a while.** Every file switch is a cut.
- **Show the effect after:** follow code with an app step that shows the behaviour, or a board step that shows the structure.
- **Don't show secrets:** environment files, keys, private paths, internal URLs.

## Review

- The right file is open and the highlighted lines are the ones the line talks about.
- The highlight and notes are clear of the captions at the bottom.
- Notes don't cover code; text is readable at 1080p.
- A still editor producing few frames is normal, not a stutter.
