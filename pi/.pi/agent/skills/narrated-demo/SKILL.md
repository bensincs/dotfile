---
name: narrated-demo
description: Record polished narrated demo, walkthrough and explainer videos of web apps. Writes a step-by-step script, voices it with Azure AI Speech (narrator plus optional speaking personas), records the app with a camera that follows the action, draws animated chalkboard diagrams and chalk notes over the UI, and produces a 1080p MP4 with window frame, captions, name cards, title cards and transitions. Deploys the Azure Speech resource with Bicep on first use. Use when asked to record, narrate, voice over or caption a product demo, walkthrough, tutorial or explainer video.
compatibility: macOS or Linux with Node.js 18+, ffmpeg, the Azure CLI, and Google Chrome or Playwright Chromium.
---

# Narrated demo

Produce a narrated MP4 from a demo spec. Run commands from the working directory, which is the project being demoed: demo specs and videos live there. `scripts/…` below means this skill's own folder, so use its full path, e.g. `node <skill-dir>/scripts/narrate.mjs demos/<name>.demo.mjs`.

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
  - Installs Playwright in `~/.cache/narrated-demo`.
  - Checks that speech works.
- **The user insists on the free tier (`--sku F0`):** it allows only one per subscription and may not include HD voices. If one already exists, setup lists it so you can adopt it with `--name` and `--resource-group`.
- **Setup fails on a token:** the user needs `az login --tenant <tenant>`.
- **`--check` returns 401 or 403 just after setup:** wait. Role assignments take a few minutes to apply, and the script already retries.
- **Only Playwright is missing:** `scripts/setup.sh --runtime-only`.

## 2. Write the demo spec

Read `references/demo-spec.md`. If the video should explain a concept before or instead of showing the product, also read `references/chalkboard.md`: chalkboard steps draw diagrams stroke by stroke as the narrator speaks. Then:
1. Confirm the app is running and the starting state is right (data seeded or empty, signed in or not).
2. Walk the flow once yourself: read the page markup and pick stable selectors. Prefer ids, `name`, `href` and visible text.
3. Shape the story with the "Story shape" section of the reference: a hook, an optional chalkboard explanation, one person doing one task, the result, and a takeaway.
4. Write the spec next to the project's other demos (default `demos/<name>.demo.mjs`). Keep it to one task, about 6–14 steps and under 2 minutes.
5. Choose what's worth adding; every feature is optional:
   - Title and end cards (`intro`, `outro`).
   - `transition: 'fade'`.
   - Personas with name cards, and with their own voice if they speak.
   - Chalk notes over the app (`annotate`).
   - Camera targets (`zoom`).
   - `pronounce` entries for names the voice may misread.
6. Write narration that explains why each step matters.

If the working directory already has demo specs (usually `demos/*.demo.mjs`), read them first. They show the project's selectors, helpers and conventions, and make good models.

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
    - If they want two or three voices compared on a line from their own demo:

      ```bash
      node scripts/narrate.mjs --samples en-US-Ava:DragonHDLatestNeural,en-GB-Ada:DragonHDLatestNeural --text "A line from the demo."
      ```

    - Recommend one if they ask:
      - Ava or Andrew (Dragon HD) for American English.
      - Ada (Dragon HD) or Emily (MAI) for British English.
    - Then save their choice with `--set-voice`.

Recording refuses to start until a voice is saved. A spec's `voice` or `--voice <name>` overrides the saved voice for one demo only.

## 4. Voice it, draft it, review it, then render the final

```bash
node scripts/narrate.mjs demos/<name>.demo.mjs --audio-only   # voice lines, print timings
node scripts/narrate.mjs demos/<name>.demo.mjs --draft        # quick 960 x 540 draft + review
node scripts/narrate.mjs demos/<name>.demo.mjs                # final 1080p + review
node scripts/narrate.mjs demos/<name>.demo.mjs --review [--draft]   # redo a review, no re-render
node scripts/narrate.mjs demos/<name>.demo.mjs --redo sara           # re-record a chapter even if unchanged
```

Every render has three stages:
1. **Capture:** replays the steps in a real browser at double resolution, in real time. It prints the capture rate and stutters.
2. **Compose:** renders every frame with the camera, window frame, board, captions, cards and fades, then mixes the voices. A final takes about 1.5–2× the video's length; a draft is about four times faster.
3. **Review:** writes `<name>[.draft].review/` alongside the video:
   - `sheet-*.png`: one frame late in each step, labelled with the step number, time and line, and any flags.
   - `review.md`: each step's length versus its line, plus flags:
     - silent stretches: action that outlasts its line by more than 2.5 s
     - stutters: frame gaps over 180 ms while something moves (pointer, typing, drawing); still moments aren't counted

Work in this order: draft → read the review → fix the spec → draft again → final.

**Use chapters for anything over a minute** (`chapter: 'name'` on the first step of each section; see "Chapters" in the reference).
- **What gets redone:** each render records and composes only the chapters that changed. Earlier app chapters replay quickly off camera to rebuild the app's state, and everything else is reused. A chalkboard fix takes about as long as that chapter, not the whole video.
- **The plan:** every render starts by printing each chapter as `record`, `replay` or `cached`.
- **Forcing it:** `--redo <chapter>` re-records a chapter anyway, and `--fresh` ignores the cache.
- **App state:** if an app chapter will be recorded or replayed, make sure the app is in its starting state first.

**Keep the machine quiet while capturing.** Capture is real time. Other heavy apps (video calls, browsers with many tabs) starve the recording browser and show up as stutter in the review.

- **Cache:** lines are cached in `~/.cache/narrated-demo/narration/`, so only changed or new lines are re-voiced. Re-recording after a selector or layout fix costs no speech calls.
- **Options:**
  - `--draft`
  - `--voice <name>`
  - `--no-captions`
  - `--headed`, to watch the run
  - `--out <dir>`
  - `--fps <n>`: output frame rate (default 30, or 15 for drafts)
  - `--keep-raw`, to keep the captured frames
  - `--silent`, the same timing with no voice track (writes `<name>.silent.mp4`)
- **Outputs** land next to the spec, unless `--out` or the spec's `out` is set:
  - `<name>.mp4`: H.264 and AAC, with a soft English subtitle track.
  - `<name>.srt`
  - `<name>.review/`
  - Drafts add `.draft` to each name.

## 5. Act on the review before reporting

Open `review.md` and every contact sheet. For each step:
- **The screen matches the line.** The camera frames the action without cutting off what matters, notes point at the right things, and name cards and captions don't cover the action.
- **On the chalkboard,** nothing overlaps and nothing runs off the board or under the captions.
- **Silent stretches:** lengthen the line to describe what's happening, split the step, or speed the action up (`d.type(..., { delay })`, fewer clicks).
- **Stutters:** an occasional one is normal. Many in one step means the browser was busy; re-render, or simplify what's on screen.
- **A step failing** (a missing selector or an unexpected page): fix the spec and re-run.

When reporting, give:
- The MP4 path and its duration.
- The contact sheets.
- What was changed after the review, and anything the demo couldn't show.

## Notes

- Recording state changes the app: a demo that creates data needs a fresh or reset environment to re-run.
- Make sure the run doesn't reveal secrets: real emails, tokens, or invite links that still work in a shared environment.
- Costs: a 60-second demo is about 1,000 characters, so even HD voices cost cents. Nothing runs while idle.
- Remove everything with `az group delete -n rg-narrated-demo --subscription <id>`.
