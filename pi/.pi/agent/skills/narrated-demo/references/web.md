# Web app scenes

App steps drive a real browser with Playwright: a pointer glides to each target, text types at a human pace, and the camera eases in on what matters. The app sits in a browser-style window with its address in the title bar.

## Before writing steps

1. Confirm the app is running and the starting state is right (data seeded or empty, signed in or not).
2. Walk the flow once yourself: read the page markup and pick stable selectors. Prefer ids, `name`, `href` and visible text.
3. If the working directory already has demo specs (usually `demos/*.demo.mjs`), read them first. They show the project's selectors, helpers and conventions.

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

`d` always drives the app, even while the video shows another scene: a `cut` during a clay scene can still prepare the app for later.

## Cut steps: creating everything through the UI

Build the demo's world through the product's own UI rather than a seed script, so the video shows the real flow. Do the slow or repetitive parts in `cut` steps:
- Other people accepting invites, each in `d.newPage()`.
- Waiting for long jobs to finish.
- Switching who is signed in.

Use `d.page` directly inside a cut (fill, click, goto). It isn't recorded, so it doesn't need the gliding helpers. Keep the spec's own helper functions (sign in, invite, accept) at the top of the file.

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
- **`backdrop: '#ffffffee'`** on a `note` or `text` puts a soft panel behind it, so it reads over busy screens.

## Review

- The camera frames the action and doesn't cut off what matters.
- Notes point at the right things; name cards and captions don't cover the action.
- Many stutters in one step mean the browser was busy: re-render, or simplify what's on screen.
