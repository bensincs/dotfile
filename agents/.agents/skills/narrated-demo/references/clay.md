# Claymation scenes

Clay scenes tell a story on a miniature plasticine set: characters walk, carry things, gesture and talk in speech bubbles while the narrator explains. Everything looks hand-moulded and lit like a miniature film set: soft fingerprinted plasticine, big soft shadows, ambient occlusion where things touch, a cool rim light, a gentle depth of field and a filmic finish. It moves like modern studio stop motion, with a subtle hand-touched shimmer. Frames render offline with three.js, so clay never stutters however busy the machine is.

Use clay for **stories and analogies**: who does what, things travelling between places, before and after. Use the chalkboard for precise structure, and code or app scenes for the real thing.

```js
export default {
  clay: {
    set: 'meadow',                                   // meadow, night or studio
    things: [
      { robot: 'pip', at: [-1.2, 1.0] },
      { block: 'nvim', at: [-3.0, 0.9], color: 'green' },
      { block: 'git', on: 'nvim', color: 'coral' },  // stacked on nvim
      { house: 'home', at: [2.6, -0.4], sign: '~/' },
    ],
  },
  steps: [
    { say: 'Meet Pip, who looks after my settings.', clay: [{ wave: 'pip' }], camera: 'pip' },
    { say: 'Pip carries each tool home.', clay: [{ carry: 'git', by: 'pip', to: [1.2, 1.0] }, { carry: 'nvim', by: 'pip', to: 'git' }], camera: 'wide' },
    { say: 'And the lights come on.', clay: [{ glow: 'home' }, { smoke: 'home', with: true }, { cheer: 'pip', with: true }] },
    { say: 'Home sweet home.', clay: [{ bubble: 'pip', text: 'Home sweet ~/' }, { hop: 'pip' }], camera: ['pip', 'home'] },
  ],
};
```

## How it plays

- **One world:** `spec.clay` sets the stage once. Every clay step continues from where the last left off, even with app, code or board scenes in between.
- **Actions share the line's time,** like chalkboard items: a step's actions run one after another and finish as the sentence does. Longer actions (a long walk) get more of it. A step with no `say` takes `ms` (default about 1.2 s an action).
- **`with: true`** runs an action at the same time as the one before it.
- **A new stage:** `clay: { stage: { set, things }, do: [ … ], camera }` replaces the world from that step on (a new place, a new cast). Without `stage`, `clay` is just the list of actions.

## The set

The floor is a plane seen from the front. `at: [x, z]`: x runs left (−) to right (+), z from the back (−) to the front (+), in metres-ish. A character is about 1.9 tall.

- **Layout that frames well:** keep the action within x −4…4 and z −2…2. Leave 1.5–2 between things that characters walk between. Put the story's destination on the right, the start on the left.
- **Sets:**

| `set` | Look |
|---|---|
| `meadow` (default) | A painted sky, rolling clay hills, grass tufts, trees and flowers, a clay sun and clouds |
| `night` | The meadow at night: moon, stars, cool light. Glowing windows and screens shine. |
| `studio` | A seamless coloured backdrop, nothing else: for clean explainers in clay |

  `set: { name: 'studio', color: '#cfe6ff' }` changes the backdrop; `ground` and `sky` override colours; `decor: false` removes the meadow's trees and flowers.

## Things

Every thing has an id: `{ robot: 'pip' }` is a robot called pip. The id doubles as the label on blocks, servers and signs unless you give `label`. Common options: `at: [x, z]`, `on: 'id'` (stacked on top), `face: 'camera' | 'left' | 'right' | 'back' | 'id' | degrees`, `color`, `hidden: true` (for `appear` later).

| Kind | Looks like | Options |
|---|---|---|
| `robot` | A friendly robot with a visor face, glowing eyes and an antenna that lights up | `color`, `accent` |
| `person` | A clay person with expressive eyes and brows | `shirt`, `pants`, `shoes`, `skin`, `hair`, `hairStyle: 'short' | 'bun' | 'long' | 'curly'` |
| `block` | A labelled cube: a tool, a package, a file | `label`, `color`, `text` (ink), `size` (0.5) |
| `parcel` | A wrapped box with a ribbon and a tag | `label`, `color`, `ribbon` |
| `house` | A cottage with windows that light up and a chimney | `sign` (text on a post beside it), `color`, `roof`, `door` |
| `server` | A server tower with blinking lights | `label`, `color` |
| `laptop` | An open laptop with text on screen | `screen` (text, `\n` for lines), `color` |
| `cloud` | A floating cloud, e.g. a cloud service | `label`, `height` (2.6), `color` |
| `sign` | A wooden sign on a post | `text` |
| `banner` | A wide banner on two poles: a title in the set | `text`, `color`, `ink` |
| `tree`, `rock`, `flower` | Scenery | `size`, `color` |

Colours: `orange`, `teal`, `coral`, `green`, `blue`, `navy`, `purple`, `yellow`, `pink`, `red`, `cream`, `brown`, `tan`, `grey`, `white`, `black`, or any CSS colour.

## Actions

Characters are robots and people. Places (`to`, `at`) are an id or `[x, z]`.

| Action | Does |
|---|---|
| `{ walk: 'pip', to: 'home', face: 'camera' }` | Turns and walks next to a thing (or to a point), then optionally turns to face something |
| `{ carry: 'git', by: 'pip', to: 'zsh' }` | Walks to the thing, picks it up, carries it and puts it down. `to` a block, parcel or server stacks it on top; `to` anything else puts it down beside that (`side: 'left' | 'right' | 'front' | 'back'`); `to: [x, z]` puts it there. |
| `{ carry: 'git', by: 'pip', into: 'home' }` | Carries it to the door and it disappears inside. `into` a cloud: lifted up into it. |
| `{ pick: 'git', by: 'pip' }` / `{ place: 'git', on: 'zsh' }` | The two halves of a carry, for narrating each |
| `{ move: 'parcel', to: 'server' }` / `{ move: 'parcel', into: 'cloud' }` | A prop flies or slides on its own (`arc` sets the height of the hop) |
| `{ turn: 'pip', to: 'camera' }` | Turns the whole body |
| `{ look: 'pip', at: 'home' }` | Turns the head; stays until they walk |
| `{ wave: 'pip' }`, `{ cheer: 'pip' }`, `{ nod: 'pip' }`, `{ shake: 'pip' }`, `{ shrug: 'pip' }`, `{ think: 'pip' }` | Gestures that settle back (cheer is both arms up and a bounce; think is hand to chin) |
| `{ point: 'pip', at: 'server' }` | Turns towards it and points |
| `{ hop: 'pip', times: 2 }` | Little jumps with a squash on landing |
| `{ bubble: 'pip', text: 'Hello!' }` | A speech bubble above them until the end of the step (and at least 2.5 s), on the clearer side (`side: 'left' | 'right'` to choose; `keep: true` to keep it; `text: ''` to clear). Put it first in a step so it shows while the line is spoken. |
| `{ appear: 'cloud' }` / `{ vanish: 'pip' }` | Pops in (for things declared `hidden: true`) or squashes away |
| `{ glow: 'home' }` / `{ dim: 'home' }` | Lights windows, server lights, the laptop screen or the robot's lamps |
| `{ smoke: 'home' }` | Puffs from the chimney |
| `{ spin: 'parcel', turns: 1 }` | Spins in place |
| `{ wait: 1 }` | A pause, weighted like an action |

## The camera

`camera` on a step (or inside `clay: { camera }`) picks the shot. It eases from the last shot over the step's first second or so, then holds.

| `camera` | Shot |
|---|---|
| `'wide'` (default) | Everything, framed where it is at the start and end of the step, so the shot holds still while things move |
| `'pip'` | A close-up that follows pip |
| `['pip', 'home']` | Frames both, following them |
| `{ on: 'pip', zoom: 1.3, yaw: -15, pitch: 8 }` | Closer or wider (`zoom`), from the side (`yaw`, degrees), higher or lower (`pitch`) |

Without `camera`, a wide shot reframes each step to fit what happens in it; a close-up stays on its subjects.

## Spec options

```js
clay: {
  set: 'meadow',     // or { name, color, sky, ground, decor }
  things: [ … ],
  camera: 'wide',    // the opening shot
  fps: 24,           // poses a second: 24 is smooth; 12 ("on twos") is the classic, jerkier stop-motion look
  boil: 0.5,         // how much things shimmer between poses: 0 is still, 1 is handmade, 2 is rough
  dof: 1,            // depth of field: 0 is all sharp, 1 is a gentle miniature look, 2 is very shallow
}
```

## Preview before recording

```bash
node scripts/narrate.mjs demos/<name>.demo.mjs --stills
```

Voices the lines (cached), lays the clay steps end to end at their real lengths, and renders a still at the end of each into `<name>.stills/` with a contact sheet. It takes seconds and records nothing: use it to fix layout, framing and actions before a draft. It also lists **rushed** moves: walks and carries that get much less time than they need (about 1.7 m a second, plus half a second to pick up or put down). Lengthen the line, drop an action, or move things closer.

`NARRATED_DEMO_DEBUG_CLAY=1` with `--stills` also prints the camera and every thing's position at each still: useful when something is out of shot.

## Writing for clay

- **One character, one goal.** "Pip carries the tools home" beats a crowd. Two characters are fine for a hand-over or a conversation.
- **Act what you say.** If the line says "carries the config to the server", that is what moves. Name things on screen as the narration does.
- **Labels carry meaning:** `block: 'zsh'`, `server: 'api'`, `cloud` with `label: 'Azure'`. Keep them to one or two words.
- **Close-up for feelings, wide for journeys.** Open on a close-up to meet the character; go wide when they travel; frame two things when they meet.
- **Finish with a payoff:** lights on, a cheer, a hop, a bubble.
- **Pace:** 1–3 actions a step. A carry across the set needs about 4 seconds of line.

## Limits

- Characters are simple: no fingers, no lip sync, no sitting or climbing. Carrying is one thing at a time, held in front.
- Things stack on blocks, parcels and servers only. Carrying or moving a thing leaves anything stacked on it behind: take stacks apart from the top.
- Rendering uses the GPU when headless Chrome has one (about 2× real time at 1080p) and software WebGL otherwise (many times slower).

## Review

- The characters and things the line names are in shot and not hidden behind others or the captions.
- Walks end where they should: nothing floats or sinks into the ground.
- Bubbles and labels are readable.
