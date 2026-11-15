# Demo specs

A demo spec is an ES module whose default export describes one video. Everything except `steps` is optional. A video is a sequence of steps; each step shows one **scene**:

| Scene | Shows | A step is in it when it has | Reference |
|---|---|---|---|
| `app` | A web app in a browser window, with a visible pointer | `do`, `annotate` or `zoom: 'selector'` | `web.md` |
| `code` | Real source files in VS Code, with lines highlighted | `code` | `code.md` |
| `terminal` | Commands typed into a terminal, with scripted or real output | `terminal` | `text-terminal.md` |
| `diagram` | A clean architecture diagram with Azure icons that builds up | `diagram` | `diagram.md` |
| `board` | A chalkboard that draws itself as the narrator speaks | `draw`, `erase` or `board: true` | `chalkboard.md` |
| `text` | Big kinetic text: a headline, number, list, quote or stats | `text` | `text-terminal.md` |
| `clay` | A claymation miniature set with characters that act | `clay` | `clay.md` |

A step with only `say` (or a persona) **holds on the scene before it**. `scene: '…'` forces one. A step can't mix scenes: give each its own step. Switching scenes is an instant cut (a soft dip with `transition: 'fade'`), and each scene keeps its own state: the app stays where it was while the video visits the board, the editor or the clay set.

```js
// demos/stow.demo.mjs
export default {
  name: 'stow',                            // output file stem; defaults to the file name
  url: 'http://localhost:3000/',           // the app's first page; only needed for app scenes
  out: undefined,                          // output folder; defaults to the spec's folder

  // Look
  viewport: { width: 1440, height: 900 },  // app and editor size in CSS pixels; captured at 2x for sharpness
  colorScheme: 'light',                    // the app's; the editor is always dark
  frame: { window: true, url: true, background: undefined, accent: '#00d2aa', padding: 64 },
  //   window: false puts the app full-bleed on the background; frame: false removes the frame entirely
  zoom: { scale: 1.6, hold: 2800, ease: 900 }, // the app camera follows typing and clicks; zoom: false turns it off
  transition: 'fade',                      // or 'none' (default); { type: 'fade', ms: 700 }
  captions: true,
  fps: 30,

  // Voice
  voice: undefined,                        // overrides the user's saved voice for this demo only
  rate: '0%',                              // SSML prosody rate, e.g. '-5%'
  pronounce: { G42: 'G forty-two' },       // how the voice should say words; captions keep the spelling

  // Cards
  intro: { title: 'Linking dotfiles', subtitle: 'In 60 seconds', say: 'Optional opening line.' },
  outro: { title: 'That is Stow', subtitle: 'github.com/…', say: 'Optional closing line.' },

  // People
  personas: {
    layla: { name: 'Layla Mansour', role: 'Platform owner', short: 'Layla', voice: 'en-GB-Ada:DragonHDLatestNeural', color: '#8fa8ff' },
  },
  cardMs: 4200,                            // how long a name card stays (at least the length of their line)

  // Scenes
  code: { root: '.' },                     // code scenes: see code.md
  terminal: { cwd: '.' },                  // terminal scenes: see text-terminal.md
  diagram: { nodes: {}, groups: {}, edges: [] }, // diagram scenes: see diagram.md
  board: { theme: 'graphite' },            // chalkboard scenes: see chalkboard.md
  text: { theme: 'dark' },                 // big text scenes: see text-terminal.md
  clay: { set: 'meadow', things: [] },     // clay scenes: see clay.md
  annotations: { colors: {} },             // colours for notes over the app

  async setup(d) {},                       // off camera before recording: sign in, seed, dismiss banners
  tail: 1200,                              // ms held on the last frame before the end card

  steps: [ /* see below */ ],
};
```

## Steps

```js
{ say: 'Every package is a folder.', clay: [{ walk: 'pip', to: 'home' }] },       // clay
{ say: 'Stow links each one into your home folder.', draw: [{ box: 'zsh', at: [500, 400] }] }, // board
{ say: 'This check runs first.', code: 'bootstrap.sh:84-89' },                      // code
{ say: 'Run it.', terminal: { cmd: './bootstrap.sh', output: '✔ done' } },           // terminal
{ say: 'Requests enter through Front Door.', diagram: ['users', 'fd', 'users->fd'] }, // diagram
{ say: 'One command, every tool.', text: 'One command. *Every* tool.' },             // big text
{ say: 'Sign in as an admin.', async do(d) { await d.click('#sign-in'); } },        // app
{ say: 'A line with no action holds on the current scene.' },
{ persona: 'layla', say: 'Layla owns the platform.', do: … },                       // name card pops up
{ speaker: 'layla', say: 'I can see every team.' },                                 // Layla speaks, in her voice
{ cut: true, async do(d) { /* off camera: data loads, someone else signs in */ } },
```

| Field | Does |
|---|---|
| `say` | The line spoken while the step runs |
| `do(d)` | Actions in the app (see `web.md`). Not allowed on code or clay steps. |
| `code` | Shows a file and highlights lines (see `code.md`) |
| `draw`, `erase`, `board` | Chalkboard (see `chalkboard.md`) |
| `clay`, `camera` | Claymation actions and the clay camera (see `clay.md`) |
| `diagram` | Shows, flows, focuses, marks or notes parts of the diagram (see `diagram.md`) |
| `text`, `terminal` | Big text, or commands in a terminal (see `text-terminal.md`) |
| `caption: false` | Hides this line's caption on screen (it stays in the subtitle file): for big text that already shows the words |
| `annotate` | Chalk notes over the app or the editor, aimed at elements by CSS selector. They clear at the next step unless `keepNotes: true`. |
| `annotateMs` | How long the notes take to draw (default: 60% of the line) |
| `zoom` | App: a selector to move the camera to, `'out'` to ease back out, or `false` for no camera moves this step. Code: `true` to zoom on the highlighted lines. |
| `scene` | Forces a scene for a step that would otherwise hold on the last one |
| `persona` | Shows that person's name card when they first appear (again only after someone else appears) |
| `speaker` | That persona speaks the line in their own voice, named in the caption. Also shows their card. |
| `chapter` | Starts a chapter (see below). Steps after it belong to it until the next `chapter`. |
| `cut` | Runs `do` off camera, mid-video, then carries on as if no time had passed. No `say`, `draw` or `annotate`. |
| `ms` | Length of a step with no line (board drawing, clay acting) |
| `pause` | Extra ms after the step (default 450) |
| `rate` | Speaking rate for this line only |

## Timing

- Each step starts its line and its action together.
- The step ends when both have finished, then waits `pause` ms.
- So a line never gets cut off, and a slow action never overlaps the next line.
- Chalkboard drawing, diagram building, big text, terminal typing, clay acting and code notes **share the line's time**: they finish as the sentence does. Steps without a line use `ms`.
- To narrate a result, put the action in one step and the explanation in the next.

## Chapters: change one part, re-render one part

Mark where each section starts with `chapter: 'name'` on its first step. Split at a change of scene or of person, typically every 3–6 steps:

```js
{ chapter: 'story', say: 'Meet Pip.', clay: [{ wave: 'pip' }] },
…
{ chapter: 'code', say: 'Here is the check.', code: 'bootstrap.sh:84-89' },
…
{ chapter: 'admin', persona: 'admin', say: 'It starts with a platform admin.', async do(d) { … } },
```

Each chapter's finished video is cached under a fingerprint of everything that shapes it:
- its steps, including the code of `do` functions
- its voiced lines
- the video's look settings
- the skill's own code
- code chapters: the contents of the files they show
- clay and diagram chapters: their set or diagram, and every clay or diagram step before them (both carry on from step to step)
- app chapters: every earlier app chapter's actions

A render then does only what changed:

| You change… | Re-recorded | Replayed off camera (fast) | Reused |
|---|---|---|---|
| A chalkboard, code or clay chapter | that chapter, without the app | nothing | everything else |
| A file a code chapter shows | that chapter | nothing | everything else |
| A clay or diagram step | that chapter and later clay or diagram chapters | nothing | the rest |
| A terminal `run` command's real output | nothing, until you `--redo` the chapter | nothing | everything |
| Narration, notes or camera in an app chapter | that chapter | earlier app chapters, to rebuild the app's state | later chapters |
| The actions (`do`, `cut`) of an app chapter | that chapter and every later app chapter | earlier app chapters | other chapters |
| Look settings or the skill itself | everything | | |

- **Replay** runs earlier app chapters' actions with no narration waits, instant typing and no drawing. That's typically a few seconds per chapter.
- **App state:** recording or replaying any app chapter needs the app in its starting state (a fresh server, for demos that create data). Other scenes don't touch the app.
- **Joining:** segments are joined without re-encoding. With `transition: 'fade'` each join is a soft dip; without it, a cut.
- **Forcing it:** `--redo <chapter,...>` re-records chapters even if unchanged; `--fresh` ignores the whole cache.
- **The cache** lives in `~/.cache/narrated-demo/chapters/<name>/`. Delete it to reclaim space.
- **A spec without chapters** is one chapter. Any change re-renders all of it.

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
- **In clay scenes,** a persona can be a clay character too: give the character and the persona the same name in the narration, and use `bubble` for a line of speech on screen.

## Story shape

The best videos follow one person doing one task, with the "why" before the "how":

1. **Hook (one line):** the problem or the outcome. "Every repository, scanned for vulnerabilities."
2. **The idea (optional, 15–40 s):** the mental model, as a clay story (people and things, warm), an architecture diagram (precise systems) or a chalkboard sketch (informal structure). Pick one per idea.
3. **The person (name card):** who's doing this and why it matters to them.
4. **The task (app or code, 30–90 s):**
   - One path, no detours.
   - Narrate the why. The screen shows the how.
   - Use notes, highlights or the camera for the one thing per screen that matters.
5. **The result:** show the outcome on screen and say what it means.
6. **Takeaway (end card):** one sentence the viewer should remember.

Choosing scenes:
- **Clay** for a story or analogy: who does what, things moving between places, before and after. Friendly, memorable, no detail.
- **Diagram** for systems: Azure architectures, request paths, network boundaries. Precise and branded.
- **Chalkboard** for informal structure: quick boxes and arrows, comparisons, notes.
- **Big text** for the hook, a key number, a list, a quote, the takeaway. A few times a video at most.
- **Code** for how something is built: one function or decision at a time.
- **Terminal** for what to run, and what happens when you do.
- **App** for what the user sees and does.

Rules of thumb:
- **Under 2 minutes**, 6–14 steps. A quick test: 2–3 steps, 15–25 seconds.
- **One idea per step, 8–22 words a line.** That's about 2.5 words a second.
- **Present tense and plain words.** Use the names visible on screen.
- **Cut setup:** sign-ins and seeding go in `setup`, or in `cut` steps.
- **Spelling and voice:** match the product's spelling, choose a voice to suit, and add `pronounce` entries for names and codes the voice gets wrong.
- **Don't reveal secrets:** real emails, tokens, private paths, or invite links that still work.

## Voices

- **Defaults:** the user's saved voice (`narrate.mjs --voice`), unless a spec or step says otherwise. See SKILL.md for choosing one.
- **Persona voices:** pick a voice that's clearly different from the narrator's, e.g. a female narrator with a male speaker, or a British narrator with an American speaker.
