// All four scenes in one video: clay, chalkboard, code and a web app. Self-contained: the code and
// the app are the storyboard page beside this file. From any scratch folder:
//
//   node <skill-dir>/scripts/narrate.mjs <skill-dir>/examples/all-scenes.demo.mjs --draft --out ./narrated-examples
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  name: 'all-scenes',
  url: new URL('./app/index.html', import.meta.url).href,
  transition: 'fade',
  intro: { title: 'Four kinds of scene', subtitle: 'Clay, chalk, code and web, in one narrated video' },
  outro: { title: 'Mix and match', subtitle: 'One spec, one narrator, four scenes' },
  code: { root: here },
  clay: {
    set: 'meadow',
    things: [
      { robot: 'pip', at: [-0.7, 1.1] },
      { block: 'web', at: [-2.5, 0.6], color: 'blue', hidden: true },
      { block: 'code', on: 'web', color: 'purple', hidden: true },
      { block: 'chalk', at: [-1.8, 1.5], color: 'green', hidden: true },
      { block: 'clay', on: 'chalk', color: 'coral', hidden: true },
      { house: 'studio', at: [2.0, -0.4], sign: 'video.mp4' },
    ],
  },
  steps: [
    // Clay: a story. Things appear, Pip carries one into the studio, and the lights come on.
    { chapter: 'story', say: 'Every video here is built from four kinds of scene.', camera: 'wide',
      clay: [{ appear: 'web' }, { appear: 'code' }, { appear: 'chalk' }, { appear: 'clay' }, { look: 'pip', at: 'clay' }] },
    { say: 'Pip, the director, picks up the clay block and carries it into the studio.', clay: [{ carry: 'clay', by: 'pip', into: 'studio' }] },
    { say: 'And the lights come on.', clay: [{ glow: 'studio' }, { turn: 'pip', to: 'camera', with: true }, { cheer: 'pip' }, { smoke: 'studio', with: true }] },

    // Chalkboard: the structure.
    { chapter: 'idea', say: 'A spec lists the steps. Capture records each one, and compose adds the voice.', draw: [
      { box: 'spec', id: 'spec', at: [330, 420] },
      { arrow: ['spec', 'capture'] },
      { box: 'capture', id: 'capture', at: [800, 420] },
      { arrow: ['capture', 'compose'] },
      { box: 'compose', id: 'compose', at: [1270, 420] },
    ] },
    { say: 'The result is one video, with captions.', draw: [{ note: 'video.mp4 + captions', at: [1270, 560] }, { underline: 'compose' }] },

    // Code: real lines, highlighted as they are explained.
    { chapter: 'code', say: 'Here is the storyboard page. Clicking Render runs this handler.', code: 'app/index.html:38-42' },
    { say: 'It shows a status message when the video is ready.', code: { lines: [41, 41], note: 'the message' } },

    // App: the same page, clicked for real.
    { chapter: 'app', say: 'And here is that page, running in a browser.', async do(d) { await d.moveTo('#render'); } },
    { say: 'One click on Render, and the video is ready.', async do(d) { await d.click('#render'); await d.wait(900); } },
    { say: 'That is every kind of scene.', annotate: [{ circle: '#status' }] },
  ],
};
