# Chalkboard scenes

A chalkboard explains an idea before, or instead of, showing a product: structures, flows, architectures, before/after comparisons. It draws itself stroke by stroke while the narrator speaks, with a piece of chalk following each line.

## Where it fits

- Any step with `draw`, `erase` or `board: true` happens on the board. A following step with only `say` holds on the board.
- **Board, then product:** start with board steps, then app steps. The app opens at the spec's `url` the first time the video shows it, and keeps its state while the video visits the board.
- **Board-only video:** leave out `url`.
- **Back to the board later:** another `draw` step returns to it. The board starts empty at each chapter and whenever the video comes back to it.
- **Board or clay?** The board is for precise structure (boxes, arrows, numbers). For a story with characters and things moving between places, use a clay scene (`clay.md`).

```js
export default {
  name: 'how-it-works',
  board: { theme: 'graphite' },          // optional; see Themes
  url: 'http://localhost:3000/auth/login', // only needed once the video shows the app
  steps: [
    { say: 'Three services handle every request.', draw: [
      { title: 'Request flow' },
      { box: 'Gateway', id: 'gw', at: [300, 400] },
      { arrow: ['gw', 'api'] },
      { box: 'API', id: 'api', at: [800, 400] },
    ] },
    { say: 'Now let us see it running.' },  // holds on the board
    { say: 'Sign in as an admin.', async do(d) { await d.type('#email', 'admin@example.com'); } },
  ],
};
```

## Timing

- **Items in a step** draw in order and share the spoken line's time. Longer items get more of it.
- **A step with no `say`** draws over `ms` (default 1.2 seconds an item).
- **Pace:** keep 1–4 items in a step. One clear idea, one sentence and a few strokes.
- **`erase: true`** wipes the board (default 0.9 s, `eraseMs` to change), then runs that step's `draw` on the clean board.

## The grid

- The board is **1600 × 900**: x runs left to right, y top to bottom, and `[800, 450]` is the centre.
- Captions sit over the bottom ~90 units, so keep important content above **y = 800**.
- Leave about 70 units between stacked boxes for an arrow, plus 46 more if the lower box has a `label`.
- Useful rows for a three-level tree: y = 230, 440, 650. Columns for two items: x = 500 and 1100; for three: 400, 800, 1200.

## Items

Every item can take `color` (a theme colour name or any CSS colour). `id` lets later items point at it.

| Item | Example | Notes |
|---|---|---|
| `title` | `{ title: 'Request flow' }` | Large heading at the top centre, underlined in the accent colour. `at` to move it. |
| `box` | `{ box: 'API', id: 'api', at: [800, 400], label: 'Service' }` | Rough rectangle around text that sizes itself. `label` is small text above the box. `shape: 'ellipse'`, `w`, `h`, `size` (font, default 46). |
| `text` | `{ text: 'p95 120ms', at: [800, 520], size: 32, align: 'left' }` | Hand-written text. `align` is `left`, `center` (default) or `right`. `rotate` in degrees. |
| `note` | `{ note: 'Owner: Layla', at: [1100, 230] }` | Smaller, slightly tilted annotation, yellow by default. |
| `arrow` | `{ arrow: ['gw', 'api'] }` or `{ arrow: [[100, 200], [300, 200]] }` | Between ids (stops at their edges and above labels) or points. `curve: 80` bends it. |
| `line` | `{ line: [[170, 200], [170, 700]], dashed: true }` | Straight rough line. |
| `circle` | `{ circle: 'api' }` or `{ circle: [800, 450, 60] }` | Rings an item to highlight it (accent colour by default), or draws a circle at `[cx, cy, r]`. |
| `underline` | `{ underline: 'api' }` | Underlines an item. |
| `tick` / `cross` | `{ tick: [1000, 400] }`, `{ cross: [800, 650] }` | Yes/no marks: accent tick, red cross. `size`. |

## Themes

```js
board: { theme: 'graphite' }   // default: dark graphite, white chalk, teal accent
board: { theme: 'green' }      // classic green board, wooden frame, yellow accent
board: { theme: 'graphite', colors: { accent: '#7aa2ff' }, board: '#18181b', boardEdge: '#0f0f12', frame: '#09090b' }
board: { theme: 'graphite', chalk: true }   // show a piece of chalk following each stroke
```

- **The chalk piece is off by default.** Strokes and lettering appear on their own, which reads as cleaner.
- **`chalk: true`** shows a stick of chalk riding each stroke. Some audiences like it, but it can look artificial up close.

- **Colour names:** `white` (default ink), `muted`, `accent`, `yellow`, `red`, `orange`, `blue`, `green`, `pink`.
- **Matching a brand:** override `accent` with the product's colour so the board and the app feel related.

## Writing for the board

- **Draw what you say, as you say it.** If the line names three things, draw three things.
- **Build up one diagram** over several steps rather than drawing a crowded board at once. Erase when the topic changes.
- **Short labels:** 1–3 words in boxes, a short phrase in notes. The narration carries the detail.
- **Highlight the takeaway last** with `circle`, `underline`, `tick` or `cross`.
- **Preview the look without the voice:** `--silent` renders with the same timing but no audio, writing `<name>.silent.mp4`.
- **Check frames:** before reporting, look at a frame after each step's drawing finishes. Look for overlaps, text running off the board, and captions covering content.
