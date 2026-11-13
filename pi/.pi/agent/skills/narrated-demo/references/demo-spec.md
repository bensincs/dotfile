# Demo specs

A demo spec is an ES module whose default export describes one video. Everything except `steps` is optional.

```js
// demos/create-enterprise.demo.mjs
export default {
  name: 'create-enterprise',              // output file stem; defaults to the file name
  url: 'http://localhost:3000/auth/login', // first page; not needed if the video opens on the chalkboard
  out: undefined,                          // output folder; defaults to the spec's folder

  // Look
  viewport: { width: 1440, height: 900 },  // the app's size in CSS pixels; captured at 2x for sharpness
  colorScheme: 'light',                    // or 'dark'
  frame: { window: true, url: true, background: undefined, accent: '#00d2aa', padding: 64 },
  //   window: false puts the app full-bleed on the background; frame: false removes the frame entirely
  zoom: { scale: 1.6, hold: 2800, ease: 900 }, // camera follows typing and clicks; zoom: false turns it off
  transition: 'fade',                      // or 'none' (default); { type: 'fade', ms: 700 }
  captions: true,
  fps: 30,

  // Voice
  voice: undefined,                        // overrides the user's saved voice for this demo only
  rate: '0%',                              // SSML prosody rate, e.g. '-5%'
  pronounce: { G42: 'G forty-two' },       // how the voice should say words; captions keep the spelling

  // Cards
  intro: { title: 'Create an enterprise', subtitle: 'Assurance in 60 seconds', say: 'Optional opening line.' },
  outro: { title: 'Ready to go', subtitle: 'assurance.example', say: 'Optional closing line.' },

  // People
  personas: {
    layla: { name: 'Layla Mansour', role: 'G42 Owner', short: 'Layla', voice: 'en-GB-Ada:DragonHDLatestNeural', color: '#8fa8ff' },
  },
  cardMs: 4200,                            // how long a name card stays (at least the length of their line)

  board: { theme: 'graphite' },            // chalkboard steps: see references/chalkboard.md
  annotations: { colors: {} },             // colours for notes over the app

  async setup(d) {},                       // off camera before recording: sign in, seed, dismiss banners
  tail: 1200,                              // ms held on the last frame before the end card

  steps: [ /* see below */ ],
};
```

## Steps

```js
{ say: 'Super admins create enterprises from Administration.',
  async do(d) { await d.navigate('a[href="/admin"]'); } },          // narrated action

{ say: 'A line with no action holds on the screen.' },
{ async do(d) { await d.click('#copy'); } },                       // action with no line

{ persona: 'layla', say: 'Layla, who owns G42, signs in.', do: … },  // name card pops up
{ speaker: 'layla', say: 'I can see every organisation in G42.' },  // Layla speaks, in her voice

{ say: 'Only super admins see Administration.',
  annotate: [{ circle: 'a[href="/admin"]' }, { note: 'super admins only', at: 'a[href="/admin"]', side: 'right' }] },

{ say: 'Every project has its own team.', zoom: '#members' },        // camera moves to an element
{ say: 'Back to the whole page.', zoom: 'out' },
{ say: 'No camera move for this one.', zoom: false, do: … },

{ say: 'Explain it first.', draw: [{ box: 'API', id: 'api', at: [800, 400] }] }, // chalkboard

{ cut: true, async do(d) { /* off camera: invites accepted, scans finish, sign in as someone else */ } },
```

| Field | Does |
|---|---|
| `say` | The line spoken while the step runs |
| `do(d)` | Actions in the app (helpers below) |
| `persona` | Shows that person's name card when they first appear (again only after someone else appears) |
| `speaker` | That persona speaks the line in their own voice, named in the caption. Also shows their card. |
| `annotate` | Chalk-style notes drawn over the app after `do`. They aim at elements by CSS selector. They clear at the next step unless `keepNotes: true`. |
| `annotateMs` | How long the notes take to draw (default: 60% of the line) |
| `zoom` | A selector to move the camera to, `'out'` to ease back out, or `false` for no camera moves this step |
| `draw`, `erase`, `board` | Chalkboard (see `references/chalkboard.md`) |
| `chapter` | Starts a chapter (see below). Steps after it belong to it until the next `chapter`. |
| `cut` | Runs `do` off camera, mid-video, then carries on as if no time had passed. With `transition: 'fade'`, the jump shows as a soft dip. No `say`, `draw` or `annotate`. |
| `pause` | Extra ms after the step (default 450) |
| `rate` | Speaking rate for this line only |

## Timing

- Each step starts its line and its action together.
- The step ends when both have finished, then waits `pause` ms.
- So a line never gets cut off, and a slow action never overlaps the next line.
- To narrate a result, put the action in one step and the explanation in the next.

## Helpers (`d`)

All selectors match the first visible element.

| Helper | Does |
|---|---|
| `d.click(sel)` | Glides the pointer to the element and clicks. The camera eases in. |
| `d.type(sel, text, { delay })` | Clicks, then types at a human pace (65 ms a key). The camera eases in. |
| `d.navigate(sel)` | Clicks and waits for the next page. The camera eases back out. |
| `d.select(sel, value)` | Chooses an option in a native `<select>` |
| `d.moveTo(sel)` | Glides the pointer to an element, to draw attention |
| `d.zoomTo(sel)` / `d.zoomOut()` | Moves the camera directly |
| `d.annotate(items, ms)` / `d.clearNotes()` | Notes over the app, from code |
| `d.goto(url)` | Opens a URL (relative to `url`) |
| `d.press(key)` | Presses a key |
| `d.wait(ms)` | Waits |
| `d.url(path)` | An absolute URL on the demo's site |
| `d.newPage()` | A separate, unrecorded browser session, e.g. for another person accepting an invite. Close it with `page.context().close()`. |
| `d.page`, `d.context` | Raw Playwright objects for anything else |

## Code walkthroughs (VS Code)

Code is another browser scene, not a separate renderer. Use real VS Code in the
browser, backed by the local checkout. Native VS Code desktop capture is not
supported. Do not silently replace it with an editor-styled HTML mockup.

### Start a disposable local editor

Reuse an installed VS Code CLI with `serve-web` support. Check `serve-web --help`
first. On macOS, the bundled CLI is commonly one of:

- `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel`
- `/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-tunnel-insiders`

On Linux, look for `code`, `code-insiders` or `code-tunnel` on PATH. If none supports
`serve-web`, ask before installing anything. An existing `code-server` also works
as a browser editor, but its launch flags differ; check its help rather than
passing the flags below.

Set `VSCODE_CLI` to the discovered executable. From the project root:

```bash
repo="$PWD"
work="$(mktemp -d "${TMPDIR:-/tmp}/narrated-code.XXXXXX")"
"$VSCODE_CLI" --cli-data-dir "$work/cli" serve-web \
  --host 127.0.0.1 --port 8766 --without-connection-token \
  --accept-server-license-terms --disable-telemetry \
  --server-data-dir "$work/server" --default-folder "$repo" \
  > "$work/server.log" 2>&1 < /dev/null &
server_pid=$!
printf '%s\n' "$server_pid" > "$work/server.pid"
```

Starting the server may download web assets and requires accepting Microsoft's
server license. Use a free port; do not kill an existing listener. No token is
acceptable here only because the listener is loopback-only and short-lived.
Never bind this unauthenticated server to `0.0.0.0` or open a public tunnel.
The server/profile is disposable; do not reuse the user's normal editor profile.
An HTTP 202 can mean assets are still downloading: wait for `.monaco-workbench`,
not just the first successful HTTP response. Keep Restricted Mode for read-only
tours; workspace trust is not needed to read source.

Keep the PID and temporary directory. When recording finishes, stop only that
process (`kill "$server_pid"` in the same shell). Do not terminate other editors
or remove the user's normal VS Code settings.

### Use the bundled helpers

Import `scripts/lib/code.mjs` using the skill's resolved absolute path. It exports:

| Helper | Use |
|---|---|
| `prepareCode(d, { url?, file?, line? })` | Off-camera setup: optionally navigate, apply readable settings, enter Zen Mode and open a file. **Replaces settings in the disposable profile.** |
| `openCodeFile(d, file, line = 1)` | Open a repository-relative path using Quick Open, then go to a line. |
| `highlightCode(d, line, endLine = line)` | Select a short range through its line-number gutter, including wrapped lines. |

Use the capture browser's `d.page`, not a second desktop window or unrecorded page.
Helpers choose Command on macOS and Control on Linux. `prepareCode` uses clipboard
permissions already granted by the recorder. It clicks the actual Monaco editor
before pasting settings: focusing a hidden textarea can miss the editor or target
Chat, and `keyboard.insertText` can fail with Monaco's EditContext. Pasting also
avoids auto-indent and auto-closing braces corrupting a full JSON document.

Example for this repository's `bootstrap.sh`; read the current file and adapt the
line numbers before reusing it:

```js
import { prepareCode, highlightCode } from '/absolute/path/to/narrated-demo/scripts/lib/code.mjs';

const editorUrl = `http://127.0.0.1:8766/?${new URLSearchParams({ folder: process.cwd() })}`;
export default {
  name: 'bootstrap-code',
  url: editorUrl,
  viewport: { width: 1440, height: 810 },
  colorScheme: 'dark',
  frame: { window: true, url: false, padding: 24 },
  zoom: false,
  fps: 15,
  pronounce: { 'bootstrap.sh': 'bootstrap dot S H' },
  async setup(d) {
    await prepareCode(d, { file: 'bootstrap.sh', line: 87 });
  },
  steps: [
    { say: 'This setup script checks for conflicts before linking configuration.' },
    { say: 'Stow previews the complete package set. A conflict stops the script.',
      async do(d) { await highlightCode(d, 84, 89); } },
    { say: 'Only a successful preview reaches the real linking command.',
      async do(d) { await highlightCode(d, 91); } },
  ],
};
```

### Mix app, code and chalkboard sections

Keep the same spec, voice and browser context. Prepare the editor in `setup`,
then return to the app with `d.goto(appUrl)` before recording. Use off-camera
`cut` steps for switching, and normal narrated steps for line highlighting:

```js
// Inside steps, after an app chapter. editorUrl and appUrl are absolute URLs;
// import openCodeFile as well as prepareCode and highlightCode from code.mjs.
{ chapter: 'code', cut: true, async do(d) {
    await d.goto(editorUrl);
    await openCodeFile(d, 'src/handler.ts', 40);
} },
{ say: 'This guard rejects the request before any data is written.', zoom: false,
  async do(d) { await highlightCode(d, 40, 45); } },
{ chapter: 'result', cut: true, async do(d) { await d.goto(appUrl); } },
{ say: 'Back in the app, the rejected request leaves the data unchanged.' },
```

Always navigate explicitly with `d.goto` when leaving the chalkboard; Quick Open
cannot operate on the board page. Regular `draw` steps can explain an algorithm
before returning to code. Chapter caching and replay work as for other app scenes.
Source file contents are **not** fingerprinted by the renderer: after changing
source or external demo inputs, use `--redo code` (the relevant chapter name) or
`--fresh` to avoid showing cached, outdated code.

### Code-specific storytelling and review

- Explain one function, decision or data flow. Do not read every line aloud.
- Read actual source first. Never invent behavior or show fake terminal output.
- Default to reading, selecting and scrolling. Do not run scripts, install project
  dependencies, edit source, save source, or trust a workspace just for a tour.
  Editing/execution demonstrations need explicit permission and a disposable copy.
- Start around 22 px text with the minimap, Chat and sidebars hidden. Keep file tabs
  and line numbers. Disable automatic zoom for code steps so long lines stay in view.
- Use repository-relative paths to avoid ambiguous Quick Open matches. Confirm the
  intended tab and source are visible. Re-check line numbers after source changes.
- Keep highlights short (roughly 5–12 lines) so both ends fit in the viewport. Split
  longer explanations into separate steps; Monaco virtualizes off-screen lines.
- Reserve the bottom for captions; do not explain code hidden underneath them.
- For a smoke test, use 2–3 steps, 15–25 seconds and 15 fps. Render a draft, inspect
  its contact sheet, then render the final if requested. Reuse the saved voice.
- Review for readable text, matching highlights, uncut long lines and no private
  paths, account prompts, secrets, environment files or terminal history. A still
  editor producing few capture frames is normal, not itself a stutter.

## Chapters: change one part, re-render one part

Mark where each section starts with `chapter: 'name'` on its first step. Split at a change of scene or of person, typically every 3–6 steps:

```js
{ chapter: 'model', say: 'The enterprise sits at the top.', draw: [ … ] },   // chalkboard
…
{ chapter: 'admin', persona: 'admin', say: 'It starts with a platform admin.', async do(d) { … } },
…
{ chapter: 'sara', persona: 'sara', say: 'Sara decides what each person can do.', async do(d) { … } },
```

Each chapter's finished video is cached under a fingerprint of everything that shapes it:
- its steps, including the code of `do` functions
- its voiced lines
- the video's look settings
- the skill's own code
- for app chapters, every earlier app chapter's actions

A render then does only what changed:

| You change… | Re-recorded | Replayed off camera (fast) | Reused |
|---|---|---|---|
| A chalkboard chapter | that chapter, without the app | nothing | everything else |
| Narration, notes or camera in an app chapter | that chapter | earlier app chapters, to rebuild the app's state | later chapters |
| The actions (`do`, `cut`) of an app chapter | that chapter and every later app chapter | earlier app chapters | chalkboard chapters |
| Look settings or the skill itself | everything | | |

- **Replay** runs earlier app chapters' actions with no narration waits, instant typing and no drawing. That's typically a few seconds per chapter.
- **App state:** recording or replaying any app chapter needs the app in its starting state (a fresh server, for demos that create data). Chalkboard-only changes don't touch the app at all.
- **Joining:** segments are joined without re-encoding. With `transition: 'fade'` each join is a soft dip; without it, a cut.
- **Forcing it:**
  - `--redo <chapter,...>` re-records chapters even if unchanged, e.g. after fixing data in the app.
  - `--fresh` ignores the whole cache.
- **The cache** lives in `~/.cache/narrated-demo/chapters/<name>/`. Delete it to reclaim space.
- **A spec without chapters** is one chapter. Any change re-renders all of it.

## Cut steps: creating everything through the UI

Build the demo's world through the product's own UI rather than a seed script, so the video shows the real flow. Do the slow or repetitive parts in `cut` steps:
- Other people accepting invites, each in `d.newPage()`.
- Waiting for long jobs to finish.
- Switching who is signed in.

Use `d.page` directly inside a cut (fill, click, goto). It isn't recorded, so it doesn't need the gliding helpers. Keep the spec's own helper functions (sign in, invite, accept) at the top of the file.

Look in the working directory (usually `demos/`) for existing `*.demo.mjs` specs that build their data this way, and follow their pattern.

## The camera

- **Zooms in:** when typing, clicking or annotating, by up to `zoom.scale`. It never zooms so far that the target stops fitting comfortably.
- **Eases out:** on page changes, scene changes, `zoom: 'out'`, or after `zoom.hold` ms with nothing new.
- **Moves smoothly:** every move eases over `zoom.ease` ms. Clicks that navigate don't zoom.
- **Turning it off:** `zoom: false` on a step, or on the whole spec.

## Notes over the app

`annotate` uses the chalkboard items (`circle`, `underline`, `arrow`, `note`, `text`, `tick`, `cross`, `line`), with page elements as targets:

```js
annotate: [
  { circle: 'button.run' },                                    // ring an element
  { underline: 'h1' },
  { arrow: ['[data-severity=critical]', [1100, 300]] },         // element to point, or point to element
  { note: 'runs in the background', at: 'button.run', side: 'right' }, // side: right, left, above, below
  { tick: [900, 420] },
]
```

- **Colours suit light interfaces.** The default ink is dark, `accent` is teal, and notes default to amber. Override with `annotations.colors`; use `red` or `accent` on dark surfaces.
- **The camera frames** everything the notes point at.

## Personas

```js
personas: {
  daniel: { name: 'Daniel Okafor', role: 'Insight engineer', voice: 'en-US-Andrew:DragonHDLatestNeural' },
}
```

- **The name card** shows the initials, name and role at the bottom left. It slides in when the person first appears or takes over from someone else.
- **`speaker`** gives that person their own voice, if they have one. Otherwise they use the narrator's voice.
- **Their caption** starts with their `short` name, or with their full name if there's no `short`.
- **Narrator or speaker:** most videos work best with a narrator describing people (`persona`). Let people speak (`speaker`) for a line or two of first-person colour.

## Story shape

The best demos follow one person doing one task, with the "why" before the "how":

1. **Hook (one line):** the problem or the outcome. "Every repository in G42, scanned for vulnerabilities."
2. **Context (chalkboard, optional, 20–40 s):** the mental model the viewer needs, drawn as it's said. Erase before the product.
3. **The person (name card):** who's doing this and why it matters to them.
4. **The task (app, 30–90 s):**
   - One path, no detours.
   - Narrate the why. The screen shows the how.
   - Use notes or the camera for the one thing per screen that matters.
5. **The result:** show the outcome on screen and say what it means.
6. **Takeaway (end card):** one sentence the viewer should remember.

Rules of thumb:
- **Under 2 minutes**, 6–14 steps.
- **One idea per step, 8–22 words a line.** That's about 2.5 words a second.
- **Present tense and plain words.** Use the names visible on screen.
- **Cut setup:** sign-ins and seeding go in `setup`, or in steps so short they need no narration.
- **Spelling and voice:** match the product's spelling, choose a voice to suit, and add `pronounce` entries for names and codes the voice gets wrong.
- **Don't reveal secrets:** real emails, tokens, or invite links that still work in a shared environment.

## Voices

- **Defaults:** the user's saved voice (`narrate.mjs --voice`), unless a spec or step says otherwise. See SKILL.md for choosing one.
- **Persona voices:** pick a voice that's clearly different from the narrator's, e.g. a female narrator with a male speaker, or a British narrator with an American speaker.
