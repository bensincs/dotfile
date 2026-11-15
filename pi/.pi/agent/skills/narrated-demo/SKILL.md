---
name: narrated-demo
description: Record narrated demo, tutorial and explainer videos that mix seven kinds of scene - web apps, source code in VS Code, terminal commands, Azure architecture diagrams with official icons, chalkboard sketches, big kinetic text and claymation stories. Scripts the story, voices it with Azure AI Speech, records or renders every scene, and produces a 1080p MP4 with captions, camera moves, name cards, title cards and transitions, then reviews it frame by frame. Deploys Azure Speech with Bicep on first use. Use when asked to record, narrate, voice over or caption a product demo, code walkthrough, architecture explainer, tutorial, animated or claymation video.
compatibility: macOS or Linux with Node.js 18+, ffmpeg, the Azure CLI, and Google Chrome or Playwright Chromium. Code scenes need VS Code 1.89+ (its CLI's serve-web). Clay scenes need WebGL.
---

# Narrated demo

Produce a narrated MP4 from a demo spec. Run commands from the working directory, which is the project being demoed: demo specs and videos live there. `scripts/…` below means this skill's own folder, so use its full path, e.g. `node <skill-dir>/scripts/narrate.mjs demos/<name>.demo.mjs`.

A video is a list of steps. Each step has a spoken line and shows one scene:

| Scene | Use it for | Step field | Reference |
|---|---|---|---|
| **Web app** | What the user sees and does: real clicks and typing in a browser | `do`, `annotate` | `references/web.md` |
| **Code** | How it's built: real files in VS Code, lines highlighted as they're explained | `code` | `references/code.md` |
| **Terminal** | What to run and what happens: commands typed, real or scripted output | `terminal` | `references/text-terminal.md` |
| **Diagram** | Systems: Azure architectures with official icons, built up, with packets flowing | `diagram` | `references/diagram.md` |
| **Chalkboard** | Informal structure: boxes, arrows and notes drawn stroke by stroke | `draw` | `references/chalkboard.md` |
| **Big text** | The hook, a number, a list, a quote, the takeaway | `text` | `references/text-terminal.md` |
| **Clay** | A story or analogy: plasticine characters carrying, pointing, cheering | `clay` | `references/clay.md` |

Mix them freely. Each scene keeps its own state between visits, and switching is an instant cut or a fade.

## 1. Make sure it's set up

```bash
node scripts/narrate.mjs --check
```

- **It passes:** go to step 2.
- **"No config":** run setup first. Ask the user for an Azure subscription if they haven't named one. Keep the default region, `swedencentral`, unless they need another; it's the only region with every voice tier (HD, MAI and Azure OpenAI voices).

  ```bash
  scripts/setup.sh --subscription <id or name> [--location swedencentral]
  ```

  Setup does the following:
  - Deploys `infra/main.bicep` into resource group `rg-narrated-demo`. This is an Azure AI Speech resource on the pay-as-you-go S0 tier, with Entra ID sign-in only (keys off) and the Speech User role for the signed-in identity.
  - Writes `~/.config/narrated-demo/config.json`.
  - Installs the runtime in `~/.cache/narrated-demo`: Playwright, rough.js and a chalk font for the board, three.js and a rounded font for clay, xterm.js and fonts for terminals and diagrams, and Microsoft's Azure architecture icons (permitted for diagrams, training and documentation).
  - Checks that speech works.
- **The user insists on the free tier (`--sku F0`):** it allows only one per subscription and may not include HD voices. If one already exists, setup lists it so you can adopt it with `--name` and `--resource-group`.
- **Setup fails on a token:** the user needs `az login --tenant <tenant>`.
- **`--check` returns 401 or 403 just after setup:** wait. Role assignments take a few minutes to apply, and the script already retries.
- **Only the runtime is missing or old** (for example "Missing three/package.json"): `scripts/setup.sh --runtime-only`.
- **Code scenes** also need VS Code installed (found automatically). Ask before installing it.

## 2. Plan the story and choose scenes

Read `references/spec.md` first: the spec format, timing, chapters and the "Story shape" section. Then read the reference for each scene you'll use. Look at `examples/` for complete specs of each scene and of all four together.

1. **Shape the story:** a hook, the idea (clay or chalkboard), one person doing one task (app or code), the result, and a takeaway.
2. **Gather the real material:**
   - App: confirm it's running and in the right starting state; walk the flow and pick stable selectors.
   - Code: read the files; note the exact lines for each point. Code scenes are read-only.
   - Diagram: list the resources, their groups (subscription, resource group, VNet, subnet) and connections; lay them on a grid, left to right. Find icons with `--icons`.
   - Terminal: decide which commands really run (read-only ones only) and which use scripted output.
   - Clay and chalkboard: sketch the layout on paper (positions, who moves where).
3. **Write the spec** next to the project's other demos (default `demos/<name>.demo.mjs`). If the working directory already has demo specs, read them first and follow their conventions. Keep it to about 6–14 steps and under 2 minutes, with `chapter`s at each change of scene. For a quick proof that recording works, 2–3 steps and 15–25 seconds.
4. **Choose extras** (all optional): title and end cards, `transition: 'fade'`, personas with name cards and their own voices, notes, camera targets, `pronounce` entries.
5. **Write narration that explains why** each step matters. 8–22 words a line.

## 3. Pick a voice

Check for a saved voice:

```bash
node scripts/narrate.mjs --voice          # prints the saved voice, or "not chosen"
```

- **A voice is saved:** use it. Don't ask again unless the user wants to change it.
- **No voice is saved:** ask the user whether they already know which voice they want.
  - **They name one:** save it. The command checks that the voice exists in their region:

    ```bash
    node scripts/narrate.mjs --set-voice en-US-Andrew:DragonHDLatestNeural
    ```

  - **They don't know, or want to hear options:** generate samples, then give them the path to play:

    ```bash
    node scripts/narrate.mjs --samples        # -> demos/voice-samples/, plus all-voices.mp3
    ```

    - Each file starts with the voice's name, and `all-voices.mp3` plays all of them in order.
    - In HD regions the samples are the most natural voices: Microsoft AI (`…:MAI-Voice-2.1`), Dragon HD (`…:DragonHDLatestNeural`) and Azure OpenAI HD (`…MultilingualNeuralHD`). Elsewhere it falls back to standard voices.
    - To compare two or three voices on a line from their own demo:

      ```bash
      node scripts/narrate.mjs --samples en-US-Ava:DragonHDLatestNeural,en-GB-Ada:DragonHDLatestNeural --text "A line from the demo."
      ```

    - Recommend one if they ask: Ava or Andrew (Dragon HD) for American English; Ada (Dragon HD) or Emily (MAI) for British English.
    - Then save their choice with `--set-voice`.

Recording refuses to start until a voice is saved. A spec's `voice` or `--voice <name>` overrides the saved voice for one demo only.

## 4. Preview, draft, review, then render the final

```bash
node scripts/narrate.mjs demos/<name>.demo.mjs --audio-only   # voice lines, print timings
node scripts/narrate.mjs demos/<name>.demo.mjs --stills       # clay and diagram steps: a still each, in seconds
node scripts/narrate.mjs --icons <words>                      # search the Azure icons for diagram nodes
node scripts/narrate.mjs demos/<name>.demo.mjs --draft        # quick 960 x 540 draft + review
node scripts/narrate.mjs demos/<name>.demo.mjs                # final 1080p + review
node scripts/narrate.mjs demos/<name>.demo.mjs --review [--draft]   # redo a review, no re-render
node scripts/narrate.mjs demos/<name>.demo.mjs --redo code           # re-record a chapter even if unchanged
```

Before recording anything, every render checks the spec: scenes, code files and line ranges, diagram nodes, icons, groups and flows, terminal commands, and clay things and actions. Mistakes fail fast with the step number.

Every render has three stages:
1. **Capture:** plays the steps in real time at double resolution. App, code, terminal, diagram, chalkboard and big text are browser pages, each with its own screencast; scene switches, file opening, real terminal commands and page loads happen off camera. Clay frames then render offline, on the same clock. It prints the capture rate and stutters per chapter.
2. **Compose:** renders every frame with the camera, window frame (app, code, terminal), full-screen scenes, captions, cards and fades, then mixes the voices. A final takes about 1.5–2× the video's length; a draft is about four times faster.
3. **Review:** writes `<name>[.draft].review/` alongside the video:
   - `sheet-*.png`: one frame late in each step, labelled with the step number, time, chapter, scene and line, and any flags.
   - `review.md`: each step's scene and length versus its line, plus flags:
     - silent stretches: action that outlasts its line by more than 2.5 s
     - stutters: frame gaps over 180 ms while something moves (pointer, typing, drawing, scrolling); still moments aren't counted
     - rushed clay moves: a walk or carry given much less time than it needs, so the character races
     - diagram layout problems: overlapping nodes, nodes crossing groups they aren't in, overlapping groups

Work in this order: (`--stills` for clay and diagrams) → draft → read the review → fix the spec → draft again → final.

**Use chapters for anything over a minute** (`chapter: 'name'` on the first step of each section; see "Chapters" in `references/spec.md`).
- **What gets redone:** each render records and composes only the chapters that changed. A code chapter re-records when its files change; a clay chapter when its clay steps (or earlier ones) change. Earlier app chapters replay quickly off camera to rebuild the app's state.
- **The plan:** every render starts by printing each chapter, its scenes, and `record`, `replay` or `cached`.
- **Forcing it:** `--redo <chapter>` re-records a chapter anyway, and `--fresh` ignores the cache.
- **App state:** if an app chapter will be recorded or replayed, make sure the app is in its starting state first.

**Keep the machine quiet while capturing.** Capture is real time. Other heavy apps (video calls, browsers with many tabs) starve the recording browser and show up as stutter in the review. Clay is immune: it renders offline.

- **Cache:** lines are cached in `~/.cache/narrated-demo/narration/`, so only changed or new lines are re-voiced.
- **Options:** `--draft`, `--voice <name>`, `--no-captions`, `--headed` (watch the run), `--out <dir>`, `--fps <n>` (default 30, or 15 for drafts), `--keep-raw` (keep captured frames), `--silent` (same timing, no voice; writes `<name>.silent.mp4`).
- **Outputs** land next to the spec, unless `--out` or the spec's `out` is set: `<name>.mp4` (H.264 and AAC, with a soft English subtitle track), `<name>.srt`, `<name>.review/`. Drafts add `.draft` to each name.
- **Debugging:** `NARRATED_DEMO_DEBUG=1` prints segment, motion and frame-gap timings per chapter, and full stack traces.

## 5. Act on the review before reporting

Open `review.md` and every contact sheet. For each step:
- **The screen matches the line.**
- **App:** the camera frames the action without cutting off what matters; notes point at the right things.
- **Code:** the right file and lines are highlighted, readable, clear of the captions; notes don't cover code.
- **Chalkboard:** nothing overlaps or runs off the board or under the captions.
- **Terminal:** the command is readable before its output starts; nothing secret on screen.
- **Diagram:** the parts the line names are visible and readable; no layout flags; focus shots keep notes in frame.
- **Big text:** fits, and isn't covered by the caption (use `caption: false` when the caption only repeats it).
- **Clay:** the characters and things the line names are in shot, not hidden behind others; walks end where they should. A rushed move needs a longer line, fewer actions, or things placed closer together.
- **Name cards and captions** don't cover the action.
- **Silent stretches:** lengthen the line to describe what's happening, split the step, or speed the action up (`d.type(..., { delay })`, fewer clicks, fewer clay actions).
- **Stutters:** an occasional one is normal. Many in one step means the browser was busy; re-render, or simplify what's on screen.
- **A step failing** (a missing selector, file or clay thing): the error names the step. Fix the spec and re-run.

When reporting, give:
- The MP4 path and its duration.
- The contact sheets.
- What was changed after the review, and anything the video couldn't show.

## Notes

- Recording state changes the app: a demo that creates data needs a fresh or reset environment to re-run.
- Code scenes are read-only: nothing is typed, saved or run in the project. The VS Code server is private (127.0.0.1, a free port, a throwaway profile), accepts Microsoft's VS Code Server licence terms, and stops when the render ends.
- Terminal `run` commands really execute on this machine whenever their chapter records. Only use them for read-only commands, or when the user asked; otherwise give scripted `output`.
- Make sure the run doesn't reveal secrets: real emails, tokens, environment files, private paths, or invite links that still work.
- Costs: a 60-second demo is about 1,000 characters, so even HD voices cost cents. Nothing runs while idle.
- Remove everything with `az group delete -n rg-narrated-demo --subscription <id>`, and delete `~/.cache/narrated-demo` for the runtime and caches.
- **Checking the skill itself** after changing it: from a scratch folder, render `examples/all-scenes.demo.mjs --draft --out .` (needs VS Code), `examples/azure-architecture.demo.mjs --draft --out .` and `examples/clay-story.demo.mjs --stills --out .`. All should finish with no flags.
